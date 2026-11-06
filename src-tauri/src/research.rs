//! Web research (Phase 4): search with a Tavily-compatible API, then the
//! researcher role summarizes the hits with numbered sources. Never fails the
//! teacher's turn: problems come back as an error the teacher can read.
//! AC-169: it runs in the background. The turn gets «en curso» at once, a
//! worker runs the job, and the result is written into the session exactly
//! once — by the worker when no turn is running, else by that turn.

use crate::agent::{endpoint_for, Role};
use crate::llm::{self, Msg};
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

pub const TOOL: &str = "research";
/// AC-169: research running at once in one session.
pub const MAX_LIVE: usize = 2;
pub const SUMMARY_TOOL: &str = "submit_research";
pub const MAX_HITS: usize = 5;
/// AC-206: one search per author or topic, never one search for everything.
pub const MAX_QUERIES: usize = 6;
/// Sources the summary reads, after merging every search.
pub const MAX_SOURCES: usize = 10;
/// Open documents offered for the library.
pub const MAX_DOCUMENTS: usize = 5;
/// Full text the summary reads from each of the best sources.
const RAW_CHARS: usize = 2500;

/// Pages that never teach anything: people and company directories, social networks.
/// A search with several names in it matched «Pichardo» with a LinkedIn profile and
/// «CEPAL» with a Greek finance company.
const JUNK: &[&str] = &[
    "linkedin.com", "rocketreach.co", "zoominfo.com", "crunchbase.com", "dnb.com", "apollo.io", "signalhire.com", "contactout.com",
    "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com", "pinterest.com", "tavily.com",
];
/// Documents behind a login or a paywall: fine as sources, never offered for the library.
const LOCKED: &[&str] = &["scribd.com", "academia.edu", "studocu.com", "dokumen.pub", "coursehero.com", "perlego.com", "researchgate.net"];

fn on(host: &str, list: &[&str]) -> bool {
    list.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// AC-206: a page from a directory or a social network, dropped before the summary.
pub fn junk(url: &str) -> bool {
    on(&crate::usage::host(url).to_lowercase(), JUNK)
}

/// AC-206: a PDF anyone can download, to offer for the library.
pub fn open_document(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
    path.ends_with(".pdf") && !on(&crate::usage::host(url).to_lowercase(), LOCKED)
}

/// The biggest PDF taken for the library: a whole book fits, a dump does not.
pub const MAX_DOCUMENT_BYTES: usize = 80 * 1024 * 1024;

/// AC-206: downloads an open PDF the research found, for the library. Only what the
/// research would offer (a .pdf off a login), only a real PDF, never too big.
pub async fn download_pdf(url: &str) -> Result<Vec<u8>> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || !open_document(url) {
        bail!("ese enlace no es un PDF abierto");
    }
    let resp = crate::llm::client()?
        .get(url)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .context("no pude bajar el documento")?;
    if !resp.status().is_success() {
        bail!("el sitio respondió {} al bajar el documento", resp.status());
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX_DOCUMENT_BYTES) {
        bail!("el documento pesa más de {} MB", MAX_DOCUMENT_BYTES / 1024 / 1024);
    }
    let mut out: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        out.extend_from_slice(&chunk.context("la descarga se cortó")?);
        if out.len() > MAX_DOCUMENT_BYTES {
            bail!("el documento pesa más de {} MB", MAX_DOCUMENT_BYTES / 1024 / 1024);
        }
    }
    if !out.starts_with(b"%PDF") {
        bail!("lo que bajó no es un PDF (el sitio puede pedir iniciar sesión)");
    }
    Ok(out)
}

