//! Sessions, agent turns, knowledge graph, student memory and learner profile.

use super::{err, CmdResult};
use crate::agent::AgentEvent;
use crate::graph::{GraphSummary, GraphView, Source};
use crate::session::{Session, SessionSummary};
use crate::tools::LearnerInput;
use crate::{agent, extract, learner, memdb, memory, research, session, student, tools, usage, AppState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Manager, State};

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Vec<SessionSummary> {
    state.sessions.list()
}

#[tauri::command]
pub fn create_session(state: State<'_, AppState>, goal: String) -> CmdResult<Session> {
    let goal = goal.trim();
    if goal.is_empty() {
        return Err("Escribí qué querés entender.".into());
    }
    let mut s = Session::new(goal);
    state.sessions.save(&mut s).map_err(err)?;
    Ok(s)
}

/// A conversation with no goal yet (AC-89): whatever the person writes, the
/// agent decides what to do with it, including when to start the method.
#[tauri::command]
pub fn start_chat(state: State<'_, AppState>, message: String) -> CmdResult<Session> {
    if message.trim().is_empty() {
        return Err("Escribí un mensaje para empezar.".into());
    }
    if message.chars().count() > 8000 {
        return Err("Es un mensaje muy largo: probá contarlo en partes.".into());
    }
    let mut s = Session::new_chat(&message);
    state.sessions.save(&mut s).map_err(err)?;
    state.activity.touch("chat");
    Ok(s)
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    state.sessions.load(&id).map_err(err)
}

/// AC-107: deleting a conversation keeps what was learned in it, unless the
/// person asks to forget that too (its ideas in the graph, its confusions and preferences).
#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String, forget: Option<bool>) -> CmdResult<()> {
    if forget.unwrap_or(false) {
        if let Ok(s) = state.sessions.load(&id) {
            if s.graph.is_some() {
                let _ = state.graph.forget(Source::Session { id: s.id.clone(), title: s.title.clone() });
            }
            let label = format!("Sesión: {}", s.title);
            let _ = state.memdb.forget_source(&Source::Session { id: s.id.clone(), title: s.title.clone() }.key(), Some(&label), None);
            let _ = state.learner.update(|p| {
                p.misconceptions.retain(|m| m.source != label);
                p.preferences.retain(|x| x.source != label);
            });
        }
    }
    // Its memory (summary, pending, what was hard) lived in the session file: it goes with it.
    let _ = state.memdb.forget_session(&id);
    state.sessions.delete(&id).map_err(err)
}

/// AC-107: rename, pin, archive. None of these counts as activity.
#[tauri::command]
pub fn update_session_meta(state: State<'_, AppState>, id: String, title: Option<String>, pinned: Option<bool>, archived: Option<bool>) -> CmdResult<session::SessionSummary> {
    let mut s = state.sessions.load(&id).map_err(err)?;
    if let Some(t) = title {
        let t: String = t.trim().chars().take(80).collect();
        if t.is_empty() {
            return Err("El nombre no puede quedar vacío.".into());
        }
        s.title = t;
    }
    if let Some(p) = pinned {
        s.pinned = p;
        if p {
            s.archived = false;
        }
    }
    if let Some(a) = archived {
        s.archived = a;
        if a {
            s.pinned = false;
        }
    }
    state.sessions.save_quiet(&s).map_err(err)?;
    Ok(s.summary())
}

/// AC-110: "Lo que Eureka recuerda": every session's memory, newest first.
#[derive(serde::Serialize)]
pub struct RememberedSession {
    pub id: String,
    pub title: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub archived: bool,
    pub memory: memory::SessionMemory,
}

