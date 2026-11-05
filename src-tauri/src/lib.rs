mod accounts;
mod activity;
mod anki;
mod career;
mod setup;
mod share;
mod sql;
mod classes;
mod agent;
mod backup;
mod cards;
mod context;
mod exam;
mod extract;
mod graph;
mod practice;
mod project;
mod research;
mod runner;
mod language;
mod learner;
mod academic;
mod local_speech;
mod ocr;
mod memdb;
mod memory;
mod oauth;
mod student;
mod companion;
mod library;
mod office;
mod llm;
mod prompts;
mod session;
mod settings;
mod study;
mod tools;
mod update;
mod usage;
mod vision;

use agent::AgentEvent;
use cards::{Deck, DeckStore, DeckSummary};
use exam::{Exam, ExamStore, ExamSummary};
use graph::{GraphStore, GraphSummary, GraphView, Source};
use practice::{PracticeSet, PracticeStore, PracticeSummary};
use prompts::{PromptView, Prompts};
use session::{Session, SessionStore, SessionSummary};
use settings::{SettingsInput, SettingsStore, SettingsView};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tools::LearnerInput;

pub struct AppState {
    pub sessions: SessionStore,
    pub settings: SettingsStore,
    /// Subscription accounts (ChatGPT Plus/Pro); tokens never live in auth.json.
    pub accounts: accounts::AccountsStore,
    pub prompts: Prompts,
    pub graph: GraphStore,
    pub practice: PracticeStore,
    pub exams: ExamStore,
    pub decks: DeckStore,
    pub study: study::StudyLog,
    /// AC-141: days with study, for the kind streak.
    pub activity: activity::ActivityLog,
    pub classes: classes::ClassStore,
    pub projects: project::ProjectStore,
    pub learner: learner::LearnerStore,
    /// AC-195: the student's memory (observations with stable topics), opened on first use.
    pub memdb: memdb::MemoryDb,
    pub library: library::LibraryStore,
    /// Mi cursada: terms, courses, class slots and the dates that matter.
    pub academic: academic::AcademicStore,
    /// AC-155: the plan of studies (malla), its correlativas and grades.
    pub career: career::CareerStore,
    /// The journal and listening mode: private, apart from everything the teacher reads.
    pub companion: companion::CompanionStore,
    pub data_dir: PathBuf,
    /// Where code runs get their (temporary) folders.
    pub runs_dir: PathBuf,
    /// Toolchains found on this PC (detected once, on demand).
    runtimes: tokio::sync::Mutex<Option<Vec<runner::Runtime>>>,
    /// Cancel flags of sessions with a turn in progress.
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// The local speech model (Parakeet or Whisper), loaded on the first dictation and kept for the next ones.
    local_speech: Arc<Mutex<Option<local_speech::Engine>>>,
    /// AC-187: the OCR sessions, created on the first scanned page and kept.
    ocr: Arc<Mutex<Option<ocr::Engine>>>,
    /// What the screen last said it is doing (pomodoro, theme, reminders…): lives only in memory.
    ui: Mutex<String>,
    /// AC-154: a `.eureka` Eureka was opened with, until the screen asks for it.
    opened: Mutex<Option<PathBuf>>,
    /// AC-169: research running in the background.
    pub research: research::Background,
    /// AC-186: what each model call spent, only on this PC.
    pub usage: Arc<usage::UsageLog>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            sessions: SessionStore::new(&data_dir),
            settings: SettingsStore::new(&data_dir),
            accounts: accounts::AccountsStore::new(&data_dir),
            prompts: Prompts::new(&data_dir),
            graph: GraphStore::new(&data_dir),
            practice: PracticeStore::new(&data_dir),
            exams: ExamStore::new(&data_dir),
            decks: DeckStore::new(&data_dir),
            study: study::StudyLog::new(&data_dir),
            activity: activity::ActivityLog::new(&data_dir),
            classes: classes::ClassStore::new(&data_dir),
            projects: project::ProjectStore::new(&data_dir),
            learner: learner::LearnerStore::new(&data_dir),
            memdb: memdb::MemoryDb::new(&data_dir),
            library: library::LibraryStore::new(&data_dir),
            academic: academic::AcademicStore::new(&data_dir),
            career: career::CareerStore::new(&data_dir),
            companion: companion::CompanionStore::new(&data_dir),
            runs_dir: data_dir.join("runs"),
            data_dir: data_dir.clone(),
            runtimes: tokio::sync::Mutex::new(None),
            running: Mutex::new(HashMap::new()),
            local_speech: Arc::new(Mutex::new(None)),
            ocr: Arc::new(Mutex::new(None)),
            ui: Mutex::new(String::new()),
            opened: Mutex::new(None),
            research: research::Background::default(),
            usage: Arc::new(usage::UsageLog::new(&data_dir)),
        }
    }

    pub fn ui_snapshot(&self) -> String {
        self.ui.lock().unwrap().clone()
    }

    pub fn set_ui_snapshot(&self, s: &str) {
        // A few short lines, never the whole screen: it goes in every prompt.
        *self.ui.lock().unwrap() = s.trim().chars().take(1200).collect();
    }
}

impl AppState {
    /// A turn of this session is in progress (the memory pass waits for it).
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id)
    }
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> SettingsView {
    state.settings.view()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, input: SettingsInput) -> CmdResult<SettingsView> {
    state.settings.save(input).map_err(err)?;
    Ok(state.settings.view())
}

// ── Acompañamiento (AC-82..88) ──

#[tauri::command]
fn companion_state(state: State<'_, AppState>) -> companion::View {
    state.companion.view()
}

