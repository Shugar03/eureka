//! Mi cursada (AC-99…): the learner's academic life. Terms (cuatrimestre,
//! trimestre…), courses with their weekly class slots, and the dates that
//! matter (parciales, TPs, finales). Everything is checked here, so the screen,
//! the agent and the importer can trust what they get.
//!
//! The agent never writes by itself: it PROPOSES (`propose_timetable`) and the
//! person confirms, exactly like a diary entry.

use crate::graph::normalize;
use anyhow::{anyhow, bail, Result};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const TOOL: &str = "propose_timetable";
pub const TERM_KINDS: &[&str] = &["cuatrimestre", "trimestre", "semestre", "anual", "otro"];
pub const DATE_KINDS: &[&str] = &["parcial", "recuperatorio", "final", "tp", "entrega", "otro"];
pub const SLOT_KINDS: &[&str] = &["teoria", "practica", "otro"];
/// How many colours the grid cycles through.
pub const PALETTE: u8 = 8;

const MAX_TERMS: usize = 40;
const MAX_BREAKS: usize = 80;
/// A break longer than this is not a break: it is the end of the term.
const MAX_BREAK_DAYS: i64 = 62;
const MAX_COURSES: usize = 300;
const MAX_DATES: usize = 2000;
const MAX_SLOTS: usize = 20;
const MAX_PROPOSAL_COURSES: usize = 30;
const MAX_PROPOSAL_DATES: usize = 100;

// ── Data ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Term {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
    /// AC-145: holidays and weeks without classes.
    #[serde(default)]
    pub breaks: Vec<TermBreak>,
}

/// AC-145: days without classes in a term (a holiday, a week of exams, a break).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TermBreak {
    pub id: String,
    /// "YYYY-MM-DD", both inclusive.
    pub start: String,
    pub end: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct BreakInput {
    pub start: String,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClassSlot {
    /// 1 = Monday … 7 = Sunday.
    pub weekday: u8,
    /// "HH:MM", local time.
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub room: String,
    #[serde(default = "slot_kind")]
    pub kind: String,
}

fn slot_kind() -> String {
    "teoria".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub term_id: String,
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub professor: String,
    /// The usual room; a slot can say another.
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub color: u8,
    #[serde(default)]
    pub slots: Vec<ClassSlot>,
    /// AC-150: its study route (an exam of kind "subject"), if linked.
    #[serde(default)]
    pub exam_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DateItem {
    pub id: String,
    pub term_id: String,
    #[serde(default)]
    pub course_id: Option<String>,
    pub kind: String,
    pub title: String,
    /// "YYYY-MM-DD".
    pub date: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub grade: Option<f32>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Data {
    #[serde(default)]
    pub terms: Vec<Term>,
    #[serde(default)]
    pub courses: Vec<Course>,
    #[serde(default)]
    pub dates: Vec<DateItem>,
    #[serde(default)]
    pub active_term: Option<String>,
}

// ── Inputs (from the screen) ──────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
pub struct TermInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CourseInput {
    #[serde(default)]
    pub id: Option<String>,
    pub term_id: String,
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub professor: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub color: Option<u8>,
    #[serde(default)]
    pub slots: Vec<ClassSlot>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct DateInput {
    #[serde(default)]
    pub id: Option<String>,
    pub term_id: String,
    #[serde(default)]
    pub course_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub date: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub grade: Option<f32>,
}

// ── Validation ────────────────────────────────────────────────────────────

fn cut(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

fn minutes_of(hhmm: &str) -> Option<u32> {
    let t = hhmm.trim();
    let (h, m) = t.split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (t.len() == 5 && h < 24 && m < 60).then_some(h * 60 + m)
}

pub fn valid_date(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn clean_optional_date(v: &Option<String>, what: &str) -> Result<Option<String>> {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(d) if valid_date(d) => Ok(Some(d.to_string())),
        Some(_) => bail!("{what}: la fecha tiene que ser AAAA-MM-DD."),
    }
}

/// Valid days and times with the end after the start, sorted by day and time, no repeats.
pub fn clean_slots(slots: &[ClassSlot]) -> Result<Vec<ClassSlot>> {
    if slots.len() > MAX_SLOTS {
        bail!("Como mucho {MAX_SLOTS} horarios por materia.");
    }
    let mut out: Vec<ClassSlot> = Vec::new();
    for s in slots {
        if !(1..=7).contains(&s.weekday) {
            bail!("El día va de 1 (lunes) a 7 (domingo).");
        }
        let (a, b) = (minutes_of(&s.start), minutes_of(&s.end));
        match (a, b) {
            (Some(a), Some(b)) if b > a => {}
            (Some(_), Some(_)) => bail!("{}: la clase tiene que terminar después de empezar.", s.start),
            _ => bail!("Los horarios van como HH:MM (por ejemplo 08:30)."),
        }
        let kind = if SLOT_KINDS.contains(&s.kind.as_str()) { s.kind.clone() } else { slot_kind() };
        let slot = ClassSlot { weekday: s.weekday, start: s.start.trim().into(), end: s.end.trim().into(), room: cut(&s.room, 60), kind };
        if !out.iter().any(|o| (o.weekday, &o.start, &o.end) == (slot.weekday, &slot.start, &slot.end)) {
            out.push(slot);
        }
    }
    out.sort_by(|a, b| (a.weekday, &a.start).cmp(&(b.weekday, &b.start)));
    Ok(out)
}

fn clean_term_kind(k: &str) -> String {
    let k = normalize(k);
    TERM_KINDS.iter().find(|x| **x == k).map(|x| x.to_string()).unwrap_or_else(|| "otro".into())
}

fn clean_date_kind(k: &str) -> String {
    let k = normalize(k);
    // "trabajo practico", "entrega de tp" … all land on the closest kind.
    let k = if k.contains("trabajo practico") || k == "tp" || k.starts_with("tp ") { "tp".to_string() } else { k };
    DATE_KINDS.iter().find(|x| **x == k).map(|x| x.to_string()).unwrap_or_else(|| "otro".into())
}

// ── Proposal: what the agent or the importer suggests, checked ────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProposalTerm {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub start: Option<String>,
    #[serde(default)]
    pub end: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProposalCourse {
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub professor: String,
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub slots: Vec<ClassSlot>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProposalDate {
    /// The course's name, as the proposal or the person's Mi cursada calls it.
    #[serde(default)]
    pub course: Option<String>,
    pub kind: String,
    pub title: String,
    pub date: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Proposal {
    #[serde(default)]
    pub term: Option<ProposalTerm>,
    #[serde(default)]
    pub courses: Vec<ProposalCourse>,
    #[serde(default)]
    pub dates: Vec<ProposalDate>,
}

/// Checks and normalizes a proposal. Errors say what is wrong in words the
/// model can act on (the same text goes back to it as the tool result).
pub fn check_proposal(p: Proposal) -> Result<Proposal> {
    if p.courses.is_empty() && p.dates.is_empty() {
        bail!("la propuesta está vacía: mandá al menos una materia o una fecha");
    }
    if p.courses.len() > MAX_PROPOSAL_COURSES || p.dates.len() > MAX_PROPOSAL_DATES {
        bail!("la propuesta es muy grande: hasta {MAX_PROPOSAL_COURSES} materias y {MAX_PROPOSAL_DATES} fechas por vez");
    }
    let term = match p.term {
        None => None,
        Some(t) => {
            let name = cut(&t.name, 80);
            if name.is_empty() {
                bail!("el período necesita un nombre (por ejemplo «2.º cuatrimestre 2026»)");
            }
            let (start, end) = (clean_optional_date(&t.start, "inicio del período").map_err(|e| anyhow!("{e}"))?, clean_optional_date(&t.end, "fin del período").map_err(|e| anyhow!("{e}"))?);
            if let (Some(a), Some(b)) = (&start, &end) {
                if b < a {
                    bail!("el período termina antes de empezar");
                }
            }
            Some(ProposalTerm { name, kind: clean_term_kind(&t.kind), start, end })
        }
    };
    let mut courses = Vec::new();
    for c in p.courses {
        let name = cut(&c.name, 100);
        if name.is_empty() {
            bail!("cada materia necesita un nombre");
        }
        let slots = clean_slots(&c.slots).map_err(|e| anyhow!("{name}: {e}"))?;
        courses.push(ProposalCourse { name, code: cut(&c.code, 30), professor: cut(&c.professor, 100), room: cut(&c.room, 60), notes: cut(&c.notes, 500), slots });
    }
    let mut dates = Vec::new();
    for d in p.dates {
        let title = cut(&d.title, 120);
        if title.is_empty() {
            bail!("cada fecha necesita un título (por ejemplo «Primer parcial»)");
        }
        if !valid_date(d.date.trim()) {
            bail!("{title}: la fecha tiene que ser AAAA-MM-DD (usá la fecha de hoy del estado para resolver «el jueves» o «el 12/11»)");
        }
        let time = match d.time.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(t) if minutes_of(t).is_some() => Some(t.to_string()),
            Some(_) => bail!("{title}: la hora va como HH:MM"),
        };
        let course = d.course.map(|c| cut(&c, 100)).filter(|c| !c.is_empty());
        dates.push(ProposalDate { course, kind: clean_date_kind(&d.kind), title, date: d.date.trim().into(), time, notes: cut(&d.notes, 500) });
    }
    Ok(Proposal { term, courses, dates })
}

/// The JSON schema of `propose_timetable` (the tool and the importer share it).
pub fn proposal_schema() -> Value {
    let slot = json!({
        "type": "object",
        "properties": {
            "weekday": { "type": "integer", "description": "1 lunes … 7 domingo" },
            "start": { "type": "string", "description": "HH:MM (24 h)" },
            "end": { "type": "string", "description": "HH:MM (24 h)" },
            "room": { "type": "string", "description": "Aula, si la dice" },
            "kind": { "type": "string", "enum": SLOT_KINDS }
        },
        "required": ["weekday", "start", "end"]
    });
    json!({
        "type": "object",
        "properties": {
            "term": {
                "type": "object",
                "description": "Solo si lo dice o se deduce; si no, se usa el período activo.",
                "properties": {
                    "name": { "type": "string", "description": "Ej.: «2.º cuatrimestre 2026»" },
                    "kind": { "type": "string", "enum": TERM_KINDS },
                    "start": { "type": "string", "description": "AAAA-MM-DD" },
                    "end": { "type": "string", "description": "AAAA-MM-DD" }
                },
                "required": ["name"]
            },
            "courses": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "code": { "type": "string" },
                    "professor": { "type": "string" },
                    "room": { "type": "string", "description": "Aula habitual" },
                    "notes": { "type": "string" },
                    "slots": { "type": "array", "items": slot }
                },
                "required": ["name"]
            }},
            "dates": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "course": { "type": "string", "description": "Nombre de la materia" },
                    "kind": { "type": "string", "enum": DATE_KINDS },
                    "title": { "type": "string", "description": "Ej.: «Primer parcial»" },
                    "date": { "type": "string", "description": "AAAA-MM-DD" },
                    "time": { "type": "string", "description": "HH:MM, si la dice" },
                    "notes": { "type": "string" }
                },
                "required": ["kind", "title", "date"]
            }}
        }
    })
}

