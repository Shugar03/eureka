//! La malla de la carrera (AC-155…AC-157): the plan of studies, its
//! correlativas, which subjects are passed and the average. It is read from
//! the plan the person pastes (or photographs) into a proposal they confirm.
//!
//! Correlativas, as most Argentine universities use them: to **cursar** a
//! subject the ones in `para_cursar` must be at least regular (regular or
//! aprobada); to **rendir el final** the ones in `para_rendir` must be aprobadas.

use crate::graph::normalize;
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const TOOL: &str = "propose_curriculum";
pub const MAX_SUBJECTS: usize = 120;
const MAX_FAILED: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Pendiente,
    Cursando,
    Regular,
    Aprobada,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Subject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub code: String,
    /// Year of the plan (1 = primer año).
    pub year: u8,
    /// 1 or 2 (cuatrimestre); `None` when annual or not said.
    #[serde(default)]
    pub term: Option<u8>,
    #[serde(default)]
    pub para_cursar: Vec<String>,
    #[serde(default)]
    pub para_rendir: Vec<String>,
    #[serde(default)]
    pub status: Status,
    /// The final grade, when aprobada.
    #[serde(default)]
    pub grade: Option<f32>,
    /// Finals not passed (aplazos), for the average with them.
    #[serde(default)]
    pub failed: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Career {
    pub name: String,
    #[serde(default)]
    pub institution: String,
    pub subjects: Vec<Subject>,
}

// ── The proposal the model fills (names, not ids) ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProposalSubject {
    pub name: String,
    #[serde(default)]
    pub code: String,
    pub year: u8,
    #[serde(default)]
    pub term: Option<u8>,
    #[serde(default)]
    pub para_cursar: Vec<String>,
    #[serde(default)]
    pub para_rendir: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Proposal {
    pub name: String,
    #[serde(default)]
    pub institution: String,
    pub subjects: Vec<ProposalSubject>,
}

