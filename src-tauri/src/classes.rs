//! AC-146, AC-147: recorded classes. The microphone records in parts of
//! under a minute; each part is transcribed (Whisper on this PC, or the
//! configured Voz) and appended here as it arrives, so a closed app never
//! loses more than the part in flight. Once the class is over, the model
//! turns the transcript into notes: a summary, key points, doubts and the
//! dates the teacher announced.

use crate::agent::Role;
use crate::AppState;
use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const TOOL: &str = "class_notes";
/// About eight hours of speech.
const MAX_TRANSCRIPT: usize = 400_000;
const MAX_PART: usize = 20_000;
/// What the notes call reads: the start and the end of a very long class.
const MAX_NOTES_INPUT: usize = 120_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnouncedDate {
    pub title: String,
    /// "YYYY-MM-DD", or empty if the teacher didn't say the day.
    #[serde(default)]
    pub date: String,
    /// One of `academic::DATE_KINDS`.
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClassNotes {
    /// Markdown notes, organized by topic.
    pub summary: String,
    #[serde(default)]
    pub key_points: Vec<String>,
    /// Doubts and what to review: things left unclear in the class.
    #[serde(default)]
    pub questions: Vec<String>,
    #[serde(default)]
    pub dates: Vec<AnnouncedDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassRecord {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub course_id: Option<String>,
    /// Local day of the class.
    pub day: String,
    pub started_at: DateTime<Utc>,
    /// Seconds recorded (sum of the parts).
    #[serde(default)]
    pub seconds: u32,
    #[serde(default)]
    pub parts: u32,
    #[serde(default)]
    pub transcript: String,
    #[serde(default)]
    pub notes: Option<ClassNotes>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClassSummary {
    pub id: String,
    pub title: String,
    pub course_id: Option<String>,
    pub day: String,
    pub seconds: u32,
    pub parts: u32,
    pub has_notes: bool,
}

pub struct ClassStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

fn cut(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

impl ClassStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("classes"), lock: Mutex::new(()) }
    }

    fn path(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            bail!("clase inválida");
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    pub fn get(&self, id: &str) -> Result<ClassRecord> {
        let text = std::fs::read_to_string(self.path(id)?).map_err(|_| anyhow!("Esa clase ya no existe."))?;
        Ok(serde_json::from_str(&text)?)
    }

    fn save(&self, c: &ClassRecord) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let p = self.path(&c.id)?;
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(c)?)?;
        std::fs::rename(tmp, p)?;
        Ok(())
    }

    pub fn start(&self, title: &str, course_id: Option<String>, day: &str) -> Result<ClassRecord> {
        if !crate::academic::valid_date(day) {
            bail!("La fecha de la clase tiene que ser AAAA-MM-DD.");
        }
        let title = cut(title, 120);
        let c = ClassRecord {
            id: uuid::Uuid::new_v4().simple().to_string(),
            title: if title.is_empty() { "Clase".into() } else { title },
            course_id: course_id.filter(|c| !c.trim().is_empty()),
            day: day.to_string(),
            started_at: Utc::now(),
            seconds: 0,
            parts: 0,
            transcript: String::new(),
            notes: None,
        };
        let _g = self.lock.lock().unwrap();
        self.save(&c)?;
        Ok(c)
    }

    /// One transcribed part. Empty parts (silence) only add their seconds.
    pub fn append(&self, id: &str, text: &str, seconds: u32) -> Result<ClassRecord> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.get(id)?;
        let text = cut(text, MAX_PART);
        if c.transcript.len() + text.len() > MAX_TRANSCRIPT {
            bail!("La clase ya es muy larga: terminala y empezá otra.");
        }
        if !text.is_empty() {
            if !c.transcript.is_empty() {
                c.transcript.push(' ');
            }
            c.transcript.push_str(&text);
        }
        c.parts += 1;
        c.seconds += seconds.min(600);
        self.save(&c)?;
        Ok(c)
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<ClassRecord> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.get(id)?;
        let title = cut(title, 120);
        if title.is_empty() {
            bail!("Poné un nombre a la clase.");
        }
        c.title = title;
        self.save(&c)?;
        Ok(c)
    }

    fn set_notes(&self, id: &str, notes: ClassNotes) -> Result<ClassRecord> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.get(id)?;
        c.notes = Some(notes);
        self.save(&c)?;
        Ok(c)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let p = self.path(id)?;
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        Ok(())
    }

    /// Newest first.
    pub fn list(&self) -> Vec<ClassSummary> {
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return Vec::new() };
        let mut out: Vec<(DateTime<Utc>, ClassSummary)> = rd
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|t| serde_json::from_str::<ClassRecord>(&t).ok())
            .map(|c| (c.started_at, ClassSummary { id: c.id, title: c.title, course_id: c.course_id, day: c.day, seconds: c.seconds, parts: c.parts, has_notes: c.notes.is_some() }))
            .collect();
        out.sort_by(|a, b| b.0.cmp(&a.0));
        out.into_iter().map(|(_, s)| s).collect()
    }
}