/// For the forced call that reads a pasted timetable.
pub fn parse_tool() -> Value {
    json!({ "type": "function", "function": { "name": TOOL, "description": "Devuelve el horario y las fechas que hay en el texto, sin inventar nada.", "parameters": proposal_schema() } })
}

pub fn parse_proposal(raw: &str) -> Result<Proposal> {
    let p: Proposal = serde_json::from_str(raw).map_err(|e| anyhow!("la propuesta vino mal formada ({e})"))?;
    check_proposal(p)
}

// ── Store ─────────────────────────────────────────────────────────────────

/// What `import` did, for the confirmation message.
#[derive(Debug, Default, Serialize, PartialEq)]
pub struct ImportReport {
    pub term: String,
    pub courses_added: usize,
    pub courses_updated: usize,
    pub dates_added: usize,
    pub dates_skipped: usize,
}

pub struct AcademicStore {
    path: PathBuf,
    lock: Mutex<()>,
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

impl AcademicStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("academic").join("academic.json"), lock: Mutex::new(()) }
    }

    pub fn data(&self) -> Data {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Read-modify-write under a lock; nothing is saved if `f` fails.
    fn update<T>(&self, f: impl FnOnce(&mut Data) -> Result<T>) -> Result<T> {
        let _g = self.lock.lock().unwrap();
        let mut d = self.data();
        let out = f(&mut d)?;
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&d)?)?;
        std::fs::rename(tmp, &self.path)?;
        Ok(out)
    }

    pub fn save_term(&self, i: TermInput) -> Result<Data> {
        let name = cut(&i.name, 80);
        if name.is_empty() {
            bail!("Poné un nombre al período (por ejemplo «2.º cuatrimestre 2026»).");
        }
        let (start, end) = (clean_optional_date(&i.start, "Inicio")?, clean_optional_date(&i.end, "Fin")?);
        if let (Some(a), Some(b)) = (&start, &end) {
            if b < a {
                bail!("El período termina antes de empezar.");
            }
        }
        self.update(|d| {
            let kind = clean_term_kind(&i.kind);
            match i.id.as_deref().and_then(|id| d.terms.iter_mut().find(|t| t.id == id)) {
                Some(t) => (t.name, t.kind, t.start, t.end) = (name, kind, start, end),
                None => {
                    if d.terms.len() >= MAX_TERMS {
                        bail!("Ya tenés {MAX_TERMS} períodos: archivá o borrá alguno.");
                    }
                    let id = new_id();
                    d.terms.push(Term { id: id.clone(), name, kind, start, end, breaks: Vec::new() });
                    d.active_term = Some(id);
                }
            }
            Ok(d.clone())
        })
    }

    pub fn delete_term(&self, id: &str) -> Result<Data> {
        self.update(|d| {
            d.terms.retain(|t| t.id != id);
            d.courses.retain(|c| c.term_id != id);
            d.dates.retain(|x| x.term_id != id);
            if d.active_term.as_deref() == Some(id) {
                d.active_term = d.terms.last().map(|t| t.id.clone());
            }
            Ok(d.clone())
        })
    }

    pub fn set_active(&self, id: &str) -> Result<Data> {
        self.update(|d| {
            if !d.terms.iter().any(|t| t.id == id) {
                bail!("Ese período no existe.");
            }
            d.active_term = Some(id.to_string());
            Ok(d.clone())
        })
    }

    pub fn save_course(&self, i: CourseInput) -> Result<Data> {
        let name = cut(&i.name, 100);
        if name.is_empty() {
            bail!("Poné el nombre de la materia.");
        }
        let slots = clean_slots(&i.slots)?;
        self.update(|d| {
            if !d.terms.iter().any(|t| t.id == i.term_id) {
                bail!("Elegí un período para la materia.");
            }
            let (code, professor, room, notes) = (cut(&i.code, 30), cut(&i.professor, 100), cut(&i.room, 60), cut(&i.notes, 500));
            match i.id.as_deref().and_then(|id| d.courses.iter_mut().find(|c| c.id == id)) {
                Some(c) => {
                    c.name = name;
                    c.term_id = i.term_id.clone();
                    (c.code, c.professor, c.room, c.notes, c.slots) = (code, professor, room, notes, slots);
                    if let Some(col) = i.color {
                        c.color = col % PALETTE;
                    }
                }
                None => {
                    if d.courses.len() >= MAX_COURSES {
                        bail!("Ya hay {MAX_COURSES} materias cargadas.");
                    }
                    let color = i.color.map(|c| c % PALETTE).unwrap_or(d.courses.iter().filter(|c| c.term_id == i.term_id).count() as u8 % PALETTE);
                    d.courses.push(Course { id: new_id(), term_id: i.term_id.clone(), name, code, professor, room, notes, color, slots, exam_id: None });
                }
            }
            Ok(d.clone())
        })
    }

    /// AC-150: links a course to its study route (or unlinks it with `None`).
    pub fn link_route(&self, course_id: &str, exam_id: Option<String>) -> Result<Data> {
        self.update(|d| {
            let c = d.courses.iter_mut().find(|c| c.id == course_id).ok_or_else(|| anyhow!("Esa materia ya no existe."))?;
            c.exam_id = exam_id.filter(|e| !e.trim().is_empty());
            Ok(d.clone())
        })
    }

    pub fn delete_course(&self, id: &str) -> Result<Data> {
        self.update(|d| {
            d.courses.retain(|c| c.id != id);
            // Its dates stay in the term, now without a course: they still matter.
            for x in d.dates.iter_mut().filter(|x| x.course_id.as_deref() == Some(id)) {
                x.course_id = None;
            }
            Ok(d.clone())
        })
    }

    pub fn save_date(&self, i: DateInput) -> Result<Data> {
        let title = cut(&i.title, 120);
        if title.is_empty() {
            bail!("Poné un título (por ejemplo «Primer parcial»).");
        }
        if !valid_date(i.date.trim()) {
            bail!("Elegí una fecha válida.");
        }
        let time = match i.time.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(t) if minutes_of(t).is_some() => Some(t.to_string()),
            Some(_) => bail!("La hora va como HH:MM."),
        };
        if i.grade.is_some_and(|g| !(0.0..=100.0).contains(&g)) {
            bail!("La nota va de 0 a 100.");
        }
        self.update(|d| {
            if !d.terms.iter().any(|t| t.id == i.term_id) {
                bail!("Elegí un período para la fecha.");
            }
            let course_id = i.course_id.clone().filter(|c| d.courses.iter().any(|x| &x.id == c));
            let (kind, notes, date) = (clean_date_kind(&i.kind), cut(&i.notes, 500), i.date.trim().to_string());
            match i.id.as_deref().and_then(|id| d.dates.iter_mut().find(|x| x.id == id)) {
                Some(x) => (x.term_id, x.course_id, x.kind, x.title, x.date, x.time, x.notes, x.done, x.grade) = (i.term_id.clone(), course_id, kind, title, date, time, notes, i.done, i.grade),
                None => {
                    if d.dates.len() >= MAX_DATES {
                        bail!("Ya hay {MAX_DATES} fechas cargadas.");
                    }
                    d.dates.push(DateItem { id: new_id(), term_id: i.term_id.clone(), course_id, kind, title, date, time, notes, done: i.done, grade: i.grade });
                }
            }
            Ok(d.clone())
        })
    }

    /// AC-145: adds days without classes to a term. Repeats (same days) are
    /// skipped, so loading the national holidays twice adds nothing.
    pub fn add_breaks(&self, term_id: &str, items: Vec<BreakInput>) -> Result<Data> {
        let mut clean = Vec::new();
        for i in &items {
            let start = i.start.trim().to_string();
            let end = i.end.as_deref().map(str::trim).filter(|e| !e.is_empty()).unwrap_or(&start).to_string();
            let (Ok(a), Ok(b)) = (NaiveDate::parse_from_str(&start, "%Y-%m-%d"), NaiveDate::parse_from_str(&end, "%Y-%m-%d")) else {
                bail!("Los días sin clases van con fecha AAAA-MM-DD.");
            };
            if b < a {
                bail!("El «hasta» es anterior al «desde».");
            }
            if (b - a).num_days() >= MAX_BREAK_DAYS {
                bail!("Como mucho {MAX_BREAK_DAYS} días seguidos sin clases.");
            }
            let name = cut(&i.name, 80);
            clean.push((start, end, if name.is_empty() { "Sin clases".to_string() } else { name }));
        }
        self.update(|d| {
            let t = d.terms.iter_mut().find(|t| t.id == term_id).ok_or_else(|| anyhow!("Ese período ya no existe."))?;
            for (start, end, name) in clean {
                if t.breaks.iter().any(|b| b.start == start && b.end == end) {
                    continue;
                }
                if t.breaks.len() >= MAX_BREAKS {
                    bail!("Ya tenés {MAX_BREAKS} días sin clases en este período.");
                }
                t.breaks.push(TermBreak { id: new_id(), start, end, name });
            }
            t.breaks.sort_by(|a, b| a.start.cmp(&b.start));
            Ok(d.clone())
        })
    }

    pub fn delete_break(&self, term_id: &str, id: &str) -> Result<Data> {
        self.update(|d| {
            if let Some(t) = d.terms.iter_mut().find(|t| t.id == term_id) {
                t.breaks.retain(|b| b.id != id);
            }
            Ok(d.clone())
        })
    }

    pub fn delete_date(&self, id: &str) -> Result<Data> {
        self.update(|d| {
            d.dates.retain(|x| x.id != id);
            Ok(d.clone())
        })
    }

    /// Applies a confirmed proposal: into the term it names (created if new, and
    /// made the active one) or into the active term. Courses with the same name
    /// are updated, not duplicated; dates already there are skipped.
    pub fn import(&self, p: Proposal) -> Result<(Data, ImportReport)> {
        let p = check_proposal(p)?;
        self.update(|d| {
            let mut report = ImportReport::default();
            let term_id = match &p.term {
                Some(t) => match d.terms.iter().find(|x| normalize(&x.name) == normalize(&t.name)).map(|x| x.id.clone()) {
                    Some(id) => {
                        d.active_term = Some(id.clone());
                        id
                    }
                    None => {
                        if d.terms.len() >= MAX_TERMS {
                            bail!("Ya tenés {MAX_TERMS} períodos: borrá alguno primero.");
                        }
                        let id = new_id();
                        d.terms.push(Term { id: id.clone(), name: t.name.clone(), kind: t.kind.clone(), start: t.start.clone(), end: t.end.clone(), breaks: Vec::new() });
                        d.active_term = Some(id.clone());
                        id
                    }
                },
                None => match d.active_term.clone().filter(|a| d.terms.iter().any(|t| &t.id == a)) {
                    Some(id) => id,
                    None => {
                        let id = new_id();
                        d.terms.push(Term { id: id.clone(), name: "Período actual".into(), kind: "otro".into(), start: None, end: None, breaks: Vec::new() });
                        d.active_term = Some(id.clone());
                        id
                    }
                },
            };
            report.term = d.terms.iter().find(|t| t.id == term_id).map(|t| t.name.clone()).unwrap_or_default();

            for c in &p.courses {
                match d.courses.iter_mut().find(|x| x.term_id == term_id && normalize(&x.name) == normalize(&c.name)) {
                    Some(x) => {
                        for (dst, src) in [(&mut x.code, &c.code), (&mut x.professor, &c.professor), (&mut x.room, &c.room), (&mut x.notes, &c.notes)] {
                            if !src.is_empty() {
                                *dst = src.clone();
                            }
                        }
                        let merged: Vec<ClassSlot> = x.slots.iter().chain(&c.slots).cloned().collect();
                        x.slots = clean_slots(&merged)?;
                        report.courses_updated += 1;
                    }
                    None => {
                        if d.courses.len() >= MAX_COURSES {
                            bail!("Ya hay {MAX_COURSES} materias cargadas.");
                        }
                        let color = d.courses.iter().filter(|x| x.term_id == term_id).count() as u8 % PALETTE;
                        d.courses.push(Course { id: new_id(), term_id: term_id.clone(), name: c.name.clone(), code: c.code.clone(), professor: c.professor.clone(), room: c.room.clone(), notes: c.notes.clone(), color, slots: c.slots.clone(), exam_id: None });
                        report.courses_added += 1;
                    }
                }
            }

            for x in &p.dates {
                let course_id = x.course.as_ref().and_then(|name| d.courses.iter().find(|c| c.term_id == term_id && normalize(&c.name) == normalize(name)).map(|c| c.id.clone()));
                let same = |e: &DateItem| e.term_id == term_id && e.course_id == course_id && e.kind == x.kind && normalize(&e.title) == normalize(&x.title) && e.date == x.date;
                if d.dates.iter().any(same) {
                    report.dates_skipped += 1;
                    continue;
                }
                if d.dates.len() >= MAX_DATES {
                    bail!("Ya hay {MAX_DATES} fechas cargadas.");
                }
                d.dates.push(DateItem { id: new_id(), term_id: term_id.clone(), course_id, kind: x.kind.clone(), title: x.title.clone(), date: x.date.clone(), time: x.time.clone(), notes: x.notes.clone(), done: false, grade: None });
                report.dates_added += 1;
            }
            Ok((d.clone(), report))
        })
    }
}

