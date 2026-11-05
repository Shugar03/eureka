//! Memory across sessions (AC-108..110), the way agent harnesses consolidate:
//! a conversation that went quiet is folded into memory in the background,
//! without the person having the session open.
//!
//! - Episodic: each session keeps a short `SessionMemory` (what was seen, what is
//!   pending, what was hard) that the agent reads to pick up a thread later.
//! - Semantic: the same pass runs the extractor (ideas to the graph, confusions
//!   and preferences to the learner profile), for chats too, not only "done".
//! - Once a day a tidy pass archives long-idle sessions and drops confusions
//!   that were repaired long ago.
//!
//! Every pass uses the Extractor role (cheap model) and only for what is new.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent::Role;
use crate::graph::{GraphSummary, Source};
use crate::session::{Phase, Session};
use crate::AppState;

/// A session counts as finished for now after this long without activity.
pub const IDLE_MINUTES: i64 = 10;
/// Fewer new messages than this aren't worth a model call.
pub const MIN_NEW_MESSAGES: usize = 4;
/// Unpinned sessions with no activity for this long go to the archive (reversible).
pub const ARCHIVE_AFTER_DAYS: i64 = 30;
/// Repaired confusions older than this leave the profile.
pub const FORGET_FIXED_AFTER_DAYS: i64 = 90;
/// How many past sessions the agent sees in its state block.
const RECENT_IN_STATE: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionMemory {
    pub summary: String,
    #[serde(default)]
    pub pending: Vec<String>,
    #[serde(default)]
    pub struggled: Vec<String>,
    /// How many messages the pass saw: more now → worth another pass.
    pub messages: usize,
    pub at: DateTime<Utc>,
}

impl SessionMemory {
    /// What "forget" leaves: nothing to show, but these messages count as seen.
    pub fn forgotten(messages: usize) -> Self {
        Self { summary: String::new(), pending: vec![], struggled: vec![], messages, at: Utc::now() }
    }
}

/// A memory worth showing (not a forgotten one).
fn has_memory(s: &Session) -> bool {
    s.memory.as_ref().is_some_and(|m| !m.summary.is_empty())
}

pub const TOOL: &str = "remember_session";

pub fn tool() -> Value {
    json!({ "type": "function", "function": {
        "name": TOOL,
        "description": "Guarda lo que hay que recordar de esta sesión para retomarla otro día.",
        "parameters": { "type": "object", "properties": {
            "summary": { "type": "string", "description": "2 a 4 oraciones: qué se habló o aprendió, en concreto." },
            "pending": { "type": "array", "items": { "type": "string" }, "description": "Lo que quedó para después (máximo 4)." },
            "struggled": { "type": "array", "items": { "type": "string" }, "description": "Lo que le costó al aprendiz, con el concepto (máximo 4)." }
        }, "required": ["summary"] }
    }})
}

fn short_list(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(|x| x.chars().take(200).collect()).take(4).collect()
}

pub fn parse(raw: &str, messages: usize) -> Result<SessionMemory> {
    let v: Value = serde_json::from_str(raw)?;
    let summary: String = v["summary"].as_str().unwrap_or("").trim().chars().take(800).collect();
    if summary.is_empty() {
        bail!("el resumen de la sesión llegó vacío");
    }
    Ok(SessionMemory { summary, pending: short_list(&v["pending"]), struggled: short_list(&v["struggled"]), messages, at: Utc::now() })
}

/// What the person wrote, counted: a session the person never spoke in has nothing to remember.
fn spoke(s: &Session) -> bool {
    s.messages.iter().any(|m| m.role == "user" && m.content.as_deref().is_some_and(|c| !c.trim().is_empty() && !c.starts_with("<estado_app>")))
}

/// Due for a pass: quiet for a while, and with enough new since the last one.
pub fn due(s: &Session, now: DateTime<Utc>) -> bool {
    let seen = s.memory.as_ref().map_or(0, |m| m.messages);
    spoke(s) && s.messages.len() >= seen + MIN_NEW_MESSAGES && now - s.updated_at >= chrono::Duration::minutes(IDLE_MINUTES)
}

/// The graph needs the new messages too (same rule as the screen's re-extraction).
fn graph_stale(s: &Session) -> bool {
    s.graph.as_ref().is_none_or(|g| g.messages + MIN_NEW_MESSAGES <= s.messages.len())
}

