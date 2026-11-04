//! The agent loop: one learner turn → model calls + tool executions until the
//! model asks a question, stops calling tools, or hits the step cap.

use crate::llm::{self, Endpoint, Msg, Subscription};
use crate::session::{Phase, Session};
use crate::settings::ModelRef;
use crate::tools::{self, Outcome};
use crate::AppState;
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;

/// Hard cap on model calls per learner turn (paid APIs: never loop forever).
pub const MAX_STEPS: usize = 12;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// A streamed text fragment of the assistant message in progress.
    Text { delta: String },
    /// What the agent is doing right now, in words ("Buscando en tu biblioteca…").
    Activity { label: String },
    /// The persisted session after a step (plan, phase, messages...).
    Session { session: Box<Session> },
    /// A control the screen must run now (AC-122): the person asked for it in words.
    Ui { command: serde_json::Value },
    Error { message: String },
    Done,
}

/// What the learner reads while a tool runs. Unknown tools get a neutral line, never a raw name.
pub fn activity_label(tool: &str) -> &'static str {
    match tool {
        t if t == crate::research::TOOL => "Mandando a investigar en la web…",
        "library_search" => "Buscando en tu biblioteca…",
        "library_read" => "Leyendo un pasaje de tu biblioteca…",
        "recall" => "Recordando lo que ya viste…",
        "make_cards" => "Armando tarjetas de repaso…",
        "propose_timetable" => "Armando tu horario…",
        "propose_exam" => "Armando tu preparación…",
        "app_status" => "Mirando cómo venís…",
        "ui_command" => "Haciéndolo…",
        "set_phase" | "begin_learning" => "Preparando la sesión…",
        _ => "Preparando la respuesta…",
    }
}

/// AC-123: a read of how the person is doing, from what the app keeps: exams and
/// their dates, cards due, minutes studied, recent sessions and books.
pub fn app_status(state: &AppState) -> String {
    let today = chrono::Local::now().date_naive();
    let mut out = String::from("## Cómo viene la persona\n");
    let ui = state.ui_snapshot();
    if !ui.is_empty() {
        out.push_str(&format!("### En pantalla\n{ui}\n"));
    }
    let exams = state.exams.list();
    out.push_str("### Exámenes\n");
    if exams.is_empty() {
        out.push_str("- (ninguno todavía)\n");
    }
    for e in exams.iter().take(8) {
        let when = match e.exam_date.as_deref().and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) {
            Some(d) => format!("{} (faltan {} días)", d.format("%d/%m/%Y"), (d - today).num_days()),
            None => "sin fecha".into(),
        };
        let last = e.last_score.map(|s| format!(", último simulacro {:.0} %", s * 100.0)).unwrap_or_default();
        out.push_str(&format!("- {}: {when}; {} temas, {} empezados, {} para repasar{last}\n", e.name, e.topics, e.started, e.to_review));
    }
    let decks: Vec<_> = state.decks.all().iter().map(|d| d.summary(today)).collect();
    let due: usize = decks.iter().map(|d| d.due).sum();
    out.push_str(&format!("### Tarjetas\n- {due} para repasar hoy en {} {}\n", decks.len(), if decks.len() == 1 { "mazo" } else { "mazos" }));
    for d in decks.iter().filter(|d| d.due > 0).take(5) {
        out.push_str(&format!("  - {}: {} vencidas\n", d.name, d.due));
    }
    let since = (today - chrono::Duration::days(6)).format("%Y-%m-%d").to_string();
    let log = state.study.since(&since);
    let day = today.format("%Y-%m-%d").to_string();
    let week: f64 = log.iter().map(|e| e.minutes).sum::<f64>() + 0.0; // an empty sum is -0.0
    let today_min: f64 = log.iter().filter(|e| e.day == day).map(|e| e.minutes).sum::<f64>() + 0.0;
    out.push_str(&format!("### Estudio\n- hoy {today_min:.0} min, últimos 7 días {week:.0} min\n"));
    let sessions = state.sessions.list();
    out.push_str(&format!("### Sesiones\n- {} en total", sessions.len()));
    for s in sessions.iter().take(3) {
        out.push_str(&format!("\n  - {} ({:?})", s.title, s.phase));
    }
    out.push_str(&format!("\n### Biblioteca\n- {} libros\n", state.library.index().titles().len()));
    out
}

