//! Learning sessions: one JSON file per session under `<data>/sessions/`.

use crate::llm::Msg;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Free conversation: no learning goal yet. The agent decides, with its tools,
    /// whether and when to start the method (`begin_learning`).
    Chat,
    /// Measure: find where understanding ends on each prerequisite.
    Probe,
    /// Plan: build the dependency map from the starting point to the goal.
    Plan,
    /// Teach: build understanding one step at a time.
    Teach,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Solid,
    Partial,
    Missing,
    Misconception,
}

/// What the prober learned about one prerequisite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub concept: String,
    pub level: Level,
    pub evidence: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Known,
    Pending,
    Current,
    Understood,
    Repair,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanNode {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub status: NodeStatus,
    #[serde(default)]
    pub note: String,
}

/// AC-34: a session that studies one topic of an exam's syllabus.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExamLink {
    pub exam_id: String,
    pub exam_name: String,
    pub domain: String,
    pub weight: f64,
    pub topic_id: String,
    pub objectives: Vec<String>,
    /// AC-61: set for a programming path ("python", "rust"…).
    #[serde(default)]
    pub lang: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub phase: Phase,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub findings: Vec<Finding>,
    #[serde(default)]
    pub plan: Vec<PlanNode>,
    /// Tool-call id of the question awaiting an answer, if any.
    #[serde(default)]
    pub pending_question: Option<String>,
    #[serde(default)]
    pub messages: Vec<Msg>,
    /// Set once the session was extracted into the knowledge graph.
    #[serde(default)]
    pub graph: Option<crate::graph::GraphSummary>,
    #[serde(default)]
    pub exam: Option<ExamLink>,
    /// Audit item 18: rolling summary of the messages the window dropped.
    #[serde(default)]
    pub summary: String,
    /// `messages[1..summarized_upto]` are covered by `summary`.
    #[serde(default)]
    pub summarized_upto: usize,
    /// AC-108: what the session left in memory (summary, pending, what was hard).
    #[serde(default)]
    pub memory: Option<crate::memory::SessionMemory>,
    /// AC-107: hidden from the lists, still remembered.
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub phase: Phase,
    pub updated_at: DateTime<Utc>,
    pub plan_total: usize,
    pub plan_done: usize,
    pub archived: bool,
    pub pinned: bool,
}

impl Session {
    pub fn new(goal: &str) -> Self {
        let now = Utc::now();
        let title: String = goal.chars().take(80).collect();
        Self {
            id: uuid::Uuid::new_v4().simple().to_string(),
            title,
            goal: goal.to_string(),
            phase: Phase::Probe,
            created_at: now,
            updated_at: now,
            findings: vec![],
            plan: vec![],
            pending_question: None,
            messages: vec![Msg::user(format!("Quiero entender: {goal}"), None)],
            graph: None,
            exam: None,
            summary: String::new(),
            summarized_upto: 0,
            memory: None,
            archived: false,
            pinned: false,
        }
    }

    /// A conversation with no learning goal yet: the first message is whatever
    /// the person wrote ("hola", a question, a list of topics…).
    pub fn new_chat(message: &str) -> Self {
        let mut s = Self::new("");
        s.phase = Phase::Chat;
        s.title = message.trim().chars().take(60).collect();
        s.messages = vec![Msg::user(message.trim().to_string(), None)];
        s
    }

    pub fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            goal: self.goal.clone(),
            phase: self.phase,
            updated_at: self.updated_at,
            plan_total: self.plan.iter().filter(|n| n.status != NodeStatus::Known).count(),
            plan_done: self.plan.iter().filter(|n| n.status == NodeStatus::Understood).count(),
            archived: self.archived,
            pinned: self.pinned,
        }
    }
}

pub struct SessionStore {
    dir: PathBuf,
}

