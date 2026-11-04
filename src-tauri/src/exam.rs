//! Exam prep (Phase 5): an official exam guide becomes a syllabus (weighted
//! domains → topics → objectives). Each topic is studied in a normal session
//! linked to the exam, and multiple-choice mock exams, spread over domains by
//! weight, are graded here without any model call.

use crate::agent::{endpoint_for, Role};
use crate::llm::{self, Msg};
use crate::practice::{forced, forced_valid};
use crate::research::{self, Hit, SourceRef};
use crate::session::{ExamLink, Session};
use crate::AppState;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const SYLLABUS_TOOL: &str = "set_syllabus";
pub const QUESTIONS_TOOL: &str = "set_exam_questions";
pub const GUIDE_TOOL: &str = "submit_exam_guide";
pub const SHEET_TOOL: &str = "submit_cheat_sheet";
pub const CHECK_TOOL: &str = "check_answers";
pub const MAX_EXPLAIN_TURNS: usize = 12;
/// Per search result, what the guide finder reads of the page.
pub const MAX_SOURCE_CHARS: usize = 8000;
pub const MAX_DOMAINS: usize = 12;
pub const MAX_TOPICS: usize = 20;
pub const MAX_OBJECTIVES: usize = 12;
pub const MAX_QUESTIONS: usize = 40;
pub const MAX_MINUTES: u32 = 600;
/// A failed question leaves the review list after this many right answers in a row.
pub const REVIEW_STREAK: u8 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Topic {
    pub id: String,
    pub title: String,
    pub objectives: Vec<String>,
    /// The study session of this topic, once started.
    #[serde(default)]
    pub session_id: Option<String>,
    /// AC-61: console exercises of this topic that passed their tests.
    #[serde(default)]
    pub exercises_passed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Domain {
    pub id: String,
    pub name: String,
    /// Share of the exam, in percent; all domains add up to 100.
    pub weight: f64,
    pub topics: Vec<Topic>,
}

/// Option indices, sorted and without repeats.
pub fn norm(mut v: Vec<usize>) -> Vec<usize> {
    v.sort_unstable();
    v.dedup();
    v
}

/// One choice as JSON: `null` (blank), a number (single answer, also the
/// pre-multi-select format) or an array of numbers.
#[derive(Deserialize)]
#[serde(untagged)]
enum RawChoice {
    One(usize),
    Many(Vec<usize>),
    Blank(()),
}

impl From<RawChoice> for Vec<usize> {
    fn from(c: RawChoice) -> Self {
        match c {
            RawChoice::One(n) => vec![n],
            RawChoice::Many(v) => norm(v),
            RawChoice::Blank(()) => vec![],
        }
    }
}

fn de_choice<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<usize>, D::Error> {
    Ok(RawChoice::deserialize(d)?.into())
}

fn de_choices<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<Vec<usize>>, D::Error> {
    Ok(Vec::<RawChoice>::deserialize(d)?.into_iter().map(Into::into).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Question {
    pub id: String,
    pub domain_id: String,
    #[serde(default)]
    pub topic_id: Option<String>,
    pub stem: String,
    pub options: Vec<String>,
    /// Indices of the correct options: one, or several for "Elegí N" (AC-41).
    #[serde(deserialize_with = "de_choice")]
    pub answer: Vec<usize>,
    pub explanation: String,
    /// AC-46: the learner reported it as wrong (their reason); it no longer counts.
    #[serde(default)]
    pub reported: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DomainScore {
    pub domain_id: String,
    pub correct: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MockResult {
    /// The learner's choices per question (empty = left blank).
    #[serde(deserialize_with = "de_choices")]
    pub answers: Vec<Vec<usize>>,
    pub correct: usize,
    pub total: usize,
    pub by_domain: Vec<DomainScore>,
    pub at: DateTime<Utc>,
    /// From the questions being shown to the submission.
    #[serde(default)]
    pub elapsed_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mock {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub questions: Vec<Question>,
    #[serde(default)]
    pub result: Option<MockResult>,
    /// AC-39: timed like the real exam; the clock starts at `created_at`.
    #[serde(default)]
    pub time_limit_secs: Option<u64>,
    /// AC-43: what a targeted mock covers ("Seguridad, Cómputo"); None = the whole exam by weight.
    #[serde(default)]
    pub focus: Option<String>,
    /// AC-46: questions a second model disagreed with and were dropped
    /// (None = the check could not run).
    #[serde(default)]
    pub dropped: Option<usize>,
}

/// AC-43: limits a mock to some domains and/or topics (both empty = all).
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct MockFocus {
    #[serde(default)]
    pub domain_ids: Vec<String>,
    #[serde(default)]
    pub topic_ids: Vec<String>,
}

/// AC-44: the one-page summary to read before the exam.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CheatSheet {
    pub markdown: String,
    pub at: DateTime<Utc>,
}

/// AC-40: a question failed in a mock exam, waiting to be reviewed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewItem {
    pub id: String,
    pub question: Question,
    pub mock_id: String,
    /// Right answers in a row while reviewing.
    pub streak: u8,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exam {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub domains: Vec<Domain>,
    #[serde(default)]
    pub mocks: Vec<Mock>,
    #[serde(default)]
    pub review: Vec<ReviewItem>,
    /// AC-42: the learner's goal for this exam.
    #[serde(default)]
    pub goal: ExamGoal,
    #[serde(default)]
    pub cheat_sheet: Option<CheatSheet>,
    /// AC-50: a certification/exam, or a course subject (its program as the syllabus).
    #[serde(default)]
    pub kind: ExamKind,
    /// AC-51: weekly classes and study blocks.
    #[serde(default)]
    pub schedule: Vec<Slot>,
    /// AC-61: the language of a programming path.
    #[serde(default)]
    pub lang: Option<crate::runner::Lang>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExamKind {
    #[default]
    Certification,
    Subject,
    /// AC-61: a programming language learning path.
    Language,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    Class,
    Study,
}

/// A weekly time slot (AC-51). `weekday`: 1 = Monday … 7 = Sunday.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Slot {
    pub weekday: u8,
    /// "HH:MM", local time.
    pub start: String,
    pub end: String,
    pub kind: SlotKind,
    #[serde(default)]
    pub place: String,
}

pub const MAX_SLOTS: usize = 40;

fn minutes_of(hhmm: &str) -> Option<u32> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60 && hhmm.trim().len() == 5).then_some(h * 60 + m)
}

/// Valid days and times, end after start, sorted by day and time.
pub fn validate_schedule(mut slots: Vec<Slot>) -> Result<Vec<Slot>> {
    if slots.len() > MAX_SLOTS {
        return Err(anyhow!("Como mucho {MAX_SLOTS} horarios por materia."));
    }
    for s in &mut slots {
        if !(1..=7).contains(&s.weekday) {
            return Err(anyhow!("Día inválido."));
        }
        let (a, b) = (minutes_of(&s.start), minutes_of(&s.end));
        match (a, b) {
            (Some(a), Some(b)) if b > a => {}
            (Some(_), Some(_)) => return Err(anyhow!("La hora de fin tiene que ser después de la de inicio.")),
            _ => return Err(anyhow!("Hora inválida: usá el formato HH:MM.")),
        }
        s.start = s.start.trim().to_string();
        s.end = s.end.trim().to_string();
        s.place = s.place.trim().chars().take(80).collect();
    }
    slots.sort_by(|x, y| (x.weekday, &x.start).cmp(&(y.weekday, &y.start)));
    Ok(slots)
}

/// AC-42: passing mark (percent, an approximation of scaled scores), exam
/// date and weekly study hours (the study plan uses the last two).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ExamGoal {
    #[serde(default)]
    pub passing_pct: Option<f64>,
    /// Local calendar date, YYYY-MM-DD.
    #[serde(default)]
    pub exam_date: Option<String>,
    #[serde(default)]
    pub hours_per_week: Option<f64>,
}

/// NF-15-style checks on the goal before saving it.
pub fn validate_goal(g: ExamGoal) -> Result<ExamGoal> {
    if let Some(p) = g.passing_pct {
        if !(1.0..=100.0).contains(&p) {
            return Err(anyhow!("La nota para aprobar tiene que estar entre 1 y 100 %."));
        }
    }
    let exam_date = match g.exam_date.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        None => None,
        Some(d) => Some(chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| anyhow!("La fecha del examen no es válida."))?.to_string()),
    };
    if let Some(h) = g.hours_per_week {
        if !(0.5..=80.0).contains(&h) {
            return Err(anyhow!("Las horas por semana tienen que estar entre 0,5 y 80."));
        }
    }
    Ok(ExamGoal { passing_pct: g.passing_pct.map(|p| (p * 10.0).round() / 10.0), exam_date, hours_per_week: g.hours_per_week })
}

