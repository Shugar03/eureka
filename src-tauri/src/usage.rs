//! Token accounting (AC-186): one line per model call in `usage.jsonl`, with
//! what the provider said it spent. Measuring comes before optimizing.
//!
//! - Counts only, never prompt text. Unknown stays unknown (`None`), never 0.
//! - Local only: the file is not in the backup (`backup::FILES`), not in any
//!   export, and never reaches a prompt. Lines older than `KEEP_DAYS` go away.

use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const FILE: &str = "usage.jsonl";
pub const KEEP_DAYS: i64 = 90;

/// What one call spent, as the provider reported it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    /// Input tokens served from the provider's prompt cache.
    pub cached: Option<u64>,
    pub reasoning: Option<u64>,
    /// In the provider's currency (OpenRouter: credits, i.e. USD).
    pub cost: Option<f64>,
}

fn num(v: &Value, paths: &[&str]) -> Option<u64> {
    paths.iter().find_map(|p| v.pointer(p).and_then(Value::as_u64))
}

/// One parser for every shape: chat completions (`prompt_tokens`…, OpenAI,
/// OpenRouter, DeepSeek, Gemini, Anthropic compat), the Responses API and
/// transcriptions (`input_tokens`…). `None` when there are no counts at all
/// (absent, `null`, or a transcription billed by `duration`).
pub fn parse(v: &Value) -> Option<Usage> {
    if !v.is_object() {
        return None;
    }
    let u = Usage {
        input: num(v, &["/prompt_tokens", "/input_tokens"]),
        output: num(v, &["/completion_tokens", "/output_tokens"]),
        // DeepSeek also says `prompt_cache_hit_tokens` (same value as cached_tokens).
        cached: num(v, &["/prompt_tokens_details/cached_tokens", "/input_tokens_details/cached_tokens", "/input_token_details/cached_tokens", "/prompt_cache_hit_tokens"]),
        reasoning: num(v, &["/completion_tokens_details/reasoning_tokens", "/output_tokens_details/reasoning_tokens"]),
        cost: v.get("cost").and_then(Value::as_f64),
    };
    (u.input.is_some() || u.output.is_some()).then_some(u)
}

/// Who made a call and why; travels on the `Endpoint`.
#[derive(Clone, Default)]
pub struct Tag {
    /// `None` (tests, listing models): nothing is recorded.
    pub sink: Option<Arc<UsageLog>>,
    /// The configured role whose model answered (teacher, prober, extractor…).
    pub role: &'static str,
    /// The prompt or feature: "turn", "practice_generate", "companion", "vision_transcribe"…
    pub purpose: String,
    pub phase: Option<String>,
    /// Model call number inside one learner turn (0-based).
    pub step: Option<u32>,
    pub session_id: Option<String>,
}

tokio::task_local! {
    /// The session whose turn is running: calls made inside it (the history
    /// summary, research without a key) count for that session too.
    static SESSION: String;
}

/// Runs `fut` with `id` as the current session for accounting.
pub async fn in_session<F: std::future::Future>(id: &str, fut: F) -> F::Output {
    SESSION.scope(id.to_string(), fut).await
}

impl Tag {
    pub fn new(sink: Arc<UsageLog>, role: &'static str) -> Self {
        let session_id = SESSION.try_with(Clone::clone).ok();
        Self { sink: Some(sink), role, session_id, ..Default::default() }
    }

    pub fn purpose(mut self, p: &str) -> Self {
        self.purpose = p.to_string();
        self
    }

    /// Writes one event. Never fails the call: a full disk only loses the count.
    pub fn record(&self, model: &str, base_url: &str, ms: u64, usage: Option<Usage>) {
        let Some(sink) = &self.sink else { return };
        let now = Utc::now();
        let u = usage.clone().unwrap_or_default();
        let e = Event {
            at: now,
            day: chrono::Local::now().date_naive().to_string(),
            role: self.role.to_string(),
            purpose: self.purpose.clone(),
            phase: self.phase.clone(),
            step: self.step,
            session_id: self.session_id.clone(),
            model: model.to_string(),
            provider: host(base_url),
            ms,
            known: usage.is_some(),
            input: u.input,
            output: u.output,
            cached: u.cached,
            reasoning: u.reasoning,
            cost: u.cost,
        };
        if let Err(err) = sink.append(&e) {
            eprintln!("uso de tokens: {err}");
        }
    }
}