/// AC-206: the searches to run: the teacher's, or the question split at «;», capped.
pub fn queries_for(question: &str, queries: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let given: Vec<String> = queries.iter().map(|q| q.trim().to_string()).filter(|q| !q.is_empty()).collect();
    let split: Vec<String> = if given.is_empty() { question.split(';').map(|q| q.trim().to_string()).filter(|q| q.chars().count() >= 3).collect() } else { given };
    for q in split {
        if !out.iter().any(|o| o.eq_ignore_ascii_case(&q)) {
            out.push(q);
        }
    }
    if out.is_empty() {
        out.push(question.trim().to_string());
    }
    out.truncate(MAX_QUERIES);
    out
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hit {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub content: String,
    /// Full page text, when the search was asked for it.
    #[serde(default)]
    pub raw_content: Option<String>,
    /// How well it matches, as the search engine says (0 when it says nothing).
    #[serde(default)]
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SourceRef {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct ResearchResult {
    pub question: String,
    pub summary: String,
    pub sources: Vec<SourceRef>,
    pub error: Option<String>,
    /// AC-206: open PDFs found on the way, offered to the learner for the library.
    pub documents: Vec<SourceRef>,
    /// AC-206: searches that found nothing useful, said plainly.
    pub uncovered: Vec<String>,
}

impl ResearchResult {
    fn failed(question: &str, error: String) -> Self {
        Self { question: question.into(), error: Some(error), ..Default::default() }
    }

    /// What the teacher reads as the tool result.
    pub fn for_teacher(&self) -> String {
        if let Some(e) = &self.error {
            return format!("error: {e}. Seguí sin investigar.");
        }
        let mut s = format!("Investigación: {}\n\nResumen: {}\n\nFuentes:\n", self.question, self.summary);
        for (i, src) in self.sources.iter().enumerate() {
            s.push_str(&format!("[{}] {} — {}\n", i + 1, src.title, src.url));
        }
        if !self.documents.is_empty() {
            s.push_str("\nDocumentos abiertos (PDF): el aprendiz los ve con un botón «Sumar a mi biblioteca». Contale que los encontraste y cuáles son; no le pidas que los suba.\n");
            for d in &self.documents {
                s.push_str(&format!("- {} — {}\n", d.title, d.url));
            }
        }
        if !self.uncovered.is_empty() {
            s.push_str(&format!("\nSin resultados útiles para: {}. Decíselo si importa; no lo rellenes con lo que no encontraste.\n", self.uncovered.join("; ")));
        }
        s
    }

    pub fn meta(&self) -> Value {
        json!({ "kind": "research", "question": self.question, "summary": self.summary, "sources": self.sources, "error": self.error, "documents": self.documents, "uncovered": self.uncovered })
    }
}

// ── AC-169: in the background ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    pub session_id: String,
    pub call_id: String,
    pub question: String,
    /// AC-206: one search per author or topic (empty: the question split at «;»).
    pub queries: Vec<String>,
}

/// Jobs waiting for the worker, running, and finished but not yet written into their session.
#[derive(Default)]
pub struct Background {
    queue: Mutex<Vec<Job>>,
    live: Mutex<Vec<Job>>,
    done: Mutex<HashMap<String, Vec<(String, ResearchResult)>>>,
    pub wake: tokio::sync::Notify,
}

/// What the teacher reads right away (the tool result until the job ends).
pub fn pending_text(question: &str) -> String {
    format!("Investigación en curso: «{question}». Corre en segundo plano: el resultado te llega solo cuando termine. Mientras tanto seguí sin esperarlo y sin inventar lo que va a decir.")
}

pub fn pending_meta(question: &str) -> Value {
    json!({ "kind": "research", "question": question, "pending": true })
}

impl Background {
    /// Queues a job, or says why not: the same question already running, or too many at once.
    pub fn enqueue(&self, job: Job) -> std::result::Result<(), String> {
        let mut q = self.queue.lock().unwrap();
        let live = self.live.lock().unwrap();
        let same: Vec<&Job> = q.iter().chain(live.iter()).filter(|j| j.session_id == job.session_id).collect();
        if same.iter().any(|j| j.question.trim().eq_ignore_ascii_case(job.question.trim())) {
            return Err("ya estás investigando esa misma pregunta: el resultado llega solo".into());
        }
        if same.len() >= MAX_LIVE {
            return Err(format!("ya hay {MAX_LIVE} investigaciones en curso; esperá sus resultados"));
        }
        q.push(job);
        drop((q, live));
        self.wake.notify_one();
        Ok(())
    }

    /// The worker takes everything queued and marks it live.
    pub fn take(&self) -> Vec<Job> {
        let jobs = std::mem::take(&mut *self.queue.lock().unwrap());
        self.live.lock().unwrap().extend(jobs.iter().cloned());
        jobs
    }

    fn finish(&self, job: &Job, result: ResearchResult) {
        self.live.lock().unwrap().retain(|j| j.call_id != job.call_id);
        self.done.lock().unwrap().entry(job.session_id.clone()).or_default().push((job.call_id.clone(), result));
    }

    pub fn take_done(&self, session_id: &str) -> Vec<(String, ResearchResult)> {
        self.done.lock().unwrap().remove(session_id).unwrap_or_default()
    }

    pub fn is_live(&self, call_id: &str) -> bool {
        self.queue.lock().unwrap().iter().chain(self.live.lock().unwrap().iter()).any(|j| j.call_id == call_id)
    }
}

/// Writes finished results into the session's research messages; true if any.
pub fn patch(s: &mut crate::session::Session, results: Vec<(String, ResearchResult)>) -> bool {
    let mut any = false;
    for (call_id, r) in results {
        if let Some(m) = s.messages.iter_mut().find(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(call_id.as_str())) {
            m.content = Some(r.for_teacher());
            let mut meta = r.meta();
            meta["told"] = json!(false);
            m.meta = Some(meta);
            any = true;
        }
    }
    any
}

/// Runs one job and hands the result over (the worker spawns one per job).
pub async fn run_job(state: &AppState, job: Job) {
    // AC-186: the summary counts for the session that asked.
    let result = crate::usage::in_session(&job.session_id, run(state, &job.question, &job.queries)).await;
    state.research.finish(&job, result);
    let _ = crate::agent::deliver_research(state, &job.session_id, false);
}

/// After a restart nothing is running: research left «en curso» says it was cut.
pub fn recover(state: &AppState) -> usize {
    let mut n = 0;
    for mut s in state.sessions.all() {
        let cut: Vec<(String, ResearchResult)> = s
            .messages
            .iter()
            .filter(|m| m.role == "tool" && m.meta.as_ref().is_some_and(|v| v["kind"] == "research" && v["pending"] == true))
            .filter(|m| !m.tool_call_id.as_deref().is_some_and(|id| state.research.is_live(id)))
            .map(|m| (m.tool_call_id.clone().unwrap_or_default(), ResearchResult::failed(m.meta.as_ref().unwrap()["question"].as_str().unwrap_or(""), "se cortó (se cerró la app antes de terminar)".into())))
            .collect();
        if !cut.is_empty() && patch(&mut s, cut) {
            for m in s.messages.iter_mut().filter_map(|m| m.meta.as_mut()) {
                if m["kind"] == "research" && m["told"] == false && m["error"].is_string() {
                    m["told"] = json!(true);
                }
            }
            let _ = state.sessions.save_quiet(&s);
            n += 1;
        }
    }
    n
}

pub fn summary_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": SUMMARY_TOOL,
        "description": "Entrega el resumen de la investigación.",
        "parameters": { "type": "object", "properties": {
            "summary": { "type": "string", "description": "3 a 6 oraciones, citando fuentes como [1], [2]." },
            "used": { "type": "array", "items": { "type": "integer" }, "description": "números de las fuentes citadas" }
        }, "required": ["summary", "used"] }
    }})
}