impl SessionStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("sessions") }
    }

    fn path(&self, id: &str) -> PathBuf {
        // Ids are generated by us; still guard against path tricks.
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<Session> {
        let raw = std::fs::read_to_string(self.path(id)).context("sesión no encontrada")?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save(&self, s: &mut Session) -> Result<()> {
        s.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&s.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
        std::fs::rename(tmp, self.path(&s.id))?;
        Ok(())
    }

    /// Saves without touching `updated_at`: pinning, archiving or the memory pass
    /// aren't activity (the list order and the idle timer stay as they were).
    pub fn save_quiet(&self, s: &Session) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&s.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
        std::fs::rename(tmp, self.path(&s.id))?;
        Ok(())
    }

    /// Every session, whole (for the memory pass).
    pub fn all(&self) -> Vec<Session> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Session>(&raw).ok())
            .collect()
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<SessionSummary> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Session>(&raw).ok())
            .map(|s| s.summary())
            .collect();
        // Pinned first, then the most recent.
        out.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated_at.cmp(&a.updated_at)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (SessionStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-sessions-{}", uuid::Uuid::new_v4().simple()));
        (SessionStore::new(&dir), dir)
    }

    #[test]
    fn new_session_starts_in_probe_with_the_goal_message() {
        let s = Session::new("  qué es una derivada");
        assert_eq!(s.phase, Phase::Probe);
        assert_eq!(s.messages.len(), 1);
        assert!(s.messages[0].content.as_deref().unwrap().contains("qué es una derivada"));
        assert_eq!(Session::new(&"x".repeat(200)).title.chars().count(), 80);
    }

    #[test]
    fn save_load_list_delete_roundtrip() {
        let (st, dir) = store();
        assert!(st.list().is_empty(), "a missing dir lists nothing");
        let mut a = Session::new("a");
        st.save(&mut a).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut b = Session::new("b");
        st.save(&mut b).unwrap();

        let listed: Vec<String> = st.list().into_iter().map(|s| s.goal).collect();
        assert_eq!(listed, vec!["b", "a"], "most recent first");
        assert_eq!(st.load(&a.id).unwrap().goal, "a");

        st.delete(&a.id).unwrap();
        assert!(st.load(&a.id).is_err());
        assert_eq!(st.list().len(), 1);
        assert!(!dir.join("sessions").read_dir().unwrap().any(|e| e.unwrap().path().extension().is_some_and(|x| x == "tmp")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ids_cannot_escape_the_sessions_dir() {
        let (st, dir) = store();
        assert!(st.path("../../evil").starts_with(dir.join("sessions")));
        assert_eq!(st.path("../a.b/c").file_name().unwrap(), "abc.json");
    }

    #[test]
    fn corrupt_files_are_skipped_in_the_list() {
        let (st, dir) = store();
        let mut a = Session::new("ok");
        st.save(&mut a).unwrap();
        std::fs::write(dir.join("sessions").join("broken.json"), "{ not json").unwrap();
        assert_eq!(st.list().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn summary_counts_progress_excluding_known() {
        let mut s = Session::new("x");
        let node = |id: &str, status| PlanNode { id: id.into(), title: id.into(), summary: String::new(), depends_on: vec![], status, note: String::new() };
        s.plan = vec![node("a", NodeStatus::Known), node("b", NodeStatus::Understood), node("c", NodeStatus::Pending)];
        let sum = s.summary();
        assert_eq!((sum.plan_done, sum.plan_total), (1, 2));
    }

    #[test]
    fn old_files_without_new_fields_still_load() {
        let (st, dir) = store();
        std::fs::create_dir_all(dir.join("sessions")).unwrap();
        let raw = r#"{"id":"abc","title":"t","goal":"g","phase":"teach","created_at":"2026-10-26T00:00:00Z","updated_at":"2026-10-26T00:00:00Z"}"#;
        std::fs::write(dir.join("sessions").join("abc.json"), raw).unwrap();
        let s = st.load("abc").unwrap();
        assert!(s.messages.is_empty() && s.plan.is_empty() && s.pending_question.is_none());
        std::fs::remove_dir_all(dir).ok();
    }
}