pub fn tool() -> Value {
    json!({ "type": "function", "function": { "name": TOOL, "description": "Devuelve los apuntes de la clase, sacados solo de la transcripción.", "parameters": {
        "type": "object",
        "properties": {
            "summary": { "type": "string", "description": "Apuntes en Markdown, ordenados por tema (### por tema, viñetas). Con las definiciones, fórmulas y ejemplos que se dieron." },
            "key_points": { "type": "array", "items": { "type": "string" }, "description": "De 3 a 8 ideas clave, una oración cada una." },
            "questions": { "type": "array", "items": { "type": "string" }, "description": "Dudas: lo que quedó confuso, cortado o para repasar. Vacío si no hay." },
            "dates": { "type": "array", "items": { "type": "object", "properties": {
                "title": { "type": "string" },
                "date": { "type": "string", "description": "AAAA-MM-DD, o vacío si no dijo el día" },
                "kind": { "type": "string", "enum": crate::academic::DATE_KINDS }
            }, "required": ["title", "kind"] }, "description": "Fechas o tareas que anunció el docente (parciales, entregas, TPs)." }
        },
        "required": ["summary", "key_points"]
    } } })
}

/// The transcript the model reads: all of it, or the start and the end of a very long one.
pub fn notes_input(c: &ClassRecord, course: Option<&str>, today: &str) -> String {
    let t = &c.transcript;
    let body = if t.len() <= MAX_NOTES_INPUT {
        t.clone()
    } else {
        let half = MAX_NOTES_INPUT / 2;
        let mut a = half;
        while !t.is_char_boundary(a) {
            a -= 1;
        }
        let mut b = t.len() - half;
        while !t.is_char_boundary(b) {
            b += 1;
        }
        format!("{}\n[… parte del medio recortada …]\n{}", &t[..a], &t[b..])
    };
    let course = course.map(|n| format!("Materia: {n}\n")).unwrap_or_default();
    format!("Clase: {}\n{course}Fecha de la clase: {} (hoy es {today})\nDuración grabada: {} min\n\n## Transcripción (automática, puede tener errores)\n{body}", c.title, c.day, c.seconds / 60)
}

pub fn parse_notes(raw: &str) -> Result<ClassNotes> {
    let mut n: ClassNotes = serde_json::from_str(raw).map_err(|e| anyhow!("los apuntes vinieron mal formados: {e}"))?;
    n.summary = n.summary.trim().to_string();
    if n.summary.chars().count() < 40 {
        bail!("el resumen está vacío o es demasiado corto: escribí los apuntes de la clase");
    }
    let clean = |v: Vec<String>, max: usize| v.into_iter().map(|s| cut(&s, 300)).filter(|s| !s.is_empty()).take(max).collect::<Vec<_>>();
    n.key_points = clean(n.key_points, 8);
    n.questions = clean(n.questions, 8);
    n.dates = n
        .dates
        .into_iter()
        .filter(|d| !d.title.trim().is_empty())
        .map(|d| AnnouncedDate {
            title: cut(&d.title, 120),
            date: if crate::academic::valid_date(d.date.trim()) { d.date.trim().to_string() } else { String::new() },
            kind: if crate::academic::DATE_KINDS.contains(&d.kind.as_str()) { d.kind } else { "otro".into() },
        })
        .take(10)
        .collect();
    Ok(n)
}