/// One pass over one session: its memory, then the graph and the learner profile.
pub async fn consolidate(state: &AppState, id: &str) -> Result<()> {
    // AC-186: the background pass counts for the session it remembers.
    crate::usage::in_session(id, consolidate_now(state, id)).await
}

async fn consolidate_now(state: &AppState, id: &str) -> Result<()> {
    let s = state.sessions.load(id)?;
    let messages = s.messages.len();
    let transcript = crate::extract::session_transcript(&s);
    let memory = crate::practice::forced_valid(state, Role::Extractor, "remember_session", tool(), TOOL, crate::extract::truncate(transcript.clone()), |raw| parse(raw, messages)).await?;
    let graph = if graph_stale(&s) {
        let source = Source::Session { id: s.id.clone(), title: s.title.clone() };
        // A chat with nothing to learn from yields no ideas: that's fine, the memory stays.
        crate::extract::extract(state, source, transcript).await.ok().map(|(_, propositions, chains)| GraphSummary { propositions, chains, at: Utc::now(), messages })
    } else {
        None
    };
    // Reload: the person may have written while the model ran.
    let mut s = state.sessions.load(id)?;
    s.memory = Some(memory);
    if graph.is_some() {
        s.graph = graph;
    }
    state.sessions.save_quiet(&s)
}

/// The daily tidy: archive long-idle sessions, drop long-repaired confusions. No model call.
pub fn tidy(state: &AppState, now: DateTime<Utc>) -> Result<usize> {
    let mut changed = 0;
    for mut s in state.sessions.all() {
        if !s.archived && !s.pinned && now - s.updated_at >= chrono::Duration::days(ARCHIVE_AFTER_DAYS) {
            s.archived = true;
            state.sessions.save_quiet(&s)?;
            changed += 1;
        }
    }
    changed += state.learner.update(|p| {
        let before = p.misconceptions.len();
        p.misconceptions.retain(|m| !(m.fixed && now - m.at >= chrono::Duration::days(FORGET_FIXED_AFTER_DAYS)));
        before - p.misconceptions.len()
    })?;
    Ok(changed)
}

fn tidy_mark(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("profile").join("last_tidy.txt")
}

fn tidy_due(data_dir: &Path, today: chrono::NaiveDate) -> bool {
    std::fs::read_to_string(tidy_mark(data_dir)).ok().and_then(|t| t.trim().parse::<chrono::NaiveDate>().ok()) != Some(today)
}

/// Sessions whose pass failed recently: wait before trying again (no retry storms on a bad key).
#[derive(Default)]
pub struct Backoff(Mutex<HashMap<String, Instant>>);

const RETRY_AFTER: Duration = Duration::from_secs(30 * 60);

impl Backoff {
    fn blocked(&self, id: &str) -> bool {
        self.0.lock().unwrap().get(id).is_some_and(|t| t.elapsed() < RETRY_AFTER)
    }
    fn fail(&self, id: &str) {
        self.0.lock().unwrap().insert(id.to_string(), Instant::now());
    }
}

/// One background pass: the daily tidy, then the sessions that are due, one at a time.
pub async fn pass(state: &AppState, backoff: &Backoff) {
    let now = Utc::now();
    let today = chrono::Local::now().date_naive();
    if tidy_due(&state.data_dir, today) && tidy(state, now).is_ok() {
        let _ = std::fs::create_dir_all(tidy_mark(&state.data_dir).parent().unwrap());
        let _ = std::fs::write(tidy_mark(&state.data_dir), today.to_string());
    }
    // No extractor (nor teacher) configured: nothing to do, quietly.
    if crate::agent::endpoint_for(state, Role::Extractor).await.is_err() {
        return;
    }
    let mut due_now: Vec<Session> = state.sessions.all().into_iter().filter(|s| due(s, now) && !state.is_running(&s.id) && !backoff.blocked(&s.id)).collect();
    due_now.sort_by_key(|s| s.updated_at);
    for s in due_now {
        if let Err(e) = consolidate(state, &s.id).await {
            eprintln!("memoria de «{}»: {e}", s.title);
            backoff.fail(&s.id);
        }
    }
}