// ── What the agent knows ──────────────────────────────────────────────────

const DAY_NAMES: [&str; 7] = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DAY_SHORT: [&str; 7] = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

pub fn day_name(weekday: u8) -> &'static str {
    DAY_NAMES[(weekday.clamp(1, 7) - 1) as usize]
}

fn dmy(d: &NaiveDate) -> String {
    format!("{:02}/{:02}", d.day(), d.month())
}

fn slot_text(s: &ClassSlot, course_room: &str) -> String {
    let room = if s.room.is_empty() { course_room } else { &s.room };
    format!("{} {}–{}{}", DAY_SHORT[(s.weekday - 1) as usize], s.start, s.end, if room.is_empty() { String::new() } else { format!(" ({room})") })
}

/// "## Cursada del aprendiz" for the model's state block: today's date (so it can
/// resolve "el jueves"), the active term, courses, today's classes and the dates
/// of the next month. Empty when there is nothing, so it costs nothing.
/// What a route of a course aims at: exams, not homework.
pub const ROUTE_KINDS: &[&str] = &["parcial", "recuperatorio", "final"];

/// AC-150: for each course with a route, the date it should aim at — its
/// next exam-like date not done yet (`None` when there is none left).
pub fn route_targets(d: &Data, today: &str) -> Vec<(String, Option<String>)> {
    d.courses
        .iter()
        .filter_map(|c| c.exam_id.as_ref().map(|e| (c, e)))
        .map(|(c, exam)| {
            let next = d.dates.iter().filter(|x| x.course_id.as_deref() == Some(c.id.as_str()) && !x.done && x.date.as_str() >= today && ROUTE_KINDS.contains(&x.kind.as_str())).map(|x| x.date.clone()).min();
            (exam.clone(), next)
        })
        .collect()
}

