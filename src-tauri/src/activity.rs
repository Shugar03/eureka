//! AC-141: the days the learner studied, for the kind streak on the home panel.
//!
//! A small log of "something was studied today" (a conversation, a focus
//! block, a card, a problem, a mock exam) per local day. The Acompañamiento
//! journal never counts: it is private and it is not study.
//!
//! Reading also folds in what older versions already left on disk (the study
//! log, the last review of each card, the last update of each session), so a
//! learner who used Eureka before this existed does not start from zero.

use crate::AppState;
use anyhow::{bail, Result};
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// What can count as a day of study.
pub const KINDS: &[&str] = &["chat", "focus", "cards", "practice", "exam", "class"];
/// Days kept in the log (about three years).
const MAX_DAYS: usize = 1100;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Log {
    #[serde(default)]
    days: BTreeMap<String, BTreeMap<String, u32>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DayActivity {
    /// Local day, YYYY-MM-DD.
    pub day: String,
    /// What was done that day, among `KINDS`.
    pub kinds: Vec<String>,
    /// Minutes of finished focus blocks that day.
    pub minutes: u32,
}

/// The learner's local day today (the machine's time zone is theirs).
pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn local_day(t: &DateTime<Utc>) -> String {
    t.with_timezone(&Local).format("%Y-%m-%d").to_string()
}

fn valid_day(d: &str) -> bool {
    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok() && d.len() == 10
}

pub struct ActivityLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl ActivityLog {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("activity.json"), lock: Mutex::new(()) }
    }

    fn read(&self) -> Log {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Notes that `kind` happened on `day`. Never fails the action it comes
    /// from: callers ignore the result.
    pub fn record(&self, day: &str, kind: &str) -> Result<()> {
        if !valid_day(day) || !KINDS.contains(&kind) {
            bail!("actividad inválida");
        }
        let _g = self.lock.lock().unwrap();
        let mut log = self.read();
        *log.days.entry(day.to_string()).or_default().entry(kind.to_string()).or_default() += 1;
        while log.days.len() > MAX_DAYS {
            let first = log.days.keys().next().cloned().unwrap();
            log.days.remove(&first);
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(&log)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    /// Records `kind` today, ignoring errors (a streak must never break an action).
    pub fn touch(&self, kind: &str) {
        let _ = self.record(&today(), kind);
    }
}

/// Every day with study on or after `since`, oldest first.
pub fn days(state: &AppState, since: &str) -> Vec<DayActivity> {
    let mut map: BTreeMap<String, (BTreeSet<String>, f64)> = BTreeMap::new();
    let mut add = |day: String, kind: &str, minutes: f64| {
        if day.as_str() >= since && valid_day(&day) {
            let e = map.entry(day).or_default();
            e.0.insert(kind.to_string());
            e.1 += minutes;
        }
    };
    for (day, kinds) in state.activity.read().days {
        for k in kinds.keys() {
            add(day.clone(), k, 0.0);
        }
    }
    for e in state.study.since(since) {
        add(e.day.clone(), "focus", e.minutes);
    }
    for deck in state.decks.all() {
        for c in deck.cards {
            if let Some(r) = c.reviewed {
                add(r, "cards", 0.0);
            }
        }
    }
    for s in state.sessions.list() {
        add(local_day(&s.updated_at), "chat", 0.0);
    }
    map.into_iter()
        .map(|(day, (kinds, minutes))| DayActivity { day, kinds: KINDS.iter().filter(|k| kinds.contains(**k)).map(|k| k.to_string()).collect(), minutes: minutes.round() as u32 })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> (ActivityLog, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-activity-{}", uuid::Uuid::new_v4().simple()));
        (ActivityLog::new(&dir), dir)
    }

    #[test]
    fn records_by_day_and_kind_and_refuses_nonsense() {
        let (l, dir) = log();
        l.record("2026-10-27", "chat").unwrap();
        l.record("2026-10-27", "chat").unwrap();
        l.record("2026-10-28", "cards").unwrap();
        let days = l.read().days;
        assert_eq!(days["2026-10-27"]["chat"], 2);
        assert_eq!(days["2026-10-28"]["cards"], 1);
        assert!(l.record("ayer", "chat").is_err());
        assert!(l.record("2026-13-40", "chat").is_err());
        assert!(l.record("2026-10-28", "diario").is_err(), "the private journal is not a kind");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn keeps_about_three_years() {
        let (l, dir) = log();
        let start = chrono::NaiveDate::from_ymd_opt(2020, 1, 1).unwrap();
        for i in 0..(MAX_DAYS + 5) {
            l.record(&(start + chrono::Days::new(i as u64)).format("%Y-%m-%d").to_string(), "focus").unwrap();
        }
        let days = l.read().days;
        assert_eq!(days.len(), MAX_DAYS);
        assert!(!days.contains_key("2020-01-01"), "the oldest go first");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn days_fold_in_the_log_focus_blocks_card_reviews_and_sessions() {
        let dir = std::env::temp_dir().join(format!("la-activity-st-{}", uuid::Uuid::new_v4().simple()));
        let st = AppState::new(dir.clone());
        st.activity.record("2026-10-20", "practice").unwrap();
        st.activity.record("2026-10-20", "exam").unwrap();
        st.study.append(&crate::study::StudyEntry { at: Utc::now(), day: "2026-10-21".into(), minutes: 25.0, context: None }).unwrap();
        st.study.append(&crate::study::StudyEntry { at: Utc::now(), day: "2026-10-21".into(), minutes: 24.6, context: None }).unwrap();
        st.study.append(&crate::study::StudyEntry { at: Utc::now(), day: "2026-09-01".into(), minutes: 25.0, context: None }).unwrap();
        let mut deck = crate::cards::create_empty(&st, "Mazo").unwrap();
        deck.cards.push(crate::cards::Card { id: "c".into(), front: "f".into(), back: "b".into(), ease: 2.5, interval: 1, reps: 1, lapses: 0, due: "2026-10-23".into(), reviewed: Some("2026-10-22".into()) });
        st.decks.save(&mut deck).unwrap();
        let mut s = crate::session::Session::new("algo");
        st.sessions.save(&mut s).unwrap();
        let today = local_day(&s.updated_at);

        let d = days(&st, "2026-10-01");
        let get = |day: &str| d.iter().find(|x| x.day == day).cloned();
        assert_eq!(get("2026-10-20").unwrap().kinds, vec!["practice", "exam"], "in KINDS order");
        assert_eq!(get("2026-10-21").unwrap(), DayActivity { day: "2026-10-21".into(), kinds: vec!["focus".into()], minutes: 50 });
        assert_eq!(get("2026-10-22").unwrap().kinds, vec!["cards"]);
        assert!(get(&today).unwrap().kinds.contains(&"chat".to_string()));
        assert!(get("2026-09-01").is_none(), "before `since` is left out");
        assert!(d.windows(2).all(|w| w[0].day < w[1].day), "oldest first");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn today_is_a_local_date() {
        assert!(valid_day(&today()));
    }
}