#[derive(Debug, Serialize)]
pub struct ExamSummary {
    pub id: String,
    pub name: String,
    pub updated_at: DateTime<Utc>,
    pub domains: usize,
    pub topics: usize,
    pub started: usize,
    /// Percent correct of the latest graded mock exam.
    pub last_score: Option<f64>,
    pub to_review: usize,
    pub kind: ExamKind,
    pub exam_date: Option<String>,
    pub schedule: Vec<Slot>,
}

impl Exam {
    pub fn summary(&self) -> ExamSummary {
        let topics = self.domains.iter().flat_map(|d| &d.topics);
        ExamSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            updated_at: self.updated_at,
            domains: self.domains.len(),
            topics: topics.clone().count(),
            started: topics.filter(|t| t.session_id.is_some()).count(),
            // Targeted mocks don't measure the whole exam.
            last_score: self.mocks.iter().rev().filter(|m| m.focus.is_none()).find_map(|m| m.result.as_ref()).map(|r| percent(r.correct, r.total)),
            to_review: self.review.len(),
            kind: self.kind,
            exam_date: self.goal.exam_date.clone(),
            schedule: self.schedule.clone(),
        }
    }

    fn topic(&self, topic_id: &str) -> Option<(&Domain, &Topic)> {
        self.domains.iter().find_map(|d| d.topics.iter().find(|t| t.id == topic_id).map(|t| (d, t)))
    }
}

fn percent(n: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        (1000.0 * n as f64 / total as f64).round() / 10.0
    }
}

// ── Pure: syllabus ─────────────────────────────────────────────────────────

pub fn syllabus_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": SYLLABUS_TOOL,
        "description": "Guarda el temario del examen.",
        "parameters": { "type": "object", "properties": { "domains": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "weight": { "type": "number", "description": "porcentaje del examen, si la guía lo indica" },
                "topics": { "type": "array", "items": { "type": "object", "properties": {
                    "title": { "type": "string" },
                    "objectives": { "type": "array", "items": { "type": "string" } }
                }, "required": ["title", "objectives"] } }
            },
            "required": ["name", "topics"]
        }}}, "required": ["domains"] }
    }})
}

#[derive(Deserialize)]
struct RawSyllabus {
    domains: Vec<RawDomain>,
}

#[derive(Deserialize)]
struct RawDomain {
    name: String,
    #[serde(default)]
    weight: Option<f64>,
    #[serde(default)]
    topics: Vec<RawTopic>,
}

#[derive(Deserialize)]
struct RawTopic {
    title: String,
    #[serde(default)]
    objectives: Vec<String>,
}

/// Rescales weights to add up to 100 (one decimal). If any weight is missing
/// or not positive, the guide gave none we can trust: split evenly.
pub fn normalize_weights(raw: &[Option<f64>]) -> Vec<f64> {
    let valid = raw.iter().all(|w| w.is_some_and(|w| w.is_finite() && w > 0.0));
    let ws: Vec<f64> = if valid { raw.iter().map(|w| w.unwrap()).collect() } else { vec![1.0; raw.len()] };
    let sum: f64 = ws.iter().sum();
    ws.iter().map(|w| (1000.0 * w / sum).round() / 10.0).collect()
}

/// NF-15: keeps named domains with at least one named topic, capped.
pub fn validate_syllabus(raw: &str) -> Result<Vec<Domain>> {
    let parsed: RawSyllabus = serde_json::from_str(raw).context("el lector de la guía devolvió datos inválidos")?;
    let mut seen = HashSet::new();
    let kept: Vec<(String, Option<f64>, Vec<(String, Vec<String>)>)> = parsed
        .domains
        .into_iter()
        .filter_map(|d| {
            let name = d.name.trim().to_string();
            let mut titles = HashSet::new();
            let topics: Vec<(String, Vec<String>)> = d
                .topics
                .into_iter()
                .filter_map(|t| {
                    let title = t.title.trim().to_string();
                    if title.is_empty() || !titles.insert(title.to_lowercase()) {
                        return None;
                    }
                    let objectives = t.objectives.into_iter().map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).take(MAX_OBJECTIVES).collect();
                    Some((title, objectives))
                })
                .take(MAX_TOPICS)
                .collect();
            (!name.is_empty() && !topics.is_empty() && seen.insert(name.to_lowercase())).then_some((name, d.weight, topics))
        })
        .take(MAX_DOMAINS)
        .collect();
    if kept.is_empty() {
        return Err(anyhow!("No se encontraron dominios con temas en la guía. Pegá el temario oficial del examen."));
    }
    let weights = normalize_weights(&kept.iter().map(|(_, w, _)| *w).collect::<Vec<_>>());
    Ok(kept
        .into_iter()
        .zip(weights)
        .enumerate()
        .map(|(i, ((name, _, topics), weight))| Domain {
            id: format!("d{}", i + 1),
            name,
            weight,
            topics: topics
                .into_iter()
                .enumerate()
                .map(|(j, (title, objectives))| Topic { id: format!("d{}t{}", i + 1, j + 1), title, objectives, session_id: None, exercises_passed: 0 })
                .collect(),
        })
        .collect())
}

// ── Pure: mock exams ───────────────────────────────────────────────────────

/// Splits `count` questions over the weights (largest remainder), so the
/// mock exam mirrors the real one.
pub fn allocate(count: usize, weights: &[f64]) -> Vec<usize> {
    let sum: f64 = weights.iter().sum();
    if weights.is_empty() || sum <= 0.0 {
        return vec![0; weights.len()];
    }
    let exact: Vec<f64> = weights.iter().map(|w| count as f64 * w / sum).collect();
    let mut out: Vec<usize> = exact.iter().map(|x| x.floor() as usize).collect();
    let mut order: Vec<usize> = (0..weights.len()).collect();
    // Ties go to the heavier (then earlier) domain.
    order.sort_by(|&a, &b| (exact[b] - exact[b].floor()).total_cmp(&(exact[a] - exact[a].floor())).then(weights[b].total_cmp(&weights[a])).then(a.cmp(&b)));
    let missing = count - out.iter().sum::<usize>();
    for &i in order.iter().take(missing) {
        out[i] += 1;
    }
    out
}

pub fn questions_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": QUESTIONS_TOOL,
        "description": "Guarda las preguntas del simulacro.",
        "parameters": { "type": "object", "properties": { "questions": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "domain_id": { "type": "string" },
                "topic_id": { "type": "string" },
                "stem": { "type": "string", "description": "Enunciado (escenario) en Markdown" },
                "options": { "type": "array", "items": { "type": "string" } },
                "answer": { "type": "array", "items": { "type": "integer" }, "description": "índices de las opciones correctas, desde 0: una sola, o 2 o 3 en las de respuesta múltiple" },
                "explanation": { "type": "string" }
            },
            "required": ["domain_id", "stem", "options", "answer", "explanation"]
        }}}, "required": ["questions"] }
    }})
}

/// AC-43: the exam narrowed to a focus, plus a label for it. Topics keep
/// their domain; a domain chosen whole keeps all its topics.
pub fn focused(exam: &Exam, focus: &MockFocus) -> Result<(Exam, Option<String>)> {
    if focus.domain_ids.is_empty() && focus.topic_ids.is_empty() {
        return Ok((exam.clone(), None));
    }
    let mut out = exam.clone();
    out.domains = exam
        .domains
        .iter()
        .filter_map(|d| {
            if focus.domain_ids.contains(&d.id) {
                return Some(d.clone());
            }
            let topics: Vec<Topic> = d.topics.iter().filter(|t| focus.topic_ids.contains(&t.id)).cloned().collect();
            (!topics.is_empty()).then(|| Domain { topics, ..d.clone() })
        })
        .collect();
    if out.domains.is_empty() {
        return Err(anyhow!("Elegí al menos un dominio o tema del examen."));
    }
    let label = out.domains.iter().map(|d| d.name.as_str()).collect::<Vec<_>>().join(", ");
    Ok((out, Some(label)))
}

pub fn questions_input(exam: &Exam, count: usize) -> String {
    let per = allocate(count, &exam.domains.iter().map(|d| d.weight).collect::<Vec<_>>());
    let mut s = format!("Generá {count} preguntas para un simulacro del examen **{}**.\n\n## Distribución por dominio\n", exam.name);
    for (d, n) in exam.domains.iter().zip(&per).filter(|(_, n)| **n > 0) {
        s.push_str(&format!("\n### {}: {} ({}% del examen) → {n} preguntas\n", d.id, d.name, d.weight));
        for t in &d.topics {
            s.push_str(&format!("- {}: {}", t.id, t.title));
            if !t.objectives.is_empty() {
                s.push_str(&format!(" — {}", t.objectives.join("; ")));
            }
            s.push('\n');
        }
    }
    s
}

#[derive(Deserialize)]
struct RawQuestions {
    questions: Vec<RawQuestion>,
}

#[derive(Deserialize)]
struct RawQuestion {
    domain_id: String,
    #[serde(default)]
    topic_id: Option<String>,
    stem: String,
    options: Vec<String>,
    #[serde(deserialize_with = "de_choice")]
    answer: Vec<usize>,
    #[serde(default)]
    explanation: String,
}