pub fn state_section(d: &Data, today: NaiveDate) -> String {
    let term = d.active_term.as_ref().and_then(|id| d.terms.iter().find(|t| &t.id == id));
    let mut out = format!("\n## Cursada del aprendiz (Mi cursada)\nHoy es {} {}/{:02}/{}.\n", day_name(today.weekday().number_from_monday() as u8), today.day(), today.month(), today.year());
    let Some(term) = term else {
        out.push_str("Todavía no cargó su cursada. Si te cuenta su horario o sus fechas, usá `propose_timetable` para que las guarde (ella confirma).\n");
        return out;
    };
    let range = match (&term.start, &term.end) {
        (Some(a), Some(b)) => format!(", del {a} al {b}"),
        _ => String::new(),
    };
    out.push_str(&format!("Período activo: {} ({}{range}).\n", term.name, term.kind));
    let courses: Vec<&Course> = d.courses.iter().filter(|c| c.term_id == term.id).collect();
    if courses.is_empty() && d.dates.iter().all(|x| x.term_id != term.id) {
        out.push_str("Sin materias ni fechas todavía.\n");
        return out;
    }
    if !courses.is_empty() {
        out.push_str("Materias:\n");
        for c in courses.iter().take(14) {
            let who = if c.professor.is_empty() { String::new() } else { format!(" · prof. {}", c.professor) };
            let slots = if c.slots.is_empty() { "sin horario".to_string() } else { c.slots.iter().map(|s| slot_text(s, &c.room)).collect::<Vec<_>>().join(", ") };
            out.push_str(&format!("- {}{who}: {slots}\n", c.name));
        }
    }
    let today_s = today.format("%Y-%m-%d").to_string();
    let off_today = term.breaks.iter().find(|b| b.start <= today_s && today_s <= b.end);
    let soon = (today + chrono::Days::new(30)).format("%Y-%m-%d").to_string();
    let breaks: Vec<&TermBreak> = term.breaks.iter().filter(|b| b.end >= today_s && b.start <= soon).take(6).collect();
    if !breaks.is_empty() {
        out.push_str("Días sin clases (próximos 30 días): ");
        out.push_str(&breaks.iter().map(|b| if b.start == b.end { format!("{} {}", b.name, b.start) } else { format!("{} del {} al {}", b.name, b.start, b.end) }).collect::<Vec<_>>().join("; "));
        out.push('\n');
    }
    let wd = today.weekday().number_from_monday() as u8;
    let mut todays: Vec<(String, &ClassSlot, &Course)> = courses.iter().flat_map(|c| c.slots.iter().filter(|s| s.weekday == wd).map(move |s| (s.start.clone(), s, *c))).collect();
    todays.sort_by(|a, b| a.0.cmp(&b.0));
    if let Some(b) = off_today {
        out.push_str(&format!("Hoy no hay clases: {}.\n", b.name));
    } else if !todays.is_empty() {
        out.push_str("Clases de hoy: ");
        out.push_str(&todays.iter().map(|(_, s, c)| format!("{} {}–{}", c.name, s.start, s.end)).collect::<Vec<_>>().join("; "));
        out.push('\n');
    }
    let mut next: Vec<(NaiveDate, &DateItem)> = d
        .dates
        .iter()
        .filter(|x| x.term_id == term.id && !x.done)
        .filter_map(|x| NaiveDate::parse_from_str(&x.date, "%Y-%m-%d").ok().map(|dt| (dt, x)))
        .filter(|(dt, _)| *dt >= today && (*dt - today).num_days() <= 30)
        .collect();
    next.sort_by_key(|(dt, _)| *dt);
    if !next.is_empty() {
        out.push_str("Fechas de los próximos 30 días:\n");
        for (dt, x) in next.iter().take(10) {
            let course = x.course_id.as_ref().and_then(|id| d.courses.iter().find(|c| &c.id == id)).map(|c| format!(" · {}", c.name)).unwrap_or_default();
            let left = (*dt - today).num_days();
            out.push_str(&format!("- {} «{}»{course}: {} (en {left} {})\n", x.kind, x.title, dmy(dt), if left == 1 { "día" } else { "días" }));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (AcademicStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-academic-{}", uuid::Uuid::new_v4().simple()));
        (AcademicStore::new(&dir), dir)
    }

    fn slot(weekday: u8, start: &str, end: &str) -> ClassSlot {
        ClassSlot { weekday, start: start.into(), end: end.into(), room: String::new(), kind: "teoria".into() }
    }

    fn term_input(name: &str) -> TermInput {
        TermInput { name: name.into(), kind: "cuatrimestre".into(), ..Default::default() }
    }

    #[test]
    fn slots_are_validated_sorted_and_deduplicated() {
        let ok = clean_slots(&[slot(3, "10:00", "12:00"), slot(1, "08:30", "10:00"), slot(3, "10:00", "12:00"), ClassSlot { kind: "raro".into(), ..slot(1, "14:00", "15:00") }]).unwrap();
        assert_eq!(ok.iter().map(|s| (s.weekday, s.start.as_str())).collect::<Vec<_>>(), [(1, "08:30"), (1, "14:00"), (3, "10:00")]);
        assert_eq!(ok[1].kind, "teoria", "an unknown kind falls back");
        for bad in [slot(0, "10:00", "11:00"), slot(8, "10:00", "11:00"), slot(1, "10:00", "10:00"), slot(1, "12:00", "10:00"), slot(1, "9:00", "10:00"), slot(1, "25:00", "26:00")] {
            assert!(clean_slots(&[bad]).is_err());
        }
        assert!(clean_slots(&vec![slot(1, "08:00", "09:00"); MAX_SLOTS + 1]).is_err());
    }

    #[test]
    fn terms_courses_and_dates_are_created_edited_and_deleted_together() {
        let (st, dir) = store();
        let d = st.save_term(term_input("  2.º cuatrimestre 2026 ")).unwrap();
        let term = d.terms[0].clone();
        assert_eq!((term.name.as_str(), d.active_term.as_deref()), ("2.º cuatrimestre 2026", Some(term.id.as_str())), "the first term is the active one");
        assert!(st.save_term(TermInput { start: Some("2026-08-10".into()), end: Some("2026-08-01".into()), ..term_input("x") }).is_err());
        assert!(st.save_term(term_input("  ")).is_err());

        let d = st.save_course(CourseInput { term_id: term.id.clone(), name: "Análisis I".into(), professor: "Pérez".into(), room: "Aula 3".into(), slots: vec![slot(1, "10:00", "12:00")], ..Default::default() }).unwrap();
        let course = d.courses[0].clone();
        assert!(st.save_course(CourseInput { term_id: "nope".into(), name: "X".into(), ..Default::default() }).is_err());
        let d = st.save_date(DateInput { term_id: term.id.clone(), course_id: Some(course.id.clone()), kind: "Trabajo práctico".into(), title: " TP 1 ".into(), date: "2026-09-14".into(), time: Some("09:00".into()), ..Default::default() }).unwrap();
        assert_eq!((d.dates[0].kind.as_str(), d.dates[0].title.as_str()), ("tp", "TP 1"), "kinds are understood, titles trimmed");
        for bad in [DateInput { date: "14/09/2026".into(), ..Default::default() }, DateInput { date: "2026-02-30".into(), ..Default::default() }] {
            assert!(st.save_date(DateInput { term_id: term.id.clone(), title: "x".into(), kind: "tp".into(), ..bad }).is_err());
        }
        assert!(st.save_date(DateInput { term_id: term.id.clone(), title: "x".into(), kind: "tp".into(), date: "2026-09-14".into(), time: Some("9am".into()), ..Default::default() }).is_err());
        assert!(st.save_date(DateInput { term_id: term.id.clone(), title: "x".into(), kind: "parcial".into(), date: "2026-09-14".into(), grade: Some(150.0), ..Default::default() }).is_err());

        // Editing keeps the identity, and deleting the course keeps its dates.
        let d = st.save_course(CourseInput { id: Some(course.id.clone()), term_id: term.id.clone(), name: "Análisis Matemático I".into(), slots: vec![], ..Default::default() }).unwrap();
        assert_eq!((d.courses.len(), d.courses[0].name.as_str(), d.courses[0].slots.len()), (1, "Análisis Matemático I", 0));
        let d = st.delete_course(&course.id).unwrap();
        assert!(d.courses.is_empty() && d.dates.len() == 1 && d.dates[0].course_id.is_none());
        let d = st.save_date(DateInput { id: Some(d.dates[0].id.clone()), term_id: term.id.clone(), kind: "parcial".into(), title: "Parcial".into(), date: "2026-10-01".into(), done: true, grade: Some(78.0), ..Default::default() }).unwrap();
        assert_eq!((d.dates.len(), d.dates[0].done, d.dates[0].grade), (1, true, Some(78.0)));
        let d = st.delete_term(&term.id).unwrap();
        assert!(d.terms.is_empty() && d.dates.is_empty() && d.active_term.is_none());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_new_term_becomes_active_and_the_active_one_can_be_chosen() {
        let (st, dir) = store();
        let a = st.save_term(term_input("1.º cuatrimestre")).unwrap().terms[0].id.clone();
        let d = st.save_term(term_input("2.º cuatrimestre")).unwrap();
        assert_eq!(d.active_term.as_deref(), Some(d.terms[1].id.as_str()));
        assert_eq!(st.set_active(&a).unwrap().active_term.as_deref(), Some(a.as_str()));
        assert!(st.set_active("nope").is_err());
        let d = st.delete_term(&a).unwrap();
        assert_eq!(d.active_term, Some(d.terms[0].id.clone()), "deleting the active term falls back to another");
        std::fs::remove_dir_all(dir).ok();
    }

    fn proposal() -> Proposal {
        Proposal {
            term: Some(ProposalTerm { name: "2.º cuatrimestre 2026".into(), kind: "Cuatrimestre".into(), start: Some("2026-08-03".into()), end: Some("2026-11-28".into()) }),
            courses: vec![
                ProposalCourse { name: "Análisis I".into(), professor: "Pérez".into(), room: "Aula 3".into(), slots: vec![slot(1, "10:00", "12:00"), slot(3, "10:00", "12:00")], ..Default::default() },
                ProposalCourse { name: "Física I".into(), slots: vec![slot(2, "14:00", "17:00")], ..Default::default() },
            ],
            dates: vec![
                ProposalDate { course: Some("análisis i".into()), kind: "parcial".into(), title: "Primer parcial".into(), date: "2026-10-05".into(), time: Some("10:00".into()), notes: String::new() },
                ProposalDate { course: None, kind: "Entrega".into(), title: "Informe de laboratorio".into(), date: "2026-10-20".into(), time: None, notes: String::new() },
            ],
        }
    }

    #[test]
    fn importing_a_proposal_builds_the_term_and_never_duplicates() {
        let (st, dir) = store();
        let (d, r) = st.import(proposal()).unwrap();
        assert_eq!((r.term.as_str(), r.courses_added, r.courses_updated, r.dates_added, r.dates_skipped), ("2.º cuatrimestre 2026", 2, 0, 2, 0));
        assert_eq!((d.terms.len(), d.terms[0].kind.as_str(), d.courses.len(), d.dates.len()), (1, "cuatrimestre", 2, 2));
        let analisis = d.courses.iter().find(|c| c.name == "Análisis I").unwrap();
        assert_eq!(d.dates.iter().find(|x| x.title == "Primer parcial").unwrap().course_id.as_deref(), Some(analisis.id.as_str()), "dates find their course by name, ignoring case and accents");
        assert_ne!(d.courses[0].color, d.courses[1].color, "each course gets its own colour");

        // The same again, plus one new slot and one new date: courses are updated, dates are not repeated.
        let mut again = proposal();
        again.courses[0].slots.push(slot(5, "08:00", "10:00"));
        again.dates.push(ProposalDate { course: Some("Física I".into()), kind: "final".into(), title: "Final".into(), date: "2026-12-10".into(), time: None, notes: String::new() });
        let (d, r) = st.import(again).unwrap();
        assert_eq!((r.courses_added, r.courses_updated, r.dates_added, r.dates_skipped), (0, 2, 1, 2));
        assert_eq!((d.terms.len(), d.courses.len(), d.dates.len()), (1, 2, 3));
        assert_eq!(d.courses.iter().find(|c| c.name == "Análisis I").unwrap().slots.len(), 3);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_proposal_without_a_term_goes_to_the_active_one_or_makes_one() {
        let (st, dir) = store();
        let mut p = proposal();
        p.term = None;
        let (d, r) = st.import(p.clone()).unwrap();
        assert_eq!((r.term.as_str(), d.terms.len()), ("Período actual", 1));
        let id = st.save_term(term_input("Trimestre 3")).unwrap().terms[1].id.clone();
        let (d, r) = st.import(p).unwrap();
        assert_eq!((r.term.as_str(), d.active_term.as_deref()), ("Trimestre 3", Some(id.as_str())));
        assert_eq!(d.courses.iter().filter(|c| c.term_id == id).count(), 2, "into the active term");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn proposals_are_checked_with_errors_the_model_can_act_on() {
        let bad = |f: fn(&mut Proposal)| {
            let mut p = proposal();
            f(&mut p);
            check_proposal(p).unwrap_err().to_string()
        };
        assert!(check_proposal(Proposal::default()).unwrap_err().to_string().contains("vacía"));
        assert!(bad(|p| p.courses[0].slots[0].end = "09:00".into()).contains("Análisis I"));
        assert!(bad(|p| p.dates[0].date = "05/10/2026".into()).contains("AAAA-MM-DD"));
        assert!(bad(|p| p.dates[0].time = Some("10hs".into())).contains("HH:MM"));
        assert!(bad(|p| p.courses[1].name = " ".into()).contains("nombre"));
        assert!(bad(|p| p.term.as_mut().unwrap().end = Some("2026-01-01".into())).contains("termina antes"));
        assert!(bad(|p| p.dates[1].title = "".into()).contains("título"));
        assert!(bad(|p| p.courses = vec![ProposalCourse { name: "x".into(), ..Default::default() }; MAX_PROPOSAL_COURSES + 1]).contains("muy grande"));
        let ok = check_proposal(proposal()).unwrap();
        assert_eq!(ok.term.unwrap().kind, "cuatrimestre");
        assert_eq!(ok.dates[1].kind, "entrega");
        // Straight from the model's JSON.
        let p = parse_proposal(r#"{"courses":[{"name":"Química","slots":[{"weekday":4,"start":"08:00","end":"10:00"}]}],"dates":[{"kind":"trabajo practico","title":"TP 2","date":"2026-09-30"}]}"#).unwrap();
        assert_eq!((p.courses[0].slots[0].kind.as_str(), p.dates[0].kind.as_str()), ("teoria", "tp"));
        assert!(parse_proposal("no json").is_err());
    }

    #[test]
    fn a_route_aims_at_the_course_next_exam_and_moves_on_when_it_is_done() {
        let (st, dir) = store();
        let term = st.save_term(term_input("T")).unwrap().terms[0].id.clone();
        let d = st.save_course(CourseInput { term_id: term.clone(), name: "Análisis".into(), ..Default::default() }).unwrap();
        let course = d.courses[0].id.clone();
        let date = |kind: &str, title: &str, day: &str| DateInput { term_id: term.clone(), course_id: Some(course.clone()), kind: kind.into(), title: title.into(), date: day.into(), ..Default::default() };
        st.save_date(date("parcial", "Primer parcial", "2026-11-05")).unwrap();
        st.save_date(date("entrega", "TP", "2026-11-01")).unwrap();
        st.save_date(date("final", "Final", "2026-12-15")).unwrap();
        st.save_date(date("parcial", "Ya pasó", "2026-10-01")).unwrap();
        assert!(route_targets(&st.data(), "2026-10-29").is_empty(), "no route linked");
        let d = st.link_route(&course, Some("exam1".into())).unwrap();
        assert_eq!(route_targets(&d, "2026-10-29"), vec![("exam1".to_string(), Some("2026-11-05".to_string()))], "the next exam, not the TP");
        let first = d.dates.iter().find(|x| x.title == "Primer parcial").unwrap().clone();
        let d = st.save_date(DateInput { id: Some(first.id), done: true, ..date("parcial", "Primer parcial", "2026-11-05") }).unwrap();
        assert_eq!(route_targets(&d, "2026-10-29")[0].1.as_deref(), Some("2026-12-15"), "done: on to the final");
        assert_eq!(route_targets(&d, "2026-12-16")[0].1, None);
        let d = st.save_course(CourseInput { id: Some(course.clone()), term_id: term.clone(), name: "Análisis I".into(), ..Default::default() }).unwrap();
        assert_eq!(d.courses[0].exam_id.as_deref(), Some("exam1"), "editing the course keeps its route");
        assert_eq!(st.link_route(&course, None).unwrap().courses[0].exam_id, None);
        assert!(st.link_route("nope", None).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn days_without_classes_are_checked_kept_once_and_told_to_the_agent() {
        let (st, dir) = store();
        let today = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap(); // a Wednesday
        st.import(proposal()).unwrap();
        let term = st.data().active_term.unwrap();
        let brk = |start: &str, end: Option<&str>, name: &str| BreakInput { start: start.into(), end: end.map(Into::into), name: name.into() };
        assert!(st.add_breaks(&term, vec![brk("28/10", None, "x")]).is_err());
        assert!(st.add_breaks(&term, vec![brk("2026-11-05", Some("2026-11-01"), "x")]).is_err());
        assert!(st.add_breaks(&term, vec![brk("2026-01-01", Some("2026-12-31"), "x")]).is_err(), "a whole year is not a break");
        assert!(st.add_breaks("nope", vec![brk("2026-11-23", None, "x")]).is_err());

        let holidays = vec![brk("2026-11-23", None, "Día de la Soberanía Nacional"), brk("2026-10-28", None, "")];
        st.add_breaks(&term, holidays.clone()).unwrap();
        let d = st.add_breaks(&term, holidays).unwrap();
        let t = d.terms.iter().find(|t| t.id == term).unwrap();
        assert_eq!(t.breaks.iter().map(|b| (b.start.as_str(), b.end.as_str(), b.name.as_str())).collect::<Vec<_>>(), vec![("2026-10-28", "2026-10-28", "Sin clases"), ("2026-11-23", "2026-11-23", "Día de la Soberanía Nacional")], "sorted, once, named");

        let s = state_section(&d, today);
        assert!(s.contains("Hoy no hay clases: Sin clases.") && !s.contains("Clases de hoy:"), "{s}");
        assert!(s.contains("Día de la Soberanía Nacional 2026-11-23"), "{s}");

        let first = t.breaks[0].id.clone();
        let d = st.delete_break(&term, &first).unwrap();
        assert_eq!(d.terms.iter().find(|t| t.id == term).unwrap().breaks.len(), 1);
        assert!(state_section(&d, today).contains("Clases de hoy: Análisis I"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_agent_knows_today_the_term_the_classes_and_what_is_coming() {
        let (st, dir) = store();
        let today = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap(); // a Wednesday
        let empty = state_section(&st.data(), today);
        assert!(empty.contains("Hoy es miércoles 28/10/2026") && empty.contains("Todavía no cargó su cursada") && empty.contains("propose_timetable"));
        st.import(proposal()).unwrap();
        let mut more = proposal();
        more.dates = vec![ProposalDate { course: Some("Física I".into()), kind: "parcial".into(), title: "Parcial de Física".into(), date: "2026-10-29".into(), time: None, notes: String::new() }, ProposalDate { course: None, kind: "final".into(), title: "Final lejano".into(), date: "2026-12-30".into(), time: None, notes: String::new() }];
        more.courses = vec![];
        st.import(more).unwrap();
        let s = state_section(&st.data(), today);
        assert!(s.contains("Período activo: 2.º cuatrimestre 2026 (cuatrimestre, del 2026-08-03 al 2026-11-28)"), "{s}");
        assert!(s.contains("- Análisis I · prof. Pérez: lun 10:00–12:00 (Aula 3), mié 10:00–12:00 (Aula 3)"), "{s}");
        assert!(s.contains("Clases de hoy: Análisis I 10:00–12:00"), "{s}");
        assert!(s.contains("parcial «Parcial de Física» · Física I: 29/10 (en 1 día)"), "{s}");
        assert!(!s.contains("Final lejano") && !s.contains("Primer parcial"), "only the next 30 days: {s}");
        std::fs::remove_dir_all(dir).ok();
    }

    // ── Written from the mutation run: each one defends a rule no test guarded. ──

    #[test]
    fn times_and_dates_are_checked_at_their_edges() {
        assert_eq!((minutes_of("00:00"), minutes_of("10:30"), minutes_of("23:59")), (Some(0), Some(630), Some(1439)));
        for bad in ["24:00", "10:60", "9:30", "10:3", "ab:cd", "", "10-30"] {
            assert_eq!(minutes_of(bad), None, "{bad}");
        }
        assert!(clean_slots(&[slot(1, "10:10", "10:50")]).is_ok(), "minutes count, not only hours");
        assert!(clean_slots(&vec![slot(1, "08:00", "09:00"); MAX_SLOTS]).is_ok(), "exactly the limit is fine");
        assert!(valid_date("2026-02-28") && !valid_date("2026-02-30") && !valid_date("2026-2-3") && !valid_date("26-02-03"));
        let (st, dir) = store();
        assert!(st.save_term(TermInput { start: Some("2026-13-45".into()), ..term_input("T") }).is_err(), "a broken date is refused, not kept");
        assert!(st.save_term(TermInput { end: Some("mañana".into()), ..term_input("T") }).is_err());
        assert!(st.save_term(TermInput { start: Some("2026-08-01".into()), end: Some("2026-08-01".into()), ..term_input("Un día") }).is_ok(), "a term of one day is a term");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn kinds_are_understood_however_they_are_written() {
        for (said, kind) in [("Parcial", "parcial"), ("TP", "tp"), ("TP 2", "tp"), ("tp", "tp"), ("Trabajo práctico 3", "tp"), ("trabajo practico", "tp"), ("Entrega", "entrega"), ("FINAL", "final"), ("recuperatorio", "recuperatorio"), ("cosa rara", "otro"), ("", "otro")] {
            assert_eq!(clean_date_kind(said), kind, "{said}");
        }
        for (said, kind) in [("Cuatrimestre", "cuatrimestre"), ("trimestre", "trimestre"), ("semestre", "semestre"), ("Anual", "anual"), ("bimestre", "otro")] {
            assert_eq!(clean_term_kind(said), kind, "{said}");
        }
    }

    #[test]
    fn proposals_have_a_size_limit_with_an_exact_edge() {
        let courses = |n: usize| (0..n).map(|i| ProposalCourse { name: format!("Materia {i}"), ..Default::default() }).collect::<Vec<_>>();
        let dates = |n: usize| (0..n).map(|i| ProposalDate { course: None, kind: "otro".into(), title: format!("Fecha {i}"), date: "2026-10-05".into(), time: None, notes: String::new() }).collect::<Vec<_>>();
        assert!(check_proposal(Proposal { courses: courses(MAX_PROPOSAL_COURSES), ..Default::default() }).is_ok());
        assert!(check_proposal(Proposal { courses: courses(MAX_PROPOSAL_COURSES + 1), ..Default::default() }).is_err());
        assert!(check_proposal(Proposal { dates: dates(MAX_PROPOSAL_DATES), ..Default::default() }).is_ok());
        assert!(check_proposal(Proposal { dates: dates(MAX_PROPOSAL_DATES + 1), ..Default::default() }).is_err());
        let term = |a: &str, b: &str| Some(ProposalTerm { name: "T".into(), kind: "otro".into(), start: Some(a.into()), end: Some(b.into()) });
        let with = |t| Proposal { term: t, courses: courses(1), ..Default::default() };
        assert!(check_proposal(with(term("2026-08-01", "2026-08-01"))).is_ok(), "a term that starts and ends the same day");
        assert!(check_proposal(with(term("2026-08-02", "2026-08-01"))).is_err());
        assert!(check_proposal(with(term("2026-08-01", "nunca"))).is_err());
    }

    #[test]
    fn the_tool_and_its_schema_are_what_the_model_is_told() {
        let t = parse_tool();
        assert_eq!((t["type"].as_str(), t["function"]["name"].as_str()), (Some("function"), Some(TOOL)));
        let schema = proposal_schema();
        for k in ["term", "courses", "dates"] {
            assert!(schema["properties"][k].is_object(), "{k}");
        }
        assert_eq!(schema["properties"]["courses"]["items"]["properties"]["slots"]["items"]["required"], json!(["weekday", "start", "end"]));
        assert_eq!(schema["properties"]["dates"]["items"]["required"], json!(["kind", "title", "date"]));
        assert_eq!(t["function"]["parameters"], schema);
    }

    #[test]
    fn editing_and_deleting_touch_only_what_they_name() {
        let (st, dir) = store();
        let a = st.save_term(term_input("A")).unwrap().terms[0].id.clone();
        let b = st.save_term(term_input("B")).unwrap().terms[1].id.clone();
        let d = st.save_term(TermInput { id: Some(a.clone()), name: "A renombrado".into(), kind: "trimestre".into(), ..Default::default() }).unwrap();
        assert_eq!((d.terms.len(), d.terms[0].name.as_str(), d.terms[0].kind.as_str(), d.active_term.as_deref()), (2, "A renombrado", "trimestre", Some(b.as_str())), "editing is not creating, and the active term stays");
        for term in [&a, &b] {
            st.save_course(CourseInput { term_id: term.clone(), name: format!("Materia de {term}"), ..Default::default() }).unwrap();
        }
        let d = st.data();
        let colour_in = |t: &str| d.courses.iter().find(|c| c.term_id == t).unwrap().color;
        assert_eq!((colour_in(&a), colour_in(&b)), (0, 0), "each term counts its own courses for the colour");
        for (term, title, day) in [(&a, "De A", "2026-10-05"), (&b, "De B 1", "2026-10-06"), (&b, "De B 2", "2026-10-07")] {
            st.save_date(DateInput { term_id: term.clone(), kind: "parcial".into(), title: title.into(), date: day.into(), ..Default::default() }).unwrap();
        }
        let gone = st.data().dates.iter().find(|x| x.title == "De B 1").unwrap().id.clone();
        st.delete_date(&gone).unwrap();
        assert_eq!(st.data().dates.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["De A", "De B 2"], "one date goes, and it stays gone");
        let d = st.delete_term(&a).unwrap();
        assert_eq!((d.terms.len(), d.courses.len(), d.dates.len()), (1, 1, 1), "a term takes its own courses and dates, nobody else's");
        assert_eq!((d.courses[0].term_id.as_str(), d.dates[0].title.as_str()), (b.as_str(), "De B 2"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn colours_cycle_through_the_palette_and_a_chosen_one_wraps() {
        let (st, dir) = store();
        let t = st.save_term(term_input("T")).unwrap().terms[0].id.clone();
        let course = |name: &str, color: Option<u8>| CourseInput { term_id: t.clone(), name: name.into(), color, ..Default::default() };
        for i in 0..10 {
            st.save_course(course(&format!("M{i}"), None)).unwrap();
        }
        let d = st.save_course(course("M10", None)).unwrap();
        assert_eq!(d.courses.iter().map(|c| c.color).collect::<Vec<_>>(), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2], "one colour per course, then around again");
        let d = st.save_course(course("Elegida", Some(10))).unwrap();
        assert_eq!(d.courses.last().unwrap().color, 2, "a chosen colour wraps into the palette");
        let id = d.courses.last().unwrap().id.clone();
        let d = st.save_course(CourseInput { id: Some(id.clone()), ..course("Elegida", Some(11)) }).unwrap();
        assert_eq!(d.courses.last().unwrap().color, 3);
        let d = st.save_course(CourseInput { id: Some(id), ..course("Elegida", None) }).unwrap();
        assert_eq!(d.courses.last().unwrap().color, 3, "editing without a colour keeps it");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_date_only_keeps_a_course_that_exists() {
        let (st, dir) = store();
        let t = st.save_term(term_input("T")).unwrap().terms[0].id.clone();
        let c = st.save_course(CourseInput { term_id: t.clone(), name: "Física".into(), ..Default::default() }).unwrap().courses[0].id.clone();
        let mk = |course: &str| DateInput { term_id: t.clone(), course_id: Some(course.into()), kind: "parcial".into(), title: format!("Parcial {course}"), date: "2026-10-05".into(), ..Default::default() };
        st.save_date(mk(&c)).unwrap();
        let d = st.save_date(mk("no-existe")).unwrap();
        assert_eq!(d.dates[0].course_id.as_deref(), Some(c.as_str()));
        assert_eq!(d.dates[1].course_id, None, "an unknown course is dropped and the date is kept");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn importing_keeps_what_the_person_already_has_and_only_skips_real_duplicates() {
        let (st, dir) = store();
        st.import(proposal()).unwrap();
        let (d, _) = st.import(Proposal { courses: vec![ProposalCourse { name: "análisis i".into(), ..Default::default() }], ..Default::default() }).unwrap();
        let a = d.courses.iter().find(|c| c.name == "Análisis I").unwrap();
        assert_eq!((a.professor.as_str(), a.room.as_str(), a.slots.len()), ("Pérez", "Aula 3", 2), "nothing said, nothing erased");
        let (d, _) = st.import(Proposal { courses: vec![ProposalCourse { name: "Análisis I".into(), professor: "Gómez".into(), ..Default::default() }], ..Default::default() }).unwrap();
        assert_eq!(d.courses.iter().find(|c| c.name == "Análisis I").unwrap().professor, "Gómez", "something new replaces");

        let base = proposal().dates[0].clone();
        let variants = vec![
            ProposalDate { course: Some("Física I".into()), ..base.clone() },
            ProposalDate { kind: "final".into(), ..base.clone() },
            ProposalDate { title: "Segundo parcial".into(), ..base.clone() },
            ProposalDate { date: "2026-10-06".into(), ..base.clone() },
            ProposalDate { course: None, ..base.clone() },
        ];
        let (before, r) = st.import(Proposal { dates: variants, ..Default::default() }).unwrap();
        assert_eq!((r.dates_added, r.dates_skipped), (5, 0), "each one differs in a single thing");
        let (after, r) = st.import(Proposal { dates: vec![base], ..Default::default() }).unwrap();
        assert_eq!((r.dates_added, r.dates_skipped, after.dates.len()), (0, 1, before.dates.len()), "only the exact same date is skipped");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_proposal_without_a_term_reuses_the_only_active_one() {
        let (st, dir) = store();
        st.save_term(term_input("Mi período")).unwrap();
        let mut p = proposal();
        p.term = None;
        let (d, r) = st.import(p).unwrap();
        assert_eq!((r.term.as_str(), d.terms.len()), ("Mi período", 1), "no second term appears");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn imported_courses_cycle_the_palette_too() {
        let (st, dir) = store();
        let courses = (0..11).map(|i| ProposalCourse { name: format!("Materia {i}"), ..Default::default() }).collect();
        let (d, _) = st.import(Proposal { courses, ..Default::default() }).unwrap();
        assert_eq!(d.courses.iter().map(|c| c.color).collect::<Vec<_>>(), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_summary_stays_honest_about_what_is_empty_and_what_is_not() {
        let (st, dir) = store();
        let today = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap();
        let t1 = st.save_term(term_input("T1")).unwrap().terms[0].id.clone();
        assert!(state_section(&st.data(), today).contains("Sin materias ni fechas todavía"));
        st.save_course(CourseInput { term_id: t1, name: "Solo materia".into(), ..Default::default() }).unwrap();
        let s = state_section(&st.data(), today);
        assert!(s.contains("- Solo materia: sin horario") && !s.contains("Sin materias ni fechas"), "a course alone is something: {s}");
        let t2 = st.save_term(term_input("T2")).unwrap().terms[1].id.clone();
        st.save_date(DateInput { term_id: t2, kind: "final".into(), title: "Final suelto".into(), date: "2026-11-10".into(), ..Default::default() }).unwrap();
        let s = state_section(&st.data(), today);
        assert!(s.contains("Final suelto") && !s.contains("Sin materias ni fechas") && !s.contains("Solo materia"), "a date alone is something, and the other term stays out: {s}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_summary_lists_only_todays_classes_and_the_pending_dates_of_the_active_term() {
        let (st, dir) = store();
        let today = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap(); // Wednesday
        st.import(proposal()).unwrap(); // Análisis Mon+Wed 10-12, Física Tue 14-17
        let s = state_section(&st.data(), today);
        assert!(s.contains("Clases de hoy: Análisis I 10:00–12:00\n") && !s.contains("Física I 14:00"), "only Wednesday's class: {s}");
        let term = st.data().terms[0].id.clone();
        st.save_date(DateInput { term_id: term.clone(), kind: "tp".into(), title: "Ya entregado".into(), date: "2026-10-30".into(), done: true, ..Default::default() }).unwrap();
        st.save_date(DateInput { term_id: term.clone(), kind: "tp".into(), title: "Pendiente".into(), date: "2026-10-31".into(), ..Default::default() }).unwrap();
        let other = Proposal { term: Some(ProposalTerm { name: "Otro período".into(), kind: "otro".into(), ..Default::default() }), dates: vec![ProposalDate { course: None, kind: "final".into(), title: "De otro período".into(), date: "2026-10-31".into(), time: None, notes: String::new() }], ..Default::default() };
        st.import(other).unwrap();
        st.set_active(&term).unwrap();
        let s = state_section(&st.data(), today);
        assert!(s.contains("Pendiente") && !s.contains("Ya entregado") && !s.contains("De otro período"), "pending, active term only: {s}");
        std::fs::remove_dir_all(dir).ok();
    }
}