/// Which configured model a role uses: its own if set, else the teacher's.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Prober,
    Teacher,
    Extractor,
    Practice,
    Researcher,
    /// Speech to text (AC-65). No fallback: the teacher's model can't transcribe.
    Speech,
}

pub async fn endpoint_for(state: &AppState, role: Role) -> Result<Endpoint> {
    let settings = state.settings.load();
    let keys = state.settings.keys();
    let own = match role {
        Role::Prober => &settings.roles.prober,
        Role::Teacher => &settings.roles.teacher,
        Role::Extractor => &settings.roles.extractor,
        Role::Practice => &settings.roles.practice,
        Role::Researcher => &settings.roles.researcher,
        Role::Speech => &settings.roles.speech,
    };
    if role == Role::Speech && own.model.is_empty() {
        return Err(anyhow!("Para el speaking configurá un modelo de transcripción en Ajustes → Voz (por ejemplo whisper-1 de OpenAI o whisper-large-v3 de Groq)."));
    }
    let chosen: &ModelRef = if own.model.is_empty() { &settings.roles.teacher } else { own };
    if chosen.model.is_empty() || chosen.provider_id.is_empty() {
        return Err(anyhow!("No hay modelo configurado. Abrí Ajustes y elegí proveedor y modelo."));
    }
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == chosen.provider_id)
        .ok_or_else(|| anyhow!("El proveedor '{}' no existe.", chosen.provider_id))?;
    let (base_url, access, subscription) = match state.accounts.get(&provider.id) {
        // A connected subscription replaces the API key for its provider and
        // speaks a different API (see `Endpoint::subscription`).
        Some(account) => {
            let account = valid_account(state, account).await?;
            let base_url = if account.base_url.trim().is_empty() { crate::oauth::API_BASE.to_string() } else { account.base_url.clone() };
            let subscription = Subscription { account_id: account.account_id, originator: account.originator };
            (base_url, account.access, Some(subscription))
        }
        None => {
            let api_key = keys
                .get(&provider.id)
                .filter(|k| !k.is_empty())
                .ok_or_else(|| anyhow!("Falta la API key de {}. Cargala en Ajustes.", provider.label))?;
            (provider.base_url.clone(), api_key.clone(), None)
        }
    };
    Ok(Endpoint { base_url, api_key: access, model: chosen.model.clone(), context_tokens: context_tokens(chosen), session: crate::llm::app_session(), subscription })
}

/// The account with a token that still works. Refreshing writes the new pair
/// back, so the next run does not refresh again.
pub(crate) async fn valid_account(state: &AppState, account: crate::accounts::Account) -> Result<crate::accounts::Account> {
    if !account.needs_refresh(chrono::Utc::now().timestamp_millis()) {
        return Ok(account);
    }
    let next = crate::oauth::refresh(&account).await?;
    state.accounts.put(crate::oauth::PROVIDER_ID, &next)?;
    Ok(next)
}

/// The model's context window from Settings (thousands of tokens), or the default.
pub fn context_tokens(m: &ModelRef) -> usize {
    m.context_k.filter(|k| *k >= 4).map_or(crate::context::DEFAULT_BUDGET, |k| k as usize * 1000)
}

/// The session's phase decides the role: the prober measures, the teacher does the rest.
async fn endpoint(state: &AppState, s: &Session) -> Result<Endpoint> {
    let mut ep = endpoint_for(state, if s.phase == Phase::Probe { Role::Prober } else { Role::Teacher }).await?;
    ep.session = format!("eureka-{}", s.id);
    Ok(ep)
}

/// Research calls allowed per learner turn (each one is a search + a model call).
pub const MAX_RESEARCH_PER_TURN: usize = 2;
pub const MAX_CARDS_PER_CALL: usize = 8;