/// NF-15: keeps well-formed questions of existing domains, up to `count`.
pub fn validate_questions(raw: &str, exam: &Exam, count: usize) -> Result<Vec<Question>> {
    let parsed: RawQuestions = serde_json::from_str(raw).context("el autor del simulacro devolvió datos inválidos")?;
    let mut stems = HashSet::new();
    let questions: Vec<Question> = parsed
        .questions
        .into_iter()
        .filter_map(|q| {
            let domain = exam.domains.iter().find(|d| d.id == q.domain_id)?;
            let stem = q.stem.trim().to_string();
            let options: Vec<String> = q.options.iter().map(|o| o.trim().to_string()).collect();
            let distinct: HashSet<String> = options.iter().map(|o| o.to_lowercase()).collect();
            let valid = !stem.is_empty()
                && (2..=6).contains(&options.len())
                && options.iter().all(|o| !o.is_empty())
                && distinct.len() == options.len()
                && !q.answer.is_empty()
                && q.answer.len() < options.len()
                && q.answer.iter().all(|&a| a < options.len());
            if !valid || !stems.insert(stem.clone()) {
                return None;
            }
            let topic_id = q.topic_id.filter(|t| domain.topics.iter().any(|x| &x.id == t));
            Some((domain.id.clone(), topic_id, stem, options, q.answer, q.explanation.trim().to_string()))
        })
        .take(count.min(MAX_QUESTIONS))
        .enumerate()
        .map(|(i, (domain_id, topic_id, stem, options, answer, explanation))| Question { id: format!("m{}", i + 1), domain_id, topic_id, stem, options, answer, explanation, reported: None })
        .collect();
    if questions.is_empty() {
        return Err(anyhow!("el autor del simulacro no devolvió ninguna pregunta válida"));
    }
    Ok(questions)
}

/// AC-36: deterministic grading; blanks and out-of-range choices count as wrong.
/// AC-36/41: all or nothing, like the real exams: every correct option and no other.
pub fn is_right(q: &Question, choice: &[usize]) -> bool {
    norm(choice.to_vec()) == q.answer
}

/// Reported questions (AC-46) count for nothing: neither right nor in the total.
pub fn grade(exam: &Exam, questions: &[Question], answers: &[Vec<usize>]) -> MockResult {
    let answers: Vec<Vec<usize>> = (0..questions.len()).map(|i| norm(answers.get(i).cloned().unwrap_or_default())).collect();
    let counted: Vec<usize> = (0..questions.len()).filter(|&i| questions[i].reported.is_none()).collect();
    let right = |i: usize| is_right(&questions[i], &answers[i]);
    let by_domain = exam
        .domains
        .iter()
        .filter_map(|d| {
            let idx: Vec<usize> = counted.iter().copied().filter(|&i| questions[i].domain_id == d.id).collect();
            (!idx.is_empty()).then(|| DomainScore { domain_id: d.id.clone(), correct: idx.iter().filter(|&&i| right(i)).count(), total: idx.len() })
        })
        .collect();
    MockResult { correct: counted.iter().filter(|&&i| right(i)).count(), total: counted.len(), by_domain, answers, at: Utc::now(), elapsed_secs: 0 }
}

/// AC-39: minutes for a timed mock (None = untimed).
pub fn time_limit(minutes: Option<u32>) -> Result<Option<u64>> {
    match minutes {
        None => Ok(None),
        Some(m) if (1..=MAX_MINUTES).contains(&m) => Ok(Some(u64::from(m) * 60)),
        Some(_) => Err(anyhow!("El tiempo tiene que estar entre 1 y {MAX_MINUTES} minutos.")),
    }
}

/// AC-40: wrong or blank answers of a graded mock join the review list; one
/// already there (same statement) starts its streak over.
pub fn add_to_review(exam: &mut Exam, mock_index: usize) {
    let mock = &exam.mocks[mock_index];
    let Some(result) = &mock.result else { return };
    let failed: Vec<Question> =
        mock.questions.iter().enumerate().filter(|(i, q)| q.reported.is_none() && !is_right(q, result.answers.get(*i).map(Vec::as_slice).unwrap_or(&[]))).map(|(_, q)| q.clone()).collect();
    let mock_id = mock.id.clone();
    for q in failed {
        let key = q.stem.to_lowercase();
        if let Some(item) = exam.review.iter_mut().find(|r| r.question.stem.to_lowercase() == key) {
            item.streak = 0;
            continue;
        }
        exam.review.push(ReviewItem {
            id: uuid::Uuid::new_v4().simple().to_string(),
            question: q,
            mock_id: mock_id.clone(),
            streak: 0,
            added_at: Utc::now(),
        });
    }
}

/// AC-40: grades one review answer; returns whether it was right. Right
/// REVIEW_STREAK times in a row and the question leaves the list.
pub fn answer_review(exam: &mut Exam, review_id: &str, choice: &[usize]) -> Result<bool> {
    let i = exam.review.iter().position(|r| r.id == review_id).ok_or_else(|| anyhow!("pregunta de repaso no encontrada"))?;
    let item = &mut exam.review[i];
    let right = is_right(&item.question, choice);
    item.streak = if right { item.streak + 1 } else { 0 };
    if item.streak >= REVIEW_STREAK {
        exam.review.remove(i);
    }
    Ok(right)
}

/// What the study session of a topic carries about the exam (AC-34).
pub fn study_link(exam: &Exam, topic_id: &str) -> Option<ExamLink> {
    let (d, t) = exam.topic(topic_id)?;
    Some(ExamLink {
        exam_id: exam.id.clone(),
        exam_name: exam.name.clone(),
        domain: d.name.clone(),
        weight: d.weight,
        topic_id: t.id.clone(),
        objectives: t.objectives.clone(),
        lang: exam.lang.map(|l| format!("{l:?}").to_lowercase()),
    })
}

// ── Pure: finding the official guide on the web ───────────────────────────

/// The guide found on the web, for the learner to review before building the path.
#[derive(Debug, Serialize, PartialEq)]
pub struct FoundGuide {
    pub guide: String,
    pub sources: Vec<SourceRef>,
}

pub fn guide_query(name: &str) -> String {
    format!("{name} official exam guide domains weighting objectives")
}

pub fn guide_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": GUIDE_TOOL,
        "description": "Entrega el temario oficial del examen, compilado de las fuentes.",
        "parameters": { "type": "object", "properties": {
            "guide": { "type": "string", "description": "Temario en texto: 'Dominio N: nombre (peso%)', temas con '- ' y objetivos con '  - '. Vacío si las fuentes no lo traen." },
            "used": { "type": "array", "items": { "type": "integer" }, "description": "números de las fuentes usadas" }
        }, "required": ["guide", "used"] }
    }})
}

pub fn guide_input(name: &str, hits: &[Hit]) -> String {
    let mut s = format!("Examen: {name}\n\n## Resultados de búsqueda\n");
    for (i, h) in hits.iter().enumerate() {
        let text = h.raw_content.as_deref().filter(|r| !r.trim().is_empty()).unwrap_or(&h.content);
        let excerpt: String = text.chars().take(MAX_SOURCE_CHARS).collect();
        s.push_str(&format!("\n[{}] {} — {}\n{}\n", i + 1, h.title, h.url, excerpt.trim()));
    }
    s
}

#[derive(Deserialize)]
struct RawGuide {
    guide: String,
    #[serde(default)]
    used: Vec<usize>,
}

pub fn parse_guide(raw: &str, hits: &[Hit]) -> Result<FoundGuide> {
    let g: RawGuide = serde_json::from_str(raw).context("el buscador de guías devolvió datos inválidos")?;
    let guide = g.guide.trim().to_string();
    if guide.is_empty() {
        return Err(anyhow!("No encontré la guía oficial de ese examen en la web. Probá con el nombre o el código exacto (por ejemplo CLF-C02), o pegala a mano."));
    }
    Ok(FoundGuide { guide, sources: research::pick_sources(hits, &g.used) })
}

// ── Store ──────────────────────────────────────────────────────────────────

pub struct ExamStore {
    dir: PathBuf,
}

impl ExamStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("exams") }
    }

    fn path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<Exam> {
        Ok(serde_json::from_str(&std::fs::read_to_string(self.path(id)).context("examen no encontrado")?)?)
    }

    pub fn save(&self, e: &mut Exam) -> Result<()> {
        e.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&e.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(e)?)?;
        std::fs::rename(tmp, self.path(&e.id))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    /// Every exam, whole (for the student model).
    pub fn all(&self) -> Vec<Exam> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Exam>(&raw).ok())
            .collect()
    }

    pub fn list(&self) -> Vec<ExamSummary> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<ExamSummary> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Exam>(&raw).ok())
            .map(|e| e.summary())
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }
}

// ── Commands' logic ────────────────────────────────────────────────────────