/// "## Sesiones anteriores" for the agent: the latest remembered sessions, so it can pick up a thread.
pub fn state_section(sessions: &[Session], current: &Session) -> String {
    let mut past: Vec<&Session> = sessions.iter().filter(|s| s.id != current.id && has_memory(s)).collect();
    if past.is_empty() {
        return String::new();
    }
    past.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let lines: Vec<String> = past.iter().take(RECENT_IN_STATE).map(|s| line(s)).collect();
    format!("\n## Sesiones anteriores (memoria)\nSi viene al caso, retomá lo pendiente; para buscar otras usá `recall` con kind \"sesiones\".\n{}\n", lines.join("\n"))
}

fn line(s: &Session) -> String {
    let m = s.memory.as_ref().unwrap();
    let mut out = format!("- «{}» ({}): {}", s.title, s.updated_at.with_timezone(&chrono::Local).format("%d/%m"), m.summary);
    if !m.pending.is_empty() {
        out.push_str(&format!(" Pendiente: {}.", m.pending.join("; ")));
    }
    if !m.struggled.is_empty() {
        out.push_str(&format!(" Le costó: {}.", m.struggled.join("; ")));
    }
    out
}

/// `recall` kind "sesiones": past sessions whose memory mentions the query.
pub fn recall(sessions: &[Session], query: &str, current_id: &str) -> Vec<String> {
    let words: Vec<String> = crate::graph::normalize(query).split_whitespace().filter(|w| w.len() > 3).map(String::from).collect();
    let mut hits: Vec<&Session> = sessions
        .iter()
        .filter(|s| s.id != current_id && has_memory(s))
        .filter(|s| {
            let m = s.memory.as_ref();
            let text = crate::graph::normalize(&format!("{} {} {} {}", s.title, m.map_or("", |m| m.summary.as_str()), m.map(|m| m.pending.join(" ")).unwrap_or_default(), m.map(|m| m.struggled.join(" ")).unwrap_or_default()));
            words.iter().any(|w| text.contains(w.as_str()))
        })
        .collect();
    hits.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    hits.into_iter().take(4).map(|s| line(s).replacen("- ", "- Sesión ", 1)).collect()
}