/// AC-147: turns the transcript into notes (one model call with the forced tool).
pub async fn make_notes(state: &AppState, id: &str, today: &str) -> Result<ClassRecord> {
    let c = state.classes.get(id)?;
    if c.transcript.trim().chars().count() < 80 {
        bail!("Todavía hay muy poco transcripto para armar apuntes.");
    }
    let data = state.academic.data();
    let course = c.course_id.as_ref().and_then(|cid| data.courses.iter().find(|x| &x.id == cid)).map(|x| x.name.clone());
    let notes = crate::practice::forced_valid(state, Role::Practice, "class_notes", tool(), TOOL, notes_input(&c, course.as_deref(), today), parse_notes).await?;
    state.classes.set_notes(id, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (ClassStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-classes-{}", uuid::Uuid::new_v4().simple()));
        (ClassStore::new(&dir), dir)
    }

    #[test]
    fn a_class_grows_part_by_part_and_is_listed_newest_first() {
        let (st, dir) = store();
        assert!(st.start("x", None, "29/10").is_err());
        let a = st.start("  Análisis · teórica  ", Some("c1".into()), "2026-10-29").unwrap();
        assert_eq!((a.title.as_str(), a.course_id.as_deref()), ("Análisis · teórica", Some("c1")));
        st.append(&a.id, "Hoy vemos límites.", 55).unwrap();
        st.append(&a.id, "   ", 55).unwrap();
        let a = st.append(&a.id, "Un límite describe a qué valor se acerca una función.", 30).unwrap();
        assert_eq!(a.transcript, "Hoy vemos límites. Un límite describe a qué valor se acerca una función.");
        assert_eq!((a.parts, a.seconds), (3, 140), "silence still counts its time");
        let b = st.start("", None, "2026-10-30").unwrap();
        assert_eq!(b.title, "Clase");
        let list = st.list();
        assert_eq!(list.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec![b.id.as_str(), a.id.as_str()]);
        assert!(!list[1].has_notes);
        assert!(st.get("../x").is_err() && st.append("nope", "x", 1).is_err());
        st.delete(&b.id).unwrap();
        assert_eq!(st.list().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn notes_are_checked_and_cleaned() {
        assert!(parse_notes(r#"{"summary":"corto","key_points":[]}"#).is_err());
        let n = parse_notes(r####"{"summary":"### Límites\n- Un límite describe a qué valor se acerca f(x) cuando x se acerca a a.","key_points":["Límite: a qué se acerca f", " "],"questions":["La definición formal quedó cortada"],"dates":[{"title":"Primer parcial","date":"2026-11-12","kind":"parcial"},{"title":"TP 2","date":"el jueves","kind":"tarea"},{"title":" ","kind":"otro"}]}"####).unwrap();
        assert_eq!(n.key_points, vec!["Límite: a qué se acerca f"]);
        assert_eq!(n.dates, vec![AnnouncedDate { title: "Primer parcial".into(), date: "2026-11-12".into(), kind: "parcial".into() }, AnnouncedDate { title: "TP 2".into(), date: "".into(), kind: "otro".into() }]);
    }

    #[test]
    fn a_very_long_class_keeps_its_start_and_its_end() {
        let mut c = ClassRecord { id: "a".into(), title: "T".into(), course_id: None, day: "2026-10-29".into(), started_at: Utc::now(), seconds: 7200, parts: 0, transcript: String::new(), notes: None };
        c.transcript = format!("COMIENZO {} FINAL", "ñ".repeat(MAX_NOTES_INPUT));
        let input = notes_input(&c, Some("Física I"), "2026-10-29");
        assert!(input.contains("COMIENZO") && input.contains("FINAL") && input.contains("recortada"));
        assert!(input.contains("Materia: Física I") && input.contains("Duración grabada: 120 min"));
        assert!(input.len() < MAX_NOTES_INPUT + 1000);
    }

    #[test]
    fn a_transcript_has_a_ceiling() {
        let (st, dir) = store();
        let c = st.start("Larga", None, "2026-10-29").unwrap();
        let part = "a".repeat(MAX_PART);
        for _ in 0..(MAX_TRANSCRIPT / MAX_PART - 1) {
            st.append(&c.id, &part, 55).unwrap();
        }
        assert!(st.append(&c.id, &part, 55).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