pub async fn create(state: &AppState, name: &str, guide: &str, kind: ExamKind) -> Result<Exam> {
    let (name, guide) = (name.trim(), guide.trim());
    if name.is_empty() || guide.is_empty() {
        return Err(anyhow!("Poné el nombre del examen y pegá su guía oficial."));
    }
    let header = match kind {
        ExamKind::Certification => "Guía oficial del examen",
        ExamKind::Subject => "Programa de la materia (sus unidades son los dominios)",
        ExamKind::Language => "Programa del curso de programación (sus módulos son los dominios)",
    };
    let input = crate::extract::truncate(format!("# {header}: {name}\n\n{guide}"));
    let domains = forced_valid(state, Role::Extractor, "exam_syllabus", syllabus_tool(), SYLLABUS_TOOL, input, validate_syllabus).await?;
    let now = Utc::now();
    let mut exam = Exam { id: uuid::Uuid::new_v4().simple().to_string(), name: name.to_string(), created_at: now, updated_at: now, domains, mocks: vec![], review: vec![], goal: ExamGoal::default(), cheat_sheet: None, kind, schedule: vec![], lang: None };
    state.exams.save(&mut exam)?;
    Ok(exam)
}

/// AC-38: searches the web for the official guide and compiles its syllabus.
pub async fn find_guide(state: &AppState, name: &str) -> Result<FoundGuide> {
    let name = name.trim();
    if name.is_empty() {
        return Err(anyhow!("Escribí el nombre del examen."));
    }
    let settings = state.settings.load();
    let key = state
        .settings
        .keys()
        .get(crate::settings::SEARCH_KEY)
        .filter(|k| !k.is_empty())
        .cloned()
        .ok_or_else(|| anyhow!("La búsqueda web no está configurada (Ajustes → Búsqueda web)."))?;
    let hits = research::search(&settings.search.base_url, &key, &guide_query(name), true).await?;
    if hits.is_empty() {
        return Err(anyhow!("La búsqueda no encontró resultados para ese examen."));
    }
    forced_valid(state, Role::Researcher, "exam_guide", guide_tool(), GUIDE_TOOL, guide_input(name, &hits), |raw| parse_guide(raw, &hits)).await
}

// ── Programming paths (AC-61) ─────────────────────────────────────────────

pub fn language_path_input(lang: crate::runner::Lang, level: &str, goal: &str) -> String {
    let goal = if goal.trim().is_empty() { "aprender el lenguaje a fondo" } else { goal.trim() };
    format!("Lenguaje: {}\nNivel de partida: {}\nPara qué lo quiere: {goal}\n", lang.label(), level.trim())
}

pub async fn create_language_path(state: &AppState, lang: crate::runner::Lang, level: &str, goal: &str) -> Result<Exam> {
    let domains = forced_valid(state, Role::Extractor, "lang_path", syllabus_tool(), SYLLABUS_TOOL, language_path_input(lang, level, goal), validate_syllabus).await?;
    let now = Utc::now();
    let name = format!("Ruta de {}", lang.label());
    let mut exam = Exam { id: uuid::Uuid::new_v4().simple().to_string(), name, created_at: now, updated_at: now, domains, mocks: vec![], review: vec![], goal: ExamGoal::default(), cheat_sheet: None, kind: ExamKind::Language, schedule: vec![], lang: Some(lang) };
    state.exams.save(&mut exam)?;
    Ok(exam)
}

pub fn record_exercise(state: &AppState, exam_id: &str, topic_id: &str) -> Result<Exam> {
    let mut exam = state.exams.load(exam_id)?;
    let t = exam.domains.iter_mut().flat_map(|d| d.topics.iter_mut()).find(|t| t.id == topic_id).ok_or_else(|| anyhow!("tema no encontrado"))?;
    t.exercises_passed += 1;
    state.exams.save(&mut exam)?;
    Ok(exam)
}

/// AC-34: opens (or resumes) the study session of a topic.
pub fn study(state: &AppState, exam_id: &str, topic_id: &str) -> Result<Session> {
    let mut exam = state.exams.load(exam_id)?;
    let link = study_link(&exam, topic_id).ok_or_else(|| anyhow!("tema no encontrado"))?;
    let (_, topic) = exam.topic(topic_id).unwrap();
    if let Some(s) = topic.session_id.as_deref().and_then(|id| state.sessions.load(id).ok()) {
        return Ok(s);
    }
    let mut s = Session::new(&topic.title);
    s.exam = Some(link);
    state.sessions.save(&mut s)?;
    for t in exam.domains.iter_mut().flat_map(|d| d.topics.iter_mut()).filter(|t| t.id == topic_id) {
        t.session_id = Some(s.id.clone());
    }
    state.exams.save(&mut exam)?;
    Ok(s)
}

pub async fn create_mock(state: &AppState, exam_id: &str, count: usize, minutes: Option<u32>, focus: &MockFocus) -> Result<Exam> {
    let time_limit_secs = time_limit(minutes)?;
    let (scope, focus) = focused(&state.exams.load(exam_id)?, focus)?;
    let count = count.clamp(1, MAX_QUESTIONS);
    // Validated against the narrowed exam: questions outside the focus are dropped.
    let questions = forced_valid(state, Role::Practice, "exam_questions", questions_tool(), QUESTIONS_TOOL, questions_input(&scope, count), |raw| validate_questions(raw, &scope, count)).await?;
    // AC-46: a second model answers them blind; disputed keys are dropped.
    let check = forced(state, Role::Teacher, "exam_check", check_tool(), CHECK_TOOL, check_input(&scope.name, &questions)).await;
    let (questions, dropped) = match check.and_then(|raw| apply_check(questions.clone(), &raw)) {
        Ok((kept, dropped)) => (kept, Some(dropped)),
        Err(_) => (questions, None),
    };
    // Reload: a topic may have been started while the model wrote.
    let mut exam = state.exams.load(exam_id)?;
    exam.mocks.push(Mock { id: uuid::Uuid::new_v4().simple().to_string(), created_at: Utc::now(), questions, result: None, time_limit_secs, focus, dropped });
    state.exams.save(&mut exam)?;
    Ok(exam)
}

pub fn submit_mock(state: &AppState, exam_id: &str, mock_id: &str, answers: &[Vec<usize>]) -> Result<Exam> {
    let mut exam = state.exams.load(exam_id)?;
    let i = exam.mocks.iter().position(|m| m.id == mock_id).ok_or_else(|| anyhow!("simulacro no encontrado"))?;
    if exam.mocks[i].result.is_some() {
        return Err(anyhow!("Este simulacro ya fue entregado."));
    }
    let mut result = grade(&exam, &exam.mocks[i].questions, answers);
    result.elapsed_secs = (result.at - exam.mocks[i].created_at).num_seconds().max(0) as u64;
    exam.mocks[i].result = Some(result);
    add_to_review(&mut exam, i);
    state.exams.save(&mut exam)?;
    // AC-57: what was failed also goes to a flashcard deck of this exam.
    let failed: Vec<(String, String)> = exam.mocks[i]
        .questions
        .iter()
        .enumerate()
        .filter(|(j, q)| q.reported.is_none() && !is_right(q, exam.mocks[i].result.as_ref().unwrap().answers.get(*j).map(Vec::as_slice).unwrap_or(&[])))
        .map(|(_, q)| crate::cards::question_card(q))
        .collect();
    let today = chrono::Local::now().date_naive();
    let _ = crate::cards::add_to_named_deck(&state.decks, &format!("Falladas: {}", exam.name), crate::cards::DeckSource::Exam { id: exam.id.clone() }, &failed, today);
    Ok(exam)
}

// ── Checking the answer key (AC-46) ───────────────────────────────────────

pub fn check_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": CHECK_TOOL,
        "description": "Entrega tus respuestas a cada pregunta.",
        "parameters": { "type": "object", "properties": { "answers": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "answer": { "type": "array", "items": { "type": "integer" }, "description": "índices de las opciones correctas, desde 0" }
            },
            "required": ["id", "answer"]
        }}}, "required": ["answers"] }
    }})
}

/// The questions WITHOUT their key: the checker answers them on its own.
pub fn check_input(exam_name: &str, questions: &[Question]) -> String {
    let mut s = format!("Resolvé estas preguntas del examen **{exam_name}**.\n");
    for q in questions {
        s.push_str(&format!("\n### {}\n{}\n", q.id, q.stem));
        if q.answer.len() > 1 {
            s.push_str(&format!("(Elegí {})\n", q.answer.len()));
        }
        for (i, o) in q.options.iter().enumerate() {
            s.push_str(&format!("{i}) {o}\n"));
        }
    }
    s
}

