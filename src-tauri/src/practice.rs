//! Practice (Phase 3): problem sets generated from chosen graph ideas, solved
//! one at a time with graded hints, and graded on the learner's reasoning.
//! AC-167: new sets are written one problem at a time, each one harder or
//! easier after how the last went. Results live in the practice set only;
//! they never touch the graph.

use crate::agent::{endpoint_for, Role};
use crate::llm::{self, Msg};
use crate::AppState;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const GENERATE_TOOL: &str = "set_problems";
pub const GRADE_TOOL: &str = "grade_answer";
pub const HINT_TOOL: &str = "give_hint";
pub const OWN_TOOL: &str = "set_own_problems";
/// AC-173: problems read from the learner's own guide, at most.
pub const MAX_OWN: usize = 20;
const OWN_TEXT_CHARS: usize = 30_000;
pub const MAX_PROBLEMS: usize = 10;
pub const MAX_HINTS: usize = 3;
/// AC-168: hints written for what the learner is thinking, per problem.
pub const MAX_NUDGES: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Target {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Correct,
    Partial,
    Incorrect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attempt {
    pub answer: String,
    #[serde(default)]
    pub confidence: Option<u8>,
    #[serde(default)]
    pub thinking: String,
    pub hints_used: usize,
    pub verdict: Verdict,
    pub feedback: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Problem {
    pub id: String,
    pub statement: String,
    /// Graph node ids this problem exercises.
    pub targets: Vec<String>,
    pub hints: Vec<String>,
    pub solution: String,
    #[serde(default)]
    pub hints_shown: usize,
    /// AC-167: 1 one idea, familiar · 2 one idea, new context · 3 two ideas,
    /// familiar · 4 two or more, new context. 0 = a set from before (fixed).
    #[serde(default)]
    pub level: u8,
    /// AC-168: hints written for where the learner's reasoning was.
    #[serde(default)]
    pub nudges: Vec<String>,
    /// AC-173: the learner's own problem whose reference solution Eureka wrote (it may be wrong).
    #[serde(default)]
    pub solution_by_model: bool,
    #[serde(default)]
    pub attempts: Vec<Attempt>,
}

impl Problem {
    /// Every hint seen: the fixed ones shown plus the nudges.
    pub fn hints_used(&self) -> usize {
        self.hints_shown + self.nudges.len()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PracticeSet {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub targets: Vec<Target>,
    pub problems: Vec<Problem>,
    /// AC-167: how many problems the set will have, written one by one.
    /// None = a set from before, generated whole.
    #[serde(default)]
    pub planned: Option<usize>,
    /// AC-173: the learner brought these problems (a guide, an old exam).
    #[serde(default)]
    pub own: bool,
}

#[derive(Debug, Serialize)]
pub struct PracticeSummary {
    pub id: String,
    pub title: String,
    pub updated_at: DateTime<Utc>,
    pub total: usize,
    /// Problems with at least one attempt.
    pub done: usize,
    /// Problems whose last attempt is correct.
    pub correct: usize,
}

impl PracticeSet {
    pub fn total(&self) -> usize {
        self.planned.unwrap_or(0).max(self.problems.len())
    }

    pub fn summary(&self) -> PracticeSummary {
        PracticeSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            updated_at: self.updated_at,
            total: self.total(),
            done: self.problems.iter().filter(|p| !p.attempts.is_empty()).count(),
            correct: self.problems.iter().filter(|p| p.attempts.last().is_some_and(|a| a.verdict == Verdict::Correct)).count(),
        }
    }
}

// ── Pure: what the models get and what we accept back ─────────────────────

pub fn generate_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": GENERATE_TOOL,
        "description": "Guarda los problemas de práctica.",
        "parameters": { "type": "object", "properties": { "problems": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "statement": { "type": "string", "description": "Enunciado en Markdown. NO nombra la idea que se necesita." },
                "targets": { "type": "array", "items": { "type": "string" }, "description": "ids de las ideas que ejercita" },
                "hints": { "type": "array", "items": { "type": "string" }, "description": "hasta 3, de sutil a directa" },
                "solution": { "type": "string" }
            },
            "required": ["statement", "targets", "hints", "solution"]
        }}}, "required": ["problems"] }
    }})
}

pub fn grade_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": GRADE_TOOL,
        "description": "Devuelve la corrección de una respuesta.",
        "parameters": { "type": "object", "properties": {
            "verdict": { "type": "string", "enum": ["correct", "partial", "incorrect"] },
            "feedback": { "type": "string", "description": "Devolución breve sobre el razonamiento, sin revelar la solución si es incorrecta." }
        }, "required": ["verdict", "feedback"] }
    }})
}

pub const MAX_LEVEL: u8 = 4;

pub fn level_label(level: u8) -> &'static str {
    match level {
        1 => "una sola idea, en un contexto conocido",
        2 => "una sola idea, en un contexto nuevo que no se parezca a cómo se enseñó",
        3 => "dos ideas combinadas, en un contexto conocido",
        _ => "dos o más ideas combinadas, en un contexto nuevo",
    }
}

/// AC-167: the level of the next problem, from how the last answered one went.
/// Right with few hints and some confidence → up; wrong or many hints → down.
pub fn next_level(set: &PracticeSet) -> u8 {
    let top = if set.targets.len() > 1 { MAX_LEVEL } else { 2 };
    let Some((p, a)) = set.problems.iter().rev().find_map(|p| p.attempts.last().map(|a| (p, a))) else {
        return 1;
    };
    let level = p.level.max(1);
    let next = match a.verdict {
        Verdict::Correct if a.hints_used <= 1 && a.confidence.unwrap_or(3) >= 3 => level + 1,
        Verdict::Incorrect => level - 1,
        _ if a.hints_used >= 2 => level - 1,
        _ => level,
    };
    next.clamp(1, top)
}