fn cut(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

/// The subject a correlativa points to: its code, or its name (normalized).
fn find_ref(subjects: &[ProposalSubject], r: &str) -> Option<usize> {
    let key = normalize(r);
    subjects
        .iter()
        .position(|s| !s.code.is_empty() && s.code.trim().eq_ignore_ascii_case(r.trim()))
        .or_else(|| subjects.iter().position(|s| normalize(&s.name) == key))
}

/// True when following the correlativas from some subject leads back to it.
fn has_cycle(edges: &[Vec<usize>]) -> Option<usize> {
    // 0 = not seen, 1 = on the current path, 2 = done.
    fn visit(i: usize, edges: &[Vec<usize>], mark: &mut [u8]) -> bool {
        match mark[i] {
            1 => return true,
            2 => return false,
            _ => {}
        }
        mark[i] = 1;
        if edges[i].iter().any(|&j| visit(j, edges, mark)) {
            return true;
        }
        mark[i] = 2;
        false
    }
    let mut mark = vec![0u8; edges.len()];
    (0..edges.len()).find(|&i| visit(i, edges, &mut mark))
}

/// Checks a proposal; errors are written for the model to fix (they go back
/// to it as the tool result).
pub fn check_proposal(mut p: Proposal) -> Result<Proposal> {
    p.name = cut(&p.name, 120);
    p.institution = cut(&p.institution, 120);
    if p.name.is_empty() {
        bail!("falta el nombre de la carrera (por ejemplo «Ingeniería en Sistemas de Información»)");
    }
    if p.subjects.is_empty() {
        bail!("la propuesta no tiene materias");
    }
    if p.subjects.len() > MAX_SUBJECTS {
        bail!("son demasiadas materias: hasta {MAX_SUBJECTS}");
    }
    let mut seen = HashSet::new();
    for s in &mut p.subjects {
        s.name = cut(&s.name, 120);
        s.code = cut(&s.code, 20);
        if s.name.is_empty() {
            bail!("hay una materia sin nombre");
        }
        if !(1..=8).contains(&s.year) {
            bail!("«{}»: el año tiene que ser de 1 a 8", s.name);
        }
        if s.term.is_some_and(|t| !(1..=2).contains(&t)) {
            bail!("«{}»: el cuatrimestre tiene que ser 1 o 2 (u omitido si es anual)", s.name);
        }
        if !seen.insert(normalize(&s.name)) {
            bail!("«{}» aparece dos veces", s.name);
        }
    }
    let mut edges = vec![Vec::new(); p.subjects.len()];
    for (i, s) in p.subjects.iter().enumerate() {
        for r in s.para_cursar.iter().chain(&s.para_rendir) {
            let Some(j) = find_ref(&p.subjects, r) else {
                bail!("«{}» tiene la correlativa «{r}», que no es ninguna materia de la propuesta: usá el nombre o el código exacto de otra materia", s.name);
            };
            if j == i {
                bail!("«{}» no puede ser correlativa de sí misma", s.name);
            }
            edges[i].push(j);
        }
    }
    if let Some(i) = has_cycle(&edges) {
        bail!("las correlativas forman un círculo que pasa por «{}»: revisalas", p.subjects[i].name);
    }
    Ok(p)
}

pub fn parse_proposal(raw: &str) -> Result<Proposal> {
    let p: Proposal = serde_json::from_str(raw).map_err(|e| anyhow!("la propuesta vino mal formada ({e})"))?;
    check_proposal(p)
}

pub fn parse_tool() -> Value {
    let refs = json!({ "type": "array", "items": { "type": "string" }, "description": "Nombres o códigos de otras materias de esta misma propuesta" });
    json!({ "type": "function", "function": {
        "name": TOOL,
        "description": "Devuelve el plan de estudios que hay en el texto, sin inventar nada.",
        "parameters": {
            "type": "object",
            "required": ["name", "subjects"],
            "properties": {
                "name": { "type": "string", "description": "Nombre de la carrera" },
                "institution": { "type": "string", "description": "Universidad o facultad, si figura" },
                "subjects": { "type": "array", "items": {
                    "type": "object",
                    "required": ["name", "year"],
                    "properties": {
                        "name": { "type": "string" },
                        "code": { "type": "string" },
                        "year": { "type": "integer", "minimum": 1, "maximum": 8 },
                        "term": { "type": "integer", "enum": [1, 2], "description": "Cuatrimestre; omitir si es anual" },
                        "para_cursar": refs.clone(),
                        "para_rendir": refs
                    }
                }}
            }
        }
    }})
}

/// Turns a checked proposal into a career, keeping what the person had
/// already marked (status, grades) for subjects with the same name or code.
pub fn from_proposal(p: Proposal, previous: Option<&Career>) -> Career {
    let ids: Vec<String> = p.subjects.iter().map(|_| uuid::Uuid::new_v4().simple().to_string()).collect();
    let resolve = |refs: &[String]| -> Vec<String> {
        let mut out: Vec<String> = refs.iter().filter_map(|r| find_ref(&p.subjects, r)).map(|j| ids[j].clone()).collect();
        out.dedup();
        out
    };
    let subjects = p
        .subjects
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let old = previous.and_then(|c| c.subjects.iter().find(|o| normalize(&o.name) == normalize(&s.name) || (!s.code.is_empty() && o.code.eq_ignore_ascii_case(&s.code))));
            Subject {
                id: ids[i].clone(),
                name: s.name.clone(),
                code: s.code.clone(),
                year: s.year,
                term: s.term,
                para_cursar: resolve(&s.para_cursar),
                para_rendir: resolve(&s.para_rendir),
                status: old.map(|o| o.status).unwrap_or_default(),
                grade: old.and_then(|o| o.grade),
                failed: old.map(|o| o.failed.clone()).unwrap_or_default(),
            }
        })
        .collect();
    Career { name: p.name, institution: p.institution, subjects }
}

