//! The student's memory (AC-195..AC-200), in the style of an agent memory
//! engine: observations about the learner in SQLite (`memory/memoria.sqlite`).
//!
//! - Each observation has a stable topic (`tema`, e.g. `concepto:derivada`),
//!   derived in Rust from its stemmed words, so saving the same thing again
//!   updates it and adds evidence instead of duplicating it.
//! - A new observation that contradicts another of the same topic ("domina"
//!   against "le cuesta") is resolved by a rule when it can (the verified and
//!   most recent wins); only when the two criteria disagree is it left for the
//!   cheap model (`memory::resolve_conflicts`).
//! - Full-text search (FTS5) over the library's stemmed terms, so `recall`
//!   finds plurals, roots and paraphrases, and reads previews first.
//! - What the student edits is verified and the background never overwrites
//!   it; what the student deletes leaves a tombstone so it isn't rebuilt from
//!   the same evidence.
//!
//! The old files (graph ledger, learner profile, session memories) stay as they
//! are: this store is filled from them once (`migrate`, resumable and
//! idempotent) and then in parallel by the same writers.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::graph::{normalize, RawChain, RawProposition, Source};
use crate::memory::SessionMemory;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Domina,
    LeCuesta,
    Confusion,
    Preferencia,
    Pendiente,
    Idea,
}