/// The provider's host only (no path, no key): "openrouter.ai".
pub fn host(base_url: &str) -> String {
    let rest = base_url.split("://").nth(1).unwrap_or(base_url);
    rest.split(['/', '?']).next().unwrap_or("").to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub at: DateTime<Utc>,
    /// Local day, YYYY-MM-DD.
    pub day: String,
    pub role: String,
    pub purpose: String,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub step: Option<u32>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub model: String,
    pub provider: String,
    pub ms: u64,
    /// The provider reported usage for this call.
    pub known: bool,
    #[serde(default)]
    pub input: Option<u64>,
    #[serde(default)]
    pub output: Option<u64>,
    #[serde(default)]
    pub cached: Option<u64>,
    #[serde(default)]
    pub reasoning: Option<u64>,
    #[serde(default)]
    pub cost: Option<f64>,
}

pub struct UsageLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl UsageLog {
    /// Opens the log and drops what is older than `KEEP_DAYS` (once per start).
    pub fn new(data_dir: &Path) -> Self {
        let log = Self { path: data_dir.join(FILE), lock: Mutex::new(()) };
        let _ = log.prune(Utc::now());
        log
    }

    pub fn append(&self, e: &Event) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(f, "{}", serde_json::to_string(e)?)?;
        Ok(())
    }

    /// Every event still kept; corrupt lines are skipped.
    pub fn all(&self) -> Vec<Event> {
        let _g = self.lock.lock().unwrap();
        let Ok(raw) = std::fs::read_to_string(&self.path) else { return vec![] };
        raw.lines().filter_map(|l| serde_json::from_str::<Event>(l).ok()).collect()
    }

    /// Rewrites the file without the old lines; untouched when nothing is old.
    pub fn prune(&self, now: DateTime<Utc>) -> Result<usize> {
        let _g = self.lock.lock().unwrap();
        let Ok(raw) = std::fs::read_to_string(&self.path) else { return Ok(0) };
        let limit = now - chrono::Duration::days(KEEP_DAYS);
        let lines: Vec<&str> = raw.lines().collect();
        let keep: Vec<&str> = lines.iter().copied().filter(|l| serde_json::from_str::<Event>(l).is_ok_and(|e| e.at >= limit)).collect();
        let dropped = lines.len() - keep.len();
        if dropped > 0 {
            let tmp = self.path.with_extension("jsonl.tmp");
            std::fs::write(&tmp, keep.iter().map(|l| format!("{l}\n")).collect::<String>())?;
            std::fs::rename(tmp, &self.path)?;
        }
        Ok(dropped)
    }
}

// ── The «Uso» view ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Totals {
    pub calls: u64,
    /// Calls the provider reported usage for.
    pub known: u64,
    pub input: u64,
    pub output: u64,
    /// `None` when no call said how much was cached.
    pub cached: Option<u64>,
    pub reasoning: Option<u64>,
    /// Only over the calls that reported a cost; `None` if none did.
    pub cost: Option<f64>,
    pub ms: u64,
}