#[tauri::command]
pub fn session_memories(state: State<'_, AppState>) -> Vec<RememberedSession> {
    let mut out: Vec<RememberedSession> = state
        .sessions
        .all()
        .into_iter()
        .filter_map(|s| s.memory.filter(|m| !m.summary.is_empty()).map(|memory| RememberedSession { id: s.id, title: s.title, updated_at: s.updated_at, archived: s.archived, memory }))
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// Forgets one session's memory; it comes back only if the conversation continues.
#[tauri::command]
pub fn forget_session_memory(state: State<'_, AppState>, id: String) -> CmdResult<Vec<RememberedSession>> {
    let mut s = state.sessions.load(&id).map_err(err)?;
    // An empty memory that has "seen" these messages: the background pass won't rebuild it from them.
    s.memory = Some(memory::SessionMemory::forgotten(s.messages.len()));
    state.sessions.save_quiet(&s).map_err(err)?;
    state.memdb.forget_session(&id).map_err(err)?;
    Ok(session_memories(state))
}

// ── Modelo del estudiante (AC-111..113) ──

#[tauri::command]
pub fn student_model(state: State<'_, AppState>) -> student::StudentModel {
    student::model(&state, chrono::Local::now().date_naive())
}

#[tauri::command]
pub fn student_today(state: State<'_, AppState>) -> Vec<student::Suggestion> {
    student::today(&student::model(&state, chrono::Local::now().date_naive()))
}

/// "Esto ya lo sé": repairs the confusion behind a topic and returns the new model.
#[tauri::command]
pub fn student_mark_known(state: State<'_, AppState>, name: String) -> CmdResult<student::StudentModel> {
    student::mark_known(&state, &name).map_err(err)?;
    Ok(student::model(&state, chrono::Local::now().date_naive()))
}

/// AC-108: folds a session into memory now (the screen asks when a session ends).
#[tauri::command]
pub async fn remember_session_now(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    memory::consolidate(&state, &id).await.map_err(err)?;
    state.sessions.load(&id).map_err(err)
}

/// Forgets one source of the graph (a session or imported notes).
#[tauri::command]
pub fn forget_source(state: State<'_, AppState>, source: Source) -> CmdResult<GraphView> {
    state.memdb.forget_source(&source.key(), None, Some(&[memdb::Kind::Idea])).map_err(err)?;
    state.graph.forget(source).map_err(err)?;
    Ok(state.graph.view())
}

// ── Learner profile (audit M5, M10) ──

#[tauri::command]
pub fn get_learner(state: State<'_, AppState>) -> learner::Profile {
    state.learner.load()
}

/// kind: "misconception" | "preference" | "all".
#[tauri::command]
pub fn forget_learner(state: State<'_, AppState>, kind: String, index: usize) -> CmdResult<learner::Profile> {
    state
        .learner
        .update(|p| {
            match kind.as_str() {
                "misconception" if index < p.misconceptions.len() => {
                    let m = p.misconceptions.remove(index);
                    let _ = state.memdb.forget_topic(memdb::Kind::Confusion, &m.concept);
                }
                "preference" if index < p.preferences.len() => {
                    let x = p.preferences.remove(index);
                    let _ = state.memdb.forget_topic(memdb::Kind::Preferencia, &x.text);
                }
                "all" => {
                    p.misconceptions.iter().for_each(|m| drop(state.memdb.forget_topic(memdb::Kind::Confusion, &m.concept)));
                    p.preferences.iter().for_each(|x| drop(state.memdb.forget_topic(memdb::Kind::Preferencia, &x.text)));
                    *p = learner::Profile::default()
                }
                _ => {}
            }
            p.clone()
        })
        .map_err(err)
}

// ── Lo que Eureka sabe de vos (AC-199, AC-200) ──

#[tauri::command]
pub fn memory_list(state: State<'_, AppState>) -> CmdResult<Vec<memdb::Observation>> {
    state.memdb.list().map_err(err)
}

/// The student corrects an observation: it becomes verified and theirs.
#[tauri::command]
pub fn memory_edit(state: State<'_, AppState>, id: i64, title: String, content: String, kind: String) -> CmdResult<Vec<memdb::Observation>> {
    let kind = memdb::Kind::parse(&kind).ok_or("Ese tipo no existe.")?;
    // A confusion (or preference) turned into another kind is the student's now: its old profile entry goes.
    if let Some(o) = state.memdb.get(id).map_err(err)?.filter(|o| o.kind != kind) {
        let _ = state.learner.update(|p| memdb::strip_from_profile(p, o.kind, &o.topic));
    }
    state.memdb.edit(id, &title, &content, kind).map_err(err)?;
    state.memdb.list().map_err(err)
}

/// Deletes one observation, also from the old profile so nothing brings it back.
#[tauri::command]
pub fn memory_delete(state: State<'_, AppState>, id: i64) -> CmdResult<Vec<memdb::Observation>> {
    if let Some(o) = state.memdb.get(id).map_err(err)? {
        let _ = state.learner.update(|p| memdb::strip_from_profile(p, o.kind, &o.topic));
    }
    state.memdb.delete(id).map_err(err)?;
    state.memdb.list().map_err(err)
}

/// "Olvidar todo" of what Eureka knows about the person (the graph is forgotten from Grafo).
#[tauri::command]
pub fn memory_forget_all(state: State<'_, AppState>) -> CmdResult<Vec<memdb::Observation>> {
    state.memdb.forget_all().map_err(err)?;
    state.learner.update(|p| *p = learner::Profile::default()).map_err(err)?;
    state.memdb.list().map_err(err)
}

/// AC-200: Markdown pages with frontmatter and links, in a folder of Downloads (an Obsidian vault).
#[tauri::command]
pub fn memory_export(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let base = app.path().download_dir().map_err(err)?;
    let name = format!("Eureka - lo que sabe de vos {}", chrono::Local::now().format("%Y-%m-%d"));
    let mut dir = base.join(&name);
    let mut n = 2;
    while dir.exists() {
        dir = base.join(format!("{name} ({n})"));
        n += 1;
    }
    state.memdb.export_okf(&dir).map_err(err)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Adds the learner's input (if any) and runs one agent turn, streaming
/// events through `on_event`. With `input: null` it just runs (kickoff/retry).
#[tauri::command]
pub async fn send_message(
    state: State<'_, AppState>,
    id: String,
    input: Option<LearnerInput>,
    ui: Option<String>,
    on_event: Channel<AgentEvent>,
) -> CmdResult<()> {
    if let Some(ui) = ui {
        state.set_ui_snapshot(&ui);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = state.running.lock().unwrap_or_else(|p| p.into_inner());
        if running.contains_key(&id) {
            return Err("El agente ya está respondiendo en esta sesión.".into());
        }
        running.insert(id.clone(), cancel.clone());
    }
    let result = async {
        if let Some(input) = input.filter(|i| !i.text.trim().is_empty()) {
            state.activity.touch("chat");
            let mut s = state.sessions.load(&id)?;
            tools::add_learner_input(&mut s, input);
            state.sessions.save(&mut s)?;
            let _ = on_event.send(AgentEvent::Session { session: Box::new(s) });
        }
        // AC-186: calls made inside the turn (summary, research) count for this session.
        usage::in_session(&id, agent::run_turn(&state, &id, &on_event, cancel)).await
    }
    .await;
    state.running.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
    // AC-169: research that arrived during the last step of this turn.
    let _ = agent::deliver_research(&state, &id, false);
    if let Err(e) = &result {
        let _ = on_event.send(AgentEvent::Error { message: e.to_string() });
    }
    let _ = on_event.send(AgentEvent::Done);
    result.map_err(err)
}

#[tauri::command]
pub fn stop_agent(state: State<'_, AppState>, id: String) {
    if let Some(flag) = state.running.lock().unwrap_or_else(|p| p.into_inner()).get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn get_graph(state: State<'_, AppState>) -> GraphView {
    state.graph.view()
}

/// AC-17: extracts a session into the graph (re-running replaces its contribution).
#[tauri::command]
pub async fn extract_session(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    let s = state.sessions.load(&id).map_err(err)?;
    let source = Source::Session { id: s.id.clone(), title: s.title.clone() };
    let messages = s.messages.len();
    let (_, propositions, chains) = extract::extract(&state, source, extract::session_transcript(&s)).await.map_err(err)?;
    // Reload: the learner may have kept chatting while the extractor ran.
    let mut s = state.sessions.load(&id).map_err(err)?;
    s.graph = Some(GraphSummary { propositions, chains, at: chrono::Utc::now(), messages });
    state.sessions.save(&mut s).map_err(err)?;
    Ok(s)
}

/// AC-21: imports pasted notes as a graph source.
#[tauri::command]
pub async fn import_notes(state: State<'_, AppState>, title: String, text: String) -> CmdResult<GraphView> {
    let (title, text) = (title.trim().to_string(), text.trim().to_string());
    if title.is_empty() || text.is_empty() {
        return Err("Poné un título y pegá el texto de las notas.".into());
    }
    let source = Source::Notes { id: uuid::Uuid::new_v4().simple().to_string(), title: title.clone() };
    let input = format!("# Notas del aprendiz: {title}\n\n{text}");
    extract::extract(&state, source, input).await.map(|(view, _, _)| view).map_err(err)
}

/// AC-206: an open PDF the research found, downloaded when the learner taps «Sumar a mi
/// biblioteca»; the frontend reads it like a dropped file (with OCR if it is scanned).
#[tauri::command]
pub async fn fetch_document(url: String) -> CmdResult<tauri::ipc::Response> {
    research::download_pdf(&url).await.map(tauri::ipc::Response::new).map_err(err)
}