/// For the phases where picking up a thread helps (chat, measuring, planning).
pub fn wants_history(s: &Session) -> bool {
    matches!(s.phase, Phase::Chat | Phase::Probe | Phase::Plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::Msg;

    fn reply(text: &str) -> Msg {
        Msg { role: "assistant".into(), content: Some(text.into()), tool_calls: None, tool_call_id: None, meta: None }
    }

    fn chat(title: &str, msgs: usize, minutes_ago: i64) -> Session {
        let mut s = Session::new_chat(title);
        for i in 1..msgs {
            s.messages.push(if i % 2 == 1 { reply("respuesta") } else { Msg::user(format!("mensaje {i}"), None) });
        }
        s.updated_at = Utc::now() - chrono::Duration::minutes(minutes_ago);
        s
    }

    fn remembered(title: &str, summary: &str) -> Session {
        let mut s = chat(title, 6, 60);
        s.memory = Some(SessionMemory { summary: summary.into(), pending: vec!["la demostración".into()], struggled: vec!["la altura".into()], messages: 6, at: Utc::now() });
        s
    }

    #[test]
    fn a_quiet_session_with_new_messages_is_due_and_a_busy_or_seen_one_is_not() {
        let now = Utc::now();
        assert!(due(&chat("triángulos", 6, 15), now));
        assert!(!due(&chat("triángulos", 6, 5), now), "still active");
        assert!(!due(&chat("hola", 2, 60), now), "too little to remember");
        let mut seen = chat("triángulos", 6, 60);
        seen.memory = Some(SessionMemory { summary: "x".into(), pending: vec![], struggled: vec![], messages: 6, at: now });
        assert!(!due(&seen, now), "nothing new since the last pass");
        seen.messages.extend((0..4).map(|_| Msg::user("más".to_string(), None)));
        assert!(due(&seen, now), "enough new messages");
        let mut silent = chat("x", 6, 60);
        silent.messages.retain(|m| m.role != "user");
        assert!(!due(&silent, now), "the person never spoke");
    }

    #[test]
    fn parses_the_memory_and_refuses_an_empty_one() {
        let m = parse(r#"{"summary":" Vimos triángulos. ","pending":["demostración"," ",""],"struggled":["altura","a","b","c","d"]}"#, 9).unwrap();
        assert_eq!(m.summary, "Vimos triángulos.");
        assert_eq!(m.pending, vec!["demostración"]);
        assert_eq!(m.struggled.len(), 4);
        assert_eq!(m.messages, 9);
        assert!(parse(r#"{"summary":"  "}"#, 1).is_err());
        assert!(parse("no json", 1).is_err());
    }

    #[test]
    fn the_agent_sees_the_latest_remembered_sessions_but_not_the_current_one() {
        let current = remembered("hoy", "la sesión de ahora");
        let mut old = remembered("vieja", "algo de hace mucho");
        old.updated_at = Utc::now() - chrono::Duration::days(10);
        let all = vec![current.clone(), remembered("triángulos", "Vimos el triángulo equilátero."), old, chat("sin memoria", 6, 60), remembered("a", "a"), remembered("b", "b")];
        let block = state_section(&all, &current);
        assert!(block.contains("«triángulos»") && block.contains("Pendiente: la demostración.") && block.contains("Le costó: la altura."));
        assert!(!block.contains("la sesión de ahora") && !block.contains("sin memoria") && !block.contains("hace mucho"), "{block}");
        assert_eq!(block.matches("\n- «").count(), RECENT_IN_STATE);
        assert_eq!(state_section(&[current.clone()], &current), "");
        let mut forgotten = remembered("olvidada", "secreto");
        forgotten.memory = Some(SessionMemory::forgotten(6));
        assert_eq!(state_section(&[forgotten.clone()], &current), "");
        assert!(recall(&[forgotten.clone()], "olvidada", "x").is_empty());
        assert!(!due(&forgotten, Utc::now()), "a forgotten memory isn't rebuilt from the same messages");
    }

    #[test]
    fn recall_finds_past_sessions_by_their_memory() {
        let all = vec![remembered("geometría", "Vimos el triángulo equilátero y su altura."), remembered("historia", "La revolución de mayo.")];
        let hits = recall(&all, "triángulo", "otra");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].starts_with("- Sesión «geometría»"), "{hits:?}");
        assert!(recall(&all, "triángulo", &all[0].id).is_empty(), "not the current one");
        assert!(recall(&all, "de", "otra").is_empty(), "short words don't match everything");
    }

    #[test]
    fn tidy_archives_long_idle_unpinned_sessions_and_drops_old_repaired_confusions() {
        let dir = std::env::temp_dir().join(format!("la-memory-{}", uuid::Uuid::new_v4()));
        let st = AppState::new(dir.clone());
        let mut old = chat("vieja", 4, 0);
        let mut pinned = chat("fijada", 4, 0);
        pinned.pinned = true;
        let mut recent = chat("reciente", 4, 0);
        for s in [&mut old, &mut pinned, &mut recent] {
            st.sessions.save(s).unwrap();
        }
        for s in [&mut old, &mut pinned] {
            s.updated_at = Utc::now() - chrono::Duration::days(ARCHIVE_AFTER_DAYS + 1);
            st.sessions.save_quiet(s).unwrap();
        }
        st.learner
            .update(|p| {
                crate::learner::add_misconception(p, "vieja reparada", "x", true, "s");
                crate::learner::add_misconception(p, "abierta", "y", false, "s");
                crate::learner::add_misconception(p, "reparada nueva", "z", true, "s");
                p.misconceptions.iter_mut().filter(|m| m.concept != "reparada nueva").for_each(|m| m.at = Utc::now() - chrono::Duration::days(FORGET_FIXED_AFTER_DAYS + 1));
            })
            .unwrap();
        assert_eq!(tidy(&st, Utc::now()).unwrap(), 2);
        assert!(st.sessions.load(&old.id).unwrap().archived);
        assert!(!st.sessions.load(&pinned.id).unwrap().archived);
        assert!(!st.sessions.load(&recent.id).unwrap().archived);
        let concepts: Vec<String> = st.learner.load().misconceptions.into_iter().map(|m| m.concept).collect();
        assert_eq!(concepts, vec!["reparada nueva", "abierta"]);
        assert!(tidy_due(&dir, chrono::Local::now().date_naive()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_some_phases_want_history_and_backoff_blocks_a_failed_session() {
        assert!(wants_history(&chat("x", 2, 0)));
        let b = Backoff::default();
        assert!(!b.blocked("a"));
        b.fail("a");
        assert!(b.blocked("a") && !b.blocked("b"));
    }
}