/// AC-167: the ideas the next problem should lean on: what went wrong last,
/// then what was practiced least.
pub fn focus<'a>(set: &'a PracticeSet) -> Vec<&'a Target> {
    let mut weak: Vec<&str> = vec![];
    for p in set.problems.iter().rev() {
        if p.attempts.last().is_some_and(|a| a.verdict != Verdict::Correct) {
            for t in &p.targets {
                if !weak.contains(&t.as_str()) {
                    weak.push(t);
                }
            }
        }
    }
    let uses = |id: &str| set.problems.iter().filter(|p| p.targets.iter().any(|t| t == id)).count();
    let mut rest: Vec<&Target> = set.targets.iter().filter(|t| !weak.contains(&t.id.as_str())).collect();
    rest.sort_by_key(|t| uses(&t.id));
    weak.iter().filter_map(|id| set.targets.iter().find(|t| t.id == *id)).chain(rest).collect()
}

/// AC-167: one problem, with how the earlier ones went.
pub fn next_input(set: &PracticeSet) -> String {
    let level = next_level(set);
    let mut s = generate_input(&set.targets, 1);
    if !set.problems.is_empty() {
        s.push_str("\n## Cómo le fue hasta ahora\n");
        for p in &set.problems {
            let ideas = p.targets.iter().filter_map(|id| set.targets.iter().find(|t| &t.id == id)).map(|t| t.text.as_str()).collect::<Vec<_>>().join("; ");
            let how = match p.attempts.last() {
                None => "lo salteó".to_string(),
                Some(a) => {
                    let mut h = format!("{:?}, {} pistas", a.verdict, a.hints_used);
                    if let Some(c) = a.confidence {
                        h.push_str(&format!(", confianza {c}/5"));
                    }
                    if !a.thinking.trim().is_empty() {
                        h.push_str(&format!(". Pensó: «{}»", a.thinking.chars().take(200).collect::<String>()));
                    }
                    h
                }
            };
            s.push_str(&format!("- Nivel {} ({ideas}): «{}» → {how}\n", p.level.max(1), p.statement.chars().take(160).collect::<String>()));
        }
    }
    let lean: Vec<String> = focus(set).iter().take(if level >= 3 { 2 } else { 1 }).map(|t| format!("{} ({})", t.text, t.id)).collect();
    s.push_str(&format!("\n## El próximo problema\nNivel {level}: {}.\nApoyate en: {}.\nNo repitas un enunciado anterior.\n", level_label(level), lean.join(" y ")));
    s
}

// ── AC-173: the learner's own problems ────────────────────────────────────

/// One problem read from the learner's text, before it becomes a practice (they can edit it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OwnProblem {
    pub statement: String,
    #[serde(default)]
    pub solution: String,
    /// The guide itself gives the answer.
    #[serde(default)]
    pub given: bool,
    #[serde(default)]
    pub hints: Vec<String>,
    /// Graph node ids it needs.
    #[serde(default)]
    pub ideas: Vec<String>,
}

pub fn own_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": OWN_TOOL,
        "description": "Guarda los ejercicios del aprendiz, uno por problema.",
        "parameters": { "type": "object", "properties": { "problems": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "statement": { "type": "string", "description": "El enunciado del aprendiz, en Markdown." },
                "solution": { "type": "string", "description": "La respuesta de la guía, o la tuya con el razonamiento clave." },
                "given": { "type": "boolean", "description": "true si la respuesta está en el texto del aprendiz" },
                "hints": { "type": "array", "items": { "type": "string" }, "description": "hasta 3, de sutil a directa" },
                "ideas": { "type": "array", "items": { "type": "string" }, "description": "ids de las ideas de la lista que necesita" }
            },
            "required": ["statement", "solution", "given", "hints"]
        }}}, "required": ["problems"] }
    }})
}

pub fn own_input(text: &str, ideas: &[Target]) -> String {
    let mut s = format!("## Lo que trajo el aprendiz\n{}\n", text.trim().chars().take(OWN_TEXT_CHARS).collect::<String>());
    if !ideas.is_empty() {
        s.push_str("\n## Ideas de su grafo (id: texto)\n");
        for t in ideas {
            s.push_str(&format!("- {}: {}\n", t.id, t.text));
        }
    }
    s
}

#[derive(Deserialize)]
struct RawOwn {
    problems: Vec<OwnProblem>,
}

/// Keeps real problems: a statement, a solution, ≤3 hints, ideas that exist; no repeats; at most MAX_OWN.
pub fn clean_own(problems: Vec<OwnProblem>, known: &HashSet<&str>) -> Vec<OwnProblem> {
    let mut seen = HashSet::new();
    problems
        .into_iter()
        .filter_map(|p| {
            let statement = p.statement.trim().to_string();
            let solution = p.solution.trim().to_string();
            if statement.is_empty() || solution.is_empty() || !seen.insert(statement.clone()) {
                return None;
            }
            let hints = p.hints.into_iter().map(|h| h.trim().to_string()).filter(|h| !h.is_empty()).take(MAX_HINTS).collect();
            let mut ideas: Vec<String> = p.ideas.into_iter().filter(|i| known.contains(i.as_str())).collect();
            ideas.dedup();
            Some(OwnProblem { statement, solution, given: p.given, hints, ideas })
        })
        .take(MAX_OWN)
        .collect()
}

pub fn validate_own(raw: &str, ideas: &[Target]) -> Result<Vec<OwnProblem>> {
    let parsed: RawOwn = serde_json::from_str(raw).context("el lector de problemas devolvió datos inválidos")?;
    let known: HashSet<&str> = ideas.iter().map(|t| t.id.as_str()).collect();
    let out = clean_own(parsed.problems, &known);
    if out.is_empty() {
        return Err(anyhow!("no encontré ningún ejercicio con su enunciado"));
    }
    Ok(out)
}