/// Extra state for the teacher (audit M6): this topic's failed exam questions.
fn exam_failures(state: &AppState, s: &Session) -> String {
    let Some(link) = &s.exam else { return String::new() };
    let Ok(exam) = state.exams.load(&link.exam_id) else { return String::new() };
    let fails: Vec<String> = exam
        .review
        .iter()
        .filter(|r| r.question.topic_id.as_deref() == Some(link.topic_id.as_str()))
        .take(5)
        .map(|r| {
            let q = &r.question;
            let stem: String = q.stem.replace('\n', " ").chars().take(200).collect();
            let right: Vec<&str> = q.answer.iter().filter_map(|&i| q.options.get(i).map(String::as_str)).collect();
            format!("- {stem} → correcta: {} (aciertos seguidos: {})", right.join(" / "), r.streak)
        })
        .collect();
    if fails.is_empty() {
        return String::new();
    }
    format!("\n## Lo que falló en simulacros de este tema\nAtacá estas confusiones durante la enseñanza:\n{}\n", fails.join("\n"))
}

/// The learner's cards from this session (`make_cards`, AC-57/audit 19).
fn make_cards(state: &AppState, s: &Session, args: &str) -> String {
    #[derive(serde::Deserialize)]
    struct A {
        cards: Vec<C>,
    }
    #[derive(serde::Deserialize)]
    struct C {
        front: String,
        back: String,
    }
    let Ok(a) = serde_json::from_str::<A>(args) else { return "error: argumentos inválidos; mandá {\"cards\": [{\"front\": \"…\", \"back\": \"…\"}]}".into() };
    if a.cards.is_empty() || a.cards.len() > MAX_CARDS_PER_CALL {
        return format!("error: mandá entre 1 y {MAX_CARDS_PER_CALL} tarjetas");
    }
    let cards: Vec<(String, String)> = a.cards.into_iter().map(|c| (c.front, c.back)).collect();
    let name = format!("Sesión: {}", s.title.chars().take(60).collect::<String>());
    match crate::cards::add_to_named_deck(&state.decks, &name, crate::cards::DeckSource::Manual, &cards, chrono::Local::now().date_naive()) {
        Ok(n) => format!("{n} tarjetas agregadas al mazo «{name}» (las repetidas se saltean). El aprendiz las repasa en Tarjetas."),
        Err(e) => format!("error: {e}"),
    }
}

/// Audit item 16: the teacher asks the learner's memory on demand (read-only).
pub fn recall(state: &AppState, s: &Session, args: &str) -> String {
    let a: serde_json::Value = serde_json::from_str(args).unwrap_or_default();
    let Some(query) = a["query"].as_str().map(str::trim).filter(|q| !q.is_empty()) else {
        return "error: recall necesita {\"query\": \"palabras clave\"}".into();
    };
    let kind = a["kind"].as_str().unwrap_or("todo");
    let mut out: Vec<String> = Vec::new();
    if matches!(kind, "todo" | "ideas") {
        let view = state.graph.view();
        for n in crate::graph::relevant(&view, query, 6) {
            let src = n.sources.first().map(|s| match s {
                crate::graph::Source::Session { title, .. } | crate::graph::Source::Notes { title, .. } => title.as_str(),
            });
            out.push(format!("- Idea entendida: {}{}", n.text, src.map(|t| format!(" (de «{t}»)")).unwrap_or_default()));
        }
    }
    let qwords: std::collections::HashSet<String> = crate::graph::normalize(query).split_whitespace().filter(|w| w.len() > 3).map(String::from).collect();
    let hits = |text: &str| crate::graph::normalize(text).split_whitespace().any(|w| qwords.contains(w));
    if matches!(kind, "todo" | "confusiones") {
        for m in state.learner.load().misconceptions.iter().filter(|m| hits(&format!("{} {}", m.concept, m.wrong_idea))).take(4) {
            out.push(format!("- Confusión {}: «{}» — {}", if m.fixed { "reparada" } else { "abierta" }, m.concept, m.wrong_idea));
        }
    }
    // AC-109: what other sessions left in memory.
    if matches!(kind, "todo" | "sesiones") {
        out.extend(crate::memory::recall(&state.sessions.all(), query, &s.id));
    }
    if matches!(kind, "todo" | "examen") {
        let exam_id = s.exam.as_ref().map(|e| e.exam_id.clone());
        for e in state.exams.list().iter().filter(|e| exam_id.is_none() || exam_id.as_deref() == Some(e.id.as_str())) {
            let Ok(exam) = state.exams.load(&e.id) else { continue };
            for r in exam.review.iter().filter(|r| hits(&r.question.stem)).take(3) {
                let stem: String = r.question.stem.replace('\n', " ").chars().take(160).collect();
                out.push(format!("- Falló en «{}»: {stem}", exam.name));
            }
        }
    }
    out.truncate(10);
    if out.is_empty() {
        format!("Nada en la memoria sobre «{query}». Probá con sinónimos o medilo con una pregunta.")
    } else {
        format!("Memoria sobre «{query}»:\n{}", out.join("\n"))
    }
}