// ── What the screen and the assistant see ──

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SubjectView {
    #[serde(flatten)]
    pub subject: Subject,
    /// Pendiente, and every correlativa para cursar is regular or aprobada.
    pub can_take: bool,
    /// Regular, and every correlativa para rendir is aprobada.
    pub can_sit_final: bool,
    /// The names of what is missing for the next step (cursar or rendir).
    pub missing: Vec<String>,
    /// A course with this name or code is in the active term of Mi cursada.
    pub in_cursada: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CareerView {
    pub name: String,
    pub institution: String,
    pub subjects: Vec<SubjectView>,
    pub approved: usize,
    pub total: usize,
    /// Average of the approved grades (sin aplazos).
    pub average: Option<f32>,
    /// Counting the failed finals too, only when there are any.
    pub average_with_failed: Option<f32>,
}

fn mean(xs: &[f32]) -> Option<f32> {
    (!xs.is_empty()).then(|| (xs.iter().sum::<f32>() / xs.len() as f32 * 100.0).round() / 100.0)
}

/// `cursada`: normalized names and codes of the active term's courses.
pub fn view(c: &Career, cursada: &[String]) -> CareerView {
    let by_id: HashMap<&str, &Subject> = c.subjects.iter().map(|s| (s.id.as_str(), s)).collect();
    let at_least_regular = |id: &String| by_id.get(id.as_str()).is_none_or(|s| matches!(s.status, Status::Regular | Status::Aprobada));
    let approved = |id: &String| by_id.get(id.as_str()).is_none_or(|s| s.status == Status::Aprobada);
    let name_of = |id: &String| by_id.get(id.as_str()).map(|s| s.name.clone());
    let subjects = c
        .subjects
        .iter()
        .map(|s| {
            let can_take = s.status == Status::Pendiente && s.para_cursar.iter().all(at_least_regular);
            let can_sit_final = s.status == Status::Regular && s.para_rendir.iter().all(approved);
            let missing = match s.status {
                Status::Pendiente => s.para_cursar.iter().filter(|id| !at_least_regular(*id)).filter_map(name_of).collect(),
                Status::Regular | Status::Cursando => s.para_rendir.iter().filter(|id| !approved(*id)).filter_map(name_of).collect(),
                Status::Aprobada => vec![],
            };
            let in_cursada = cursada.contains(&normalize(&s.name)) || (!s.code.is_empty() && cursada.contains(&normalize(&s.code)));
            SubjectView { subject: s.clone(), can_take, can_sit_final, missing, in_cursada }
        })
        .collect();
    let grades: Vec<f32> = c.subjects.iter().filter(|s| s.status == Status::Aprobada).filter_map(|s| s.grade).collect();
    let failed: Vec<f32> = c.subjects.iter().flat_map(|s| s.failed.iter().copied()).collect();
    let with_failed: Vec<f32> = grades.iter().chain(&failed).copied().collect();
    CareerView {
        name: c.name.clone(),
        institution: c.institution.clone(),
        subjects,
        approved: c.subjects.iter().filter(|s| s.status == Status::Aprobada).count(),
        total: c.subjects.len(),
        average: mean(&grades),
        average_with_failed: if failed.is_empty() { None } else { mean(&with_failed) },
    }
}

/// The active term's courses of Mi cursada, normalized (names and codes).
pub fn cursada_keys(d: &crate::academic::Data) -> Vec<String> {
    let Some(term) = d.active_term.as_deref() else { return vec![] };
    d.courses.iter().filter(|c| c.term_id == term).flat_map(|c| [normalize(&c.name), normalize(&c.code)]).filter(|k| !k.is_empty()).collect()
}

fn number(x: f32) -> String {
    let s = if x.fract() == 0.0 { format!("{x:.0}") } else { format!("{x:.2}").trim_end_matches('0').to_string() };
    s.replace('.', ",")
}

/// AC-157: a few lines for the assistant: progress, average and what is next.
pub fn state_section(v: &CareerView) -> String {
    if v.total == 0 {
        return String::new();
    }
    let mut out = format!("\n## Su carrera\n{}{}: {} de {} materias aprobadas", v.name, if v.institution.is_empty() { String::new() } else { format!(" ({})", v.institution) }, v.approved, v.total);
    if let Some(a) = v.average {
        out.push_str(&format!(", promedio {}", number(a)));
        if let Some(w) = v.average_with_failed {
            out.push_str(&format!(" ({} con aplazos)", number(w)));
        }
    }
    out.push_str(".\n");
    let list = |xs: Vec<&str>| {
        let more = xs.len().saturating_sub(8);
        let mut s = xs.into_iter().take(8).collect::<Vec<_>>().join(", ");
        if more > 0 {
            s.push_str(&format!(" y {more} más"));
        }
        s
    };
    let now: Vec<&str> = v.subjects.iter().filter(|s| s.subject.status == Status::Cursando || (s.in_cursada && s.subject.status == Status::Pendiente)).map(|s| s.subject.name.as_str()).collect();
    if !now.is_empty() {
        out.push_str(&format!("- Cursando: {}.\n", list(now)));
    }
    let finals: Vec<&str> = v.subjects.iter().filter(|s| s.can_sit_final).map(|s| s.subject.name.as_str()).collect();
    if !finals.is_empty() {
        out.push_str(&format!("- Puede rendir el final de: {}.\n", list(finals)));
    }
    let next: Vec<&str> = v.subjects.iter().filter(|s| s.can_take && !s.in_cursada).map(|s| s.subject.name.as_str()).collect();
    if !next.is_empty() {
        out.push_str(&format!("- Puede cursar: {}.\n", list(next)));
    }
    out
}

// ── Edits ──

#[derive(Debug, Clone, Deserialize, Default)]
pub struct SubjectInput {
    /// None adds a new subject.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub code: String,
    pub year: u8,
    #[serde(default)]
    pub term: Option<u8>,
    #[serde(default)]
    pub para_cursar: Vec<String>,
    #[serde(default)]
    pub para_rendir: Vec<String>,
    #[serde(default)]
    pub status: Status,
    #[serde(default)]
    pub grade: Option<f32>,
    #[serde(default)]
    pub failed: Vec<f32>,
}

fn check_grade(g: f32) -> Result<f32> {
    if !(0.0..=10.0).contains(&g) || g.is_nan() {
        bail!("La nota tiene que estar entre 0 y 10.");
    }
    Ok((g * 100.0).round() / 100.0)
}

/// Saves one subject (new or edited). Correlativas must be other subjects of
/// the career and must not make a circle.
pub fn save_subject(c: &mut Career, i: SubjectInput) -> Result<()> {
    let name = cut(&i.name, 120);
    if name.is_empty() {
        bail!("Poné el nombre de la materia.");
    }
    if !(1..=8).contains(&i.year) {
        bail!("El año tiene que ser de 1 a 8.");
    }
    if i.term.is_some_and(|t| !(1..=2).contains(&t)) {
        bail!("El cuatrimestre tiene que ser 1 o 2.");
    }
    let id = i.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    if c.subjects.iter().any(|s| s.id != id && normalize(&s.name) == normalize(&name)) {
        bail!("Ya hay una materia «{name}».");
    }
    let known: HashSet<&str> = c.subjects.iter().map(|s| s.id.as_str()).collect();
    for r in i.para_cursar.iter().chain(&i.para_rendir) {
        if r == &id || !known.contains(r.as_str()) {
            bail!("Una correlativa no es otra materia de la carrera.");
        }
    }
    let grade = match (i.status, i.grade) {
        (Status::Aprobada, Some(g)) => Some(check_grade(g)?),
        _ => None,
    };
    let failed = i.failed.iter().take(MAX_FAILED).map(|&g| check_grade(g)).collect::<Result<Vec<_>>>()?;
    let mut s = Subject { id: id.clone(), name, code: cut(&i.code, 20), year: i.year, term: i.term, para_cursar: i.para_cursar, para_rendir: i.para_rendir, status: i.status, grade, failed };
    s.para_cursar.dedup();
    s.para_rendir.dedup();
    let mut next = c.subjects.clone();
    match next.iter_mut().find(|x| x.id == id) {
        Some(x) => *x = s,
        None if i.id.is_some() => bail!("Esa materia ya no existe."),
        None => next.push(s),
    }
    let index: HashMap<&str, usize> = next.iter().enumerate().map(|(k, s)| (s.id.as_str(), k)).collect();
    let edges: Vec<Vec<usize>> = next.iter().map(|s| s.para_cursar.iter().chain(&s.para_rendir).filter_map(|r| index.get(r.as_str()).copied()).collect()).collect();
    if has_cycle(&edges).is_some() {
        bail!("Esas correlativas forman un círculo.");
    }
    c.subjects = next;
    Ok(())
}

/// Removes a subject and every correlativa that pointed to it.
pub fn delete_subject(c: &mut Career, id: &str) -> Result<()> {
    let before = c.subjects.len();
    c.subjects.retain(|s| s.id != id);
    if c.subjects.len() == before {
        bail!("Esa materia ya no existe.");
    }
    for s in &mut c.subjects {
        s.para_cursar.retain(|r| r != id);
        s.para_rendir.retain(|r| r != id);
    }
    Ok(())
}

// ── Store ──

pub struct CareerStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl CareerStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("academic").join("career.json"), lock: Mutex::new(()) }
    }

    pub fn get(&self) -> Option<Career> {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok())
    }

    fn write(&self, c: &Career) -> Result<()> {
        std::fs::create_dir_all(self.path.parent().unwrap())?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(c)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Replaces the plan (keeping the marks of subjects that are still there).
    pub fn set_plan(&self, p: Proposal) -> Result<Career> {
        let _g = self.lock.lock().unwrap();
        let p = check_proposal(p)?;
        let c = from_proposal(p, self.get().as_ref());
        self.write(&c)?;
        Ok(c)
    }

    pub fn update(&self, f: impl FnOnce(&mut Career) -> Result<()>) -> Result<Career> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.get().ok_or_else(|| anyhow!("Todavía no cargaste tu carrera."))?;
        f(&mut c)?;
        self.write(&c)?;
        Ok(c)
    }

    pub fn delete(&self) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        match std::fs::remove_file(&self.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subject(name: &str, year: u8, cursar: &[&str], rendir: &[&str]) -> ProposalSubject {
        ProposalSubject { name: name.into(), code: String::new(), year, term: None, para_cursar: cursar.iter().map(|s| s.to_string()).collect(), para_rendir: rendir.iter().map(|s| s.to_string()).collect() }
    }

    fn plan() -> Proposal {
        Proposal {
            name: "Ingeniería en Sistemas".into(),
            institution: "UTN FRBA".into(),
            subjects: vec![
                ProposalSubject { code: "AM1".into(), ..subject("Análisis Matemático I", 1, &[], &[]) },
                subject("Álgebra", 1, &[], &[]),
                subject("Análisis Matemático II", 2, &["AM1", "algebra"], &["Análisis Matemático I"]),
                subject("Probabilidad", 3, &["Análisis Matemático II"], &["Análisis Matemático II", "Álgebra"]),
            ],
        }
    }

    #[test]
    fn a_plan_is_checked_so_the_model_can_fix_it() {
        assert!(check_proposal(plan()).is_ok(), "correlativas by code or by name, accents aside");
        let mut p = plan();
        p.subjects[2].para_cursar.push("Física III".into());
        assert!(check_proposal(p).unwrap_err().to_string().contains("«Física III», que no es ninguna materia"));
        let mut p = plan();
        p.subjects[0].para_cursar.push("Probabilidad".into());
        assert!(check_proposal(p).unwrap_err().to_string().contains("círculo"));
        let mut p = plan();
        p.subjects[1].para_rendir.push("Álgebra".into());
        assert!(check_proposal(p).unwrap_err().to_string().contains("sí misma"));
        let mut p = plan();
        p.subjects[3].year = 9;
        assert!(check_proposal(p).is_err());
        let mut p = plan();
        p.subjects.push(subject("ALGEBRA", 1, &[], &[]));
        assert!(check_proposal(p).unwrap_err().to_string().contains("dos veces"));
        assert!(check_proposal(Proposal { name: "X".into(), ..Default::default() }).is_err());
    }

    fn marked() -> Career {
        let mut c = from_proposal(check_proposal(plan()).unwrap(), None);
        c.subjects[0].status = Status::Aprobada;
        c.subjects[0].grade = Some(8.0);
        c.subjects[0].failed = vec![2.0];
        c.subjects[1].status = Status::Regular;
        c
    }

    #[test]
    fn what_can_be_taken_and_sat_follows_the_correlativas() {
        let v = view(&marked(), &[]);
        let s = |name: &str| v.subjects.iter().find(|s| s.subject.name == name).unwrap();
        assert!(s("Análisis Matemático II").can_take, "AM1 aprobada and Álgebra regular are enough to cursar");
        assert!(s("Álgebra").can_sit_final);
        assert!(!s("Probabilidad").can_take);
        assert_eq!(s("Probabilidad").missing, vec!["Análisis Matemático II"]);
        assert!(!s("Análisis Matemático I").can_take, "already passed");
        assert_eq!((v.approved, v.total), (1, 4));
        assert_eq!(v.average, Some(8.0));
        assert_eq!(v.average_with_failed, Some(5.0), "8 and the 2 of the aplazo");
    }

    #[test]
    fn a_regular_subject_waits_for_its_correlativas_to_be_passed_before_the_final() {
        let mut c = marked();
        c.subjects[2].status = Status::Regular;
        c.subjects[3].status = Status::Regular;
        let v = view(&c, &[]);
        assert!(v.subjects[2].can_sit_final, "AM1 is aprobada");
        assert!(!v.subjects[3].can_sit_final);
        assert_eq!(v.subjects[3].missing, vec!["Análisis Matemático II", "Álgebra"]);
    }

    #[test]
    fn reloading_the_plan_keeps_what_was_marked() {
        let old = marked();
        let mut p = plan();
        p.subjects[0].name = "Análisis Matemático 1".into(); // same code, new name
        p.subjects[2].para_rendir = vec!["AM1".into()];
        p.subjects.push(subject("Física I", 1, &[], &[]));
        let c = from_proposal(check_proposal(p).unwrap(), Some(&old));
        assert_eq!(c.subjects[0].status, Status::Aprobada, "found by its code");
        assert_eq!(c.subjects[0].grade, Some(8.0));
        assert_eq!(c.subjects[1].status, Status::Regular, "found by its name");
        assert_eq!(c.subjects[4].status, Status::Pendiente);
        assert_eq!(c.subjects[2].para_cursar, vec![c.subjects[0].id.clone(), c.subjects[1].id.clone()]);
    }

    #[test]
    fn a_subject_in_mi_cursada_shows_up_as_being_taken() {
        let c = marked();
        let v = view(&c, &[normalize("análisis matemático ii")]);
        assert!(v.subjects[2].in_cursada);
        let text = state_section(&v);
        assert!(text.contains("Ingeniería en Sistemas (UTN FRBA): 1 de 4 materias aprobadas, promedio 8 (5 con aplazos)."), "{text}");
        assert!(text.contains("- Cursando: Análisis Matemático II."), "{text}");
        assert!(text.contains("- Puede rendir el final de: Álgebra."), "{text}");
        assert!(!text.contains("Puede cursar: Análisis Matemático II"), "already in Mi cursada");
        assert_eq!(state_section(&view(&Career::default(), &[])), "");
    }

    #[test]
    fn edits_are_checked_and_deleting_cleans_the_correlativas() {
        let mut c = marked();
        let (am1, am2) = (c.subjects[0].id.clone(), c.subjects[2].id.clone());
        let edit = |s: &Subject| SubjectInput { id: Some(s.id.clone()), name: s.name.clone(), code: s.code.clone(), year: s.year, term: s.term, para_cursar: s.para_cursar.clone(), para_rendir: s.para_rendir.clone(), status: s.status, grade: s.grade, failed: s.failed.clone() };
        let mut i = edit(&c.subjects[2]);
        i.status = Status::Aprobada;
        i.grade = Some(9.456);
        save_subject(&mut c, i).unwrap();
        assert_eq!(c.subjects[2].grade, Some(9.46));
        let mut i = edit(&c.subjects[0]);
        i.para_cursar = vec![am2.clone()];
        assert!(save_subject(&mut c, i).unwrap_err().to_string().contains("círculo"));
        let mut i = edit(&c.subjects[1]);
        i.grade = Some(11.0);
        i.status = Status::Aprobada;
        assert!(save_subject(&mut c, i).is_err());
        let mut i = edit(&c.subjects[1]);
        i.status = Status::Regular;
        i.grade = Some(7.0);
        save_subject(&mut c, i).unwrap();
        assert_eq!(c.subjects[1].grade, None, "a grade only for an aprobada");
        assert!(save_subject(&mut c, SubjectInput { name: "álgebra".into(), year: 1, ..Default::default() }).unwrap_err().to_string().contains("Ya hay"));
        save_subject(&mut c, SubjectInput { name: "Física I".into(), year: 1, para_cursar: vec![am1.clone()], ..Default::default() }).unwrap();
        assert_eq!(c.subjects.len(), 5);
        delete_subject(&mut c, &am1).unwrap();
        assert!(c.subjects.iter().all(|s| !s.para_cursar.contains(&am1) && !s.para_rendir.contains(&am1)));
        assert!(delete_subject(&mut c, &am1).is_err());
    }

    #[test]
    fn the_store_keeps_one_career() {
        let dir = std::env::temp_dir().join(format!("la-career-{}", uuid::Uuid::new_v4().simple()));
        let st = CareerStore::new(&dir);
        assert!(st.get().is_none());
        assert!(st.update(|_| Ok(())).is_err());
        let c = st.set_plan(plan()).unwrap();
        assert_eq!(st.get().unwrap(), c);
        st.update(|c| {
            c.subjects[0].status = Status::Aprobada;
            Ok(())
        })
        .unwrap();
        assert_eq!(st.set_plan(plan()).unwrap().subjects[0].status, Status::Aprobada, "a new plan keeps the marks");
        st.delete().unwrap();
        assert!(st.get().is_none());
        st.delete().unwrap();
        std::fs::remove_dir_all(dir).ok();
    }
}