pub fn summarize_input(question: &str, queries: &[String], hits: &[Hit]) -> String {
    let mut s = format!("Pregunta: {question}\n");
    if queries.len() > 1 || queries.first().is_some_and(|q| q != question) {
        s.push_str(&format!("Búsquedas que hizo el profesor (una por autor o tema): {}\n", queries.join(" | ")));
    }
    s.push_str("\n## Resultados de búsqueda\n");
    for (i, h) in hits.iter().enumerate() {
        // AC-206: the best sources are read in full (as far as RAW_CHARS), not only their snippet.
        let full = h.raw_content.as_deref().map(str::trim).filter(|r| i < 6 && r.chars().count() > h.content.chars().count());
        let excerpt: String = match full {
            Some(r) => r.chars().take(RAW_CHARS).collect(),
            None => h.content.chars().take(1200).collect(),
        };
        s.push_str(&format!("\n[{}] {} — {}\n{}\n", i + 1, h.title, h.url, excerpt));
    }
    s
}

/// Parses a Tavily-style response: `{ "results": [{ title, url, content }] }`.
pub fn parse_hits(v: &Value) -> Vec<Hit> {
    v.get("results")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|r| serde_json::from_value::<Hit>(r.clone()).ok())
                .filter(|h| h.url.starts_with("http://") || h.url.starts_with("https://"))
                .take(MAX_HITS)
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct RawSummary {
    summary: String,
    #[serde(default)]
    used: Vec<usize>,
}

