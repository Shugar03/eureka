//! The learner model (harness audit M5): what the app learned about the
//! learner across sessions — confusions and how they study best. Small and
//! capped; written by the extractor (no extra model call) and by graded
//! practice; read through the student model (student.rs); visible and
//! erasable from Mi progreso.

use crate::graph::normalize;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_MISCONCEPTIONS: usize = 30;
pub const MAX_PREFERENCES: usize = 10;
const MAX_LINES: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Misconception {
    pub concept: String,
    pub wrong_idea: String,
    /// Repaired in a later session or practice.
    pub fixed: bool,
    /// Where it came from ("Sesión: …", "Práctica: …").
    pub source: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preference {
    pub text: String,
    pub source: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    #[serde(default)]
    pub misconceptions: Vec<Misconception>,
    #[serde(default)]
    pub preferences: Vec<Preference>,
}

/// Adds or updates a confusion (same concept = same entry), newest first, capped.
pub fn add_misconception(p: &mut Profile, concept: &str, wrong_idea: &str, fixed: bool, source: &str) {
    let (concept, wrong_idea) = (concept.trim(), wrong_idea.trim());
    if concept.is_empty() || wrong_idea.is_empty() {
        return;
    }
    let key = normalize(concept);
    p.misconceptions.retain(|m| normalize(&m.concept) != key);
    p.misconceptions.insert(0, Misconception { concept: concept.chars().take(120).collect(), wrong_idea: wrong_idea.chars().take(300).collect(), fixed, source: source.into(), at: Utc::now() });
    p.misconceptions.truncate(MAX_MISCONCEPTIONS);
}

/// Marks an open confusion about `concept` as repaired (same concept = same entry).
/// False when there was none: nothing is invented.
pub fn mark_fixed(p: &mut Profile, concept: &str, source: &str) -> bool {
    let key = normalize(concept.trim());
    let Some(i) = p.misconceptions.iter().position(|m| !m.fixed && normalize(&m.concept) == key) else { return false };
    let mut m = p.misconceptions.remove(i);
    m.fixed = true;
    m.source = source.into();
    m.at = Utc::now();
    p.misconceptions.insert(0, m);
    true
}

pub fn add_preference(p: &mut Profile, text: &str, source: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    let key = normalize(text);
    p.preferences.retain(|x| normalize(&x.text) != key);
    p.preferences.insert(0, Preference { text: text.chars().take(160).collect(), source: source.into(), at: Utc::now() });
    p.preferences.truncate(MAX_PREFERENCES);
}

/// The extractor's optional `misconceptions` / `preferences` (record_knowledge).
pub fn merge_extraction(p: &mut Profile, args: &Value, source: &str) -> usize {
    let mut n = 0;
    for m in args["misconceptions"].as_array().into_iter().flatten() {
        if let (Some(c), Some(w)) = (m["concept"].as_str(), m["wrong_idea"].as_str()) {
            add_misconception(p, c, w, m["fixed"].as_bool().unwrap_or(false), source);
            n += 1;
        }
    }
    for pref in args["preferences"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        add_preference(p, pref, source);
        n += 1;
    }
    n
}

pub struct LearnerStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl LearnerStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("profile").join("learner.json"), lock: Mutex::new(()) }
    }

    pub fn load(&self) -> Profile {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Read-modify-write under a lock (extraction and practice may overlap).
    pub fn update<T>(&self, f: impl FnOnce(&mut Profile) -> T) -> Result<T> {
        let _g = self.lock.lock().unwrap();
        let mut p = self.load();
        let out = f(&mut p);
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&p)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn entries_merge_by_concept_and_are_capped() {
        let mut p = Profile::default();
        add_misconception(&mut p, "La derivada", "es el área", false, "Sesión: a");
        // AC-111: repairing keeps the wrong idea (it's the history) and only touches an open one.
        let mut q = p.clone();
        assert!(mark_fixed(&mut q, "la derivada", "Práctica: x"));
        assert!(q.misconceptions[0].fixed && q.misconceptions[0].wrong_idea == "es el área" && q.misconceptions[0].source == "Práctica: x");
        assert!(!mark_fixed(&mut q, "la derivada", "Práctica: y"), "already repaired");
        assert!(!mark_fixed(&mut q, "integrales", "Práctica: y"), "nothing to repair");
        add_misconception(&mut p, "la DERIVADA", "es la pendiente de la secante", true, "Sesión: b");
        assert_eq!(p.misconceptions.len(), 1);
        assert!(p.misconceptions[0].fixed && p.misconceptions[0].source == "Sesión: b");
        for i in 0..40 {
            add_misconception(&mut p, &format!("c{i}"), "x", false, "s");
            add_preference(&mut p, &format!("pref {i}"), "s");
        }
        assert_eq!((p.misconceptions.len(), p.preferences.len()), (MAX_MISCONCEPTIONS, MAX_PREFERENCES));
        assert_eq!(p.misconceptions[0].concept, "c39", "newest first");
        add_misconception(&mut p, " ", "x", false, "s");
        assert_eq!(p.misconceptions[0].concept, "c39");
    }

    #[test]
    fn the_extractor_fills_the_profile() {
        let mut p = Profile::default();
        let args = json!({ "propositions": [], "chains": [], "misconceptions": [{ "concept": "Límite", "wrong_idea": "es el valor en el punto", "fixed": true }, { "concept": "x" }], "preferences": ["aprende mejor con ejemplos numéricos"] });
        assert_eq!(merge_extraction(&mut p, &args, "Sesión: derivadas"), 2);
        assert_eq!(p.misconceptions[0].wrong_idea, "es el valor en el punto");
        assert_eq!(p.preferences[0].text, "aprende mejor con ejemplos numéricos");
        assert_eq!(merge_extraction(&mut Profile::default(), &json!({ "propositions": [] }), "s"), 0, "older extractions without the fields");
    }

    #[test]
    fn store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("la-learner-{}", uuid::Uuid::new_v4().simple()));
        let st = LearnerStore::new(&dir);
        assert_eq!(st.load(), Profile::default());
        st.update(|p| add_preference(p, "ejemplos", "s")).unwrap();
        assert_eq!(st.load().preferences.len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }
}