#[tauri::command]
fn companion_ack_privacy(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.ack_privacy().map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
async fn companion_send(state: State<'_, AppState>, text: String) -> CmdResult<companion::View> {
    companion::send(&state, &text).await.map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_new_conversation(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.new_conversation().map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
async fn companion_propose_entry(state: State<'_, AppState>) -> CmdResult<companion::EntryInput> {
    companion::propose_entry(&state).await.map_err(err)
}

#[tauri::command]
fn companion_save_entry(state: State<'_, AppState>, input: companion::EntryInput) -> CmdResult<companion::View> {
    state.companion.save_entry(input).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_delete_entry(state: State<'_, AppState>, id: String) -> CmdResult<companion::View> {
    state.companion.delete_entry(&id).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_checkin(state: State<'_, AppState>, mood: u8, emotions: Vec<String>, note: String) -> CmdResult<companion::View> {
    state.companion.add_checkin(mood, &emotions, &note).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_set_insight(state: State<'_, AppState>, key: String, verdict: Option<String>) -> CmdResult<companion::View> {
    state.companion.set_insight(&key, verdict.as_deref()).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_unlock(state: State<'_, AppState>, pin: String) -> CmdResult<companion::View> {
    state.companion.unlock(&pin).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_lock(state: State<'_, AppState>) -> companion::View {
    state.companion.lock_now();
    state.companion.view()
}

#[tauri::command]
fn companion_set_pin(state: State<'_, AppState>, new_pin: Option<String>, current: Option<String>) -> CmdResult<companion::View> {
    state.companion.set_pin(new_pin.as_deref(), current.as_deref()).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_save_resources(state: State<'_, AppState>, resources: Vec<companion::Resource>) -> CmdResult<companion::View> {
    state.companion.set_resources(resources).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
fn companion_export(state: State<'_, AppState>) -> CmdResult<String> {
    state.companion.export().map_err(err)
}

#[tauri::command]
fn companion_erase(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.erase().map_err(err)?;
    Ok(state.companion.view())
}

// ── Mi cursada (AC-99…) ──

#[tauri::command]
fn academic_state(state: State<'_, AppState>) -> academic::Data {
    state.academic.data()
}

#[tauri::command]
fn academic_save_term(state: State<'_, AppState>, input: academic::TermInput) -> CmdResult<academic::Data> {
    state.academic.save_term(input).map_err(err)
}

#[tauri::command]
fn academic_delete_term(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_term(&id).map_err(err)
}

/// AC-150: each linked route takes its course's next exam date (keeping
/// the rest of its goal). Called after anything that changes dates or links.
fn sync_routes(state: &AppState, d: academic::Data) -> academic::Data {
    for (exam_id, next) in academic::route_targets(&d, &activity::today()) {
        let Ok(e) = state.exams.load(&exam_id) else { continue };
        if e.goal.exam_date != next {
            let _ = exam::set_goal(state, &exam_id, exam::ExamGoal { exam_date: next, ..e.goal });
        }
    }
    d
}

/// AC-150
#[tauri::command]
fn academic_link_route(state: State<'_, AppState>, course_id: String, exam_id: Option<String>) -> CmdResult<academic::Data> {
    let d = state.academic.link_route(&course_id, exam_id).map_err(err)?;
    Ok(sync_routes(&state, d))
}

/// AC-145
#[tauri::command]
fn academic_add_breaks(state: State<'_, AppState>, term_id: String, items: Vec<academic::BreakInput>) -> CmdResult<academic::Data> {
    state.academic.add_breaks(&term_id, items).map_err(err)
}

/// AC-145
#[tauri::command]
fn academic_delete_break(state: State<'_, AppState>, term_id: String, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_break(&term_id, &id).map_err(err)
}

#[tauri::command]
fn academic_set_active(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.set_active(&id).map_err(err)
}

#[tauri::command]
fn academic_save_course(state: State<'_, AppState>, input: academic::CourseInput) -> CmdResult<academic::Data> {
    state.academic.save_course(input).map_err(err)
}

#[tauri::command]
fn academic_delete_course(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_course(&id).map_err(err)
}

#[tauri::command]
fn academic_save_date(state: State<'_, AppState>, input: academic::DateInput) -> CmdResult<academic::Data> {
    let d = state.academic.save_date(input).map_err(err)?;
    Ok(sync_routes(&state, d))
}

#[tauri::command]
fn academic_delete_date(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    let d = state.academic.delete_date(&id).map_err(err)?;
    Ok(sync_routes(&state, d))
}

#[derive(serde::Serialize)]
struct ImportResult {
    data: academic::Data,
    report: academic::ImportReport,
}

/// Applies a proposal the learner confirmed (from the chat or from "Importar horario").
#[tauri::command]
fn academic_import(state: State<'_, AppState>, proposal: academic::Proposal) -> CmdResult<ImportResult> {
    let (data, report) = state.academic.import(proposal).map_err(err)?;
    Ok(ImportResult { data: sync_routes(&state, data), report })
}

// ── La malla de la carrera (AC-155…AC-157) ──

fn career_view(state: &AppState) -> Option<career::CareerView> {
    state.career.get().map(|c| career::view(&c, &career::cursada_keys(&state.academic.data())))
}

#[tauri::command]
fn career_get(state: State<'_, AppState>) -> Option<career::CareerView> {
    career_view(&state)
}

/// Reads a pasted (or transcribed) plan of studies into a proposal. Not saved:
/// the person reviews it first.
#[tauri::command]
async fn career_parse(state: State<'_, AppState>, text: String) -> CmdResult<career::Proposal> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Pegá el plan de estudios de tu carrera.".into());
    }
    if text.chars().count() > 40_000 {
        return Err("Es mucho texto: pegá solo el plan de estudios (las materias y sus correlativas).".into());
    }
    let input = format!("Texto de la persona:\n{text}");
    match practice::forced_valid(&state, agent::Role::Practice, "career_parse", career::parse_tool(), career::TOOL, input, career::parse_proposal).await {
        Err(e) if e.to_string().contains("no tiene materias") => Err("No encontré materias en ese texto. Probá pegar el plan tal cual lo publica tu facultad.".into()),
        r => r.map_err(err),
    }
}

/// AC-155: saves the confirmed plan; what was already marked stays.
#[tauri::command]
fn career_save_plan(state: State<'_, AppState>, proposal: career::Proposal) -> CmdResult<Option<career::CareerView>> {
    state.career.set_plan(proposal).map_err(err)?;
    Ok(career_view(&state))
}

/// AC-156: a subject's status, grade, aplazos and correlativas (or a new one).
#[tauri::command]
fn career_save_subject(state: State<'_, AppState>, input: career::SubjectInput) -> CmdResult<Option<career::CareerView>> {
    state.career.update(|c| career::save_subject(c, input)).map_err(err)?;
    Ok(career_view(&state))
}

#[tauri::command]
fn career_delete_subject(state: State<'_, AppState>, id: String) -> CmdResult<Option<career::CareerView>> {
    state.career.update(|c| career::delete_subject(c, &id)).map_err(err)?;
    Ok(career_view(&state))
}

#[tauri::command]
fn career_delete(state: State<'_, AppState>) -> CmdResult<()> {
    state.career.delete().map_err(err)
}

/// Reads a pasted timetable or list of dates into a proposal. It is NOT saved:
/// the learner reviews it first.
#[tauri::command]
async fn academic_parse(state: State<'_, AppState>, text: String) -> CmdResult<academic::Proposal> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Pegá tu horario o tus fechas.".into());
    }
    if text.chars().count() > 20_000 {
        return Err("Es mucho texto: pegá un período por vez.".into());
    }
    let input = format!("Hoy es {}.\n\nTexto de la persona:\n{text}", chrono::Local::now().date_naive());
    match practice::forced_valid(&state, agent::Role::Practice, "academic_parse", academic::parse_tool(), academic::TOOL, input, academic::parse_proposal).await {
        // The model found nothing: say so plainly, not with the text meant for the model.
        Err(e) if e.to_string().contains("vacía") => Err("No encontré horarios ni fechas en ese texto. Probá pegarlo tal cual te lo pasaron.".into()),
        r => r.map_err(err),
    }
}

#[tauri::command]
fn get_identity(state: State<'_, AppState>) -> settings::Identity {
    state.settings.load().identity
}

#[tauri::command]
fn save_identity(state: State<'_, AppState>, input: settings::Identity) -> CmdResult<settings::Identity> {
    state.settings.save_identity(input).map_err(err)
}

#[tauri::command]
fn get_accessibility(state: State<'_, AppState>) -> settings::Accessibility {
    state.settings.load().accessibility
}

#[tauri::command]
fn save_accessibility(state: State<'_, AppState>, input: settings::Accessibility) -> CmdResult<settings::Accessibility> {
    state.settings.save_accessibility(input).map_err(err)
}

#[tauri::command]
async fn list_models(state: State<'_, AppState>, provider_id: String) -> CmdResult<Vec<String>> {
    let settings = state.settings.load();
    let p = settings.providers.iter().find(|p| p.id == provider_id).ok_or("proveedor desconocido")?;
    let key = state.settings.keys().get(&provider_id).cloned().ok_or("falta la API key")?;
    llm::list_models(&p.base_url, &key).await.map_err(err)
}

/// AC-158/159: a pasted key becomes a working setup (or a question: which service).
#[tauri::command]
async fn quick_setup(state: State<'_, AppState>, key: String, provider: Option<String>) -> CmdResult<setup::Outcome> {
    setup::run(&state, &key, provider.as_deref()).await.map_err(err)
}

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Vec<SessionSummary> {
    state.sessions.list()
}

#[tauri::command]
fn create_session(state: State<'_, AppState>, goal: String) -> CmdResult<Session> {
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
fn start_chat(state: State<'_, AppState>, message: String) -> CmdResult<Session> {
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
fn get_session(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    state.sessions.load(&id).map_err(err)
}

/// AC-107: deleting a conversation keeps what was learned in it, unless the
/// person asks to forget that too (its ideas in the graph, its confusions and preferences).
#[tauri::command]
fn delete_session(state: State<'_, AppState>, id: String, forget: Option<bool>) -> CmdResult<()> {
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
fn update_session_meta(state: State<'_, AppState>, id: String, title: Option<String>, pinned: Option<bool>, archived: Option<bool>) -> CmdResult<session::SessionSummary> {
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
struct RememberedSession {
    id: String,
    title: String,
    updated_at: chrono::DateTime<chrono::Utc>,
    archived: bool,
    memory: memory::SessionMemory,
}

#[tauri::command]
fn session_memories(state: State<'_, AppState>) -> Vec<RememberedSession> {
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
fn forget_session_memory(state: State<'_, AppState>, id: String) -> CmdResult<Vec<RememberedSession>> {
    let mut s = state.sessions.load(&id).map_err(err)?;
    // An empty memory that has "seen" these messages: the background pass won't rebuild it from them.
    s.memory = Some(memory::SessionMemory::forgotten(s.messages.len()));
    state.sessions.save_quiet(&s).map_err(err)?;
    state.memdb.forget_session(&id).map_err(err)?;
    Ok(session_memories(state))
}

// ── Modelo del estudiante (AC-111..113) ──

#[tauri::command]
fn student_model(state: State<'_, AppState>) -> student::StudentModel {
    student::model(&state, chrono::Local::now().date_naive())
}

#[tauri::command]
fn student_today(state: State<'_, AppState>) -> Vec<student::Suggestion> {
    student::today(&student::model(&state, chrono::Local::now().date_naive()))
}

/// "Esto ya lo sé": repairs the confusion behind a topic and returns the new model.
#[tauri::command]
fn student_mark_known(state: State<'_, AppState>, name: String) -> CmdResult<student::StudentModel> {
    student::mark_known(&state, &name).map_err(err)?;
    Ok(student::model(&state, chrono::Local::now().date_naive()))
}

/// AC-108: folds a session into memory now (the screen asks when a session ends).
#[tauri::command]
async fn remember_session_now(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
    memory::consolidate(&state, &id).await.map_err(err)?;
    state.sessions.load(&id).map_err(err)
}

/// Forgets one source of the graph (a session or imported notes).
#[tauri::command]
fn forget_source(state: State<'_, AppState>, source: Source) -> CmdResult<GraphView> {
    state.memdb.forget_source(&source.key(), None, Some(&[memdb::Kind::Idea])).map_err(err)?;
    state.graph.forget(source).map_err(err)?;
    Ok(state.graph.view())
}

// ── Learner profile (audit M5, M10) ──

#[tauri::command]
fn get_learner(state: State<'_, AppState>) -> learner::Profile {
    state.learner.load()
}

/// kind: "misconception" | "preference" | "all".
#[tauri::command]
fn forget_learner(state: State<'_, AppState>, kind: String, index: usize) -> CmdResult<learner::Profile> {
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
fn memory_list(state: State<'_, AppState>) -> CmdResult<Vec<memdb::Observation>> {
    state.memdb.list().map_err(err)
}

/// The student corrects an observation: it becomes verified and theirs.
#[tauri::command]
fn memory_edit(state: State<'_, AppState>, id: i64, title: String, content: String, kind: String) -> CmdResult<Vec<memdb::Observation>> {
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
fn memory_delete(state: State<'_, AppState>, id: i64) -> CmdResult<Vec<memdb::Observation>> {
    if let Some(o) = state.memdb.get(id).map_err(err)? {
        let _ = state.learner.update(|p| memdb::strip_from_profile(p, o.kind, &o.topic));
    }
    state.memdb.delete(id).map_err(err)?;
    state.memdb.list().map_err(err)
}

/// "Olvidar todo" of what Eureka knows about the person (the graph is forgotten from Grafo).
#[tauri::command]
fn memory_forget_all(state: State<'_, AppState>) -> CmdResult<Vec<memdb::Observation>> {
    state.memdb.forget_all().map_err(err)?;
    state.learner.update(|p| *p = learner::Profile::default()).map_err(err)?;
    state.memdb.list().map_err(err)
}

/// AC-200: Markdown pages with frontmatter and links, in a folder of Downloads (an Obsidian vault).
#[tauri::command]
fn memory_export(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
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
async fn send_message(
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
        let mut running = state.running.lock().unwrap();
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
    state.running.lock().unwrap().remove(&id);
    // AC-169: research that arrived during the last step of this turn.
    let _ = agent::deliver_research(&state, &id, false);
    if let Err(e) = &result {
        let _ = on_event.send(AgentEvent::Error { message: e.to_string() });
    }
    let _ = on_event.send(AgentEvent::Done);
    result.map_err(err)
}

#[tauri::command]
fn stop_agent(state: State<'_, AppState>, id: String) {
    if let Some(flag) = state.running.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn list_prompts(state: State<'_, AppState>) -> Vec<PromptView> {
    state.prompts.list()
}

#[tauri::command]
fn save_prompt(state: State<'_, AppState>, name: String, content: String) -> CmdResult<()> {
    state.prompts.save(&name, &content).map_err(err)
}

#[tauri::command]
fn reset_prompt(state: State<'_, AppState>, name: String) -> CmdResult<()> {
    state.prompts.reset(&name).map_err(err)
}

#[tauri::command]
fn get_graph(state: State<'_, AppState>) -> GraphView {
    state.graph.view()
}

/// AC-17: extracts a session into the graph (re-running replaces its contribution).
#[tauri::command]
async fn extract_session(state: State<'_, AppState>, id: String) -> CmdResult<Session> {
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
/// AC-69: a document already converted to Markdown on this PC (pdf.js / text).
#[tauri::command]
/// AC-187: `ocr`, the scanned pages already read on this PC and the ones still to read.
fn import_book(state: State<'_, AppState>, title: String, file_name: String, markdown: String, pages: u32, scanned: Vec<u32>, ocr: Option<OcrImport>) -> CmdResult<library::BookSummary> {
    let ocr = ocr.map(|o| (o.hash.to_ascii_lowercase(), o.pages, o.pending));
    state.library.import(&title, &file_name, &markdown, pages, scanned, ocr).map(|b| b.summary()).map_err(err)
}

/// AC-191: a Word, PowerPoint, EPUB or ODT file as raw bytes (see `office::parse_upload`),
/// converted to Markdown on this PC and imported like any other document.
#[tauri::command]
async fn import_document(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<library::BookSummary> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else { return Err("El archivo no llegó como bytes.".into()) };
    let (title, file_name, bytes) = office::parse_upload(body).map_err(err)?;
    let (name, bytes) = (file_name.clone(), bytes.to_vec());
    let markdown = tokio::task::spawn_blocking(move || office::to_markdown(&name, &bytes)).await.map_err(err)?.map_err(err)?;
    state.library.import(&title, &file_name, &markdown, 0, vec![], None).map(|b| b.summary()).map_err(err)
}

#[derive(serde::Deserialize)]
struct OcrImport {
    hash: String,
    pages: Vec<library::OcrPage>,
    pending: Vec<u32>,
}

// ── OCR local (AC-187, AC-188) ──

/// AC-187: the next OCR'd pages of a book being read in the background.
#[tauri::command]
fn add_ocr_pages(state: State<'_, AppState>, id: String, pages: Vec<library::OcrPage>, pending: Vec<u32>) -> CmdResult<library::BookSummary> {
    state.library.add_ocr_pages(&id, &pages, pending).map(|b| b.summary()).map_err(err)
}

/// Whether this build can read scans (desktop with its models; not the phone).
#[tauri::command]
fn ocr_available(app: tauri::AppHandle) -> bool {
    !cfg!(target_os = "android") && ocr::models_dir(app.path().resource_dir().ok()).is_some()
}

/// One page or photo, as raw bytes (no JSON: a page is ~18 MB): width, height and the
/// page number (0 for a photo, only for messages) as little-endian u32, then RGBA. The models load on the first page and stay loaded.
#[tauri::command]
async fn ocr_page(app: tauri::AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<ocr::PageText> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else { return Err("La imagen no llegó como bytes.".into()) };
    if body.len() < 12 {
        return Err("La imagen llegó vacía.".into());
    }
    let u32_at = |i: usize| u32::from_le_bytes(body[i..i + 4].try_into().unwrap());
    let (w, h, page) = (u32_at(0) as usize, u32_at(4) as usize, u32_at(8));
    let img = ocr::Image::from_rgba(w, h, &body[12..]).map_err(err)?;
    let what = if page == 0 { "la imagen".to_string() } else { format!("la página {page}") };
    let dir = ocr::models_dir(app.path().resource_dir().ok()).ok_or("Esta versión de Eureka no trae el lector de escaneos.")?;
    let engine = state.ocr.clone();
    // CPU-heavy: off the async runtime, one page at a time.
    tokio::task::spawn_blocking(move || {
        let mut slot = engine.lock().unwrap_or_else(|p| p.into_inner());
        if slot.is_none() {
            *slot = Some(ocr::Engine::load(&dir)?);
        }
        Ok::<_, anyhow::Error>(ocr::page_text(slot.as_mut().unwrap().read(img)?))
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("No pude leer {what}: {e}"))
}

/// Pages of a PDF already read (by its sha256): a reading continues where it stopped.
#[tauri::command]
fn ocr_cached(state: State<'_, AppState>, hash: String) -> CmdResult<std::collections::BTreeMap<u32, ocr::PageText>> {
    ocr::Cache::new(&state.data_dir).get(&hash).map_err(err)
}

#[tauri::command]
fn ocr_cache_put(state: State<'_, AppState>, hash: String, page: u32, text: ocr::PageText) -> CmdResult<()> {
    ocr::Cache::new(&state.data_dir).put(&hash, page, text).map_err(err)
}

#[tauri::command]
fn ocr_cache_clear(state: State<'_, AppState>, hash: String) -> CmdResult<()> {
    ocr::Cache::new(&state.data_dir).clear(&hash).map_err(err)
}

#[tauri::command]
fn list_books(state: State<'_, AppState>) -> Vec<library::BookSummary> {
    state.library.list()
}

#[tauri::command]
fn get_book(state: State<'_, AppState>, id: String) -> CmdResult<library::Book> {
    state.library.load(&id).map_err(err)
}

#[tauri::command]
fn delete_book(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.library.delete(&id).map_err(err)
}

/// AC-70: BM25 over every book, locally.
#[tauri::command]
fn search_library(state: State<'_, AppState>, query: String, limit: Option<usize>) -> Vec<library::Hit> {
    state.library.search(&query, limit.unwrap_or(10).min(30))
}

#[tauri::command]
async fn import_notes(state: State<'_, AppState>, title: String, text: String) -> CmdResult<GraphView> {
    let (title, text) = (title.trim().to_string(), text.trim().to_string());
    if title.is_empty() || text.is_empty() {
        return Err("Poné un título y pegá el texto de las notas.".into());
    }
    let source = Source::Notes { id: uuid::Uuid::new_v4().simple().to_string(), title: title.clone() };
    let input = format!("# Notas del aprendiz: {title}

{text}");
    extract::extract(&state, source, input).await.map(|(view, _, _)| view).map_err(err)
}

#[tauri::command]
fn list_practice(state: State<'_, AppState>) -> Vec<PracticeSummary> {
    state.practice.list()
}

#[tauri::command]
fn get_practice(state: State<'_, AppState>, id: String) -> CmdResult<PracticeSet> {
    state.practice.load(&id).map_err(err)
}

/// AC-22/23: generates a practice set from chosen graph ideas.
#[tauri::command]
async fn create_practice(state: State<'_, AppState>, node_ids: Vec<String>, count: usize) -> CmdResult<PracticeSet> {
    practice::create(&state, &node_ids, count).await.map_err(err)
}

#[tauri::command]
fn reveal_hint(state: State<'_, AppState>, set_id: String, problem_id: String) -> CmdResult<PracticeSet> {
    practice::reveal_hint(&state, &set_id, &problem_id).map_err(err)
}

/// AC-167: the next problem of a set written one by one (`have` = how many the screen has).
#[tauri::command]
async fn next_problem(state: State<'_, AppState>, set_id: String, have: usize) -> CmdResult<PracticeSet> {
    practice::next_problem(&state, &set_id, have).await.map_err(err)
}

/// AC-173: reads the learner's own problems (a guide, an old exam) to review; nothing is saved.
#[tauri::command]
async fn read_own_problems(state: State<'_, AppState>, text: String, book: Option<String>) -> CmdResult<Vec<practice::OwnProblem>> {
    practice::read_own(&state, &text, book.as_deref()).await.map_err(err)
}

/// AC-173: the practice from the problems the learner kept.
#[tauri::command]
fn create_own_practice(state: State<'_, AppState>, title: String, problems: Vec<practice::OwnProblem>) -> CmdResult<PracticeSet> {
    practice::create_own(&state, &title, problems).map_err(err)
}

/// AC-168: a hint written for what the learner is thinking right now.
#[tauri::command]
async fn practice_nudge(state: State<'_, AppState>, set_id: String, problem_id: String, draft: String) -> CmdResult<practice::Nudge> {
    practice::nudge(&state, &set_id, &problem_id, &draft).await.map_err(err)
}

/// AC-25: grades one answer (nothing is saved if grading fails).
#[tauri::command]
async fn answer_problem(state: State<'_, AppState>, set_id: String, problem_id: String, input: LearnerInput) -> CmdResult<PracticeSet> {
    let set = practice::answer(&state, &set_id, &problem_id, &input.text, input.confidence, &input.thinking).await.map_err(err)?;
    state.activity.touch("practice");
    Ok(set)
}

#[tauri::command]
fn delete_practice(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.practice.delete(&id).map_err(err)
}

#[tauri::command]
fn list_exams(state: State<'_, AppState>) -> Vec<ExamSummary> {
    state.exams.list()
}

#[tauri::command]
fn get_exam(state: State<'_, AppState>, id: String) -> CmdResult<Exam> {
    state.exams.load(&id).map_err(err)
}

/// AC-32: turns a pasted exam guide into a weighted syllabus.
#[tauri::command]
async fn create_exam(state: State<'_, AppState>, name: String, guide: String, kind: Option<exam::ExamKind>) -> CmdResult<Exam> {
    exam::create(&state, &name, &guide, kind.unwrap_or_default()).await.map_err(err)
}

/// AC-61: a learning path for a programming language.
#[tauri::command]
async fn create_language_path(state: State<'_, AppState>, lang: runner::Lang, level: String, goal: String) -> CmdResult<Exam> {
    exam::create_language_path(&state, lang, &level, &goal).await.map_err(err)
}

/// AC-61: an exercise of a path's topic passed its tests.
#[tauri::command]
fn record_exercise(state: State<'_, AppState>, exam_id: String, topic_id: String) -> CmdResult<Exam> {
    exam::record_exercise(&state, &exam_id, &topic_id).map_err(err)
}

/// AC-51: weekly classes and study blocks of an exam or subject.
#[tauri::command]
fn set_exam_schedule(state: State<'_, AppState>, exam_id: String, slots: Vec<exam::Slot>) -> CmdResult<Exam> {
    exam::set_schedule(&state, &exam_id, slots).map_err(err)
}

#[tauri::command]
fn delete_exam(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.exams.delete(&id).map_err(err)
}

/// AC-38: finds the official exam guide on the web (to review before creating the exam).
#[tauri::command]
async fn find_exam_guide(state: State<'_, AppState>, name: String) -> CmdResult<exam::FoundGuide> {
    exam::find_guide(&state, &name).await.map_err(err)
}

/// AC-34: opens or resumes the study session of one topic.
#[tauri::command]
fn study_topic(state: State<'_, AppState>, exam_id: String, topic_id: String) -> CmdResult<Session> {
    exam::study(&state, &exam_id, &topic_id).map_err(err)
}

/// AC-35: generates a multiple-choice mock exam spread by domain weight.
#[tauri::command]
async fn create_mock(state: State<'_, AppState>, exam_id: String, count: usize, minutes: Option<u32>, focus: Option<exam::MockFocus>) -> CmdResult<Exam> {
    exam::create_mock(&state, &exam_id, count, minutes, &focus.unwrap_or_default()).await.map_err(err)
}

/// AC-45: the teacher answers a question about one graded question.
#[tauri::command]
async fn explain_question(
    state: State<'_, AppState>,
    exam_id: String,
    question: exam::Question,
    chosen: Vec<usize>,
    history: Vec<exam::ExplainTurn>,
    ask: String,
) -> CmdResult<String> {
    exam::explain(&state, &exam_id, &question, &chosen, &history, &ask).await.map_err(err)
}

/// AC-46: the learner reports a question as wrong.
#[tauri::command]
fn report_question(state: State<'_, AppState>, exam_id: String, mock_id: String, question_id: String, reason: String) -> CmdResult<Exam> {
    exam::report(&state, &exam_id, &mock_id, &question_id, &reason).map_err(err)
}

#[tauri::command]
fn report_review(state: State<'_, AppState>, exam_id: String, review_id: String) -> CmdResult<Exam> {
    exam::report_review(&state, &exam_id, &review_id).map_err(err)
}

/// AC-44: writes the final one-page review sheet.
#[tauri::command]
async fn create_cheat_sheet(state: State<'_, AppState>, exam_id: String) -> CmdResult<Exam> {
    exam::cheat_sheet(&state, &exam_id).await.map_err(err)
}

/// AC-36: grades a mock exam (no model call).
#[tauri::command]
fn submit_mock(state: State<'_, AppState>, exam_id: String, mock_id: String, answers: Vec<Vec<usize>>) -> CmdResult<Exam> {
    let e = exam::submit_mock(&state, &exam_id, &mock_id, &answers).map_err(err)?;
    state.activity.touch("exam");
    Ok(e)
}

/// AC-42: passing mark, exam date and weekly hours.
#[tauri::command]
fn set_exam_goal(state: State<'_, AppState>, exam_id: String, goal: exam::ExamGoal) -> CmdResult<Exam> {
    exam::set_goal(&state, &exam_id, goal).map_err(err)
}

/// AC-40: one answer while reviewing failed questions.
#[tauri::command]
fn answer_review(state: State<'_, AppState>, exam_id: String, review_id: String, choice: Vec<usize>) -> CmdResult<Exam> {
    let e = exam::review(&state, &exam_id, &review_id, &choice).map_err(err)?;
    state.activity.touch("exam");
    Ok(e)
}

// ── Code console (AC-53) ──

async fn runtimes(state: &AppState, refresh: bool) -> Vec<runner::Runtime> {
    let mut cached = state.runtimes.lock().await;
    if refresh || cached.is_none() {
        *cached = Some(runner::detect().await);
    }
    cached.clone().unwrap_or_default()
}

#[tauri::command]
async fn code_runtimes(state: State<'_, AppState>, refresh: bool) -> CmdResult<Vec<runner::Runtime>> {
    Ok(runtimes(&state, refresh).await)
}

/// Runs the learner's code. Only the UI calls this (an explicit "Run"); no agent tool can.
#[tauri::command]
async fn run_code(state: State<'_, AppState>, lang: runner::Lang, code: String, stdin: String, tests: Option<String>) -> CmdResult<runner::RunResult> {
    let rts = runtimes(&state, false).await;
    // AC-55: "Probar" joins the exercise's tests in the order the language needs.
    let code = match tests.filter(|t| !t.trim().is_empty()) {
        Some(t) => runner::with_tests(lang, &code, &t),
        None => code,
    };
    runner::run(&rts, &state.runs_dir, lang, &code, &stdin).await.map_err(err)
}

/// AC-55: a practice exercise with hidden tests.
#[tauri::command]
async fn generate_code_exercise(state: State<'_, AppState>, lang: runner::Lang, topic: String, level: String) -> CmdResult<runner::CodeExercise> {
    if topic.trim().is_empty() {
        return Err("Escribí el tema que querés practicar.".into());
    }
    practice::forced_valid(&state, agent::Role::Practice, "code_exercise", runner::exercise_tool(), runner::EXERCISE_TOOL, runner::exercise_input(lang, &topic, &level), |raw| runner::validate_exercise(raw, lang))
        .await
        .map_err(err)
}

/// One plain answer from the teacher (no tools) with the given prompt.
async fn teacher_answer(state: &AppState, prompt: &str, input: String) -> CmdResult<String> {
    let mut ep = agent::endpoint_for(state, agent::Role::Teacher).await.map_err(err)?;
    ep.usage.purpose = prompt.into();
    let system = state.prompts.get(prompt).map_err(err)?;
    // Code help and speaking feedback are read by the learner (AC-75).
    let input = practice::with_access(state, input);
    let c = llm::stream_chat(&ep, &system, &[llm::Msg::user(input, None)], &serde_json::json!([]), None, |_| {}, || false).await.map_err(err)?;
    let text = c.text.trim().to_string();
    if text.is_empty() {
        return Err("El profesor no respondió. Probá de nuevo.".into());
    }
    Ok(text)
}

/// AC-54: the teacher explains a run's error (or answers about the code).
#[tauri::command]
async fn explain_code(state: State<'_, AppState>, lang: runner::Lang, code: String, output: String, ask: String) -> CmdResult<String> {
    teacher_answer(&state, "code_explain", runner::explain_input(lang, &code, &output, &ask)).await
}

/// AC-58: a senior-style review of working code.
#[tauri::command]
async fn review_code(state: State<'_, AppState>, lang: runner::Lang, code: String, focus: String) -> CmdResult<String> {
    runner::validate(&code, "").map_err(err)?;
    teacher_answer(&state, "code_review", runner::review_input(lang, &code, &focus)).await
}

/// AC-63: transcribes photos or scanned pages with a vision-capable model.
#[tauri::command]
async fn read_images(state: State<'_, AppState>, images: Vec<String>, purpose: String) -> CmdResult<String> {
    vision::read(&state, &images, &purpose).await.map_err(err)
}

// ── Language exams (AC-65) ──

#[tauri::command]
async fn generate_listening(state: State<'_, AppState>, language: String, level: String, topic: String) -> CmdResult<language::Listening> {
    language::listening(&state, &language, &level, &topic).await.map_err(err)
}

/// Transcribes a recording with the configured speech model.
#[tauri::command]
async fn transcribe_audio(state: State<'_, AppState>, audio: Vec<u8>, mime: String, language: String) -> CmdResult<String> {
    let speech = state.settings.load().roles.speech;
    if speech.provider_id == local_speech::PROVIDER {
        return transcribe_local(&state, audio, &mime, language, &speech.model).await.map_err(err);
    }
    language::transcribe(&state, audio, &mime, &language).await.map_err(err)
}

// ── Voz local (AC-106) ──

async fn transcribe_local(state: &AppState, audio: Vec<u8>, mime: &str, language: String, model: &str) -> anyhow::Result<String> {
    let info = local_speech::model(model).ok_or_else(|| anyhow::anyhow!("Elegí un modelo de voz local en Ajustes → Modelos → Voz."))?;
    if !mime.starts_with("audio/wav") {
        anyhow::bail!("No pude preparar la grabación para la voz local. Probá de nuevo.");
    }
    let samples = local_speech::wav_samples(&audio)?;
    let (engine, data_dir) = (state.local_speech.clone(), state.data_dir.clone());
    // CPU-heavy: off the async runtime. The model stays loaded for the next dictation.
    tokio::task::spawn_blocking(move || {
        let mut slot = engine.lock().unwrap_or_else(|p| p.into_inner());
        if slot.as_ref().map(|e| e.id) != Some(info.id) {
            *slot = Some(local_speech::Engine::load(&data_dir, info)?);
        }
        slot.as_mut().unwrap().transcribe(&samples, &language)
    })
    .await?
}

#[tauri::command]
fn local_speech_status(state: State<'_, AppState>) -> Vec<local_speech::ModelStatus> {
    local_speech::status(&state.data_dir)
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    done: u64,
    total: u64,
}

#[tauri::command]
async fn local_speech_download(state: State<'_, AppState>, model: String, on_progress: Channel<DownloadProgress>) -> CmdResult<Vec<local_speech::ModelStatus>> {
    let info = local_speech::model(&model).ok_or("Ese modelo no existe.")?;
    let mut last = 0u64;
    local_speech::download(&state.data_dir, info, |done, total| {
        // About every 2 MB: enough for a smooth bar without flooding the IPC.
        if done - last >= 2_000_000 || done >= total {
            last = done;
            let _ = on_progress.send(DownloadProgress { done, total });
        }
    })
    .await
    .map_err(err)?;
    Ok(local_speech::status(&state.data_dir))
}

#[tauri::command]
fn local_speech_remove(state: State<'_, AppState>, model: String) -> CmdResult<Vec<local_speech::ModelStatus>> {
    let info = local_speech::model(&model).ok_or("Ese modelo no existe.")?;
    let mut slot = state.local_speech.lock().unwrap_or_else(|p| p.into_inner());
    if slot.as_ref().map(|e| e.id) == Some(info.id) {
        *slot = None;
    }
    drop(slot);
    local_speech::remove(&state.data_dir, info).map_err(err)?;
    Ok(local_speech::status(&state.data_dir))
}

/// Feedback on what the learner said (from the transcript).
#[tauri::command]
async fn speaking_feedback(state: State<'_, AppState>, input: language::SpeakingInput) -> CmdResult<String> {
    if input.transcript.trim().is_empty() {
        return Err("No hay nada para corregir: grabá tu respuesta primero.".into());
    }
    teacher_answer(&state, "lang_speaking", language::speaking_input(&input)).await
}

// ── Projects (AC-64) ──

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Vec<project::ProjectSummary> {
    state.projects.list()
}

#[tauri::command]
fn get_project(state: State<'_, AppState>, id: String) -> CmdResult<project::Project> {
    state.projects.load(&id).map_err(err)
}

#[tauri::command]
fn save_project(state: State<'_, AppState>, project: project::Project) -> CmdResult<project::Project> {
    let mut p = project;
    if p.id.trim().is_empty() {
        p.id = uuid::Uuid::new_v4().simple().to_string();
    }
    state.projects.save(&mut p).map_err(err)?;
    Ok(p)
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.projects.delete(&id).map_err(err)
}

/// Runs or tests the project's files as they are in the editor (only on the learner's click).
#[tauri::command]
async fn run_project(state: State<'_, AppState>, lang: runner::Lang, files: Vec<project::ProjectFile>, mode: project::Mode, stdin: String) -> CmdResult<runner::RunResult> {
    let rts = runtimes(&state, false).await;
    project::run(&rts, &state.runs_dir, lang, &files, mode, &stdin).await.map_err(err)
}

/// A mini project with failing tests, proposed by the teacher (TDD).
#[tauri::command]
async fn generate_project(state: State<'_, AppState>, lang: runner::Lang, topic: String, level: String) -> CmdResult<project::Project> {
    if topic.trim().is_empty() {
        return Err("Escribí de qué querés que sea el proyecto.".into());
    }
    let mut p = practice::forced_valid(&state, agent::Role::Practice, "code_project", project::project_tool(), project::PROJECT_TOOL, project::project_input(lang, &topic, &level), |raw| project::validate_project(raw, lang))
        .await
        .map_err(err)?;
    state.projects.save(&mut p).map_err(err)?;
    Ok(p)
}

// ── Backup and Anki (AC-60) ──

/// Writes a .zip of all learning data (never the API keys) to Downloads.
#[tauri::command]
fn create_backup(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let dir = app.path().download_dir().map_err(err)?;
    let name = format!("Eureka-respaldo-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M"));
    let path = dir.join(name);
    backup::backup_state(&state, &path).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Restores a backup; the current data is saved first next to the data folder.
#[tauri::command]
fn restore_backup(state: State<'_, AppState>, bytes: Vec<u8>) -> CmdResult<usize> {
    let safety = state.data_dir.join(format!("antes-de-restaurar-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    let restored = backup::restore_state(&state, &bytes, &safety).map_err(err)?;
    // AC-190: the library's files changed under the index.
    state.library.invalidate();
    Ok(restored)
}

/// Creates a deck from imported cards (Anki's plain text or .apkg, a shared deck).
#[tauri::command]
fn import_cards(state: State<'_, AppState>, name: String, cards: Vec<(String, String)>, today: String) -> CmdResult<String> {
    let today = cards::parse_day(&today).map_err(err)?;
    let (deck, _) = cards::import_deck(&state.decks, &name, &cards, today).map_err(err)?;
    Ok(deck.id)
}

// ── Anki .apkg and shared decks (AC-152…AC-154) ──

/// The bytes of a file the screen sent as the raw request body.
fn raw_body<'a>(request: &'a tauri::ipc::Request<'_>) -> CmdResult<&'a [u8]> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b),
        _ => Err("Elegí un archivo.".into()),
    }
}

/// A file in Downloads that does not overwrite another one.
fn free_download(app: &tauri::AppHandle, name: &str) -> CmdResult<PathBuf> {
    let dir = app.path().download_dir().map_err(err)?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let mut path = dir.join(name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    Ok(path)
}

fn deck_pairs(state: &AppState, deck_id: &str) -> CmdResult<(String, Vec<(String, String)>)> {
    let d = state.decks.load(deck_id).map_err(err)?;
    Ok((d.name, d.cards.into_iter().map(|c| (c.front, c.back)).collect()))
}

/// AC-152: the cards of an Anki package, to review before importing.
#[tauri::command]
fn read_apkg(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<anki::Imported> {
    anki::read_apkg(raw_body(&request)?, &state.data_dir.join("tmp")).map_err(err)
}

/// AC-153: the deck as an .apkg in Downloads; returns its path.
#[tauri::command]
fn export_apkg(app: tauri::AppHandle, state: State<'_, AppState>, deck_id: String) -> CmdResult<String> {
    let (name, cards) = deck_pairs(&state, &deck_id)?;
    let bytes = anki::write_apkg(&name, &cards, &state.data_dir.join("tmp")).map_err(err)?;
    let path = free_download(&app, &share::file_name(&name, "apkg"))?;
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// AC-154: the deck as a `.eureka` file in Downloads, to send; returns its path.
#[tauri::command]
fn share_deck(app: tauri::AppHandle, state: State<'_, AppState>, deck_id: String) -> CmdResult<String> {
    let (name, cards) = deck_pairs(&state, &deck_id)?;
    let bytes = share::to_file(&name, &cards).map_err(err)?;
    let path = free_download(&app, &share::file_name(&name, share::EXTENSION))?;
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// AC-154: a shared deck picked in the screen, to review before importing.
#[tauri::command]
fn read_shared_deck(request: tauri::ipc::Request<'_>) -> CmdResult<share::Incoming> {
    share::from_file(raw_body(&request)?).map_err(err)
}

/// AC-154: the `.eureka` Eureka was opened with (double click), once.
#[tauri::command]
fn opened_deck(state: State<'_, AppState>) -> CmdResult<Option<share::Incoming>> {
    let Some(path) = state.opened.lock().unwrap().take() else { return Ok(None) };
    let meta = std::fs::metadata(&path).map_err(|_| "No encontré el mazo que abriste.".to_string())?;
    if meta.len() as usize > share::MAX_SHARED_BYTES {
        return Err("El mazo compartido es demasiado grande.".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "No pude leer el mazo que abriste.".to_string())?;
    share::from_file(&bytes).map(Some).map_err(err)
}

// ── Cuentas con suscripción (ChatGPT Plus/Pro) ──

/// What Ajustes sees of a connected account: never the tokens.
#[derive(serde::Serialize)]
pub struct AccountView {
    pub provider_id: String,
    pub account_id: String,
    pub email: Option<String>,
    pub expires: i64,
}

impl AccountView {
    fn of(account: accounts::Account) -> Self {
        Self { provider_id: oauth::PROVIDER_ID.to_string(), account_id: account.account_id, email: account.email, expires: account.expires }
    }
}

#[tauri::command]
fn chatgpt_status(state: State<'_, AppState>) -> Option<AccountView> {
    state.accounts.get(oauth::PROVIDER_ID).map(AccountView::of)
}

/// Opens the browser and waits for the callback. Nothing is saved until the
/// token exchange succeeds, so a cancelled sign-in leaves no half account.
#[tauri::command]
async fn chatgpt_connect(state: State<'_, AppState>) -> CmdResult<AccountView> {
    let account = oauth::connect(oauth::ORIGINATOR, |url| {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| anyhow::anyhow!("no se pudo abrir el navegador: {e}"))
    })
    .await
    .map_err(err)?;
    state.accounts.put(oauth::PROVIDER_ID, &account).map_err(err)?;
    Ok(AccountView::of(account))
}

#[tauri::command]
fn chatgpt_disconnect(state: State<'_, AppState>) -> CmdResult<()> {
    state.accounts.remove(oauth::PROVIDER_ID).map_err(err)
}

/// The models the connected account may use. A ChatGPT subscription does not
/// serve the provider's `/models`, and the list depends on the plan, so it is
/// read from the account itself instead of from Settings.
#[tauri::command]
async fn chatgpt_models(state: State<'_, AppState>) -> CmdResult<Vec<llm::ModelInfo>> {
    let account = state.accounts.get(oauth::PROVIDER_ID).ok_or_else(|| "No hay una cuenta de ChatGPT conectada.".to_string())?;
    let account = agent::valid_account(&state, oauth::PROVIDER_ID, account).await.map_err(err)?;
    let ep = llm::Endpoint {
        base_url: oauth::API_BASE.to_string(),
        api_key: account.access,
        model: String::new(),
        context_tokens: 0,
        session: llm::app_session(),
        subscription: Some(llm::Subscription { account_id: account.account_id, originator: account.originator }),
        usage: Default::default(),
    };
    llm::list_chatgpt_models(&ep).await.map_err(err)
}

// ── Token usage (AC-186): read here, never sent anywhere ──

#[tauri::command]
fn usage_summary(state: State<'_, AppState>) -> usage::Summary {
    let titles = state.sessions.list().into_iter().map(|s| (s.id, s.title)).collect();
    usage::summarize(&state.usage.all(), chrono::Local::now().date_naive(), &titles)
}

// ── Study log (AC-49) ──

#[tauri::command]
fn log_study(state: State<'_, AppState>, entry: study::StudyInput) -> CmdResult<study::StudyEntry> {
    let e = study::validate(entry).map_err(err)?;
    state.study.append(&e).map_err(err)?;
    let _ = state.activity.record(&e.day, "focus");
    Ok(e)
}

// ── Clases grabadas (AC-146, AC-147) ──

#[tauri::command]
fn class_list(state: State<'_, AppState>) -> Vec<classes::ClassSummary> {
    state.classes.list()
}

#[tauri::command]
fn class_get(state: State<'_, AppState>, id: String) -> CmdResult<classes::ClassRecord> {
    state.classes.get(&id).map_err(err)
}

#[tauri::command]
fn class_start(state: State<'_, AppState>, title: String, course_id: Option<String>, day: String) -> CmdResult<classes::ClassRecord> {
    state.classes.start(&title, course_id, &day).map_err(err)
}

/// One transcribed part of the recording.
#[tauri::command]
fn class_append(state: State<'_, AppState>, id: String, text: String, seconds: u32) -> CmdResult<classes::ClassRecord> {
    let c = state.classes.append(&id, &text, seconds).map_err(err)?;
    if !text.trim().is_empty() {
        state.activity.touch("class");
    }
    Ok(c)
}

#[tauri::command]
fn class_rename(state: State<'_, AppState>, id: String, title: String) -> CmdResult<classes::ClassRecord> {
    state.classes.rename(&id, &title).map_err(err)
}

#[tauri::command]
fn class_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.classes.delete(&id).map_err(err)
}

#[tauri::command]
async fn class_notes(state: State<'_, AppState>, id: String, today: String) -> CmdResult<classes::ClassRecord> {
    classes::make_notes(&state, &id, &today).await.map_err(err)
}

/// AC-141: days with study since `since` (local YYYY-MM-DD), for the streak.
#[tauri::command]
fn activity_days(state: State<'_, AppState>, since: String) -> Vec<activity::DayActivity> {
    activity::days(&state, &since)
}

#[tauri::command]
fn study_log(state: State<'_, AppState>, since: String) -> Vec<study::StudyEntry> {
    state.study.since(&since)
}

// ── Flashcards (AC-47, AC-48). `today` is the learner's local date. ──

#[tauri::command]
fn list_decks(state: State<'_, AppState>, today: String) -> CmdResult<Vec<DeckSummary>> {
    let today = cards::parse_day(&today).map_err(err)?;
    Ok(state.decks.all().iter().map(|d| d.summary(today)).collect())
}

#[tauri::command]
fn get_deck(state: State<'_, AppState>, id: String) -> CmdResult<Deck> {
    state.decks.load(&id).map_err(err)
}

#[tauri::command]
fn create_deck(state: State<'_, AppState>, name: String) -> CmdResult<Deck> {
    cards::create_empty(&state, &name).map_err(err)
}

#[tauri::command]
async fn generate_deck(state: State<'_, AppState>, name: String, source: cards::CardSource, count: usize, today: String) -> CmdResult<Deck> {
    cards::generate(&state, &name, source, count, &today).await.map_err(err)
}

#[tauri::command]
fn delete_deck(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.decks.delete(&id).map_err(err)
}

#[tauri::command]
fn save_card(state: State<'_, AppState>, deck_id: String, card_id: Option<String>, front: String, back: String, today: String) -> CmdResult<Deck> {
    cards::upsert_card(&state, &deck_id, card_id.as_deref(), &front, &back, &today).map_err(err)
}

#[tauri::command]
fn delete_card(state: State<'_, AppState>, deck_id: String, card_id: String) -> CmdResult<Deck> {
    cards::delete_card(&state, &deck_id, &card_id).map_err(err)
}

/// AC-57: saves an explained console error as a flashcard.
#[tauri::command]
fn save_code_card(state: State<'_, AppState>, lang: runner::Lang, front: String, back: String, today: String) -> CmdResult<usize> {
    let today = cards::parse_day(&today).map_err(err)?;
    let name = format!("Errores de {}", lang.label());
    cards::add_to_named_deck(&state.decks, &name, cards::DeckSource::Manual, &[(front, back)], today).map_err(err)
}

#[tauri::command]
fn grade_card(state: State<'_, AppState>, deck_id: String, card_id: String, grade: cards::Grade, today: String) -> CmdResult<Deck> {
    let d = cards::grade_card(&state, &deck_id, &card_id, grade, &today).map_err(err)?;
    let _ = state.activity.record(&today, "cards");
    Ok(d)
}

/// The version of this build (Ajustes → Acerca de).
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Distribution: is there a newer signed installer?
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> CmdResult<update::Check> {
    update::check(&app).await.map_err(err)
}

/// Installs the update found by `update_check` and reopens Eureka.
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> CmdResult<()> {
    update::install(&app).await.map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // AC-154: one Eureka on the real data; a second launch (double click on a
    // `.eureka`) hands its file to the open window. Tests use their own data
    // folder (LA_DATA_DIR) and never reach the person's Eureka.
    #[cfg(desktop)]
    if std::env::var_os("LA_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Emitter;
            if let Some(path) = share::opened_file(args) {
                *app.state::<AppState>().opened.lock().unwrap() = Some(path);
                let _ = app.emit("deck-opened", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // On the phone, files are saved where the user picks (a content:// address).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(update::Pending::default())
        .setup(|app| {
            // LA_DATA_DIR relocates all data (used by tests); default: OS app-data dir.
            let dir = match std::env::var_os("LA_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState::new(dir));
            *app.state::<AppState>().opened.lock().unwrap() = share::opened_file(std::env::args());
            // AC-169: the research worker; what a closed app left «en curso» says it was cut.
            research::recover(&app.state::<AppState>());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    handle.state::<AppState>().research.wake.notified().await;
                    for job in handle.state::<AppState>().research.take() {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move { research::run_job(&h.state::<AppState>(), job).await });
                    }
                }
            });
            // AC-108: the memory pass, in the background, every few minutes.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let backoff = memory::Backoff::default();
                // AC-195: the one-time migration to the student's memory (resumable; old files stay).
                match memdb::migrate(&handle.state::<AppState>()) {
                    Ok(c) if c.created + c.merged > 0 => eprintln!("memoria del estudiante: {c:?}"),
                    Ok(_) => {}
                    Err(e) => eprintln!("memoria del estudiante: {e}"),
                }
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                loop {
                    memory::pass(&handle.state::<AppState>(), &backoff).await;
                    tokio::time::sleep(std::time::Duration::from_secs(3 * 60)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            update_check,
            update_install,
            get_settings,
            save_settings,
            chatgpt_status,
            chatgpt_connect,
            chatgpt_disconnect,
            chatgpt_models,
            usage_summary,
            update_session_meta,
            student_model,
            student_today,
            student_mark_known,
            session_memories,
            forget_session_memory,
            memory_list,
            memory_edit,
            memory_delete,
            memory_forget_all,
            memory_export,
            remember_session_now,
            companion_state,
            companion_ack_privacy,
            companion_send,
            companion_new_conversation,
            companion_propose_entry,
            companion_save_entry,
            companion_delete_entry,
            companion_checkin,
            companion_unlock,
            companion_set_insight,
            companion_lock,
            companion_set_pin,
            companion_save_resources,
            companion_export,
            companion_erase,
            academic_state,
            academic_save_term,
            academic_add_breaks,
            academic_link_route,
            academic_delete_break,
            academic_delete_term,
            academic_set_active,
            academic_save_course,
            academic_delete_course,
            academic_save_date,
            academic_delete_date,
            academic_import,
            academic_parse,
            career_get,
            career_parse,
            career_save_plan,
            career_save_subject,
            career_delete_subject,
            career_delete,
            get_identity,
            save_identity,
            get_accessibility,
            save_accessibility,
            list_models,
            quick_setup,
            list_sessions,
            create_session,
            start_chat,
            get_session,
            delete_session,
            forget_source,
            import_book,
            add_ocr_pages,
            import_document,
            ocr_available,
            ocr_page,
            ocr_cached,
            ocr_cache_put,
            ocr_cache_clear,
            list_books,
            get_book,
            delete_book,
            search_library,
            get_learner,
            forget_learner,
            send_message,
            stop_agent,
            list_prompts,
            save_prompt,
            reset_prompt,
            get_graph,
            extract_session,
            import_notes,
            list_practice,
            get_practice,
            create_practice,
            reveal_hint,
            practice_nudge,
            read_own_problems,
            create_own_practice,
            next_problem,
            answer_problem,
            delete_practice,
            list_exams,
            get_exam,
            create_exam,
            delete_exam,
            find_exam_guide,
            study_topic,
            create_mock,
            submit_mock,
            answer_review,
            set_exam_goal,
            set_exam_schedule,
            create_language_path,
            record_exercise,
            create_cheat_sheet,
            explain_question,
            report_question,
            report_review,
            list_decks,
            get_deck,
            create_deck,
            generate_deck,
            delete_deck,
            save_card,
            delete_card,
            grade_card,
            save_code_card,
            log_study,
            class_list,
            class_get,
            class_start,
            class_append,
            class_rename,
            class_delete,
            class_notes,
            activity_days,
            create_backup,
            read_images,
            generate_listening,
            transcribe_audio,
            local_speech_status,
            local_speech_download,
            local_speech_remove,
            speaking_feedback,
            list_projects,
            get_project,
            save_project,
            delete_project,
            run_project,
            generate_project,
            restore_backup,
            import_cards,
            read_apkg,
            export_apkg,
            share_deck,
            read_shared_deck,
            opened_deck,
            code_runtimes,
            run_code,
            explain_code,
            review_code,
            generate_code_exercise,
            study_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "android")]
            if let tauri::RunEvent::Opened { urls } = _event {
                receive_opened(_app, urls);
            }
        });
}

/// AC-154 on Android: another app hands Eureka a `.eureka` as a content://
/// address that only works while that hand-over lasts, so it is copied in now.
#[cfg(target_os = "android")]
fn receive_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let Some(url) = urls.into_iter().find(|u| matches!(u.scheme(), "content" | "file")) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        use tauri::Emitter;
        use tauri_plugin_fs::FsExt;
        let mut opts = tauri_plugin_fs::OpenOptions::new();
        opts.read(true);
        let Ok(file) = app.fs().open(tauri_plugin_fs::FilePath::Url(url), opts) else { return };
        // One byte over the limit is enough for `opened_deck` to say it is too big.
        let mut bytes = Vec::new();
        if file.take(share::MAX_SHARED_BYTES as u64 + 1).read_to_end(&mut bytes).is_err() {
            return;
        }
        let state = app.state::<AppState>();
        let path = state.data_dir.join("abierto.eureka");
        if std::fs::write(&path, bytes).is_ok() {
            *state.opened.lock().unwrap() = Some(path);
            let _ = app.emit("deck-opened", ());
        }
    });
}

/// IPC contract: the exact JSON shapes `src/api.ts` / `src/types.ts` use. The
/// e2e mock speaks the same shapes, so these tests tie mock, UI and Rust together.
#[cfg(test)]
mod contract_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_input_from_ui_keeps_key_when_blank() {
        // What Settings.tsx sends: api_key "" for untouched keys, no clear_key.
        let raw = json!({
            "providers": [{ "id": "openrouter", "label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "" }],
            "roles": { "teacher": { "provider_id": "openrouter", "model": "x/y" }, "prober": { "provider_id": "", "model": "" } }
        });
        let input: SettingsInput = serde_json::from_value(raw).unwrap();
        assert_eq!(input.providers[0].provider.id, "openrouter");
        assert!(!input.providers[0].clear_key);

        let dir = std::env::temp_dir().join(format!("la-contract-{}", uuid::Uuid::new_v4().simple()));
        let store = SettingsStore::new(&dir);
        store.save(serde_json::from_value(json!({
            "providers": [{ "id": "openrouter", "label": "OpenRouter", "base_url": "u", "api_key": "sk-1" }],
            "roles": { "teacher": { "provider_id": "", "model": "" }, "prober": { "provider_id": "", "model": "" } }
        })).unwrap()).unwrap();
        store.save(input).unwrap();
        assert_eq!(store.keys().get("openrouter").map(String::as_str), Some("sk-1"), "blank key must not erase the stored one");
        let view = serde_json::to_value(store.view()).unwrap();
        assert_eq!(view["providers"][0]["has_key"], true);
        assert!(!view.to_string().contains("sk-1"), "the key never reaches the UI");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn learner_input_from_ui() {
        let full: LearnerInput = serde_json::from_value(json!({ "text": "a", "confidence": 3, "thinking": "t" })).unwrap();
        assert_eq!(full.confidence, Some(3));
        let free: LearnerInput = serde_json::from_value(json!({ "text": "hola" })).unwrap();
        assert!(free.confidence.is_none() && free.thinking.is_empty());
    }

    #[test]
    fn agent_events_match_ts_union() {
        let s = Session::new("g");
        let ev = |e: AgentEvent| serde_json::to_value(e).unwrap();
        assert_eq!(ev(AgentEvent::Text { delta: "x".into() }), json!({ "type": "text", "delta": "x" }));
        assert_eq!(ev(AgentEvent::Activity { label: "x".into() }), json!({ "type": "activity", "label": "x" }));
        assert_eq!(crate::agent::activity_label("library_search"), "Buscando en tu biblioteca…");
        assert_eq!(crate::agent::activity_label(crate::research::TOOL), "Mandando a investigar en la web…");
        assert_eq!(crate::agent::activity_label("herramienta_rara"), "Preparando la respuesta…");
        assert_eq!(ev(AgentEvent::Error { message: "m".into() }), json!({ "type": "error", "message": "m" }));
        assert_eq!(ev(AgentEvent::Done), json!({ "type": "done" }));
        let v = ev(AgentEvent::Session { session: Box::new(s) });
        assert_eq!(v["type"], "session");
        // Fields types.ts relies on.
        for key in ["id", "title", "goal", "phase", "findings", "plan", "pending_question", "messages", "updated_at"] {
            assert!(v["session"].get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["session"]["phase"], "probe");
    }
}