/// AC-174: the whole text of a library document, by its title (the chat names it).
pub fn book_text(state: &AppState, title: &str) -> Result<String> {
    let want = crate::graph::normalize(title);
    let books = state.library.all();
    let book = books
        .iter()
        .find(|b| crate::graph::normalize(&b.title) == want)
        .or_else(|| books.iter().find(|b| !want.is_empty() && crate::graph::normalize(&b.title).contains(&want)))
        .ok_or_else(|| anyhow!("No encontré «{}» en tu biblioteca.", title.trim()))?;
    let text: String = book
        .sections
        .iter()
        .flat_map(|s| s.markdown.lines())
        .filter(|l| !l.trim_start().starts_with("<!-- p:"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(text.chars().take(OWN_TEXT_CHARS).collect())
}

/// AC-173: reads the learner's text into problems to review (nothing is saved).
/// AC-174: or the text of a library document, when the chat names one.
pub async fn read_own(state: &AppState, text: &str, book: Option<&str>) -> Result<Vec<OwnProblem>> {
    let from_book;
    let text = match book.map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) if text.trim().is_empty() => {
            from_book = book_text(state, b)?;
            from_book.as_str()
        }
        _ => text,
    };
    if text.trim().is_empty() {
        return Err(anyhow!("Pegá tus ejercicios o elegí un archivo."));
    }
    let view = state.graph.view();
    let ideas: Vec<Target> = crate::graph::relevant(&view, text, 20).iter().map(|n| Target { id: n.id.clone(), text: n.text.clone() }).collect();
    forced_valid(state, Role::Practice, "practice_own", own_tool(), OWN_TOOL, own_input(text, &ideas), |raw| validate_own(raw, &ideas)).await
}

/// AC-173: the practice from the problems the learner kept (and maybe edited).
pub fn create_own(state: &AppState, title: &str, problems: Vec<OwnProblem>) -> Result<PracticeSet> {
    let view = state.graph.view();
    let known: HashSet<&str> = view.nodes.iter().map(|n| n.id.as_str()).collect();
    let problems = clean_own(problems, &known);
    if problems.is_empty() {
        return Err(anyhow!("Dejá al menos un ejercicio con su enunciado."));
    }
    let used: HashSet<&str> = problems.iter().flat_map(|p| p.ideas.iter().map(String::as_str)).collect();
    let targets: Vec<Target> = view.nodes.iter().filter(|n| used.contains(n.id.as_str())).map(|n| Target { id: n.id.clone(), text: n.text.clone() }).collect();
    let title = match title.trim() {
        "" => format!("Mis problemas ({})", problems.len()),
        t => t.chars().take(80).collect(),
    };
    let now = Utc::now();
    let mut set = PracticeSet {
        id: uuid::Uuid::new_v4().simple().to_string(),
        title,
        created_at: now,
        updated_at: now,
        targets,
        problems: problems
            .into_iter()
            .enumerate()
            .map(|(i, p)| Problem { id: format!("q{}", i + 1), statement: p.statement, targets: p.ideas, hints: p.hints, solution: p.solution, hints_shown: 0, level: 0, nudges: vec![], solution_by_model: !p.given, attempts: vec![] })
            .collect(),
        planned: None,
        own: true,
    };
    state.practice.save(&mut set)?;
    Ok(set)
}

pub fn hint_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": HINT_TOOL,
        "description": "Da un empujón mínimo desde donde está el razonamiento del aprendiz.",
        "parameters": { "type": "object", "properties": {
            "hint": { "type": "string", "description": "Una o dos oraciones. Nunca la respuesta." },
            "solved": { "type": "boolean", "description": "true si lo que pensó ya resuelve el problema" }
        }, "required": ["hint", "solved"] }
    }})
}

pub fn hint_input(set: &PracticeSet, p: &Problem, draft: &str) -> String {
    let ideas: Vec<&str> = set.targets.iter().filter(|t| p.targets.contains(&t.id)).map(|t| t.text.as_str()).collect();
    let mut s = format!("## Problema\n{}\n\n## Ideas que ejercita\n- {}\n\n## Solución de referencia\n{}\n\n", p.statement, ideas.join("\n- "), p.solution);
    let seen: Vec<&str> = p.hints.iter().take(p.hints_shown).chain(&p.nudges).map(String::as_str).collect();
    if !seen.is_empty() {
        s.push_str(&format!("## Pistas que ya vio\n- {}\n\n", seen.join("\n- ")));
    }
    if let Some(a) = p.attempts.last() {
        s.push_str(&format!("## Su intento anterior ({:?})\n{}\nDevolución: {}\n\n", a.verdict, a.answer, a.feedback));
    }
    s.push_str(&format!("## Lo que viene pensando\n{}\n", draft.trim()));
    s
}

#[derive(Deserialize)]
struct RawHint {
    hint: String,
    #[serde(default)]
    solved: bool,
}

pub fn parse_hint(raw: &str) -> Result<(String, bool)> {
    let h: RawHint = serde_json::from_str(raw).context("el modelo devolvió una pista inválida")?;
    let hint = h.hint.trim().to_string();
    if hint.is_empty() {
        return Err(anyhow!("la pista vino vacía"));
    }
    Ok((hint, h.solved))
}

pub fn generate_input(targets: &[Target], count: usize) -> String {
    let mut s = format!("Generá {count} problemas de práctica.\n\n## Ideas a ejercitar (id: texto)\n");
    for t in targets {
        s.push_str(&format!("- {}: {}\n", t.id, t.text));
    }
    s
}