/// Audit item 18: folds the messages that left the window into `s.summary`.
/// Best effort: if the summarizer fails, the turn goes on with the old summary.
async fn refresh_summary(state: &AppState, s: &mut Session, upto: usize) {
    let from = s.summarized_upto.max(1);
    let input = crate::context::summary_input(&s.summary, &s.messages[from..upto]);
    match crate::practice::forced_valid(state, Role::Extractor, "summarize_history", crate::context::summary_tool(), crate::context::SUMMARY_TOOL, input, crate::context::parse_summary).await {
        Ok(summary) => {
            s.summary = summary;
            s.summarized_upto = upto;
            let _ = state.sessions.save(s);
        }
        Err(e) => eprintln!("resumen de la sesión: {e}"),
    }
}

/// Passages the teacher can cite, per session: `[L1]`, `[L2]`… (AC-72).
fn library_refs(s: &Session) -> Vec<serde_json::Value> {
    s.messages
        .iter()
        .filter(|m| m.role == "tool")
        .filter_map(|m| m.meta.as_ref())
        .filter(|meta| meta["kind"] == "library")
        .flat_map(|meta| meta["refs"].as_array().cloned().unwrap_or_default())
        .collect()
}

pub const LIBRARY_HITS: usize = 4;
const PASSAGE_CHARS: usize = 900;
const SECTION_CHARS: usize = 6000;

fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &text[..cut])
}

/// AC-72: BM25 over the learner's books; each passage gets a session-wide ref.
pub fn library_search(state: &AppState, s: &Session, args: &str) -> (String, serde_json::Value) {
    let a: serde_json::Value = serde_json::from_str(args).unwrap_or_default();
    let query = a["query"].as_str().unwrap_or("").trim().to_string();
    let none = serde_json::json!({ "kind": "library", "query": query, "refs": [] });
    if query.is_empty() {
        return ("error: library_search necesita {\"query\": \"palabras clave\"}".into(), none);
    }
    let index = state.library.index();
    if index.titles().is_empty() {
        return ("La biblioteca del aprendiz está vacía. Si necesitás fuentes, usá research.".into(), none);
    }
    let hits = index.search(&query, LIBRARY_HITS);
    if hits.is_empty() {
        return (format!("La biblioteca no tiene nada sobre «{query}». Probá con otras palabras o, si hace falta, usá research."), none);
    }
    let first = library_refs(s).len() + 1;
    let mut text = format!("Biblioteca — «{query}»:\n");
    let mut refs = Vec::new();
    for (i, h) in hits.iter().enumerate() {
        let n = first + i;
        let page = h.page.map(|p| format!(" · p. {p}")).unwrap_or_default();
        // NF-22: say which words matched, so a one-word match reads as weak.
        let fit = if h.weak { format!(" · coincidencia débil (solo: {})", h.matched.join(", ")) } else { format!(" · coincide: {}", h.matched.join(", ")) };
        text.push_str(&format!("\n[L{n}] «{}» · {}{page}{fit}\n{}\n", h.book_title, h.section, clip(&h.text, PASSAGE_CHARS)));
        refs.push(serde_json::json!({ "n": n, "book_id": h.book_id, "book_title": h.book_title, "section_id": h.section_id, "section": h.section, "page": h.page }));
    }
    if hits.iter().all(|h| h.weak) {
        text.push_str("\nTodas las coincidencias son débiles: probablemente la biblioteca no trata esto. Si no responde la pregunta, decilo y usá research.\n");
    }
    text.push_str("\nCitá lo que uses con su número, ej.: [L1]. No cites lo que no esté acá. Para la sección completa: library_read.");
    // NF-22: what this search adds to the teacher's context, for the transcript.
    let tokens = crate::context::estimate_tokens(&[Msg::tool("", text.clone(), None)]);
    (text, serde_json::json!({ "kind": "library", "query": query, "refs": refs, "tokens": tokens }))
}