/// Drops the questions where the checker's answer differs from the key (it
/// never swaps the key). A question the checker skipped is kept. Ids are
/// renumbered; returns the kept questions and how many were dropped.
pub fn apply_check(questions: Vec<Question>, raw: &str) -> Result<(Vec<Question>, usize)> {
    #[derive(Deserialize)]
    struct Raw {
        answers: Vec<RawCheck>,
    }
    #[derive(Deserialize)]
    struct RawCheck {
        id: String,
        #[serde(deserialize_with = "de_choice")]
        answer: Vec<usize>,
    }
    let r: Raw = serde_json::from_str(raw).context("el verificador devolvió datos inválidos")?;
    let total = questions.len();
    let kept: Vec<Question> = questions
        .into_iter()
        .filter(|q| r.answers.iter().find(|c| c.id == q.id).is_none_or(|c| c.answer.is_empty() || c.answer == q.answer))
        .enumerate()
        .map(|(i, q)| Question { id: format!("m{}", i + 1), ..q })
        .collect();
    if kept.is_empty() {
        return Err(anyhow!("El verificador no estuvo de acuerdo con ninguna respuesta. Probá generar el simulacro de nuevo."));
    }
    let dropped = total - kept.len();
    Ok((kept, dropped))
}

/// AC-46: marks a question as wrong; the mock is re-graded without it and it
/// leaves the review list.
pub fn report_in(exam: &mut Exam, mock_id: &str, question_id: &str, reason: &str) -> Result<()> {
    let reason = reason.trim();
    let reason = if reason.is_empty() { "sin motivo" } else { reason };
    let i = exam.mocks.iter().position(|m| m.id == mock_id).ok_or_else(|| anyhow!("simulacro no encontrado"))?;
    let q = exam.mocks[i].questions.iter_mut().find(|q| q.id == question_id).ok_or_else(|| anyhow!("pregunta no encontrada"))?;
    q.reported = Some(reason.to_string());
    let stem = q.stem.to_lowercase();
    exam.review.retain(|r| r.question.stem.to_lowercase() != stem);
    if let Some(old) = exam.mocks[i].result.clone() {
        let mut regraded = grade(exam, &exam.mocks[i].questions, &old.answers);
        regraded.at = old.at;
        regraded.elapsed_secs = old.elapsed_secs;
        exam.mocks[i].result = Some(regraded);
    }
    Ok(())
}

pub fn report(state: &AppState, exam_id: &str, mock_id: &str, question_id: &str, reason: &str) -> Result<Exam> {
    let mut exam = state.exams.load(exam_id)?;
    report_in(&mut exam, mock_id, question_id, reason)?;
    state.exams.save(&mut exam)?;
    Ok(exam)
}

/// AC-46: a question reported from the review list just leaves it.
pub fn report_review(state: &AppState, exam_id: &str, review_id: &str) -> Result<Exam> {
    let mut exam = state.exams.load(exam_id)?;
    let before = exam.review.len();
    exam.review.retain(|r| r.id != review_id);
    if exam.review.len() == before {
        return Err(anyhow!("pregunta de repaso no encontrada"));
    }
    state.exams.save(&mut exam)?;
    Ok(exam)
}

// ── "¿Por qué no la B?" (AC-45) ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct ExplainTurn {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
}

/// The question as the learner saw it after grading, for the teacher.
pub fn explain_context(exam_name: &str, q: &Question, chosen: &[usize]) -> String {
    let mut s = format!("Pregunta de un simulacro de **{exam_name}**:\n\n{}\n\n", q.stem);
    for (i, o) in q.options.iter().enumerate() {
        let tag = match (q.answer.contains(&i), chosen.contains(&i)) {
            (true, true) => " ← correcta (la eligió)",
            (true, false) => " ← correcta",
            (false, true) => " ← la eligió el aprendiz (incorrecta)",
            _ => "",
        };
        s.push_str(&format!("{}) {o}{tag}\n", (b'A' + i as u8) as char));
    }
    s.push_str(&format!("\nExplicación de la corrección: {}\n", q.explanation));
    s
}

pub async fn explain(state: &AppState, exam_id: &str, q: &Question, chosen: &[usize], history: &[ExplainTurn], ask: &str) -> Result<String> {
    let ask = ask.trim();
    if ask.is_empty() {
        return Err(anyhow!("Escribí tu pregunta."));
    }
    let exam = state.exams.load(exam_id)?;
    let ep = endpoint_for(state, Role::Teacher).await?;
    let system = state.prompts.get("exam_explain")?;
    let mut messages = vec![Msg::user(crate::practice::with_access(state, explain_context(&exam.name, q, chosen)), None)];
    for t in history.iter().rev().take(MAX_EXPLAIN_TURNS).rev() {
        messages.push(if t.role == "assistant" { Msg { role: "assistant".into(), content: Some(t.content.clone()), tool_calls: None, tool_call_id: None, meta: None } } else { Msg::user(t.content.clone(), None) });
    }
    messages.push(Msg::user(ask.to_string(), None));
    let c = llm::stream_chat(&ep, &system, &messages, &json!([]), None, |_| {}, || false).await?;
    let text = c.text.trim().to_string();
    if text.is_empty() {
        return Err(anyhow!("El profesor no respondió. Probá de nuevo."));
    }
    Ok(text)
}

// ── Cheat sheet (AC-44) ────────────────────────────────────────────────────

pub fn sheet_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": SHEET_TOOL,
        "description": "Entrega la hoja de repaso final.",
        "parameters": { "type": "object", "properties": {
            "markdown": { "type": "string", "description": "La hoja completa en Markdown: una sección ## por dominio." }
        }, "required": ["markdown"] }
    }})
}

/// What the cheat-sheet writer reads: syllabus, what the learner already
/// understood (graph) and what they keep failing (review list).
pub fn sheet_input(exam: &Exam, known: &[&str]) -> String {
    let mut s = format!("# Examen: {}\n", exam.name);
    if let Some(p) = exam.goal.passing_pct {
        s.push_str(&format!("Nota para aprobar: {p}%\n"));
    }
    s.push_str("\n## Temario (dominios por peso)\n");
    let mut domains: Vec<&Domain> = exam.domains.iter().collect();
    domains.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    for d in domains {
        s.push_str(&format!("\n### {} ({}%)\n", d.name, d.weight));
        for t in &d.topics {
            s.push_str(&format!("- {}", t.title));
            if !t.objectives.is_empty() {
                s.push_str(&format!(": {}", t.objectives.join("; ")));
            }
            s.push('\n');
        }
    }
    if !known.is_empty() {
        s.push_str("\n## Lo que el aprendiz ya entendió (de su grafo)\n");
        for k in known {
            s.push_str(&format!("- {k}\n"));
        }
    }
    if !exam.review.is_empty() {
        s.push_str("\n## Preguntas que viene fallando\n");
        for r in exam.review.iter().take(20) {
            let q = &r.question;
            let right: Vec<&str> = q.answer.iter().filter_map(|&i| q.options.get(i).map(String::as_str)).collect();
            s.push_str(&format!("- {} → correcta: {}. {}\n", q.stem.replace('\n', " "), right.join(" / "), q.explanation));
        }
    }
    s
}

pub fn parse_sheet(raw: &str) -> Result<String> {
    #[derive(Deserialize)]
    struct Raw {
        markdown: String,
    }
    let r: Raw = serde_json::from_str(raw).context("el redactor de la hoja devolvió datos inválidos")?;
    let md = r.markdown.trim().to_string();
    if md.is_empty() {
        return Err(anyhow!("La hoja de repaso salió vacía. Probá de nuevo."));
    }
    Ok(md)
}

pub async fn cheat_sheet(state: &AppState, exam_id: &str) -> Result<Exam> {
    let exam = state.exams.load(exam_id)?;
    let view = state.graph.view();
    let query = std::iter::once(exam.name.as_str()).chain(exam.domains.iter().flat_map(|d| d.topics.iter().map(|t| t.title.as_str()))).collect::<Vec<_>>().join(" ");
    let known: Vec<&str> = crate::graph::relevant(&view, &query, 30).iter().map(|n| n.text.as_str()).collect();
    let markdown = forced_valid(state, Role::Teacher, "exam_cheat_sheet", sheet_tool(), SHEET_TOOL, sheet_input(&exam, &known), parse_sheet).await?;
    let mut exam = state.exams.load(exam_id)?;
    exam.cheat_sheet = Some(CheatSheet { markdown, at: Utc::now() });
    state.exams.save(&mut exam)?;
    Ok(exam)
}

pub fn set_schedule(state: &AppState, exam_id: &str, slots: Vec<Slot>) -> Result<Exam> {
    let slots = validate_schedule(slots)?;
    let mut exam = state.exams.load(exam_id)?;
    exam.schedule = slots;
    state.exams.save(&mut exam)?;
    Ok(exam)
}

pub fn set_goal(state: &AppState, exam_id: &str, goal: ExamGoal) -> Result<Exam> {
    let goal = validate_goal(goal)?;
    let mut exam = state.exams.load(exam_id)?;
    exam.goal = goal;
    state.exams.save(&mut exam)?;
    Ok(exam)
}