#[derive(Deserialize)]
struct RawProblems {
    problems: Vec<RawProblem>,
}

#[derive(Deserialize)]
struct RawProblem {
    statement: String,
    #[serde(default)]
    targets: Vec<String>,
    #[serde(default)]
    hints: Vec<String>,
    #[serde(default)]
    solution: String,
}

/// NF-13: keeps valid problems (non-empty statement, ≥1 chosen target,
/// ≤3 non-empty hints), up to `count` and MAX_PROBLEMS.
pub fn validate_problems(raw: &str, targets: &[Target], count: usize) -> Result<Vec<Problem>> {
    let parsed: RawProblems = serde_json::from_str(raw).context("el generador devolvió datos inválidos")?;
    let allowed: HashSet<&str> = targets.iter().map(|t| t.id.as_str()).collect();
    let mut seen = HashSet::new();
    let problems: Vec<Problem> = parsed
        .problems
        .into_iter()
        .filter_map(|p| {
            let statement = p.statement.trim().to_string();
            let mut ts: Vec<String> = p.targets.into_iter().filter(|t| allowed.contains(t.as_str())).collect();
            ts.dedup();
            if statement.is_empty() || ts.is_empty() || !seen.insert(statement.clone()) {
                return None;
            }
            let hints = p.hints.into_iter().map(|h| h.trim().to_string()).filter(|h| !h.is_empty()).take(MAX_HINTS).collect();
            Some((statement, ts, hints, p.solution.trim().to_string()))
        })
        .take(count.min(MAX_PROBLEMS))
        .enumerate()
        .map(|(i, (statement, targets, hints, solution))| Problem {
            id: format!("q{}", i + 1),
            statement,
            targets,
            hints,
            solution,
            hints_shown: 0,
            level: 0,
            nudges: vec![],
            solution_by_model: false,
            attempts: vec![],
        })
        .collect();
    if problems.is_empty() {
        return Err(anyhow!("el generador no devolvió ningún problema válido"));
    }
    Ok(problems)
}

pub fn grade_input(set: &PracticeSet, p: &Problem, answer: &str, confidence: Option<u8>, thinking: &str) -> String {
    let ideas: Vec<&str> = set.targets.iter().filter(|t| p.targets.contains(&t.id)).map(|t| t.text.as_str()).collect();
    let mut s = format!(
        "## Problema\n{}\n\n## Ideas que ejercita\n- {}\n\n## Solución de referencia\n{}\n\n## Pistas usadas: {} de {}\n\n",
        p.statement,
        ideas.join("\n- "),
        p.solution,
        p.hints_used(),
        p.hints.len() + p.nudges.len()
    );
    if p.solution_by_model {
        // AC-173: the learner's own problem; Eureka wrote this reference.
        s.push_str("Ojo: esta solución de referencia la escribió un modelo, no viene de la guía del aprendiz, y puede estar mal. Si el razonamiento del aprendiz es válido y llega a otro resultado, revisá la referencia antes de marcarlo mal, y si la referencia está mal, decilo en la devolución.\n\n");
    }
    s.push_str(&format!("Respuesta del aprendiz: {answer}\n"));
    if let Some(c) = confidence {
        s.push_str(&format!("Confianza: {c}/5\n"));
    }
    if !thinking.trim().is_empty() {
        s.push_str(&format!("Su razonamiento: {thinking}\n"));
    }
    s
}

#[derive(Deserialize)]
struct RawGrade {
    verdict: Verdict,
    feedback: String,
}

pub fn parse_grade(raw: &str) -> Result<(Verdict, String)> {
    let g: RawGrade = serde_json::from_str(raw).context("el corrector devolvió datos inválidos")?;
    let feedback = g.feedback.trim().to_string();
    if feedback.is_empty() {
        return Err(anyhow!("el corrector no dio devolución"));
    }
    Ok((g.verdict, feedback))
}

pub fn title_for(targets: &[Target]) -> String {
    let first: String = targets.first().map(|t| t.text.chars().take(60).collect()).unwrap_or_default();
    match targets.len() {
        0 => "Práctica".into(),
        1 => first,
        n => format!("{first} (+{})", n - 1),
    }
}

// ── Store ──────────────────────────────────────────────────────────────────

pub struct PracticeStore {
    dir: PathBuf,
}

impl PracticeStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("practice") }
    }

    fn path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<PracticeSet> {
        Ok(serde_json::from_str(&std::fs::read_to_string(self.path(id)).context("práctica no encontrada")?)?)
    }

    pub fn save(&self, s: &mut PracticeSet) -> Result<()> {
        s.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&s.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
        std::fs::rename(tmp, self.path(&s.id))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    /// Every set, whole (for the student model).
    pub fn all(&self) -> Vec<PracticeSet> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<PracticeSet>(&raw).ok())
            .collect()
    }

    pub fn list(&self) -> Vec<PracticeSummary> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<PracticeSummary> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<PracticeSet>(&raw).ok())
            .map(|s| s.summary())
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }
}

// ── Model calls ────────────────────────────────────────────────────────────

/// One call with `name` forced; returns that tool's raw arguments.
pub async fn forced(state: &AppState, role: Role, prompt: &str, tool: Value, name: &str, input: String) -> Result<String> {
    forced_valid(state, role, prompt, tool, name, input, |raw| Ok(raw.to_string())).await
}

/// Prompts whose output the learner reads: problems and feedback, exam
/// questions and cheat sheets, cards, listening, code exercises and projects.
/// The others (graph, summaries, syllabus, guides, checks) never reach the learner.
const LEARNER_FACING: &[&str] = &["class_notes", "practice_generate", "practice_grade", "practice_hint", "practice_own", "exam_questions", "exam_cheat_sheet", "cards_generate", "lang_listening", "code_exercise", "code_project"];