/// The whole section a cited passage came from.
pub fn library_read(state: &AppState, s: &Session, args: &str) -> String {
    let a: serde_json::Value = serde_json::from_str(args).unwrap_or_default();
    let want = a["ref"].as_str().unwrap_or("").trim().trim_start_matches(['[', 'L', 'l']).trim_end_matches(']').parse::<u64>().ok();
    let refs = library_refs(s);
    let Some(r) = want.and_then(|n| refs.iter().find(|r| r["n"].as_u64() == Some(n))) else {
        return "error: ese fragmento no existe; usá un número que haya devuelto library_search (ej.: 'L1')".into();
    };
    let Ok(book) = state.library.load(r["book_id"].as_str().unwrap_or("")) else {
        return "error: ese libro ya no está en la biblioteca".into();
    };
    let Some(sec) = book.sections.iter().find(|x| Some(x.id as u64) == r["section_id"].as_u64()) else {
        return "error: esa sección ya no existe".into();
    };
    let body = sec.markdown.lines().map(|l| match l.trim().strip_prefix("<!-- p:").and_then(|x| x.strip_suffix("-->")) {
        Some(p) => format!("(p. {})", p.trim()),
        None => l.to_string(),
    }).collect::<Vec<_>>().join("\n");
    format!("«{}» · {}\n\n{}\n\n(Citá esta sección como [L{}].)", book.title, book.path(sec.id), clip(&body, SECTION_CHARS), r["n"])
}

/// AC-169: writes finished research into the session, exactly once. From the
/// worker (`in_turn` false) only while no turn runs; a running turn calls it
/// itself at each step. The `running` lock is held so the two never interleave.
pub fn deliver_research(state: &AppState, session_id: &str, in_turn: bool) -> Result<bool> {
    let running = state.running.lock().unwrap();
    if !in_turn && running.contains_key(session_id) {
        return Ok(false);
    }
    let results = state.research.take_done(session_id);
    if results.is_empty() {
        return Ok(false);
    }
    let mut s = state.sessions.load(session_id)?;
    let any = crate::research::patch(&mut s, results);
    if any {
        state.sessions.save(&mut s)?;
    }
    drop(running);
    Ok(any)
}

/// AC-169: research that arrived and the teacher has not seen yet (a note in the state, once).
fn arrived_research(s: &mut Session) -> String {
    let mut out = String::new();
    for m in s.messages.iter_mut().filter(|m| m.role == "tool") {
        let Some(meta) = m.meta.as_mut().filter(|v| v["kind"] == "research" && v["told"] == false) else { continue };
        meta["told"] = serde_json::json!(true);
        out.push_str(&format!("\n{}\n", m.content.as_deref().unwrap_or("")));
    }
    if out.is_empty() {
        return out;
    }
    format!("\n## Llegó una investigación\nLa pediste antes y terminó recién: usala si sirve (citá las fuentes como [1], [2]); si no ayuda, seguí.\n{out}")
}