pub fn review(state: &AppState, exam_id: &str, review_id: &str, choice: &[usize]) -> Result<Exam> {
    let mut exam = state.exams.load(exam_id)?;
    answer_review(&mut exam, review_id, choice)?;
    state.exams.save(&mut exam)?;
    Ok(exam)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn syllabus() -> String {
        json!({ "domains": [
            { "name": "Seguridad", "weight": 30, "topics": [
                { "title": "IAM", "objectives": ["Usuarios y roles", " ", "Políticas"] },
                { "title": "iam", "objectives": [] },
                { "title": "Cifrado", "objectives": [] }
            ]},
            { "name": "  ", "weight": 10, "topics": [{ "title": "x", "objectives": [] }] },
            { "name": "Sin temas", "weight": 10, "topics": [] },
            { "name": "Cómputo", "weight": 50, "topics": [{ "title": "EC2", "objectives": ["Tipos de instancia"] }] },
            { "name": "seguridad", "weight": 20, "topics": [{ "title": "dup", "objectives": [] }] }
        ]})
        .to_string()
    }

    fn exam() -> Exam {
        Exam { id: "e1".into(), name: "AWS CCP".into(), created_at: Utc::now(), updated_at: Utc::now(), domains: validate_syllabus(&syllabus()).unwrap(), mocks: vec![], review: vec![], goal: ExamGoal::default(), cheat_sheet: None, kind: ExamKind::Certification, schedule: vec![], lang: None }
    }

    fn q(domain: &str, answer: usize) -> Value {
        json!({ "domain_id": domain, "topic_id": "d1t1", "stem": format!("¿{domain} {answer}?"), "options": ["A", "B", "C", "D"], "answer": answer, "explanation": " porque sí " })
    }

    #[test]
    fn validate_syllabus_keeps_named_domains_with_topics() {
        let ds = validate_syllabus(&syllabus()).unwrap();
        assert_eq!(ds.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["Seguridad", "Cómputo"]);
        assert_eq!(ds[0].topics.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["IAM", "Cifrado"], "duplicate topics dropped");
        assert_eq!(ds[0].topics[0].objectives, ["Usuarios y roles", "Políticas"]);
        assert_eq!((ds[0].id.as_str(), ds[1].topics[0].id.as_str()), ("d1", "d2t1"));
        assert_eq!((ds[0].weight, ds[1].weight), (37.5, 62.5), "kept weights rescaled to 100");
        assert!(validate_syllabus(r#"{"domains":[]}"#).is_err());
        assert!(validate_syllabus("no es json").is_err());
    }

    #[test]
    fn validate_syllabus_caps_sizes() {
        let topics: Vec<Value> = (0..30).map(|i| json!({ "title": format!("t{i}"), "objectives": (0..20).map(|j| format!("o{j}")).collect::<Vec<_>>() })).collect();
        let raw = json!({ "domains": (0..15).map(|i| json!({ "name": format!("D{i}"), "topics": topics })).collect::<Vec<_>>() }).to_string();
        let ds = validate_syllabus(&raw).unwrap();
        assert_eq!(ds.len(), MAX_DOMAINS);
        assert_eq!(ds[0].topics.len(), MAX_TOPICS);
        assert_eq!(ds[0].topics[0].objectives.len(), MAX_OBJECTIVES);
    }

    #[test]
    fn weights_are_normalized_or_split_evenly() {
        assert_eq!(normalize_weights(&[Some(20.0), Some(30.0), Some(50.0)]), [20.0, 30.0, 50.0]);
        assert_eq!(normalize_weights(&[Some(1.0), Some(3.0)]), [25.0, 75.0]);
        assert_eq!(normalize_weights(&[Some(40.0), None]), [50.0, 50.0]);
        assert_eq!(normalize_weights(&[Some(40.0), Some(0.0)]), [50.0, 50.0]);
        assert_eq!(normalize_weights(&[None, None, None]), [33.3, 33.3, 33.3]);
    }

    #[test]
    fn allocate_follows_weights_and_sums_exactly() {
        assert_eq!(allocate(10, &[30.0, 70.0]), [3, 7]);
        assert_eq!(allocate(10, &[33.3, 33.3, 33.3]), [4, 3, 3], "ties go to the earlier domain");
        assert_eq!(allocate(5, &[10.0, 60.0, 30.0]), [0, 3, 2]);
        assert_eq!(allocate(7, &[24.0, 30.0, 26.0, 20.0]).iter().sum::<usize>(), 7);
        assert_eq!(allocate(3, &[]), Vec::<usize>::new());
    }

    #[test]
    fn questions_input_carries_distribution_and_topics() {
        let s = questions_input(&exam(), 8);
        assert!(s.contains("Generá 8 preguntas"));
        assert!(s.contains("### d1: Seguridad (37.5% del examen) → 3 preguntas"));
        assert!(s.contains("### d2: Cómputo (62.5% del examen) → 5 preguntas"));
        assert!(s.contains("- d1t1: IAM — Usuarios y roles; Políticas"));
        assert!(s.contains("- d1t2: Cifrado\n"));
    }

    #[test]
    fn validate_questions_keeps_only_well_formed_ones() {
        let e = exam();
        let mut bad_topic = q("d2", 0);
        bad_topic["stem"] = json!("Tema ajeno");
        let raw = json!({ "questions": [
            q("d1", 1),
            q("d9", 0),
            { "domain_id": "d1", "stem": "  ", "options": ["A", "B"], "answer": 0 },
            { "domain_id": "d1", "stem": "una opción", "options": ["A"], "answer": 0 },
            { "domain_id": "d1", "stem": "repetidas", "options": ["A", "a"], "answer": 0 },
            { "domain_id": "d1", "stem": "vacía", "options": ["A", " "], "answer": 0 },
            { "domain_id": "d1", "stem": "fuera de rango", "options": ["A", "B"], "answer": 2 },
            { "domain_id": "d1", "stem": "siete", "options": ["1", "2", "3", "4", "5", "6", "7"], "answer": 0 },
            q("d1", 1),
            bad_topic
        ]})
        .to_string();
        let qs = validate_questions(&raw, &e, 10).unwrap();
        assert_eq!(qs.len(), 2);
        assert_eq!((qs[0].id.as_str(), qs[0].answer.as_slice(), qs[0].explanation.as_str()), ("m1", &[1][..], "porque sí"));
        assert_eq!(qs[0].topic_id.as_deref(), Some("d1t1"));
        assert_eq!(qs[1].topic_id, None, "a topic of another domain is dropped");
        assert_eq!(validate_questions(&raw, &e, 1).unwrap().len(), 1);
        assert!(validate_questions(r#"{"questions":[]}"#, &e, 5).is_err());
    }

    #[test]
    fn grade_scores_total_and_by_domain() {
        let e = exam();
        let raw = json!({ "questions": [q("d1", 0), q("d1", 1), q("d2", 2)] }).to_string();
        let qs = validate_questions(&raw, &e, 10).unwrap();
        let r = grade(&e, &qs, &[vec![0], vec![3]]);
        assert_eq!((r.correct, r.total), (1, 3));
        assert_eq!(r.answers, [vec![0], vec![3], vec![]], "missing answers are blanks");
        assert_eq!(r.by_domain, [DomainScore { domain_id: "d1".into(), correct: 1, total: 2 }, DomainScore { domain_id: "d2".into(), correct: 0, total: 1 }]);
        assert_eq!(grade(&e, &qs[..1], &[]).by_domain.len(), 1, "domains without questions are left out");
    }

    #[test]
    fn summary_and_study_link() {
        let mut e = exam();
        e.domains[0].topics[0].session_id = Some("s".into());
        let qs = validate_questions(&json!({ "questions": [q("d1", 0), q("d2", 0)] }).to_string(), &e, 5).unwrap();
        let result = grade(&e, &qs, &[vec![0], vec![1]]);
        e.mocks.push(Mock { id: "m".into(), created_at: Utc::now(), questions: qs.clone(), result: Some(result), time_limit_secs: None, focus: None, dropped: None });
        e.mocks.push(Mock { id: "n".into(), created_at: Utc::now(), questions: qs, result: None, time_limit_secs: None, focus: None, dropped: None });
        let s = e.summary();
        assert_eq!((s.domains, s.topics, s.started, s.last_score), (2, 3, 1, Some(50.0)));

        let link = study_link(&e, "d1t1").unwrap();
        assert_eq!((link.exam_name.as_str(), link.domain.as_str(), link.weight), ("AWS CCP", "Seguridad", 37.5));
        assert_eq!(link.objectives, ["Usuarios y roles", "Políticas"]);
        assert!(study_link(&e, "nope").is_none());
    }

    #[test]
    fn multi_select_questions_are_validated_and_all_or_nothing() {
        let e = exam();
        let multi = |stem: &str, answer: Value| json!({ "domain_id": "d1", "stem": stem, "options": ["A", "B", "C", "D"], "answer": answer, "explanation": "" });
        let raw = json!({ "questions": [
            multi("dos", json!([2, 0])),
            multi("repetida", json!([1, 1])),
            multi("todas", json!([0, 1, 2, 3])),
            multi("ninguna", json!([])),
            multi("fuera", json!([0, 9]))
        ]})
        .to_string();
        let qs = validate_questions(&raw, &e, 10).unwrap();
        assert_eq!(qs.iter().map(|q| (q.stem.as_str(), q.answer.clone())).collect::<Vec<_>>(), [("dos", vec![0, 2]), ("repetida", vec![1])]);
        assert!(is_right(&qs[0], &[2, 0]));
        assert!(!is_right(&qs[0], &[0]), "half right is wrong");
        assert!(!is_right(&qs[0], &[0, 1, 2]), "an extra option is wrong");
        assert!(!is_right(&qs[0], &[]));
        assert_eq!(grade(&e, &qs, &[vec![0, 2, 2], vec![1]]).correct, 2);
    }

    #[test]
    fn focus_narrows_the_exam_and_names_it() {
        let e = exam();
        let all = MockFocus::default();
        assert_eq!(focused(&e, &all).unwrap().1, None);
        let (scope, label) = focused(&e, &MockFocus { domain_ids: vec!["d2".into()], topic_ids: vec!["d1t2".into()] }).unwrap();
        assert_eq!(label.as_deref(), Some("Seguridad, Cómputo"));
        assert_eq!(scope.domains[0].topics.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["d1t2"], "only the chosen topic");
        assert_eq!(scope.domains[1].topics.len(), 1, "a whole domain keeps its topics");
        let s = questions_input(&scope, 4);
        assert!(s.contains("d1t2: Cifrado") && !s.contains("d1t1: IAM"));
        assert!(focused(&e, &MockFocus { domain_ids: vec!["zz".into()], topic_ids: vec![] }).is_err());

        let raw = json!({ "questions": [q("d1", 0), q("d2", 1)] }).to_string();
        let only_d2 = focused(&e, &MockFocus { domain_ids: vec!["d2".into()], topic_ids: vec![] }).unwrap().0;
        assert_eq!(validate_questions(&raw, &only_d2, 5).unwrap().len(), 1, "questions outside the focus are dropped");
    }

    #[test]
    fn targeted_mocks_do_not_count_as_the_last_score() {
        let mut e = exam();
        let qs = validate_questions(&json!({ "questions": [q("d1", 0), q("d2", 0)] }).to_string(), &e, 5).unwrap();
        let full = grade(&e, &qs, &[vec![0], vec![1]]);
        let targeted = grade(&e, &qs, &[vec![0], vec![0]]);
        e.mocks.push(Mock { id: "a".into(), created_at: Utc::now(), questions: qs.clone(), result: Some(full), time_limit_secs: None, focus: None, dropped: None });
        e.mocks.push(Mock { id: "b".into(), created_at: Utc::now(), questions: qs, result: Some(targeted), time_limit_secs: None, focus: Some("Seguridad".into()), dropped: None });
        assert_eq!(e.summary().last_score, Some(50.0));
    }

    #[test]
    fn cheat_sheet_input_has_syllabus_graph_and_failures() {
        let mut e = exam();
        e.goal.passing_pct = Some(70.0);
        let i = graded(&mut e, "m1", &[Some(0), Some(0), Some(0)]);
        add_to_review(&mut e, i);
        let s = sheet_input(&e, &["IAM separa usuarios de roles"]);
        assert!(s.starts_with("# Examen: AWS CCP\nNota para aprobar: 70%"));
        assert!(s.find("### Cómputo (62.5%)").unwrap() < s.find("### Seguridad (37.5%)").unwrap(), "heaviest first");
        assert!(s.contains("- IAM: Usuarios y roles; Políticas"));
        assert!(s.contains("## Lo que el aprendiz ya entendió (de su grafo)\n- IAM separa usuarios de roles"));
        assert!(s.contains("- ¿d1 1? → correcta: B. porque sí"));
        assert!(!sheet_input(&exam(), &[]).contains("viene fallando"));
        assert_eq!(parse_sheet(r##"{"markdown":"  ## Seguridad\n- IAM "}"##).unwrap(), "## Seguridad\n- IAM");
        assert!(parse_sheet(r#"{"markdown":" "}"#).is_err());
    }

    #[test]
    fn the_checker_answers_blind_and_disputed_keys_are_dropped() {
        let e = exam();
        let raw = json!({ "questions": [q("d1", 0), q("d1", 1), q("d2", 2), { "domain_id": "d2", "stem": "doble", "options": ["A", "B", "C"], "answer": [0, 2], "explanation": "" }] }).to_string();
        let qs = validate_questions(&raw, &e, 10).unwrap();
        let input = check_input("AWS CCP", &qs);
        assert!(input.contains("### m4\ndoble\n(Elegí 2)\n0) A\n1) B\n2) C\n"));
        assert!(!input.contains("porque sí"), "no explanations: they would give the key away");

        let verdict = json!({ "answers": [
            { "id": "m1", "answer": [0] },
            { "id": "m2", "answer": [3] },
            { "id": "m4", "answer": [2, 0] }
        ]})
        .to_string();
        let (kept, dropped) = apply_check(qs.clone(), &verdict).unwrap();
        assert_eq!(dropped, 1);
        assert_eq!(kept.iter().map(|q| (q.id.as_str(), q.stem.as_str())).collect::<Vec<_>>(), [("m1", "¿d1 0?"), ("m2", "¿d2 2?"), ("m3", "doble")], "skipped kept, ids renumbered");
        assert_eq!(kept[0].answer, [0], "the key is never swapped");
        let all_wrong = json!({ "answers": qs.iter().map(|q| json!({ "id": q.id, "answer": [9] })).collect::<Vec<_>>() }).to_string();
        assert!(apply_check(qs, &all_wrong).is_err());
    }

    #[test]
    fn a_reported_question_stops_counting_and_leaves_the_review() {
        let mut e = exam();
        let i = graded(&mut e, "m1", &[Some(0), Some(0), Some(0)]);
        add_to_review(&mut e, i);
        assert_eq!(e.review.len(), 2);
        let q2 = e.mocks[i].questions[1].id.clone();
        report_in(&mut e, "m1", &q2, "  ").unwrap();
        let r = e.mocks[i].result.as_ref().unwrap();
        assert_eq!((r.correct, r.total), (1, 2), "re-graded without it");
        assert_eq!(e.mocks[i].questions[1].reported.as_deref(), Some("sin motivo"));
        assert_eq!(e.review.len(), 1, "out of the review list");
        assert!(report_in(&mut e, "m1", "zz", "x").is_err());
        assert!(report_in(&mut e, "nope", &q2, "x").is_err());
    }

    #[test]
    fn the_teacher_sees_the_options_the_key_and_the_choice() {
        let e = exam();
        let raw = json!({ "questions": [{ "domain_id": "d1", "stem": "¿Cuál?", "options": ["Uno", "Dos", "Tres"], "answer": [0], "explanation": "Porque uno." }] }).to_string();
        let q = &validate_questions(&raw, &e, 1).unwrap()[0];
        let s = explain_context("AWS CCP", q, &[1]);
        assert!(s.contains("A) Uno ← correcta\nB) Dos ← la eligió el aprendiz (incorrecta)\nC) Tres\n"));
        assert!(s.contains("Explicación de la corrección: Porque uno."));
        assert!(explain_context("x", q, &[0]).contains("A) Uno ← correcta (la eligió)"));
    }

    #[test]
    fn language_paths_tell_the_teacher_the_language() {
        let mut e = exam();
        e.kind = ExamKind::Language;
        e.lang = Some(crate::runner::Lang::Rust);
        let link = study_link(&e, "d1t1").unwrap();
        assert_eq!(link.lang.as_deref(), Some("rust"));
        assert_eq!(study_link(&exam(), "d1t1").unwrap().lang, None);
        assert_eq!(language_path_input(crate::runner::Lang::Rust, "medio", " "), "Lenguaje: Rust\nNivel de partida: medio\nPara qué lo quiere: aprender el lenguaje a fondo\n");
        assert_eq!(serde_json::to_value(ExamKind::Language).unwrap(), json!("language"));
    }

    #[test]
    fn schedule_is_validated_and_sorted() {
        let slot = |d: u8, s: &str, e: &str| Slot { weekday: d, start: s.into(), end: e.into(), kind: SlotKind::Class, place: " Aula 3 ".into() };
        let ok = validate_schedule(vec![slot(3, "18:00", "20:00"), slot(1, "09:30", "11:00"), slot(1, "08:00", "09:00")]).unwrap();
        assert_eq!(ok.iter().map(|s| (s.weekday, s.start.as_str())).collect::<Vec<_>>(), [(1, "08:00"), (1, "09:30"), (3, "18:00")]);
        assert_eq!(ok[0].place, "Aula 3");
        assert!(validate_schedule(vec![slot(0, "08:00", "09:00")]).is_err());
        assert!(validate_schedule(vec![slot(8, "08:00", "09:00")]).is_err());
        assert!(validate_schedule(vec![slot(1, "9:00", "10:00")]).is_err(), "HH:MM");
        assert!(validate_schedule(vec![slot(1, "24:00", "24:30")]).is_err());
        assert!(validate_schedule(vec![slot(1, "10:00", "10:00")]).is_err());
        assert!(validate_schedule((0..41).map(|_| slot(1, "08:00", "09:00")).collect()).is_err());
        let e: Exam = serde_json::from_value(json!({ "id": "e", "name": "n", "created_at": "2026-10-27T10:00:00Z", "updated_at": "2026-10-27T10:00:00Z", "domains": [] })).unwrap();
        assert_eq!((e.kind, e.schedule.len()), (ExamKind::Certification, 0), "older files are certifications without schedule");
        assert_eq!(serde_json::to_value(SlotKind::Study).unwrap(), json!("study"));
    }

    #[test]
    fn goal_is_validated_and_normalized() {
        let g = |p: Option<f64>, d: Option<&str>, h: Option<f64>| ExamGoal { passing_pct: p, exam_date: d.map(String::from), hours_per_week: h };
        assert_eq!(validate_goal(g(Some(70.04), Some(" 2026-12-15 "), Some(6.0))).unwrap(), g(Some(70.0), Some("2026-12-15"), Some(6.0)));
        assert_eq!(validate_goal(g(None, Some(""), None)).unwrap(), ExamGoal::default(), "blank date clears it");
        assert!(validate_goal(g(Some(0.0), None, None)).is_err());
        assert!(validate_goal(g(Some(101.0), None, None)).is_err());
        assert!(validate_goal(g(None, Some("2026-02-30"), None)).is_err());
        assert!(validate_goal(g(None, None, Some(0.0))).is_err());
        let e: Exam = serde_json::from_value(json!({ "id": "e", "name": "n", "created_at": "2026-10-27T10:00:00Z", "updated_at": "2026-10-27T10:00:00Z", "domains": [] })).unwrap();
        assert_eq!(e.goal, ExamGoal::default(), "older exam files load without a goal");
    }

    #[test]
    fn old_single_answer_files_still_load() {
        let q: Question = serde_json::from_value(json!({ "id": "m1", "domain_id": "d1", "stem": "s", "options": ["A", "B"], "answer": 1, "explanation": "" })).unwrap();
        assert_eq!(q.answer, [1]);
        let r: MockResult = serde_json::from_value(json!({ "answers": [null, 1, [2, 0]], "correct": 0, "total": 3, "by_domain": [], "at": "2026-10-27T10:00:00Z" })).unwrap();
        assert_eq!(r.answers, [vec![], vec![1], vec![0, 2]]);
        assert_eq!(r.elapsed_secs, 0);
        assert_eq!(serde_json::to_value(&q).unwrap()["answer"], json!([1]), "saved in the new shape");
    }

    #[test]
    fn time_limit_is_optional_and_bounded() {
        assert_eq!(time_limit(None).unwrap(), None);
        assert_eq!(time_limit(Some(90)).unwrap(), Some(5400));
        assert_eq!(time_limit(Some(1)).unwrap(), Some(60));
        assert_eq!(time_limit(Some(MAX_MINUTES)).unwrap(), Some(36_000));
        assert!(time_limit(Some(0)).is_err());
        assert!(time_limit(Some(MAX_MINUTES + 1)).is_err());
    }

    fn graded(e: &mut Exam, id: &str, answers: &[Option<usize>]) -> usize {
        let answers: Vec<Vec<usize>> = answers.iter().map(|a| a.iter().copied().collect()).collect();
        let raw = json!({ "questions": [q("d1", 0), q("d1", 1), q("d2", 2)] }).to_string();
        let qs = validate_questions(&raw, e, 10).unwrap();
        let result = grade(e, &qs, &answers);
        e.mocks.push(Mock { id: id.into(), created_at: Utc::now(), questions: qs, result: Some(result), time_limit_secs: Some(60), focus: None, dropped: None });
        e.mocks.len() - 1
    }

    #[test]
    fn failed_questions_join_the_review_once() {
        let mut e = exam();
        let i = graded(&mut e, "m1", &[Some(0), Some(0), None]);
        add_to_review(&mut e, i);
        assert_eq!(e.review.iter().map(|r| r.question.stem.as_str()).collect::<Vec<_>>(), ["¿d1 1?", "¿d2 2?"], "wrong and blank, not right");
        assert_eq!(e.review[0].mock_id, "m1");

        e.review[0].streak = 1;
        let j = graded(&mut e, "m2", &[Some(1), Some(1), Some(1)]);
        add_to_review(&mut e, j);
        assert_eq!(e.review.len(), 3, "the same statement is not added twice");
        assert_eq!(e.review[0].streak, 1, "answered right this time: streak kept");
        assert_eq!(e.review[2].question.stem, "¿d1 0?");
        let k = graded(&mut e, "m3", &[Some(0), Some(0), Some(2)]);
        add_to_review(&mut e, k);
        assert_eq!(e.review[0].streak, 0, "failed again: streak starts over");
        assert_eq!(e.summary().to_review, 3);

        e.mocks.push(Mock { id: "open".into(), created_at: Utc::now(), questions: vec![], result: None, time_limit_secs: None, focus: None, dropped: None });
        let last = e.mocks.len() - 1;
        add_to_review(&mut e, last);
        assert_eq!(e.review.len(), 3, "an ungraded mock adds nothing");
    }

    #[test]
    fn review_needs_two_right_answers_in_a_row() {
        let mut e = exam();
        let i = graded(&mut e, "m1", &[None, None, None]);
        add_to_review(&mut e, i);
        let id = e.review[0].id.clone();
        let right = e.review[0].question.answer.clone();
        let wrong = vec![right[0] + 1];
        assert!(answer_review(&mut e, &id, &right).unwrap());
        assert_eq!(e.review[0].streak, 1);
        assert!(!answer_review(&mut e, &id, &wrong).unwrap());
        assert_eq!(e.review[0].streak, 0, "a miss starts over");
        answer_review(&mut e, &id, &right).unwrap();
        answer_review(&mut e, &id, &right).unwrap();
        assert!(e.review.iter().all(|r| r.id != id), "mastered: out of the list");
        assert_eq!(e.review.len(), 2);
        assert!(answer_review(&mut e, &id, &right).is_err());
    }

    #[test]
    fn guide_input_prefers_full_page_text_and_caps_it() {
        let hits = vec![
            Hit { title: "AWS".into(), url: "https://aws.example/guide".into(), content: "corto".into(), raw_content: Some("x".repeat(MAX_SOURCE_CHARS + 50)) },
            Hit { title: "Blog".into(), url: "https://blog.example".into(), content: "resumen del blog".into(), raw_content: Some("  ".into()) },
        ];
        let s = guide_input("AWS CCP", &hits);
        assert!(s.starts_with("Examen: AWS CCP"));
        assert!(s.contains(&format!("[1] AWS — https://aws.example/guide\n{}\n", "x".repeat(MAX_SOURCE_CHARS))));
        assert!(!s.contains(&"x".repeat(MAX_SOURCE_CHARS + 1)));
        assert!(s.contains("[2] Blog — https://blog.example\nresumen del blog"), "blank raw text falls back to the snippet");
        assert!(guide_query("AWS CCP").starts_with("AWS CCP official exam guide"));
    }

    #[test]
    fn parse_guide_keeps_cited_sources_and_rejects_empty() {
        let hits = vec![
            Hit { title: "A".into(), url: "https://a.example".into(), content: String::new(), raw_content: None },
            Hit { title: "B".into(), url: "https://b.example".into(), content: String::new(), raw_content: None },
        ];
        let g = parse_guide(r#"{"guide":" Dominio 1: X (100%)\n- T ","used":[2]}"#, &hits).unwrap();
        assert_eq!(g.guide, "Dominio 1: X (100%)\n- T");
        assert_eq!(g.sources, [SourceRef { title: "B".into(), url: "https://b.example".into() }]);
        assert!(parse_guide(r#"{"guide":"  ","used":[]}"#, &hits).unwrap_err().to_string().contains("No encontré la guía"));
        assert!(parse_guide("{", &hits).is_err());
    }

    #[test]
    fn store_roundtrip_list_and_delete() {
        let dir = std::env::temp_dir().join(format!("la-exam-{}", uuid::Uuid::new_v4().simple()));
        let st = ExamStore::new(&dir);
        assert!(st.list().is_empty());
        let mut e = exam();
        st.save(&mut e).unwrap();
        assert_eq!(st.load("e1").unwrap().domains.len(), 2);
        assert_eq!(st.list().len(), 1);
        assert!(st.path("../x").starts_with(dir.join("exams")));
        st.delete("e1").unwrap();
        assert!(st.list().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }
}
