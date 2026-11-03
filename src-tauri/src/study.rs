//! Study log (AC-49): an append-only `study_log.jsonl` of finished focus
//! blocks (pomodoros). The UI adds up minutes per day and per context; the
//! study plan compares them with the weekly goal.

use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_MINUTES: f64 = 600.0;

/// What the learner was studying (the screen they were on).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyContext {
    /// "session", "exam", "deck", "practice", "subject"…
    pub kind: String,
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyEntry {
    pub at: DateTime<Utc>,
    /// The learner's local day, YYYY-MM-DD.
    pub day: String,
    pub minutes: f64,
    #[serde(default)]
    pub context: Option<StudyContext>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StudyInput {
    pub day: String,
    pub minutes: f64,
    #[serde(default)]
    pub context: Option<StudyContext>,
}

pub fn validate(input: StudyInput) -> Result<StudyEntry> {
    let day = NaiveDate::parse_from_str(input.day.trim(), "%Y-%m-%d").map_err(|_| anyhow!("día inválido"))?;
    if !(input.minutes > 0.0 && input.minutes <= MAX_MINUTES) {
        return Err(anyhow!("los minutos tienen que estar entre 0 y {MAX_MINUTES}"));
    }
    let context = input.context.filter(|c| !c.id.trim().is_empty()).map(|c| StudyContext { title: c.title.chars().take(120).collect(), ..c });
    Ok(StudyEntry { at: Utc::now(), day: day.to_string(), minutes: (input.minutes * 10.0).round() / 10.0, context })
}

pub struct StudyLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl StudyLog {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("study_log.jsonl"), lock: Mutex::new(()) }
    }

    pub fn append(&self, e: &StudyEntry) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(f, "{}", serde_json::to_string(e)?)?;
        Ok(())
    }

    /// Entries on `since` (local day) or later; corrupt lines are skipped.
    pub fn since(&self, since: &str) -> Vec<StudyEntry> {
        let Ok(raw) = std::fs::read_to_string(&self.path) else { return vec![] };
        raw.lines().filter_map(|l| serde_json::from_str::<StudyEntry>(l).ok()).filter(|e| e.day.as_str() >= since).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(day: &str, minutes: f64) -> StudyInput {
        StudyInput { day: day.into(), minutes, context: Some(StudyContext { kind: "exam".into(), id: "e1".into(), title: "AWS".into() }) }
    }

    #[test]
    fn entries_are_validated() {
        let e = validate(input(" 2026-10-27 ", 25.04)).unwrap();
        assert_eq!((e.day.as_str(), e.minutes), ("2026-10-27", 25.0));
        assert!(validate(input("27/10/2026", 25.0)).is_err());
        assert!(validate(input("2026-10-27", 0.0)).is_err());
        assert!(validate(input("2026-10-27", 601.0)).is_err());
        let mut blank = input("2026-10-27", 5.0);
        blank.context.as_mut().unwrap().id = " ".into();
        assert_eq!(validate(blank).unwrap().context, None);
    }

    #[test]
    fn log_appends_and_filters_by_day() {
        let dir = std::env::temp_dir().join(format!("la-study-{}", uuid::Uuid::new_v4().simple()));
        let log = StudyLog::new(&dir);
        assert!(log.since("2026-01-01").is_empty());
        log.append(&validate(input("2026-10-20", 25.0)).unwrap()).unwrap();
        log.append(&validate(input("2026-10-27", 50.0)).unwrap()).unwrap();
        std::fs::OpenOptions::new().append(true).open(dir.join("study_log.jsonl")).unwrap().write_all(b"{roto\n").unwrap();
        assert_eq!(log.since("2026-10-21").iter().map(|e| e.minutes).collect::<Vec<_>>(), [50.0]);
        assert_eq!(log.since("2026-10-01").len(), 2, "corrupt lines skipped");
        std::fs::remove_dir_all(dir).ok();
    }
}