/// Keeps only cited sources that exist, in citation order; all hits when none cited.
pub fn pick_sources(hits: &[Hit], used: &[usize]) -> Vec<SourceRef> {
    let mut out: Vec<SourceRef> = Vec::new();
    for &n in used {
        if let Some(h) = n.checked_sub(1).and_then(|i| hits.get(i)) {
            if !out.iter().any(|s| s.url == h.url) {
                out.push(SourceRef { title: h.title.clone(), url: h.url.clone() });
            }
        }
    }
    if out.is_empty() {
        out = hits.iter().map(|h| SourceRef { title: h.title.clone(), url: h.url.clone() }).collect();
    }
    out
}

/// `raw` asks the API for each page's full text too (Tavily `include_raw_content`).
pub async fn search(base_url: &str, key: &str, query: &str, raw: bool) -> Result<Vec<Hit>> {
    search_with(base_url, key, query, raw, "basic").await
}

/// AC-206: research searches deep (`advanced`): better hits for names and titles.
async fn search_with(base_url: &str, key: &str, query: &str, raw: bool, depth: &str) -> Result<Vec<Hit>> {
    let resp = crate::llm::client()?
        .post(format!("{}/search", base_url.trim_end_matches('/')))
        .bearer_auth(key)
        .json(&json!({ "api_key": key, "query": query, "max_results": MAX_HITS, "search_depth": depth, "include_raw_content": raw }))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .context("no se pudo conectar con el buscador")?;
    if !resp.status().is_success() {
        let status = resp.status();
        bail!("el buscador respondió {status}: {}", resp.text().await.unwrap_or_default());
    }
    Ok(parse_hits(&resp.json::<Value>().await?))
}

async fn summarize(state: &AppState, question: &str, queries: &[String], hits: &[Hit]) -> Result<(String, Vec<SourceRef>)> {
    let mut ep = endpoint_for(state, Role::Researcher).await?;
    ep.usage.purpose = "research".into();
    let system = state.prompts.get("research")?;
    let choice = json!({ "type": "function", "function": { "name": SUMMARY_TOOL } });
    let c = llm::stream_chat(&ep, &system, &[Msg::user(summarize_input(question, queries, hits), None)], &json!([summary_tool()]), Some(&choice), |_| {}, || false).await?;
    let call = c.tool_calls.into_iter().find(|t| t.function.name == SUMMARY_TOOL).ok_or_else(|| anyhow!("el investigador no devolvió {SUMMARY_TOOL}"))?;
    let raw: RawSummary = serde_json::from_str(&call.function.arguments).context("el investigador devolvió datos inválidos")?;
    let summary = raw.summary.trim().to_string();
    if summary.is_empty() {
        bail!("el investigador devolvió un resumen vacío");
    }
    Ok((summary, pick_sources(hits, &raw.used)))
}