/// AC-75: the learner's accessibility settings, appended to the input of
/// any call that writes for the learner (the system prompt stays stable).
pub fn with_access(state: &AppState, input: String) -> String {
    let section = state.settings.load().accessibility.teacher_section();
    if section.is_empty() {
        return input;
    }
    format!("{input}\n{section}Aplicalos a todo lo que vaya a leer o escuchar el aprendiz: consignas, opciones, explicaciones, devoluciones y tarjetas.\n")
}

/// The provider refused the `tool_choice` itself (DeepSeek in thinking mode,
/// through OpenCode Go, answers 400 "does not support this tool_choice").
fn rejects_tool_choice(e: &anyhow::Error) -> bool {
    let t = format!("{e:#}").to_lowercase();
    t.contains("tool_choice") && (t.contains("400") || t.contains("not support"))
}

/// One call that must come back with `name`: by name first, then
/// `"required"`, then `"auto"` with that single tool. A choice the provider
/// refuses (or that returns no call) moves on to the next one.
async fn call_tool(ep: &llm::Endpoint, system: &str, msgs: &[Msg], tools: &Value, name: &str) -> Result<Option<llm::ToolCall>> {
    let choices = [json!({ "type": "function", "function": { "name": name } }), json!("required"), json!("auto")];
    let mut refused = None;
    for choice in &choices {
        match llm::stream_chat(ep, system, msgs, tools, Some(choice), |_| {}, || false).await {
            Ok(c) => {
                if let Some(call) = c.tool_calls.into_iter().find(|t| t.function.name == name) {
                    return Ok(Some(call));
                }
            }
            Err(e) if rejects_tool_choice(&e) => refused = Some(e),
            Err(e) => return Err(e),
        }
    }
    match refused {
        Some(e) => Err(e),
        None => Ok(None),
    }
}

/// A forced-tool call whose result must pass `validate` (audit item 8).
/// If the model ignores the named tool, or the provider refuses to force it,
/// it is asked again with a looser `tool_choice` (see `call_tool`); if the
/// result doesn't validate, the model sees its call and the concrete error
/// and gets ONE chance to correct it.
pub async fn forced_valid<T>(state: &AppState, role: Role, prompt: &str, tool: Value, name: &str, input: String, validate: impl Fn(&str) -> Result<T>) -> Result<T> {
    let mut ep = endpoint_for(state, role).await?;
    ep.usage.purpose = prompt.into();
    let system = state.prompts.get(prompt)?;
    let tools = json!([tool]);
    let input = if LEARNER_FACING.contains(&prompt) { with_access(state, input) } else { input };
    let mut msgs = vec![Msg::user(input, None)];
    let call = call_tool(&ep, &system, &msgs, &tools, name).await?.ok_or_else(|| anyhow!("el modelo no devolvió {name}"))?;
    match validate(&call.function.arguments) {
        Ok(v) => Ok(v),
        Err(first) => {
            msgs.push(Msg { role: "assistant".into(), content: None, tool_calls: Some(vec![call.clone()]), tool_call_id: None, meta: None });
            msgs.push(Msg::tool(&call.id, format!("error: {first}"), None));
            msgs.push(Msg::user(format!("Corregí lo que dice el error y volvé a llamar `{name}` con todos los datos."), None));
            let retry = call_tool(&ep, &system, &msgs, &tools, name).await?.ok_or(first)?;
            validate(&retry.function.arguments)
        }
    }
}

pub async fn create(state: &AppState, node_ids: &[String], count: usize) -> Result<PracticeSet> {
    let view = state.graph.view();
    let targets: Vec<Target> = view
        .nodes
        .iter()
        .filter(|n| node_ids.contains(&n.id))
        .map(|n| Target { id: n.id.clone(), text: n.text.clone() })
        .collect();
    if targets.is_empty() {
        return Err(anyhow!("Elegí al menos una idea del grafo."));
    }
    let count = count.clamp(1, MAX_PROBLEMS);
    let now = Utc::now();
    let mut set = PracticeSet { id: uuid::Uuid::new_v4().simple().to_string(), title: title_for(&targets), created_at: now, updated_at: now, targets, problems: vec![], planned: Some(count), own: false };
    // AC-167: only the first one now; the rest after each answer.
    set.problems.push(write_next(state, &set).await?);
    state.practice.save(&mut set)?;
    Ok(set)
}

/// One more problem at `next_level`, never a repeated statement.
async fn write_next(state: &AppState, set: &PracticeSet) -> Result<Problem> {
    let level = next_level(set);
    let seen: HashSet<&str> = set.problems.iter().map(|p| p.statement.as_str()).collect();
    let mut p = forced_valid(state, Role::Practice, "practice_generate", generate_tool(), GENERATE_TOOL, next_input(set), |raw| {
        let p = validate_problems(raw, &set.targets, 1)?.remove(0);
        if seen.contains(p.statement.as_str()) {
            return Err(anyhow!("ese enunciado ya salió: escribí otro problema"));
        }
        Ok(p)
    })
    .await?;
    p.id = format!("q{}", set.problems.len() + 1);
    p.level = level;
    Ok(p)
}

/// AC-167: writes the next problem when the learner has `have` of them and
/// more are planned. Asked twice (ahead of time and on "Siguiente"), it
/// writes it once: a call that finds more than `have` returns the set as is.
pub async fn next_problem(state: &AppState, set_id: &str, have: usize) -> Result<PracticeSet> {
    let set = state.practice.load(set_id)?;
    if set.problems.len() != have || set.problems.len() >= set.total() {
        return Ok(set);
    }
    let p = write_next(state, &set).await?;
    let mut set = state.practice.load(set_id)?;
    if set.problems.len() == have {
        set.problems.push(p);
        state.practice.save(&mut set)?;
    }
    Ok(set)
}