impl Totals {
    fn add(&mut self, e: &Event) {
        self.calls += 1;
        self.ms += e.ms;
        if !e.known {
            return;
        }
        self.known += 1;
        self.input += e.input.unwrap_or(0);
        self.output += e.output.unwrap_or(0);
        if let Some(c) = e.cached {
            *self.cached.get_or_insert(0) += c;
        }
        if let Some(r) = e.reasoning {
            *self.reasoning.get_or_insert(0) += r;
        }
        if let Some(c) = e.cost {
            *self.cost.get_or_insert(0.0) += c;
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Group {
    pub key: String,
    pub label: String,
    pub totals: Totals,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Summary {
    pub today: Totals,
    pub week: Totals,
    /// Last 7 days, by what the call was for, biggest input first.
    pub by_role: Vec<Group>,
    /// The sessions with calls in the kept days, most recent first (8 at most).
    pub sessions: Vec<Group>,
    pub keep_days: i64,
}

/// What the call was for, in the words of the «Uso» view.
pub fn bucket(e: &Event) -> (&'static str, &'static str) {
    let p = e.purpose.as_str();
    match p {
        "turn" if e.phase.as_deref() == Some("probe") => ("prober", "Diagnóstico"),
        "turn" if e.phase.as_deref() == Some("chat") => ("chat", "Charla"),
        "turn" => ("teacher", "Profesor en la sesión"),
        "summarize_history" => ("summary", "Resumen de la sesión"),
        "remember_session" | "extract" => ("memory", "Memoria e ideas"),
        "cards_generate" => ("cards", "Tarjetas"),
        "research" => ("research", "Investigación"),
        "vision_transcribe" => ("vision", "Lectura de fotos"),
        "setup_test" => ("setup", "Prueba de conexión"),
        "academic_parse" | "career_parse" | "class_notes" => ("academic", "Mi cursada y clases"),
        _ if p.starts_with("practice_") || p.starts_with("code_") => ("practice", "Práctica y código"),
        _ if p.starts_with("exam_") || p == "lang_path" => ("exam", "Exámenes"),
        _ if p.starts_with("companion") => ("companion", "Acompañamiento"),
        _ if p.starts_with("lang_") || p == "speech" => ("language", "Idiomas y voz"),
        _ => ("other", "Otros"),
    }
}

pub fn summarize(events: &[Event], today: NaiveDate, titles: &HashMap<String, String>) -> Summary {
    let day = today.to_string();
    let since = (today - chrono::Duration::days(6)).to_string();
    let mut out = Summary { keep_days: KEEP_DAYS, ..Default::default() };
    let mut roles: Vec<Group> = Vec::new();
    let mut sessions: Vec<(DateTime<Utc>, Group)> = Vec::new();
    for e in events {
        if e.day == day {
            out.today.add(e);
        }
        if e.day >= since && e.day <= day {
            out.week.add(e);
            let (key, label) = bucket(e);
            match roles.iter_mut().find(|g| g.key == key) {
                Some(g) => g.totals.add(e),
                None => {
                    let mut g = Group { key: key.into(), label: label.into(), totals: Totals::default() };
                    g.totals.add(e);
                    roles.push(g);
                }
            }
        }
        if let Some(id) = &e.session_id {
            match sessions.iter_mut().find(|(_, g)| &g.key == id) {
                Some((at, g)) => {
                    *at = (*at).max(e.at);
                    g.totals.add(e);
                }
                None => {
                    let label = titles.get(id).cloned().unwrap_or_else(|| "Sesión borrada".into());
                    let mut g = Group { key: id.clone(), label, totals: Totals::default() };
                    g.totals.add(e);
                    sessions.push((e.at, g));
                }
            }
        }
    }
    roles.sort_by(|a, b| b.totals.input.cmp(&a.totals.input).then(b.totals.calls.cmp(&a.totals.calls)));
    sessions.sort_by(|a, b| b.0.cmp(&a.0));
    out.by_role = roles;
    out.sessions = sessions.into_iter().take(8).map(|(_, g)| g).collect();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openai_final_chunk_with_cache_and_reasoning() {
        let v = json!({ "prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280,
            "prompt_tokens_details": { "cached_tokens": 1024, "audio_tokens": 0 },
            "completion_tokens_details": { "reasoning_tokens": 32, "audio_tokens": 0 } });
        assert_eq!(parse(&v), Some(Usage { input: Some(1200), output: Some(80), cached: Some(1024), reasoning: Some(32), cost: None }));
    }

    #[test]
    fn openrouter_reports_its_cost() {
        let v = json!({ "prompt_tokens": 500, "completion_tokens": 20, "total_tokens": 520, "cost": 0.00042,
            "is_byok": false, "prompt_tokens_details": { "cached_tokens": 0 }, "completion_tokens_details": { "reasoning_tokens": 0 } });
        let u = parse(&v).unwrap();
        assert_eq!(u.cost, Some(0.00042));
        assert_eq!(u.cached, Some(0), "zero cached is a real zero, not unknown");
    }

    #[test]
    fn deepseek_cache_hit_tokens_count_as_cached() {
        let v = json!({ "prompt_tokens": 900, "completion_tokens": 10, "total_tokens": 910, "prompt_cache_hit_tokens": 640, "prompt_cache_miss_tokens": 260 });
        assert_eq!(parse(&v).unwrap().cached, Some(640));
    }

    #[test]
    fn responses_api_names() {
        let v = json!({ "input_tokens": 3000, "input_tokens_details": { "cached_tokens": 2048 }, "output_tokens": 150, "output_tokens_details": { "reasoning_tokens": 64 }, "total_tokens": 3150 });
        assert_eq!(parse(&v), Some(Usage { input: Some(3000), output: Some(150), cached: Some(2048), reasoning: Some(64), cost: None }));
    }

    #[test]
    fn nothing_reported_is_unknown_not_zero() {
        assert_eq!(parse(&Value::Null), None);
        assert_eq!(parse(&json!({})), None);
        assert_eq!(parse(&json!({ "type": "duration", "seconds": 12 })), None, "a transcription billed by time has no token counts");
        let u = parse(&json!({ "prompt_tokens": 10, "completion_tokens": 2 })).unwrap();
        assert_eq!((u.cached, u.reasoning, u.cost), (None, None, None));
    }

    #[test]
    fn host_never_keeps_paths_or_keys() {
        assert_eq!(host("https://openrouter.ai/api/v1"), "openrouter.ai");
        assert_eq!(host("http://127.0.0.1:4000/v1?key=x"), "127.0.0.1:4000");
    }

    fn ev(day: &str, purpose: &str, phase: Option<&str>, session: Option<&str>, u: Option<Usage>) -> Event {
        let at = format!("{day}T12:00:00Z").parse().unwrap();
        let x = u.clone().unwrap_or_default();
        Event { at, day: day.into(), role: "teacher".into(), purpose: purpose.into(), phase: phase.map(String::from), step: Some(0), session_id: session.map(String::from), model: "m".into(), provider: "p".into(), ms: 100, known: u.is_some(), input: x.input, output: x.output, cached: x.cached, reasoning: x.reasoning, cost: x.cost }
    }

    fn u(input: u64, cached: Option<u64>, cost: Option<f64>) -> Option<Usage> {
        Some(Usage { input: Some(input), output: Some(10), cached, reasoning: None, cost })
    }

    #[test]
    fn summary_today_week_roles_and_sessions() {
        let today: NaiveDate = "2026-11-04".parse().unwrap();
        let events = vec![
            ev("2026-11-04", "turn", Some("teach"), Some("s1"), u(1000, Some(800), Some(0.01))),
            ev("2026-11-04", "turn", Some("probe"), Some("s1"), u(500, None, None)),
            ev("2026-11-03", "practice_generate", None, None, None),
            ev("2026-10-01", "turn", Some("chat"), Some("s2"), u(9000, Some(0), None)),
        ];
        let titles = HashMap::from([("s1".to_string(), "Derivadas".to_string())]);
        let s = summarize(&events, today, &titles);
        assert_eq!((s.today.calls, s.today.input, s.today.cached, s.today.cost), (2, 1500, Some(800), Some(0.01)));
        assert_eq!((s.week.calls, s.week.known, s.week.input), (3, 2, 1500), "the unknown call counts as a call, not as tokens");
        assert_eq!(s.by_role.iter().map(|g| g.key.as_str()).collect::<Vec<_>>(), vec!["teacher", "prober", "practice"]);
        assert_eq!(s.sessions[0].label, "Derivadas");
        assert_eq!(s.sessions[1].label, "Sesión borrada");
        assert_eq!(s.sessions[1].totals.input, 9000, "sessions cover every kept day");
        assert_eq!(summarize(&[], today, &titles).today.cost, None, "no cost reported: no cost shown");
    }

    #[test]
    fn the_log_appends_reads_and_prunes_old_lines() {
        let dir = std::env::temp_dir().join(format!("la-usage-{}", uuid::Uuid::new_v4().simple()));
        let log = UsageLog::new(&dir);
        let old = ev("2026-01-01", "turn", None, None, u(1, None, None));
        let new = ev("2026-11-03", "turn", None, None, u(2, None, None));
        log.append(&old).unwrap();
        log.append(&new).unwrap();
        assert_eq!(log.all().len(), 2);
        assert_eq!(log.prune("2026-11-04T00:00:00Z".parse().unwrap()).unwrap(), 1);
        assert_eq!(log.all(), vec![new]);
        let raw = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!raw.contains("http") && !raw.contains("sk-"), "counts only: no urls, no keys");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn usage_never_goes_in_a_backup() {
        let dir = std::env::temp_dir().join(format!("la-usage-bk-{}", uuid::Uuid::new_v4().simple()));
        let log = UsageLog::new(&dir);
        log.append(&ev("2026-11-03", "turn", None, None, None)).unwrap();
        std::fs::write(dir.join("study_log.jsonl"), "").unwrap();
        let names = crate::backup::entries(&dir);
        assert!(names.contains(&"study_log.jsonl".to_string()));
        assert!(!names.iter().any(|n| n.contains("usage")));
        assert!(!crate::backup::allowed(FILE), "a backup can't bring one in either");
        std::fs::remove_dir_all(dir).ok();
    }
}