pub async fn run_turn(state: &AppState, session_id: &str, ch: &Channel<AgentEvent>, cancel: Arc<AtomicBool>) -> Result<()> {
    let mut researched = 0;
    for step in 0..MAX_STEPS {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        // AC-169: research that finished while this turn ran goes in before reading the session.
        deliver_research(state, session_id, true)?;
        let mut s = state.sessions.load(session_id)?;
        if s.pending_question.is_some() {
            return Ok(());
        }
        // Rebuilt every step: a tool call may have changed the phase.
        let ep = endpoint(state, &s).await?;
        let defs = tools::definitions_for(s.phase);
        // AC-20: while measuring and planning, show what the graph already holds.
        let view = if matches!(s.phase, Phase::Probe | Phase::Plan) { state.graph.view() } else { Default::default() };
        // Audit M7: the query is the goal plus what the plan names (more words to match).
        let query = std::iter::once(s.goal.as_str()).chain(s.plan.iter().map(|n| n.title.as_str())).collect::<Vec<_>>().join(" ");
        let known: Vec<&str> = crate::graph::relevant(&view, &query, 12).iter().map(|n| n.text.as_str()).collect();
        let (mut wire, dropped) = crate::context::window(crate::context::compact(&s.messages), ep.context_tokens);
        if dropped > 0 && dropped + 1 >= s.summarized_upto.max(1) + crate::context::SUMMARY_EVERY {
            refresh_summary(state, &mut s, dropped + 1).await;
        }
        // Audit M1–M4: stable system prompt; compacted, windowed history; state last.
        let system = state.prompts.phase_prompt(&s)?;
        let mut block = crate::prompts::state_block(&s, &known);
        block.push_str(&exam_failures(state, &s));
        let books = state.library.index().titles();
        if !books.is_empty() {
            let shown: Vec<String> = books.iter().take(8).map(|t| format!("- «{t}»")).collect();
            let more = if books.len() > 8 { format!("\n- …y {} más", books.len() - 8) } else { String::new() };
            block.push_str(&format!("\n## Biblioteca del aprendiz\n{}{more}\nBuscá ahí con `library_search` antes que en la web, y citá con [L…].\n", shown.join("\n")));
        }
        // AC-75: in every phase; the learner chose these in Ajustes → Accesibilidad.
        let prefs = state.settings.load();
        block.push_str(&prefs.accessibility.teacher_section());
        // AC-92: how the person asked to be addressed, and what they study.
        block.push_str(&prefs.identity.teacher_section());
        // AC-123: what is on screen right now (pomodoro, theme, reminders…), as the app last told us.
        let ui = state.ui_snapshot();
        if !ui.is_empty() {
            block.push_str(&format!("\n## La app ahora\n{ui}\n"));
        }
        // AC-102: today's date, the term, the classes and what is coming. Free when nothing is loaded
        // (outside the chat, where the "tell me your schedule" hint would only be noise).
        let acad = state.academic.data();
        if s.phase == Phase::Chat || !acad.terms.is_empty() {
            block.push_str(&crate::academic::state_section(&acad, chrono::Local::now().date_naive()));
        }
        // AC-157: the career (malla): progress, average and what can be taken next.
        if let Some(c) = state.career.get() {
            block.push_str(&crate::career::state_section(&crate::career::view(&c, &crate::career::cursada_keys(&acad))));
        }
        // AC-111: one student model (confusions, practice, mocks, cards, memories, dates) in every phase.
        let model = crate::student::model(state, chrono::Local::now().date_naive());
        block.push_str(&crate::student::state_section(&model, &s));
        // AC-112: in a chat, the plan for today, to offer it when the person brings no topic.
        if s.phase == Phase::Chat {
            block.push_str(&crate::student::today_section(&crate::student::today(&model)));
        }
        // AC-109: the latest remembered sessions, to pick up a thread.
        if crate::memory::wants_history(&s) {
            block.push_str(&crate::memory::state_section(&state.sessions.all(), &s));
        }
        if dropped > 0 && !s.summary.is_empty() {
            block.push_str(&format!("\n## Lo que pasó antes en esta sesión\n{}\n", s.summary));
        }
        block.push_str(&arrived_research(&mut s));
        if let Some(note) = crate::context::steps_note(step, MAX_STEPS) {
            block.push_str(&note);
        }
        wire.push(crate::context::state_message(&block));

        let _ = ch.send(AgentEvent::Activity { label: if step == 0 { "Pensando…".into() } else { "Pensando el siguiente paso…".into() } });
        let completion = llm::stream_chat(
            &ep,
            &system,
            &wire,
            &defs,
            None,
            |t| {
                let _ = ch.send(AgentEvent::Text { delta: t.to_string() });
            },
            || cancel.load(Ordering::Relaxed),
        )
        .await?;

        let had_calls = !completion.tool_calls.is_empty();
        if completion.text.is_empty() && !had_calls {
            // Audit M4: a silent first step leaves the learner with no signal.
            return if step == 0 { Err(anyhow!("El modelo no respondió nada. Probá de nuevo o cambiá de modelo en Ajustes.")) } else { Ok(()) };
        }
        s.messages.push(Msg {
            role: "assistant".into(),
            content: (!completion.text.is_empty()).then(|| completion.text.clone()),
            tool_calls: had_calls.then(|| completion.tool_calls.clone()),
            tool_call_id: None,
            meta: None,
        });

        if cancel.load(Ordering::Relaxed) && had_calls {
            // Interrupted mid-stream: don't execute half-received calls.
            s.messages.last_mut().unwrap().tool_calls = None;
            state.sessions.save(&mut s)?;
            let _ = ch.send(AgentEvent::Session { session: Box::new(s) });
            return Ok(());
        }

        let mut asked = false;
        for call in &completion.tool_calls {
            // Once a question is waiting, the rest of the batch would act before the answer.
            if asked {
                s.messages.push(Msg::tool(&call.id, "ignorada: ya hiciste una pregunta en este paso; esperá la respuesta del aprendiz antes de seguir.", None));
                continue;
            }
            let _ = ch.send(AgentEvent::Activity { label: activity_label(&call.function.name).into() });
            // Research needs IO (web + a model), so it runs here, not in tools::apply.
            if call.function.name == crate::research::TOOL {
                if researched >= MAX_RESEARCH_PER_TURN {
                    s.messages.push(Msg::tool(&call.id, format!("ignorada: ya investigaste {MAX_RESEARCH_PER_TURN} veces en este turno; seguí con lo que tenés."), None));
                    continue;
                }
                researched += 1;
                let q: serde_json::Value = serde_json::from_str(&call.function.arguments).unwrap_or_default();
                let Some(question) = q["question"].as_str().filter(|x| !x.trim().is_empty()) else {
                    s.messages.push(Msg::tool(&call.id, "error: research necesita {\"question\": \"…\"}", None));
                    continue;
                };
                // AC-169: without a search key it fails now; otherwise it runs in the background.
                if !state.settings.keys().get(crate::settings::SEARCH_KEY).is_some_and(|k| !k.is_empty()) {
                    let result = crate::research::run(state, question).await;
                    s.messages.push(Msg::tool(&call.id, result.for_teacher(), Some(result.meta())));
                    continue;
                }
                let job = crate::research::Job { session_id: s.id.clone(), call_id: call.id.clone(), question: question.trim().into() };
                match state.research.enqueue(job) {
                    Ok(()) => s.messages.push(Msg::tool(&call.id, crate::research::pending_text(question.trim()), Some(crate::research::pending_meta(question.trim())))),
                    Err(why) => s.messages.push(Msg::tool(&call.id, format!("ignorada: {why}."), None)),
                }
                continue;
            }
            if call.function.name == "library_search" {
                let (r, meta) = library_search(state, &s, &call.function.arguments);
                s.messages.push(Msg::tool(&call.id, r, Some(meta)));
                continue;
            }
            if call.function.name == "library_read" {
                let r = library_read(state, &s, &call.function.arguments);
                s.messages.push(Msg::tool(&call.id, r, None));
                continue;
            }
            if call.function.name == "recall" {
                let r = recall(state, &s, &call.function.arguments);
                s.messages.push(Msg::tool(&call.id, r, None));
                continue;
            }
            if call.function.name == "make_cards" {
                let r = make_cards(state, &s, &call.function.arguments);
                s.messages.push(Msg::tool(&call.id, r, None));
                continue;
            }
            if call.function.name == "app_status" {
                let r = app_status(state);
                s.messages.push(Msg::tool(&call.id, r, None));
                continue;
            }
            match tools::apply(&mut s, call) {
                Outcome::Result(r) => {
                    // AC-122: a validated control is run by the screen, once, as it happens.
                    if call.function.name == "ui_command" && !r.starts_with("error:") {
                        if let Ok((command, _)) = tools::check_ui_command(&call.function.arguments) {
                            let _ = ch.send(AgentEvent::Ui { command });
                        }
                    }
                    s.messages.push(Msg::tool(&call.id, r, None));
                }
                // Its tool result is the learner's answer (tools::add_learner_input).
                Outcome::AwaitLearner => asked = true,
            }
        }
        state.sessions.save(&mut s)?;
        let waiting = s.pending_question.is_some();
        let _ = ch.send(AgentEvent::Session { session: Box::new(s) });
        if !had_calls || waiting {
            return Ok(());
        }
    }
    Err(anyhow!("El agente alcanzó el límite de {MAX_STEPS} pasos en este turno. Escribí algo para continuar."))
}

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