/// AC-29/30: runs the whole research step; errors are reported, not raised.
/// AC-206: the hits of every search, junk out, merged without repeats, best first.
pub fn merge(per_query: Vec<Vec<Hit>>) -> Vec<Hit> {
    let mut all: Vec<Hit> = Vec::new();
    for hits in per_query {
        for h in hits.into_iter().filter(|h| !junk(&h.url)) {
            if !all.iter().any(|x| x.url == h.url) {
                all.push(h);
            }
        }
    }
    // Stable: equal scores keep the order of the searches.
    all.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    all.truncate(MAX_SOURCES);
    all
}

pub fn documents_in(hits: &[Hit]) -> Vec<SourceRef> {
    hits.iter().filter(|h| open_document(&h.url)).take(MAX_DOCUMENTS).map(|h| SourceRef { title: h.title.clone(), url: h.url.clone() }).collect()
}

pub async fn run(state: &AppState, question: &str, queries: &[String]) -> ResearchResult {
    let question = question.trim();
    if question.is_empty() {
        return ResearchResult::failed(question, "la pregunta de investigación está vacía".into());
    }
    let settings = state.settings.load();
    let Some(key) = state.settings.keys().get(crate::settings::SEARCH_KEY).filter(|k| !k.is_empty()).cloned() else {
        return ResearchResult::failed(question, "búsqueda web no configurada (Ajustes → Búsqueda web)".into());
    };
    let base = settings.search.base_url.clone();
    let queries = queries_for(question, queries);
    let found = futures_util::future::join_all(queries.iter().map(|q| search_with(&base, &key, q, true, "advanced"))).await;
    let mut per_query: Vec<Vec<Hit>> = Vec::new();
    let mut uncovered: Vec<String> = Vec::new();
    let mut first_error: Option<String> = None;
    for (q, r) in queries.iter().zip(found) {
        let mut hits = match r {
            Ok(h) => h,
            Err(e) => {
                first_error.get_or_insert(e.to_string());
                Vec::new()
            }
        };
        hits.retain(|h| !junk(&h.url));
        // A second pass, only for what came back empty: the documents of a niche subject
        // are often PDFs that a plainer search finds.
        if hits.is_empty() && first_error.is_none() {
            hits = search_with(&base, &key, &format!("{q} pdf"), true, "advanced").await.unwrap_or_default();
            hits.retain(|h| !junk(&h.url));
        }
        if hits.is_empty() {
            uncovered.push(q.clone());
        }
        per_query.push(hits);
    }
    let hits = merge(per_query);
    if hits.is_empty() {
        return ResearchResult::failed(question, first_error.unwrap_or_else(|| "la búsqueda no encontró resultados útiles".into()));
    }
    let documents = documents_in(&hits);
    match summarize(state, question, &queries, &hits).await {
        Ok((summary, sources)) => ResearchResult { question: question.into(), summary, sources, error: None, documents, uncovered },
        Err(e) => ResearchResult::failed(question, e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(n: usize) -> Hit {
        Hit { title: format!("T{n}"), url: format!("https://e.test/{n}"), content: "x".repeat(2000), raw_content: None, score: 0.0 }
    }

    #[test]
    fn parses_hits_dropping_bad_urls_and_capping() {
        let v = json!({ "results": [
            { "title": "A", "url": "https://a.test", "content": "c" },
            { "title": "JS", "url": "javascript:alert(1)", "content": "" },
            { "title": "sin url" },
            { "title": "B", "url": "http://b.test" }
        ]});
        let hits = parse_hits(&v);
        assert_eq!(hits.iter().map(|h| h.title.as_str()).collect::<Vec<_>>(), ["A", "B"]);
        let many = json!({ "results": (0..9).map(|i| json!({ "title": i.to_string(), "url": format!("https://x.test/{i}") })).collect::<Vec<_>>() });
        assert_eq!(parse_hits(&many).len(), MAX_HITS);
        assert!(parse_hits(&json!({})).is_empty());
    }

    fn h(url: &str, score: f64) -> Hit {
        Hit { title: url.into(), url: url.into(), content: "c".into(), raw_content: None, score }
    }

    #[test]
    fn one_search_per_author_or_topic() {
        // AC-206: the real session sent four authors in one search and got LinkedIn profiles.
        let q = queries_for("Carballeda intervención; Pichardo Muñiz planificación ; ; UNESCO 1958", &[]);
        assert_eq!(q, ["Carballeda intervención", "Pichardo Muñiz planificación", "UNESCO 1958"]);
        let given: Vec<String> = (0..9).map(|i| format!("autor {i}")).collect();
        assert_eq!(queries_for("x", &given).len(), MAX_QUERIES);
        assert_eq!(queries_for("una sola pregunta", &[" ".into()]), ["una sola pregunta"]);
        assert_eq!(queries_for("a", &["Oszlak".into(), "oszlak".into()]), ["Oszlak"], "no repeats");
    }

    #[test]
    fn directories_are_dropped_and_open_pdfs_offered() {
        // AC-206
        for bad in ["https://linkedin.com/in/pichardo", "https://www.linkedin.com/in/x", "https://rocketreach.co/imp", "https://tavily.com/knowledge/company/x"] {
            assert!(junk(bad), "{bad}");
        }
        assert!(!junk("https://www.margen.org/epub/Intervencion_losocial.pdf"));
        assert!(open_document("https://www.margen.org/epub/Intervencion_losocial.pdf"));
        assert!(open_document("https://e-tcs.org/x/Oszlak.PDF?dl=1"));
        assert!(!open_document("https://es.scribd.com/document/1/x.pdf"), "behind a login");
        assert!(!open_document("https://rieoei.org/RIE/article/view/1180"), "a page, not a PDF");
        let merged = merge(vec![
            vec![h("https://www.margen.org/a.pdf", 0.89), h("https://linkedin.com/in/p", 0.95)],
            vec![h("https://iiep.unesco.org/x", 0.7), h("https://www.margen.org/a.pdf", 0.89)],
        ]);
        assert_eq!(merged.iter().map(|h| h.url.as_str()).collect::<Vec<_>>(), ["https://www.margen.org/a.pdf", "https://iiep.unesco.org/x"]);
        assert_eq!(documents_in(&merged).len(), 1);
    }

    #[test]
    fn the_teacher_hears_about_documents_and_gaps() {
        let r = ResearchResult {
            question: "q".into(),
            summary: "s [1]".into(),
            sources: vec![SourceRef { title: "Carballeda".into(), url: "https://m.org/a.pdf".into() }],
            documents: vec![SourceRef { title: "Carballeda".into(), url: "https://m.org/a.pdf".into() }],
            uncovered: vec!["Pichardo Muñiz".into()],
            ..Default::default()
        };
        let t = r.for_teacher();
        assert!(t.contains("Sumar a mi biblioteca") && t.contains("no le pidas que los suba") && t.contains("- Carballeda — https://m.org/a.pdf"), "{t}");
        assert!(t.contains("Sin resultados útiles para: Pichardo Muñiz"));
        assert_eq!(r.meta()["documents"][0]["url"], "https://m.org/a.pdf");
    }

    #[test]
    fn the_best_sources_are_read_in_full() {
        let mut full = hit(1);
        full.raw_content = Some(format!("TEXTO COMPLETO {}", "y".repeat(5000)));
        let s = summarize_input("q", &["Carballeda pdf".into(), "Oszlak pdf".into()], &[full, hit(2)]);
        assert!(s.contains("Búsquedas que hizo el profesor (una por autor o tema): Carballeda pdf | Oszlak pdf"));
        assert!(s.contains("TEXTO COMPLETO") && s.len() < 2500 + 1200 + 400, "capped: {}", s.len());
    }

    #[test]
    fn picks_cited_sources_in_order_ignoring_bad_numbers() {
        let hits = vec![hit(1), hit(2), hit(3)];
        let s = pick_sources(&hits, &[3, 0, 9, 1, 3]);
        assert_eq!(s.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), ["T3", "T1"]);
        assert_eq!(pick_sources(&hits, &[]).len(), 3, "nothing cited → all hits");
    }

    #[test]
    fn summarize_input_numbers_and_truncates() {
        let s = summarize_input("¿qué?", &[], &[hit(1), hit(2)]);
        assert!(s.contains("Pregunta: ¿qué?") && s.contains("[1] T1 — https://e.test/1") && s.contains("[2] T2"));
        assert!(s.len() < 3000, "excerpts are capped");
    }

    #[test]
    fn background_jobs_are_deduped_capped_and_patched_once() {
        // AC-169
        let bg = Background::default();
        let job = |call: &str, q: &str| Job { session_id: "s1".into(), call_id: call.into(), question: q.into(), queries: vec![] };
        assert!(bg.enqueue(job("c1", "¿Qué es la derivada?")).is_ok());
        assert!(bg.enqueue(job("c2", "¿qué es la derivada? ")).unwrap_err().contains("misma pregunta"));
        assert!(bg.enqueue(job("c3", "Otra")).is_ok());
        assert!(bg.enqueue(job("c4", "Una tercera")).unwrap_err().contains("2 investigaciones"));
        assert!(bg.enqueue(Job { session_id: "s2".into(), ..job("c5", "Otra") }).is_ok(), "per session");
        let taken = bg.take();
        assert_eq!(taken.len(), 3);
        assert!(bg.is_live("c1") && bg.take().is_empty());
        let ok = ResearchResult { question: "¿Qué es la derivada?".into(), summary: "La pendiente [1].".into(), sources: vec![SourceRef { title: "T".into(), url: "https://t".into() }], ..Default::default() };
        bg.finish(&taken[0], ok.clone());
        assert!(!bg.is_live("c1"));
        let mut s = crate::session::Session::new("x");
        s.messages.push(Msg::tool("c1", pending_text("¿Qué es la derivada?"), Some(pending_meta("¿Qué es la derivada?"))));
        assert!(patch(&mut s, bg.take_done("s1")));
        assert!(bg.take_done("s1").is_empty(), "handed over once");
        let m = s.messages.last().unwrap();
        assert!(m.content.as_deref().unwrap().starts_with("Investigación: ¿Qué es la derivada?"));
        let meta = m.meta.as_ref().unwrap();
        assert_eq!((meta["summary"].as_str(), meta["told"].as_bool(), meta.get("pending")), (Some("La pendiente [1]."), Some(false), None));
        assert!(!patch(&mut s, vec![("nope".into(), ok)]), "a message that is not there");
    }

    #[test]
    fn teacher_text_and_meta() {
        let ok = ResearchResult { question: "q".into(), summary: "s [1]".into(), sources: vec![SourceRef { title: "T".into(), url: "https://t".into() }], ..Default::default() };
        assert!(ok.for_teacher().starts_with("Investigación: q"));
        assert!(ok.for_teacher().contains("[1] T — https://t"));
        assert_eq!(ok.meta()["kind"], "research");
        let bad = ResearchResult::failed("q", "sin key".into());
        assert!(bad.for_teacher().starts_with("error: sin key"));
        assert_eq!(bad.meta()["error"], "sin key");
    }
}