pub fn reveal_hint(state: &AppState, set_id: &str, problem_id: &str) -> Result<PracticeSet> {
    let mut set = state.practice.load(set_id)?;
    let p = set.problems.iter_mut().find(|p| p.id == problem_id).ok_or_else(|| anyhow!("problema no encontrado"))?;
    p.hints_shown = (p.hints_shown + 1).min(p.hints.len());
    state.practice.save(&mut set)?;
    Ok(set)
}

#[derive(Debug, Serialize)]
pub struct Nudge {
    pub set: PracticeSet,
    pub hint: String,
    /// What they thought already solves it: the hint says so and is not counted.
    pub solved: bool,
}

/// AC-168: a hint written for where the learner's reasoning is right now.
pub async fn nudge(state: &AppState, set_id: &str, problem_id: &str, draft: &str) -> Result<Nudge> {
    if draft.trim().is_empty() {
        return Err(anyhow!("Escribí lo que venís pensando y te doy un empujón desde ahí."));
    }
    let set = state.practice.load(set_id)?;
    let p = set.problems.iter().find(|p| p.id == problem_id).ok_or_else(|| anyhow!("problema no encontrado"))?;
    if p.nudges.len() >= MAX_NUDGES {
        return Err(anyhow!("Ya te di {MAX_NUDGES} empujones en este problema: probá con lo que tenés o mirá la solución."));
    }
    let (hint, solved) = forced_valid(state, Role::Practice, "practice_hint", hint_tool(), HINT_TOOL, hint_input(&set, p, draft), parse_hint).await?;
    let mut set = state.practice.load(set_id)?;
    if !solved {
        let p = set.problems.iter_mut().find(|p| p.id == problem_id).ok_or_else(|| anyhow!("problema no encontrado"))?;
        p.nudges.push(hint.clone());
        state.practice.save(&mut set)?;
    }
    Ok(Nudge { set, hint, solved })
}