impl Kind {
    pub const ALL: [Kind; 6] = [Kind::LeCuesta, Kind::Confusion, Kind::Pendiente, Kind::Domina, Kind::Preferencia, Kind::Idea];

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Domina => "domina",
            Kind::LeCuesta => "le_cuesta",
            Kind::Confusion => "confusion",
            Kind::Preferencia => "preferencia",
            Kind::Pendiente => "pendiente",
            Kind::Idea => "idea",
        }
    }

    pub fn parse(s: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.as_str() == s)
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Domina => "Ya lo domina",
            Kind::LeCuesta => "Le cuesta",
            Kind::Confusion => "Confusión",
            Kind::Preferencia => "Cómo aprende mejor",
            Kind::Pendiente => "Pendiente",
            Kind::Idea => "Idea entendida",
        }
    }

    fn prefix(self) -> &'static str {
        match self {
            Kind::Preferencia => "preferencia",
            Kind::Idea => "idea",
            _ => "concepto",
        }
    }

    /// Two kinds that cannot both hold for one topic.
    fn contradicts(self, other: Kind) -> bool {
        matches!((self, other), (Kind::Domina, Kind::LeCuesta | Kind::Confusion) | (Kind::LeCuesta | Kind::Confusion, Kind::Domina))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Evidence {
    /// Where it came from, as a key: `session:<id>` (extractor), `memory:<id>`
    /// (session memory), `notes:<id>`, `practice:<id>`, `perfil`, `student`.
    pub source: String,
    /// The same, for people: "Sesión: derivadas", "Práctica: …", "Lo corregiste vos".
    pub label: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Observation {
    pub id: i64,
    pub topic: String,
    pub kind: Kind,
    pub title: String,
    pub content: String,
    pub evidence: Vec<Evidence>,
    pub confidence: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// A practice, an exam or the student confirmed it.
    pub verified: bool,
    /// The student wrote or corrected it: the background never overwrites it.
    pub by_student: bool,
    /// When to review it (YYYY-MM-DD), set by the daily hygiene.
    pub due: Option<String>,
    /// "activa" | "reparada" | "reemplazada" | "borrada".
    pub state: String,
    /// An open contradiction waiting for a decision.
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Relation {
    pub from: i64,
    pub to: i64,
    /// "reemplaza" | "contradice" | "relacionada" | "prerrequisito".
    pub kind: String,
    /// "regla" | "modelo" | "estudiante" | "extractor" | "pendiente" (not decided yet).
    pub decided_by: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionRow {
    pub rowid: i64,
    pub id: String,
    pub title: String,
    pub summary: String,
    pub pending: Vec<String>,
    pub struggled: Vec<String>,
    pub at: DateTime<Utc>,
}

/// What a writer proposes.
#[derive(Debug, Clone)]
pub struct Note {
    pub kind: Kind,
    pub title: String,
    pub content: String,
    pub evidence: Evidence,
    pub verified: bool,
    /// For a confusion: it was repaired.
    pub repaired: bool,
}

impl Note {
    pub fn new(kind: Kind, title: &str, content: &str, source: &str, label: &str, at: DateTime<Utc>) -> Self {
        Note { kind, title: title.into(), content: content.into(), evidence: Evidence { source: source.into(), label: label.into(), at }, verified: false, repaired: false }
    }
}

/// What a batch of writes did (the migration report, and the measurements).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Counts {
    pub created: usize,
    /// Saved again under an existing topic, from another source: a duplicate that wasn't.
    pub merged: usize,
    pub skipped: usize,
    pub contradictions: usize,
    /// Of those, left for the model.
    pub ambiguous: usize,
    pub relations: usize,
}

impl Counts {
    fn add(&mut self, o: &Counts) {
        self.created += o.created;
        self.merged += o.merged;
        self.skipped += o.skipped;
        self.contradictions += o.contradictions;
        self.ambiguous += o.ambiguous;
        self.relations += o.relations;
    }
}

const MAX_TITLE: usize = 160;
const MAX_CONTENT: usize = 600;
const MAX_EVIDENCE: usize = 8;
const COLS: &str = "id, topic, kind, title, content, evidence, confidence, created_at, updated_at, verified, by_student, due, state";
/// Active states: what the teacher and the view see.
const LIVE: &str = "state IN ('activa','reparada')";

fn ts(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_ts(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now())
}

fn cap(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

/// The stemmed words of a text, sorted and unique (the library's stemming).
pub fn stems(text: &str) -> Vec<String> {
    let mut v: Vec<String> = crate::library::terms(text).into_iter().filter(|t| !t.starts_with('~')).collect();
    v.sort();
    v.dedup();
    v
}

/// The stable topic of an observation: kind family + its stemmed words.
/// "La derivada" and "las derivadas" are `concepto:derivada`.
pub fn topic(kind: Kind, title: &str) -> String {
    let s = stems(title);
    let body = if s.is_empty() { normalize(title).replace(' ', "-") } else { s.join("-") };
    format!("{}:{}", kind.prefix(), body)
}

/// The words of a topic key (after the prefix).
fn topic_words(topic: &str) -> HashSet<&str> {
    topic.split_once(':').map_or("", |(_, b)| b).split('-').filter(|w| !w.is_empty()).collect()
}

/// Two topics that are evidently the same: most of the words of BOTH are shared.
fn near(a: &str, b: &str) -> bool {
    let (wa, wb) = (topic_words(a), topic_words(b));
    let big = wa.len().max(wb.len());
    big > 0 && wa.intersection(&wb).count() * 2 > big
}

/// The same topic as stored: equal, or a concept evidently the same (the way
/// `note` files a near topic under the existing one). Use this, never `==`,
/// when matching a recomputed `topic()` against stored ones.
pub fn same_topic(a: &str, b: &str) -> bool {
    a == b || (a.starts_with("concepto:") && b.starts_with("concepto:") && near(a, b))
}

/// Ids of the observations of `kind` filed under a topic matching `t`.
fn ids_of(tx: &Transaction, t: &str, kind: Kind) -> Result<Vec<i64>> {
    let rows: Vec<(i64, String)> = tx.prepare("SELECT id, topic FROM observations WHERE kind = ?1")?.query_map([kind.as_str()], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows.into_iter().filter(|(_, x)| same_topic(x, t)).map(|(id, _)| id).collect())
}

/// FTS5 query from free text: each stemmed term (and root) quoted, OR'ed.
/// Quoting keeps words like AND, NOT or a stray `:` from being syntax.
fn fts_query(text: &str) -> Option<String> {
    let mut terms = crate::library::terms(text);
    terms.sort();
    terms.dedup();
    (!terms.is_empty()).then(|| terms.iter().map(|t| format!("\"{}\"", t.replace('"', ""))).collect::<Vec<_>>().join(" OR "))
}

fn row_obs(r: &rusqlite::Row) -> rusqlite::Result<Observation> {
    let kind: String = r.get(2)?;
    let evidence: String = r.get(5)?;
    Ok(Observation {
        id: r.get(0)?,
        topic: r.get(1)?,
        kind: Kind::parse(&kind).unwrap_or(Kind::Idea),
        title: r.get(3)?,
        content: r.get(4)?,
        evidence: serde_json::from_str(&evidence).unwrap_or_default(),
        confidence: r.get(6)?,
        created_at: parse_ts(&r.get::<_, String>(7)?),
        updated_at: parse_ts(&r.get::<_, String>(8)?),
        verified: r.get::<_, i64>(9)? != 0,
        by_student: r.get::<_, i64>(10)? != 0,
        due: r.get(11)?,
        state: r.get(12)?,
        conflict: false,
    })
}

fn row_session(r: &rusqlite::Row) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        rowid: r.get(0)?,
        id: r.get(1)?,
        title: r.get(2)?,
        summary: r.get(3)?,
        pending: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
        struggled: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
        at: parse_ts(&r.get::<_, String>(6)?),
    })
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    by_student INTEGER NOT NULL DEFAULT 0,
    due TEXT,
    state TEXT NOT NULL DEFAULT 'activa',
    UNIQUE(topic, kind)
);
CREATE TABLE IF NOT EXISTS relations(
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL,
    PRIMARY KEY(from_id, to_id, kind)
);
CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    pending TEXT NOT NULL DEFAULT '[]',
    struggled TEXT NOT NULL DEFAULT '[]',
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migrated(key TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS obs_fts USING fts5(terms, tokenize = "unicode61 tokenchars '~'");
CREATE VIRTUAL TABLE IF NOT EXISTS ses_fts USING fts5(terms, tokenize = "unicode61 tokenchars '~'");
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '1');
"#;

pub struct MemoryDb {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl MemoryDb {
    /// Opened on first use: most of the app (and its tests) never touches it.
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("memory").join("memoria.sqlite"), conn: Mutex::new(None) }
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut g = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_none() {
            std::fs::create_dir_all(self.path.parent().unwrap())?;
            let c = Connection::open(&self.path)?;
            c.busy_timeout(std::time::Duration::from_secs(5))?;
            // WAL with NORMAL sync: a commit neither waits for a full fsync nor
            // creates and deletes a journal file (slow on Windows, antivirus included).
            c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
            c.execute_batch(SCHEMA)?;
            *g = Some(c);
        }
        f(g.as_mut().unwrap())
    }

    fn tx<T>(&self, f: impl FnOnce(&Transaction) -> Result<T>) -> Result<T> {
        self.with(|c| {
            let tx = c.transaction()?;
            let out = f(&tx)?;
            tx.commit()?;
            Ok(out)
        })
    }

    // ── Writing ──

    /// Saves one observation (one transaction).
    pub fn note(&self, n: Note) -> Result<Counts> {
        self.tx(|tx| note_in(tx, n))
    }

    /// The extractor's result for a source: ideas (with their chains as
    /// prerequisites) and, for sessions, confusions and preferences. A new
    /// extraction of a source replaces what that source said before.
    pub fn record_extraction(&self, source: &Source, props: &[RawProposition], chains: &[RawChain], args: &Value, at: DateTime<Utc>) -> Result<Counts> {
        self.tx(|tx| record_extraction_in(tx, source, props, chains, args, at))
    }

    /// A session's memory (summary, pending, what was hard).
    pub fn record_session(&self, id: &str, title: &str, m: &SessionMemory) -> Result<Counts> {
        self.tx(|tx| record_session_in(tx, id, title, m))
    }

    /// A graded practice answer: verified evidence about an idea.
    pub fn record_practice(&self, idea: &str, correct: bool, wrong: &str, set_id: &str, label: &str) -> Result<Counts> {
        self.tx(|tx| {
            let source = format!("practice:{set_id}");
            let at = Utc::now();
            let mut c = Counts::default();
            if correct {
                set_state(tx, &topic(Kind::Confusion, idea), Kind::Confusion, "reparada", at)?;
                let mut n = Note::new(Kind::Domina, idea, "la respondió bien en una práctica", &source, label, at);
                n.verified = true;
                c.add(&note_in(tx, n)?);
            } else {
                let mut n = Note::new(Kind::Confusion, idea, wrong, &source, label, at);
                n.verified = true;
                c.add(&note_in(tx, n)?);
            }
            Ok(c)
        })
    }

    /// "Esto ya lo sé" (or a repair elsewhere): open confusions on the topic are repaired.
    pub fn repair(&self, concept: &str) -> Result<()> {
        self.tx(|tx| set_state(tx, &topic(Kind::Confusion, concept), Kind::Confusion, "reparada", Utc::now()))
    }

    /// Removes what a source said; observations left without evidence go away
    /// (unless the student wrote them). `label` also matches old profile entries.
    pub fn forget_source(&self, source: &str, label: Option<&str>, kinds: Option<&[Kind]>) -> Result<usize> {
        self.tx(|tx| forget_source_in(tx, source, label, kinds))
    }

    /// AC-110: "Olvidar" a session's memory.
    pub fn forget_session(&self, id: &str) -> Result<()> {
        self.tx(|tx| {
            if let Some(rowid) = tx.query_row("SELECT rowid FROM sessions WHERE id = ?1", [id], |r| r.get::<_, i64>(0)).optional()? {
                tx.execute("DELETE FROM ses_fts WHERE rowid = ?1", [rowid])?;
            }
            tx.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
            forget_source_in(tx, &format!("memory:{id}"), None, None)?;
            Ok(())
        })
    }

    /// The student corrects an observation: it becomes theirs and verified.
    pub fn edit(&self, id: i64, title: &str, content: &str, kind: Kind) -> Result<()> {
        let (title, content) = (cap(title, MAX_TITLE), cap(content, MAX_CONTENT));
        if title.is_empty() {
            return Err(anyhow!("El título no puede quedar vacío."));
        }
        self.tx(|tx| {
            let o = get_in(tx, id)?.ok_or_else(|| anyhow!("Eso ya no está en la memoria."))?;
            let now = Utc::now();
            let mut evidence = o.evidence.clone();
            evidence.retain(|e| e.source != "student");
            evidence.insert(0, Evidence { source: "student".into(), label: "Lo corregiste vos".into(), at: now });
            evidence.truncate(MAX_EVIDENCE);
            // Same topic, other kind: if that row exists, it is replaced by this one.
            let target = if kind != o.kind { tx.query_row("SELECT id FROM observations WHERE topic = ?1 AND kind = ?2", params![o.topic, kind.as_str()], |r| r.get::<_, i64>(0)).optional()? } else { None };
            if let Some(other) = target {
                delete_row(tx, other)?;
            }
            tx.execute(
                "UPDATE observations SET title = ?2, content = ?3, kind = ?4, evidence = ?5, updated_at = ?6, verified = 1, by_student = 1, confidence = 1.0, state = 'activa' WHERE id = ?1",
                params![id, title, content, kind.as_str(), serde_json::to_string(&evidence)?, ts(now)],
            )?;
            index_obs(tx, id)?;
            resolve_in(tx, id)?;
            Ok(())
        })
    }

    /// The student deletes an observation: a tombstone (no text) stays so the
    /// same evidence doesn't bring it back.
    pub fn delete(&self, id: i64) -> Result<()> {
        self.tx(|tx| tombstone(tx, id, Utc::now()))
    }

    /// "Olvidar todo": every observation becomes a tombstone.
    pub fn forget_all(&self) -> Result<usize> {
        self.tx(|tx| {
            let ids: Vec<i64> = tx.prepare("SELECT id FROM observations WHERE state != 'borrada'")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            let now = Utc::now();
            for id in &ids {
                tombstone(tx, *id, now)?;
            }
            Ok(ids.len())
        })
    }

    /// Tombstones the observation of a topic (the old profile's "Olvidar").
    pub fn forget_topic(&self, kind: Kind, title: &str) -> Result<()> {
        self.tx(|tx| {
            for id in ids_of(tx, &topic(kind, title), kind)? {
                tombstone(tx, id, Utc::now())?;
            }
            Ok(())
        })
    }

    // ── Conflicts ──

    /// Contradictions the rule left open: (newer, older).
    pub fn pending_conflicts(&self, limit: usize) -> Result<Vec<(Observation, Observation)>> {
        self.with(|c| {
            let pairs: Vec<(i64, i64)> = c.prepare("SELECT from_id, to_id FROM relations WHERE kind = 'contradice' AND decided_by = 'pendiente' LIMIT ?1")?.query_map([limit as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
            let mut out = Vec::new();
            for (a, b) in pairs {
                if let (Some(a), Some(b)) = (get_in(c, a)?, get_in(c, b)?) {
                    out.push((a, b));
                }
            }
            Ok(out)
        })
    }

    /// The model's decision on an open contradiction: "a" (the first), "b" or "ambas".
    pub fn decide(&self, a: i64, b: i64, keep: &str, reason: &str) -> Result<()> {
        self.tx(|tx| {
            tx.execute("DELETE FROM relations WHERE from_id = ?1 AND to_id = ?2 AND kind = 'contradice'", params![a, b])?;
            let now = ts(Utc::now());
            let reason = cap(reason, 200);
            match keep {
                "ambas" => {
                    tx.execute("INSERT OR REPLACE INTO relations VALUES (?1, ?2, 'relacionada', 'modelo', ?3, ?4)", params![a, b, reason, now])?;
                }
                _ => {
                    let (winner, loser) = if keep == "b" { (b, a) } else { (a, b) };
                    tx.execute("UPDATE observations SET state = 'reemplazada' WHERE id = ?1 AND by_student = 0", [loser])?;
                    tx.execute("INSERT OR REPLACE INTO relations VALUES (?1, ?2, 'reemplaza', 'modelo', ?3, ?4)", params![winner, loser, reason, now])?;
                }
            }
            Ok(())
        })
    }

    // ── Reading ──

    pub fn get(&self, id: i64) -> Result<Option<Observation>> {
        self.with(|c| get_in(c, id))
    }

    /// What the view shows: live observations, newest first, with open conflicts flagged.
    pub fn list(&self) -> Result<Vec<Observation>> {
        self.with(|c| {
            let mut out: Vec<Observation> = c.prepare(&format!("SELECT {COLS} FROM observations WHERE {LIVE} ORDER BY updated_at DESC"))?.query_map([], row_obs)?.collect::<rusqlite::Result<_>>()?;
            let open: HashSet<i64> = c
                .prepare("SELECT from_id, to_id FROM relations WHERE kind = 'contradice' AND decided_by = 'pendiente'")?
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
                .flatten()
                .flat_map(|(a, b)| [a, b])
                .collect();
            out.iter_mut().for_each(|o| o.conflict = open.contains(&o.id));
            Ok(out)
        })
    }

    pub fn relations(&self, id: i64) -> Result<Vec<Relation>> {
        self.with(|c| relations_in(c, Some(id)))
    }

    pub fn all_relations(&self) -> Result<Vec<Relation>> {
        self.with(|c| relations_in(c, None))
    }

    /// Full-text search over live observations (BM25), best first.
    pub fn search(&self, query: &str, kinds: &[Kind], limit: usize) -> Result<Vec<Observation>> {
        let Some(q) = fts_query(query) else { return Ok(vec![]) };
        self.with(|c| {
            let sql = format!("SELECT {COLS} FROM obs_fts JOIN observations o ON o.id = obs_fts.rowid WHERE obs_fts MATCH ?1 AND {LIVE} ORDER BY bm25(obs_fts) LIMIT 200");
            let rows: Vec<Observation> = c.prepare(&sql)?.query_map([q], row_obs)?.collect::<rusqlite::Result<_>>()?;
            Ok(rows.into_iter().filter(|o| kinds.is_empty() || kinds.contains(&o.kind)).take(limit).collect())
        })
    }

    pub fn search_sessions(&self, query: &str, except: &str, limit: usize) -> Result<Vec<SessionRow>> {
        let Some(q) = fts_query(query) else { return Ok(vec![]) };
        self.with(|c| {
            let sql = "SELECT s.rowid, s.id, s.title, s.summary, s.pending, s.struggled, s.at FROM ses_fts JOIN sessions s ON s.rowid = ses_fts.rowid WHERE ses_fts MATCH ?1 AND s.id != ?2 ORDER BY bm25(ses_fts) LIMIT ?3";
            let rows = c.prepare(sql)?.query_map(params![q, except, limit as i64], row_session)?.collect::<rusqlite::Result<_>>()?;
            Ok(rows)
        })
    }

    pub fn session(&self, rowid: i64) -> Result<Option<SessionRow>> {
        self.with(|c| Ok(c.query_row("SELECT rowid, id, title, summary, pending, struggled, at FROM sessions WHERE rowid = ?1", [rowid], row_session).optional()?))
    }

    pub fn sessions(&self) -> Result<Vec<SessionRow>> {
        self.with(|c| Ok(c.prepare("SELECT rowid, id, title, summary, pending, struggled, at FROM sessions ORDER BY at DESC")?.query_map([], row_session)?.collect::<rusqlite::Result<_>>()?))
    }

    /// What the student decided, for the student model: their own live
    /// observations, and the tombstones (topic, when) of what they deleted.
    pub fn overrides(&self) -> Result<(Vec<Observation>, Vec<(String, Kind, DateTime<Utc>)>)> {
        self.with(|c| {
            let mine: Vec<Observation> = c.prepare(&format!("SELECT {COLS} FROM observations WHERE by_student = 1 AND {LIVE}"))?.query_map([], row_obs)?.collect::<rusqlite::Result<_>>()?;
            let gone = c
                .prepare("SELECT topic, kind, updated_at FROM observations WHERE state = 'borrada'")?
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
                .flatten()
                .filter_map(|(t, k, at)| Kind::parse(&k).map(|k| (t, k, parse_ts(&at))))
                .collect();
            Ok((mine, gone))
        })
    }

    // ── Hygiene (daily, no model) ──

    /// Sets review dates, joins evident duplicate ideas, and lets old repaired
    /// confusions go. Returns how many observations changed.
    pub fn hygiene(&self, now: DateTime<Utc>) -> Result<usize> {
        self.tx(|tx| {
            let mut changed = 0;
            // Review: what is hard in a week, what is mastered in a month.
            for (kind, days) in [("le_cuesta", 7), ("confusion", 7), ("domina", 30)] {
                changed += tx.execute(&format!("UPDATE observations SET due = date(updated_at, '+{days} days') WHERE kind = ?1 AND state = 'activa' AND due IS NULL"), [kind])?;
            }
            // Repaired confusions older than the old profile's limit go.
            let old = ts(now - chrono::Duration::days(crate::memory::FORGET_FIXED_AFTER_DAYS));
            let ids: Vec<i64> = tx.prepare("SELECT id FROM observations WHERE state = 'reparada' AND by_student = 0 AND updated_at < ?1")?.query_map([old], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            for id in &ids {
                delete_row(tx, *id)?;
            }
            changed += ids.len();
            changed += merge_near_ideas(tx)?;
            Ok(changed)
        })
    }

    // ── Migration ──

    /// Loads the old files once: the graph ledger (latest extraction of each
    /// source, as the graph folds it), the session memories and the learner
    /// profile. Each item is one transaction recorded in `migrated`, so a cut
    /// run resumes and a second run adds nothing. The old files are not touched.
    pub fn migrate(&self, ledger: &[crate::graph::Extraction], sessions: &[crate::session::Session], profile: &crate::learner::Profile) -> Result<Counts> {
        let mut total = Counts::default();
        let done = |tx: &Transaction, key: &str| -> Result<bool> { Ok(tx.query_row("SELECT 1 FROM migrated WHERE key = ?1", [key], |_| Ok(())).optional()?.is_some()) };
        let mark = |tx: &Transaction, key: &str| -> Result<()> {
            tx.execute("INSERT OR IGNORE INTO migrated VALUES (?1, ?2)", params![key, ts(Utc::now())])?;
            Ok(())
        };
        for e in crate::graph::latest(ledger) {
            let key = format!("ledger:{}@{}", e.source.key(), ts(e.at));
            total.add(&self.tx(|tx| {
                if done(tx, &key)? {
                    return Ok(Counts::default());
                }
                let c = record_extraction_in(tx, &e.source, &e.propositions, &e.chains, &Value::Null, e.at)?;
                mark(tx, &key)?;
                Ok(c)
            })?);
        }
        for s in sessions {
            let Some(m) = s.memory.as_ref().filter(|m| !m.summary.is_empty()) else { continue };
            let key = format!("session:{}@{}", s.id, ts(m.at));
            total.add(&self.tx(|tx| {
                if done(tx, &key)? {
                    return Ok(Counts::default());
                }
                let c = record_session_in(tx, &s.id, &s.title, m)?;
                mark(tx, &key)?;
                Ok(c)
            })?);
        }
        for m in &profile.misconceptions {
            let key = format!("perfil:confusion:{}@{}", normalize(&m.concept), ts(m.at));
            total.add(&self.tx(|tx| {
                if done(tx, &key)? {
                    return Ok(Counts::default());
                }
                let mut n = Note::new(Kind::Confusion, &m.concept, &m.wrong_idea, &profile_source(&m.source), &m.source, m.at);
                n.verified = m.source.starts_with("Práctica");
                n.repaired = m.fixed;
                let c = note_in(tx, n)?;
                mark(tx, &key)?;
                Ok(c)
            })?);
        }
        for p in &profile.preferences {
            let key = format!("perfil:preferencia:{}@{}", normalize(&p.text), ts(p.at));
            total.add(&self.tx(|tx| {
                if done(tx, &key)? {
                    return Ok(Counts::default());
                }
                let c = note_in(tx, Note::new(Kind::Preferencia, &p.text, &p.text, &profile_source(&p.source), &p.source, p.at))?;
                mark(tx, &key)?;
                Ok(c)
            })?);
        }
        self.with(|c| {
            c.execute("INSERT OR REPLACE INTO meta VALUES ('migrated_v1', ?1)", [ts(Utc::now())])?;
            Ok(())
        })?;
        Ok(total)
    }

    /// How many live observations, topics, and open contradictions there are.
    pub fn stats(&self) -> Result<(usize, usize, usize)> {
        self.with(|c| {
            let obs: i64 = c.query_row(&format!("SELECT COUNT(*) FROM observations WHERE {LIVE}"), [], |r| r.get(0))?;
            let topics: i64 = c.query_row(&format!("SELECT COUNT(DISTINCT topic) FROM observations WHERE {LIVE}"), [], |r| r.get(0))?;
            let open: i64 = c.query_row("SELECT COUNT(*) FROM relations WHERE kind = 'contradice' AND decided_by = 'pendiente'", [], |r| r.get(0))?;
            Ok((obs as usize, topics as usize, open as usize))
        })
    }

    // ── Export (AC-200) ──

    /// Writes the memory as linked Markdown pages with YAML frontmatter (in the
    /// style of the Open Knowledge Format), a folder Obsidian opens as a vault.
    pub fn export_okf(&self, dir: &Path) -> Result<usize> {
        let obs = self.list()?;
        let rels = self.all_relations()?;
        let sessions = self.sessions()?;
        let pages = crate::memdb::okf::pages(&obs, &rels, &sessions, Utc::now());
        for (path, text) in &pages {
            let p = dir.join(path);
            std::fs::create_dir_all(p.parent().unwrap())?;
            std::fs::write(p, text)?;
        }
        Ok(pages.len())
    }
}

/// The one-time migration from the app's files (AC-195).
pub fn migrate(state: &crate::AppState) -> Result<Counts> {
    state.memdb.migrate(&state.graph.ledger(), &state.sessions.all(), &state.learner.load())
}

/// An old profile entry's source label as a source key ("Sesión: x" → the session isn't known by id).
fn profile_source(label: &str) -> String {
    if label.starts_with("Práctica") {
        "practice:perfil".into()
    } else {
        "perfil".into()
    }
}

fn get_in(c: &Connection, id: i64) -> Result<Option<Observation>> {
    Ok(c.query_row(&format!("SELECT {COLS} FROM observations WHERE id = ?1"), [id], row_obs).optional()?)
}

fn relations_in(c: &Connection, id: Option<i64>) -> Result<Vec<Relation>> {
    let map = |r: &rusqlite::Row| Ok(Relation { from: r.get(0)?, to: r.get(1)?, kind: r.get(2)?, decided_by: r.get(3)?, reason: r.get(4)? });
    Ok(match id {
        Some(id) => c.prepare("SELECT from_id, to_id, kind, decided_by, reason FROM relations WHERE from_id = ?1 OR to_id = ?1")?.query_map([id], map)?.collect::<rusqlite::Result<_>>()?,
        None => c.prepare("SELECT from_id, to_id, kind, decided_by, reason FROM relations")?.query_map([], map)?.collect::<rusqlite::Result<_>>()?,
    })
}

fn index_obs(tx: &Transaction, id: i64) -> Result<()> {
    tx.execute("DELETE FROM obs_fts WHERE rowid = ?1", [id])?;
    if let Some(o) = get_in(tx, id)? {
        if o.state != "borrada" {
            let terms = crate::library::terms(&format!("{} {}", o.title, o.content)).join(" ");
            tx.execute("INSERT INTO obs_fts(rowid, terms) VALUES (?1, ?2)", params![id, terms])?;
        }
    }
    Ok(())
}

fn delete_row(tx: &Transaction, id: i64) -> Result<()> {
    tx.execute("DELETE FROM obs_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM relations WHERE from_id = ?1 OR to_id = ?1", [id])?;
    tx.execute("DELETE FROM observations WHERE id = ?1", [id])?;
    Ok(())
}

fn tombstone(tx: &Transaction, id: i64, now: DateTime<Utc>) -> Result<()> {
    tx.execute("DELETE FROM obs_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM relations WHERE from_id = ?1 OR to_id = ?1", [id])?;
    tx.execute("UPDATE observations SET state = 'borrada', title = '', content = '', evidence = '[]', by_student = 0, verified = 0, updated_at = ?2 WHERE id = ?1", params![id, ts(now)])?;
    Ok(())
}

fn set_state(tx: &Transaction, topic: &str, kind: Kind, state: &str, at: DateTime<Utc>) -> Result<()> {
    for id in ids_of(tx, topic, kind)? {
        tx.execute("UPDATE observations SET state = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'activa' AND by_student = 0", params![id, state, ts(at)])?;
    }
    Ok(())
}

/// A concept topic that already exists and is evidently the same as `t`.
fn resolve_topic(tx: &Transaction, kind: Kind, t: String) -> Result<String> {
    if kind.prefix() != "concepto" {
        return Ok(t);
    }
    let exact: bool = tx.query_row("SELECT 1 FROM observations WHERE topic = ?1 LIMIT 1", [&t], |_| Ok(())).optional()?.is_some();
    if exact {
        return Ok(t);
    }
    let topics: Vec<String> = tx.prepare("SELECT DISTINCT topic FROM observations WHERE topic LIKE 'concepto:%'")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(topics.into_iter().filter(|x| near(x, &t)).max_by_key(|x| topic_words(x).intersection(&topic_words(&t)).count()).unwrap_or(t))
}

fn note_in(tx: &Transaction, n: Note) -> Result<Counts> {
    let mut c = Counts::default();
    let (title, content) = (cap(&n.title, MAX_TITLE), cap(&n.content, MAX_CONTENT));
    if normalize(&title).is_empty() {
        c.skipped += 1;
        return Ok(c);
    }
    let t = resolve_topic(tx, n.kind, topic(n.kind, &title))?;
    let existing = tx.query_row(&format!("SELECT {COLS} FROM observations WHERE topic = ?1 AND kind = ?2"), params![t, n.kind.as_str()], row_obs).optional()?;
    let at = n.evidence.at;
    let id = match existing {
        Some(o) if o.state == "borrada" && at <= o.updated_at => {
            c.skipped += 1;
            return Ok(c);
        }
        Some(o) if o.by_student => {
            c.skipped += 1;
            return Ok(c);
        }
        Some(o) => {
            let mut evidence = o.evidence.clone();
            let new_source = !evidence.iter().any(|e| e.source == n.evidence.source);
            evidence.retain(|e| e.source != n.evidence.source);
            evidence.push(n.evidence.clone());
            evidence.sort_by(|a, b| b.at.cmp(&a.at));
            evidence.truncate(MAX_EVIDENCE);
            let newer = at >= o.updated_at;
            let updated = o.updated_at.max(at);
            let (title, content) = if newer && o.state != "borrada" { (title, if content.is_empty() { o.content.clone() } else { content }) } else if o.state == "borrada" { (title, content) } else { (o.title.clone(), o.content.clone()) };
            let state = match (o.state.as_str(), newer) {
                ("borrada", _) => if n.repaired { "reparada" } else { "activa" },
                (_, true) if n.kind == Kind::Confusion => if n.repaired { "reparada" } else { "activa" },
                ("reemplazada", true) => "activa",
                (s, _) => s,
            }
            .to_string();
            let confidence = if new_source { (o.confidence + 0.1).min(0.95) } else { o.confidence };
            tx.execute(
                "UPDATE observations SET title = ?2, content = ?3, evidence = ?4, updated_at = ?5, verified = ?6, confidence = ?7, state = ?8 WHERE id = ?1",
                params![o.id, title, content, serde_json::to_string(&evidence)?, ts(updated), (o.verified || n.verified) as i64, confidence, state],
            )?;
            if new_source && o.state != "borrada" {
                c.merged += 1;
            } else if o.state == "borrada" {
                c.created += 1;
            }
            o.id
        }
        None => {
            tx.execute(
                "INSERT INTO observations(topic, kind, title, content, evidence, confidence, created_at, updated_at, verified, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)",
                params![t, n.kind.as_str(), title, content, serde_json::to_string(&vec![n.evidence.clone()])?, if n.verified { 0.8 } else { 0.5 }, ts(at), n.verified as i64, if n.kind == Kind::Confusion && n.repaired { "reparada" } else { "activa" }],
            )?;
            c.created += 1;
            tx.last_insert_rowid()
        }
    };
    index_obs(tx, id)?;
    let r = resolve_in(tx, id)?;
    c.contradictions += r.0;
    c.ambiguous += r.1;
    Ok(c)
}

/// Contradictions of `id` with the other live observations of its topic.
/// The rule: the student's word wins; otherwise the verified AND most recent
/// wins; when one is verified and the other more recent, it is left for the
/// model (`contradice`, pending). Returns (contradictions, ambiguous).
fn resolve_in(tx: &Transaction, id: i64) -> Result<(usize, usize)> {
    let Some(r) = get_in(tx, id)? else { return Ok((0, 0)) };
    if r.state != "activa" {
        return Ok((0, 0));
    }
    let others: Vec<Observation> = tx.prepare(&format!("SELECT {COLS} FROM observations WHERE topic = ?1 AND id != ?2 AND state = 'activa'"))?.query_map(params![r.topic, r.id], row_obs)?.collect::<rusqlite::Result<_>>()?;
    let (mut found, mut ambiguous) = (0, 0);
    let now = ts(Utc::now());
    for o in others.into_iter().filter(|o| r.kind.contradicts(o.kind)) {
        found += 1;
        let r_newer = r.updated_at >= o.updated_at;
        let decision: Option<(&Observation, &Observation, &str, &str)> = if o.by_student && !r.by_student {
            Some((&o, &r, "estudiante", "lo corrigió el estudiante"))
        } else if r.by_student {
            Some((&r, &o, "estudiante", "lo corrigió el estudiante"))
        } else {
            match (r.verified, o.verified) {
                (a, b) if a == b => Some(if r_newer { (&r, &o, "regla", "más reciente") } else { (&o, &r, "regla", "más reciente") }),
                (true, false) if r_newer => Some((&r, &o, "regla", "verificada y más reciente")),
                (false, true) if !r_newer => Some((&o, &r, "regla", "verificada y más reciente")),
                _ => None,
            }
        };
        match decision {
            Some((winner, loser, by, reason)) => {
                tx.execute("UPDATE observations SET state = 'reemplazada' WHERE id = ?1", [loser.id])?;
                tx.execute("DELETE FROM relations WHERE kind = 'contradice' AND ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1))", params![winner.id, loser.id])?;
                tx.execute("INSERT OR REPLACE INTO relations VALUES (?1, ?2, 'reemplaza', ?3, ?4, ?5)", params![winner.id, loser.id, by, reason, now])?;
            }
            None => {
                ambiguous += 1;
                let (newer, older) = if r_newer { (&r, &o) } else { (&o, &r) };
                tx.execute("INSERT OR IGNORE INTO relations VALUES (?1, ?2, 'contradice', 'pendiente', '', ?3)", params![newer.id, older.id, now])?;
            }
        }
        if r.kind.contradicts(o.kind) && get_in(tx, r.id)?.is_some_and(|x| x.state != "activa") {
            break;
        }
    }
    Ok((found, ambiguous))
}

fn forget_source_in(tx: &Transaction, source: &str, label: Option<&str>, kinds: Option<&[Kind]>) -> Result<usize> {
    let rows: Vec<Observation> = tx.prepare(&format!("SELECT {COLS} FROM observations WHERE state != 'borrada'"))?.query_map([], row_obs)?.collect::<rusqlite::Result<_>>()?;
    let mut changed = 0;
    for o in rows {
        if kinds.is_some_and(|k| !k.contains(&o.kind)) {
            continue;
        }
        let matches = |e: &Evidence| e.source == source || label.is_some_and(|l| e.label == l);
        if !o.evidence.iter().any(matches) {
            continue;
        }
        let left: Vec<&Evidence> = o.evidence.iter().filter(|e| !matches(e)).collect();
        changed += 1;
        if left.is_empty() && !o.by_student {
            delete_row(tx, o.id)?;
        } else {
            tx.execute("UPDATE observations SET evidence = ?2 WHERE id = ?1", params![o.id, serde_json::to_string(&left)?])?;
        }
    }
    Ok(changed)
}

fn record_extraction_in(tx: &Transaction, source: &Source, props: &[RawProposition], chains: &[RawChain], args: &Value, at: DateTime<Utc>) -> Result<Counts> {
    let (key, label) = match source {
        Source::Session { id, title } => (format!("session:{id}"), format!("Sesión: {title}")),
        Source::Notes { id, title } => (format!("notes:{id}"), format!("Notas: {title}")),
    };
    // The latest extraction of a source replaces its ideas (as the graph folds it).
    forget_source_in(tx, &key, None, Some(&[Kind::Idea]))?;
    let mut c = Counts::default();
    let mut ids: HashMap<&str, i64> = HashMap::new();
    for p in props {
        c.add(&note_in(tx, Note::new(Kind::Idea, &p.text, &p.text, &key, &label, at))?);
        let t = topic(Kind::Idea, &cap(&p.text, MAX_TITLE));
        if let Some(id) = tx.query_row("SELECT id FROM observations WHERE topic = ?1 AND kind = 'idea' AND state != 'borrada'", [t], |r| r.get::<_, i64>(0)).optional()? {
            ids.insert(p.key.as_str(), id);
        }
    }
    for ch in chains {
        let Some(&to) = ids.get(ch.conclusion.as_str()) else { continue };
        for p in &ch.premises {
            if let Some(&from) = ids.get(p.as_str()).filter(|&&f| f != to) {
                c.relations += tx.execute("INSERT OR IGNORE INTO relations VALUES (?1, ?2, 'prerrequisito', 'extractor', '', ?3)", params![from, to, ts(at)])?;
            }
        }
    }
    for m in args["misconceptions"].as_array().into_iter().flatten() {
        if let (Some(concept), Some(wrong)) = (m["concept"].as_str(), m["wrong_idea"].as_str()) {
            let mut n = Note::new(Kind::Confusion, concept, wrong, &key, &label, at);
            n.repaired = m["fixed"].as_bool().unwrap_or(false);
            c.add(&note_in(tx, n)?);
        }
    }
    for p in args["preferences"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        c.add(&note_in(tx, Note::new(Kind::Preferencia, p, p, &key, &label, at))?);
    }
    Ok(c)
}

fn record_session_in(tx: &Transaction, id: &str, title: &str, m: &SessionMemory) -> Result<Counts> {
    let key = format!("memory:{id}");
    let label = format!("Sesión: {title}");
    forget_source_in(tx, &key, None, None)?;
    if let Some(rowid) = tx.query_row("SELECT rowid FROM sessions WHERE id = ?1", [id], |r| r.get::<_, i64>(0)).optional()? {
        tx.execute("DELETE FROM ses_fts WHERE rowid = ?1", [rowid])?;
    }
    if m.summary.is_empty() {
        tx.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        return Ok(Counts::default());
    }
    tx.execute(
        "INSERT INTO sessions(id, title, summary, pending, struggled, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET title = ?2, summary = ?3, pending = ?4, struggled = ?5, at = ?6",
        params![id, title, m.summary, serde_json::to_string(&m.pending)?, serde_json::to_string(&m.struggled)?, ts(m.at)],
    )?;
    let rowid: i64 = tx.query_row("SELECT rowid FROM sessions WHERE id = ?1", [id], |r| r.get(0))?;
    let terms = crate::library::terms(&format!("{title} {} {} {}", m.summary, m.pending.join(" "), m.struggled.join(" "))).join(" ");
    tx.execute("INSERT INTO ses_fts(rowid, terms) VALUES (?1, ?2)", params![rowid, terms])?;
    let mut c = Counts::default();
    for x in &m.struggled {
        c.add(&note_in(tx, Note::new(Kind::LeCuesta, x, x, &key, &label, m.at))?);
    }
    for x in &m.pending {
        c.add(&note_in(tx, Note::new(Kind::Pendiente, x, x, &key, &label, m.at))?);
    }
    Ok(c)
}

/// Evident duplicate ideas (different topics, most words shared): the newer
/// joins the older, which keeps both evidences.
fn merge_near_ideas(tx: &Transaction) -> Result<usize> {
    let ideas: Vec<Observation> = tx.prepare(&format!("SELECT {COLS} FROM observations WHERE kind = 'idea' AND state = 'activa' ORDER BY created_at"))?.query_map([], row_obs)?.collect::<rusqlite::Result<_>>()?;
    let mut gone: HashSet<i64> = HashSet::new();
    let mut merged = 0;
    for (i, a) in ideas.iter().enumerate() {
        if gone.contains(&a.id) {
            continue;
        }
        let dups: Vec<&Observation> = ideas[i + 1..].iter().filter(|b| !gone.contains(&b.id) && !b.by_student && jaccard(&a.topic, &b.topic) >= 0.8).collect();
        for b in dups {
            let mut evidence = a.evidence.clone();
            for e in &b.evidence {
                if !evidence.iter().any(|x| x.source == e.source) {
                    evidence.push(e.clone());
                }
            }
            evidence.truncate(MAX_EVIDENCE);
            tx.execute("UPDATE observations SET evidence = ?2, updated_at = max(updated_at, ?3) WHERE id = ?1", params![a.id, serde_json::to_string(&evidence)?, ts(b.updated_at)])?;
            tx.execute("UPDATE observations SET state = 'reemplazada' WHERE id = ?1", [b.id])?;
            tx.execute("INSERT OR REPLACE INTO relations VALUES (?1, ?2, 'reemplaza', 'regla', 'duplicado evidente', ?3)", params![a.id, b.id, ts(Utc::now())])?;
            gone.insert(b.id);
            merged += 1;
        }
    }
    Ok(merged)
}

fn jaccard(a: &str, b: &str) -> f64 {
    let (wa, wb) = (topic_words(a), topic_words(b));
    let union = wa.union(&wb).count();
    if union == 0 {
        0.0
    } else {
        wa.intersection(&wb).count() as f64 / union as f64
    }
}

/// What the teacher reads from `recall`: a short preview per observation.
pub fn preview(o: &Observation) -> String {
    let kind = match (o.kind, o.state.as_str()) {
        (Kind::Confusion, "reparada") => "Confusión reparada",
        (Kind::Confusion, _) => "Confusión abierta",
        (k, _) => k.label(),
    };
    let src = o.evidence.first().map(|e| format!(" (de «{}»)", e.label.split_once(": ").map_or(e.label.as_str(), |(_, t)| t))).unwrap_or_default();
    let body = if o.content.is_empty() || normalize(&o.content) == normalize(&o.title) { String::new() } else { format!(" — {}", short(&o.content, 100)) };
    let tags = [(o.verified, " [verificada]"), (o.by_student, " [la corrigió el estudiante]"), (o.conflict, " [en conflicto]")].iter().filter(|(b, _)| *b).map(|(_, t)| *t).collect::<String>();
    if o.kind == Kind::Confusion {
        format!("- [M{}] {kind}: «{}»{body}{tags}", o.id, short(&o.title, 100))
    } else {
        format!("- [M{}] {kind}: {}{body}{src}{tags}", o.id, short(&o.title, 140))
    }
}

pub fn short(s: &str, n: usize) -> String {
    let s = s.replace('\n', " ");
    if s.chars().count() <= n {
        s
    } else {
        format!("{}…", s.chars().take(n).collect::<String>().trim_end())
    }
}

pub mod okf;

#[cfg(test)]
#[path = "memdb_tests.rs"]
mod tests;