pub async fn answer(state: &AppState, set_id: &str, problem_id: &str, answer: &str, confidence: Option<u8>, thinking: &str) -> Result<PracticeSet> {
    let answer = answer.trim();
    if answer.is_empty() {
        return Err(anyhow!("Escribí una respuesta."));
    }
    let set = state.practice.load(set_id)?;
    let p = set.problems.iter().find(|p| p.id == problem_id).ok_or_else(|| anyhow!("problema no encontrado"))?;
    let (verdict, feedback) = forced_valid(state, Role::Practice, "practice_grade", grade_tool(), GRADE_TOOL, grade_input(&set, p, answer, confidence, thinking), parse_grade).await?;
    // Reload: only now, after a successful grade, is anything written (NF-13).
    let mut set = state.practice.load(set_id)?;
    let p = set.problems.iter_mut().find(|p| p.id == problem_id).ok_or_else(|| anyhow!("problema no encontrado"))?;
    let ideas: Vec<String> = set.targets.iter().filter(|t| p.targets.contains(&t.id)).map(|t| t.text.clone()).collect();
    let source = format!("Práctica: {}", set.title);
    if verdict != Verdict::Correct {
        if let Some(idea) = ideas.first() {
            let wrong = format!("respondió «{}»: {}", answer.chars().take(120).collect::<String>(), feedback.chars().take(160).collect::<String>());
            let _ = state.learner.update(|pr| crate::learner::add_misconception(pr, idea, &wrong, false, &source));
        }
    } else {
        // AC-111: getting it right repairs an open confusion about the same ideas.
        let _ = state.learner.update(|pr| ideas.iter().for_each(|idea| {
            crate::learner::mark_fixed(pr, idea, &source);
        }));
    }
    p.attempts.push(Attempt {
        answer: answer.to_string(),
        confidence,
        thinking: thinking.trim().to_string(),
        hints_used: p.hints_used(),
        verdict,
        feedback,
        at: Utc::now(),
    });
    state.practice.save(&mut set)?;
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn targets() -> Vec<Target> {
        vec![Target { id: "a".into(), text: "La derivada es la pendiente".into() }, Target { id: "b".into(), text: "Un límite".into() }]
    }

    #[test]
    fn validate_keeps_only_valid_problems() {
        let raw = json!({ "problems": [
            { "statement": "  Uno  ", "targets": ["a", "zzz"], "hints": ["h1", " ", "h2", "h3", "h4"], "solution": "6" },
            { "statement": "", "targets": ["a"], "hints": [], "solution": "" },
            { "statement": "Sin idea elegida", "targets": ["zzz"], "hints": [], "solution": "" },
            { "statement": "Uno", "targets": ["b"], "hints": [], "solution": "" },
            { "statement": "Dos", "targets": ["b"], "hints": [], "solution": "x" }
        ]})
        .to_string();
        let ps = validate_problems(&raw, &targets(), 5).unwrap();
        assert_eq!(ps.iter().map(|p| p.statement.as_str()).collect::<Vec<_>>(), ["Uno", "Dos"]);
        assert_eq!(ps[0].targets, ["a"]);
        assert_eq!(ps[0].hints, ["h1", "h2", "h3"]);
        assert_eq!((ps[0].id.as_str(), ps[1].id.as_str()), ("q1", "q2"));
    }

    #[test]
    fn validate_caps_and_rejects() {
        let many = json!({ "problems": (0..20).map(|i| json!({ "statement": format!("p{i}"), "targets": ["a"], "hints": [], "solution": "" })).collect::<Vec<_>>() }).to_string();
        assert_eq!(validate_problems(&many, &targets(), 3).unwrap().len(), 3);
        assert_eq!(validate_problems(&many, &targets(), 50).unwrap().len(), MAX_PROBLEMS);
        assert!(validate_problems(r#"{"problems":[]}"#, &targets(), 3).is_err());
        assert!(validate_problems("{roto", &targets(), 3).is_err());
    }

    #[test]
    fn grade_input_carries_problem_ideas_solution_hints_and_answer() {
        let set = PracticeSet {
            id: "s".into(),
            title: "t".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            targets: targets(),
            problems: vec![],
            planned: None, own: false,
        };
        let mut p = Problem { id: "q1".into(), statement: "¿Pendiente de x² en 3?".into(), targets: vec!["a".into()], hints: vec!["h".into(), "h2".into()], solution: "6".into(), hints_shown: 1, level: 0, nudges: vec![], solution_by_model: false, attempts: vec![] };
        let s = grade_input(&set, &p, "6", Some(4), "derivé");
        for part in ["¿Pendiente de x² en 3?", "La derivada es la pendiente", "Solución de referencia\n6", "Pistas usadas: 1 de 2", "Respuesta del aprendiz: 6", "Confianza: 4/5", "Su razonamiento: derivé"] {
            assert!(s.contains(part), "missing {part:?} in {s}");
        }
        assert!(!s.contains("Un límite"), "only this problem's ideas");
        assert!(!grade_input(&set, &p, "6", None, " ").contains("Confianza"));
        // AC-168: the grader counts the nudges as hints too.
        p.nudges.push("mirá qué pasa cerca del 3".into());
        assert!(grade_input(&set, &p, "6", None, "").contains("Pistas usadas: 2 de 3"));
        assert_eq!(p.hints_used(), 2);
    }

    #[test]
    fn a_nudge_starts_from_where_the_reasoning_is() {
        let set = PracticeSet { id: "s".into(), title: "t".into(), created_at: Utc::now(), updated_at: Utc::now(), targets: targets(), problems: vec![], planned: None, own: false };
        let mut p = Problem { id: "q1".into(), statement: "¿Pendiente de x² en 3?".into(), targets: vec!["a".into()], hints: vec!["sutil".into(), "directa".into()], solution: "6".into(), hints_shown: 1, level: 0, nudges: vec!["antes".into()], solution_by_model: false, attempts: vec![] };
        let s = hint_input(&set, &p, "  derivé y me dio 2x, ¿y ahora?  ");
        for part in ["¿Pendiente de x² en 3?", "La derivada es la pendiente", "Solución de referencia\n6", "Pistas que ya vio\n- sutil\n- antes", "Lo que viene pensando\nderivé y me dio 2x, ¿y ahora?"] {
            assert!(s.contains(part), "missing {part:?} in {s}");
        }
        assert!(!s.contains("directa"), "a fixed hint not shown yet stays hidden");
        p.hints_shown = 0;
        p.nudges.clear();
        assert!(!hint_input(&set, &p, "x").contains("Pistas que ya vio"));
        assert_eq!(parse_hint(r#"{"hint":" mirá el 3 ","solved":false}"#).unwrap(), ("mirá el 3".into(), false));
        assert_eq!(parse_hint(r#"{"hint":"ya está, mandalo"}"#).unwrap().1, false, "solved defaults to false");
        assert!(parse_hint(r#"{"hint":"  ","solved":true}"#).is_err());
    }

    #[test]
    fn parse_grade_validates() {
        assert_eq!(parse_grade(r#"{"verdict":"partial","feedback":" casi "}"#).unwrap(), (Verdict::Partial, "casi".into()));
        assert!(parse_grade(r#"{"verdict":"meh","feedback":"x"}"#).is_err());
        assert!(parse_grade(r#"{"verdict":"correct","feedback":"  "}"#).is_err());
    }

    #[test]
    fn titles_and_summary() {
        assert_eq!(title_for(&targets()), "La derivada es la pendiente (+1)");
        assert_eq!(title_for(&targets()[..1]), "La derivada es la pendiente");
        let attempt = |v| Attempt { answer: "x".into(), confidence: None, thinking: String::new(), hints_used: 0, verdict: v, feedback: "f".into(), at: Utc::now() };
        let problem = |id: &str, attempts: Vec<Attempt>| Problem { id: id.into(), statement: id.into(), targets: vec!["a".into()], hints: vec![], solution: String::new(), hints_shown: 0, level: 0, nudges: vec![], solution_by_model: false, attempts };
        let set = PracticeSet {
            id: "s".into(),
            title: "t".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            targets: targets(),
            problems: vec![problem("1", vec![attempt(Verdict::Incorrect), attempt(Verdict::Correct)]), problem("2", vec![attempt(Verdict::Partial)]), problem("3", vec![])],
            planned: None, own: false,
        };
        let s = set.summary();
        assert_eq!((s.total, s.done, s.correct), (3, 2, 1));
    }

    #[test]
    fn the_next_problem_follows_how_the_last_one_went() {
        // AC-167
        let attempt = |v, hints, conf| Attempt { answer: "x".into(), confidence: conf, thinking: "probé con 3".into(), hints_used: hints, verdict: v, feedback: "f".into(), at: Utc::now() };
        let problem = |id: &str, ts: &[&str], level, attempts: Vec<Attempt>| Problem { id: id.into(), statement: format!("enunciado {id}"), targets: ts.iter().map(|t| t.to_string()).collect(), hints: vec![], solution: String::new(), hints_shown: 0, level, nudges: vec![], solution_by_model: false, attempts };
        let set = |problems| PracticeSet { id: "s".into(), title: "t".into(), created_at: Utc::now(), updated_at: Utc::now(), targets: targets(), problems, planned: Some(5), own: false };

        assert_eq!(next_level(&set(vec![])), 1, "it starts easy");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 1, vec![attempt(Verdict::Correct, 0, Some(4))])])), 2, "right, sure and alone → up");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 2, vec![attempt(Verdict::Correct, 2, Some(4))])])), 1, "right but with two hints → down");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 3, vec![attempt(Verdict::Partial, 1, Some(3))])])), 3, "partial → same");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 3, vec![attempt(Verdict::Incorrect, 0, Some(5))])])), 2, "wrong → down");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 4, vec![attempt(Verdict::Correct, 0, None)])])), 4, "capped");
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 1, vec![attempt(Verdict::Incorrect, 0, None)])])), 1, "floored");
        // A skipped last problem: the last one answered decides.
        assert_eq!(next_level(&set(vec![problem("q1", &["a"], 1, vec![attempt(Verdict::Correct, 0, Some(5))]), problem("q2", &["b"], 2, vec![])])), 2);
        let mut one = set(vec![problem("q1", &["a"], 2, vec![attempt(Verdict::Correct, 0, Some(5))])]);
        one.targets.truncate(1);
        assert_eq!(next_level(&one), 2, "with one idea there is nothing to combine");

        // What went wrong comes first, then what was practiced least.
        let s = set(vec![problem("q1", &["a"], 1, vec![attempt(Verdict::Correct, 0, Some(4))]), problem("q2", &["b"], 2, vec![attempt(Verdict::Incorrect, 1, Some(2))])]);
        assert_eq!(focus(&s).iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        let s2 = set(vec![problem("q1", &["a"], 1, vec![attempt(Verdict::Correct, 0, Some(4))])]);
        assert_eq!(focus(&s2)[0].id, "b", "the idea not practiced yet");

        let input = next_input(&s);
        for part in ["Generá 1 problemas", "Cómo le fue hasta ahora", "- Nivel 1 (La derivada es la pendiente): «enunciado q1» → Correct, 0 pistas, confianza 4/5. Pensó: «probé con 3»", "Incorrect, 1 pistas", "Nivel 1: una sola idea, en un contexto conocido.", "Apoyate en: Un límite (b)."] {
            assert!(input.contains(part), "missing {part:?} in {input}");
        }
        assert!(!next_input(&set(vec![])).contains("Cómo le fue"));
        assert_eq!(set(vec![]).total(), 5, "the planned count, before they exist");
        assert_eq!(PracticeSet { planned: None, ..set(vec![problem("q1", &["a"], 0, vec![])]) }.total(), 1, "an old set is what it has");
    }

    #[test]
    fn own_problems_are_cleaned_before_anyone_sees_them() {
        // AC-173
        let raw = json!({ "problems": [
            { "statement": "  1) Un auto parte del reposo con $a = 2$ m/s². ¿Qué velocidad tiene a los 3 s?  ", "solution": "6 m/s", "given": true, "hints": ["h1", " ", "h2", "h3", "h4"], "ideas": ["a", "zzz"] },
            { "statement": "", "solution": "x", "given": false, "hints": [] },
            { "statement": "Sin solución", "solution": "  ", "given": false, "hints": [] },
            { "statement": "1) Un auto parte del reposo con $a = 2$ m/s². ¿Qué velocidad tiene a los 3 s?", "solution": "6", "given": false, "hints": [] },
            { "statement": "2) ¿Y la distancia?", "solution": "9 m", "hints": [] }
        ]})
        .to_string();
        let ps = validate_own(&raw, &targets()).unwrap();
        assert_eq!(ps.len(), 2, "empty, unsolved and repeated ones go");
        assert_eq!((ps[0].given, ps[0].hints.len(), ps[0].ideas.clone()), (true, 3, vec!["a".to_string()]));
        assert!(!ps[1].given, "given defaults to false: Eureka wrote it");
        assert!(validate_own(r#"{"problems":[]}"#, &targets()).is_err());
        let many: Vec<OwnProblem> = (0..30).map(|i| OwnProblem { statement: format!("p{i}"), solution: "s".into(), given: false, hints: vec![], ideas: vec![] }).collect();
        assert_eq!(clean_own(many, &HashSet::new()).len(), MAX_OWN);
        let input = own_input("  1) uno  ", &targets());
        assert!(input.starts_with("## Lo que trajo el aprendiz\n1) uno") && input.contains("- a: La derivada es la pendiente"));
        assert!(!own_input("x", &[]).contains("Ideas de su grafo"));
    }

    #[test]
    fn the_grader_knows_when_eureka_wrote_the_solution() {
        let set = PracticeSet { id: "s".into(), title: "t".into(), created_at: Utc::now(), updated_at: Utc::now(), targets: vec![], problems: vec![], planned: None, own: true };
        let mut p = Problem { id: "q1".into(), statement: "¿2+2?".into(), targets: vec![], hints: vec![], solution: "4".into(), hints_shown: 0, level: 0, nudges: vec![], solution_by_model: true, attempts: vec![] };
        assert!(grade_input(&set, &p, "4", None, "").contains("la escribió un modelo"));
        p.solution_by_model = false;
        assert!(!grade_input(&set, &p, "4", None, "").contains("la escribió un modelo"));
    }

    #[test]
    fn store_roundtrip_list_and_delete() {
        let dir = std::env::temp_dir().join(format!("la-practice-{}", uuid::Uuid::new_v4().simple()));
        let st = PracticeStore::new(&dir);
        assert!(st.list().is_empty());
        let mut set = PracticeSet { id: "abc".into(), title: "t".into(), created_at: Utc::now(), updated_at: Utc::now(), targets: targets(), problems: vec![], planned: None, own: false };
        st.save(&mut set).unwrap();
        assert_eq!(st.load("abc").unwrap().title, "t");
        assert_eq!(st.list().len(), 1);
        assert!(st.path("../x").starts_with(dir.join("practice")));
        st.delete("abc").unwrap();
        assert!(st.list().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }
}
