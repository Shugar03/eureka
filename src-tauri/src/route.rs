//! Learning routes (AC-214..AC-217): a course of many classes towards a goal.
//!
//! The teacher only gathers what the person wants (topic, purpose, level, hours)
//! and calls `propose_route`. The route itself is planned here, by a model that
//! still thinks (the live teacher answers without thinking since AC-212), from
//! real search results about how the topic is taught: university syllabi and
//! known courses. Only sources the planner actually used reach the card, with
//! their real URLs. Nothing is created until the person confirms.
//!
//! Each class becomes a session when it is started; whether it is done is read
//! from that session (no second truth).

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agent::Role;
use crate::research::{self, Hit};
use crate::session::{Phase, Session};
use crate::AppState;

pub const TOOL: &str = "propose_route";
const PLAN_TOOL: &str = "set_route";

const MAX_UNITS: usize = 8;
const MIN_CLASSES: usize = 3;
const MAX_CLASSES: usize = 30;
const MIN_MINUTES: u32 = 15;
const MAX_MINUTES: u32 = 180;
/// Searches per route (each is a deep web search).
const MAX_QUERIES: usize = 5;
/// Pages the planner reads, and how much of each.
const MAX_HITS: usize = 8;
const HIT_CHARS: usize = 3000;

// ── Data ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClassKind {
    #[default]
    Normal,
    /// Added by the route when something was hard (a futuro).
    Refuerzo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteClass {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub topics: Vec<String>,
    pub minutes: u32,
    /// The person already masters it: the route skips it.
    #[serde(default)]
    pub known: bool,
    #[serde(default)]
    pub kind: ClassKind,
    /// The session of this class, once started.
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteUnit {
    pub id: String,
    pub title: String,
    pub classes: Vec<RouteClass>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteSource {
    pub title: String,
    pub url: String,
}

/// What the route changed by itself, said to the person.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Adjustment {
    pub kind: String,
    pub text: String,
    pub at: DateTime<Utc>,
}

/// What the card shows; the person can edit it before creating the route.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteProposal {
    pub title: String,
    pub goal: String,
    #[serde(default)]
    pub purpose: String,
    pub hours_per_week: f64,
    #[serde(default)]
    pub deadline: Option<String>,
    pub units: Vec<RouteUnit>,
    #[serde(default)]
    pub sources: Vec<RouteSource>,
    /// Built from a web search (false: from what the model knows; the card says so).
    #[serde(default)]
    pub researched: bool,
    /// A line from the planner about the choices it made.
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Route {
    pub id: String,
    pub title: String,
    pub goal: String,
    #[serde(default)]
    pub purpose: String,
    pub hours_per_week: f64,
    #[serde(default)]
    pub deadline: Option<String>,
    pub units: Vec<RouteUnit>,
    #[serde(default)]
    pub sources: Vec<RouteSource>,
    #[serde(default)]
    pub researched: bool,
    #[serde(default)]
    pub adjustments: Vec<Adjustment>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Where a class stands, read from its session.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClassState {
    Done,
    /// Skipped: the person already knew it.
    Known,
    /// The next one to take.
    Current,
    /// Started but not finished (only the current one counts as next).
    Started,
    Todo,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClassView {
    #[serde(flatten)]
    pub class: RouteClass,
    pub state: ClassState,
    /// 1-based position among the classes to take (known ones don't count).
    pub number: usize,
    pub done_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UnitView {
    pub id: String,
    pub title: String,
    pub classes: Vec<ClassView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RouteView {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub purpose: String,
    pub hours_per_week: f64,
    pub deadline: Option<String>,
    pub sources: Vec<RouteSource>,
    pub researched: bool,
    pub adjustments: Vec<Adjustment>,
    pub units: Vec<UnitView>,
    /// Classes to take (not known), and how many are done.
    pub total: usize,
    pub done: usize,
    pub minutes_left: u32,
    pub current: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// What a session of a route carries (AC-216).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteLink {
    pub route_id: String,
    pub class_id: String,
}

// ── Store ──────────────────────────────────────────────────────────────────

pub struct RouteStore {
    dir: PathBuf,
}

impl RouteStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("routes") }
    }

    fn path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<Route> {
        Ok(serde_json::from_str(&std::fs::read_to_string(self.path(id)).context("ruta no encontrada")?)?)
    }

    pub fn save(&self, r: &mut Route) -> Result<()> {
        r.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&r.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(r)?)?;
        std::fs::rename(tmp, self.path(&r.id))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    pub fn all(&self) -> Vec<Route> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<Route> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|t| serde_json::from_str(&t).ok())
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }
}

// ── The teacher's call ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct ProposeArgs {
    pub topic: String,
    #[serde(default)]
    pub purpose: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub hours_per_week: Option<f64>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub queries: Vec<String>,
}

pub fn tool_definition() -> Value {
    json!({ "type": "function", "function": {
        "name": TOOL,
        "description": "Arma una ruta de aprendizaje de varias clases (un curso) para un tema amplio. La app investiga cómo se enseña (programas de universidades, cursos conocidos) y planifica las clases; vos solo pasás lo que la persona dijo. Se le muestra una tarjeta que puede editar y la crea si confirma.",
        "parameters": { "type": "object", "properties": {
            "topic": { "type": "string", "description": "El tema, corto: «Machine Learning», «Historia argentina del siglo XX»." },
            "purpose": { "type": "string", "description": "Para qué lo quiere, en sus palabras." },
            "level": { "type": "string", "description": "Qué sabe ya o desde dónde arranca." },
            "hours_per_week": { "type": "number", "description": "Horas por semana que dijo; si no dijo, omitilo." },
            "deadline": { "type": "string", "description": "Fecha límite AAAA-MM-DD si la dijo." },
            "queries": { "type": "array", "items": { "type": "string" }, "description": "Opcional: hasta 2 búsquedas extra si nombró un curso, una universidad o un enfoque." }
        }, "required": ["topic"] }
    }})
}

pub fn parse_args(raw: &str) -> Result<ProposeArgs> {
    let a: ProposeArgs = serde_json::from_str(raw).map_err(|e| anyhow!("argumentos inválidos: {e}"))?;
    if a.topic.trim().is_empty() {
        bail!("propose_route necesita {{\"topic\": \"…\"}}");
    }
    if let Some(h) = a.hours_per_week {
        if !(0.5..=60.0).contains(&h) {
            bail!("hours_per_week tiene que ir de 0,5 a 60");
        }
    }
    if let Some(d) = a.deadline.as_deref().filter(|d| !d.is_empty()) {
        if d.parse::<chrono::NaiveDate>().is_err() {
            bail!("deadline va como AAAA-MM-DD");
        }
    }
    Ok(a)
}

/// The searches about how the topic is taught: universities and known courses,
/// in Spanish and in English, plus what the teacher added.
pub fn queries(a: &ProposeArgs) -> Vec<String> {
    let t = a.topic.trim();
    let mut q = vec![
        format!("{t} programa de la materia universidad unidades temario"),
        format!("{t} university course syllabus lectures"),
        format!("{t} best online course curriculum modules"),
    ];
    q.extend(a.queries.iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(2));
    q.truncate(MAX_QUERIES);
    q
}

/// The pages the planner reads: no junk, no repeats, the best first.
pub fn pick_hits(mut hits: Vec<Hit>) -> Vec<Hit> {
    hits.retain(|h| !research::junk(&h.url));
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| seen.insert(h.url.trim_end_matches('/').to_lowercase()));
    hits.truncate(MAX_HITS);
    hits
}

/// What the planner reads: the person, what they already master, and the pages.
pub fn plan_input(a: &ProposeArgs, mastered: &[String], hard: &[String], hits: &[Hit]) -> String {
    let mut s = format!("Tema: {}\n", a.topic.trim());
    if !a.purpose.trim().is_empty() {
        s.push_str(&format!("Para qué: {}\n", a.purpose.trim()));
    }
    if !a.level.trim().is_empty() {
        s.push_str(&format!("Desde dónde arranca: {}\n", a.level.trim()));
    }
    match a.hours_per_week {
        Some(h) => s.push_str(&format!("Horas por semana: {h}\n")),
        None => s.push_str("Horas por semana: no lo dijo (pensá en unas 4)\n"),
    }
    if let Some(d) = a.deadline.as_deref().filter(|d| !d.is_empty()) {
        s.push_str(&format!("Fecha límite: {d}\n"));
    }
    if !mastered.is_empty() {
        s.push_str(&format!("\n## Lo que ya domina (según Eureka)\n{}\n", mastered.iter().map(|m| format!("- {m}")).collect::<Vec<_>>().join("\n")));
    }
    if !hard.is_empty() {
        s.push_str(&format!("\n## Lo que le cuesta\n{}\n", hard.iter().map(|m| format!("- {m}")).collect::<Vec<_>>().join("\n")));
    }
    if hits.is_empty() {
        s.push_str("\n## Resultados de búsqueda\n(no hubo búsqueda: armala con lo que sabés de cómo se enseña el tema y dejá `used` vacío)\n");
    } else {
        s.push_str("\n## Resultados de búsqueda\n");
        for (i, h) in hits.iter().enumerate() {
            let text = h.raw_content.as_deref().filter(|r| !r.trim().is_empty()).unwrap_or(&h.content);
            let text: String = text.chars().take(HIT_CHARS).collect();
            s.push_str(&format!("\n### [{}] {}\n{}\n{}\n", i + 1, h.title, h.url, text));
        }
    }
    s
}

pub fn plan_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": PLAN_TOOL,
        "description": "Entrega la ruta: unidades en orden, cada una con sus clases.",
        "parameters": { "type": "object", "properties": {
            "title": { "type": "string", "description": "Nombre corto de la ruta (3 a 6 palabras)." },
            "goal": { "type": "string", "description": "Qué va a poder hacer al terminar, en una oración." },
            "units": { "type": "array", "items": { "type": "object", "properties": {
                "title": { "type": "string" },
                "classes": { "type": "array", "items": { "type": "object", "properties": {
                    "title": { "type": "string", "description": "El tema de la clase, corto." },
                    "topics": { "type": "array", "items": { "type": "string" }, "description": "2 a 5 ideas que cubre." },
                    "minutes": { "type": "integer", "description": "Duración estimada: 30 a 120." },
                    "known": { "type": "boolean", "description": "true si ya la domina según Eureka: la ruta la saltea." }
                }, "required": ["title", "topics", "minutes"] } }
            }, "required": ["title", "classes"] } },
            "used": { "type": "array", "items": { "type": "integer" }, "description": "Números de los resultados que usaste de verdad." },
            "note": { "type": "string", "description": "Una oración: en qué se basó y qué decidiste (para mostrarle a la persona)." }
        }, "required": ["title", "goal", "units", "used"] }
    }})
}

#[derive(Debug, Deserialize)]
struct RawClass {
    title: String,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    minutes: Option<i64>,
    #[serde(default)]
    known: bool,
}

#[derive(Debug, Deserialize)]
struct RawUnit {
    title: String,
    #[serde(default)]
    classes: Vec<RawClass>,
}

#[derive(Debug, Deserialize)]
struct RawPlan {
    title: String,
    goal: String,
    units: Vec<RawUnit>,
    #[serde(default)]
    used: Vec<i64>,
    #[serde(default)]
    note: String,
}

/// Checks the planner's answer and turns it into a proposal. Its errors go back
/// to the planner (forced_valid), so they say what to fix.
pub fn parse_plan(raw: &str, a: &ProposeArgs, hits: &[Hit]) -> Result<RouteProposal> {
    let p: RawPlan = serde_json::from_str(raw).map_err(|e| anyhow!("JSON inválido: {e}"))?;
    if p.title.trim().is_empty() || p.goal.trim().is_empty() {
        bail!("faltan title o goal");
    }
    let units: Vec<RawUnit> = p.units.into_iter().filter(|u| !u.title.trim().is_empty() && !u.classes.is_empty()).collect();
    if units.is_empty() || units.len() > MAX_UNITS {
        bail!("tiene que haber de 1 a {MAX_UNITS} unidades con clases");
    }
    let total: usize = units.iter().map(|u| u.classes.len()).sum();
    if !(MIN_CLASSES..=MAX_CLASSES).contains(&total) {
        bail!("tiene que haber de {MIN_CLASSES} a {MAX_CLASSES} clases en total (hay {total})");
    }
    let mut n = 0;
    let units = units
        .into_iter()
        .enumerate()
        .map(|(ui, u)| RouteUnit {
            id: format!("u{}", ui + 1),
            title: clean(&u.title, 80),
            classes: u
                .classes
                .into_iter()
                .filter(|c| !c.title.trim().is_empty())
                .map(|c| {
                    n += 1;
                    RouteClass {
                        id: format!("c{n}"),
                        title: clean(&c.title, 100),
                        topics: c.topics.iter().map(|t| clean(t, 100)).filter(|t| !t.is_empty()).take(6).collect(),
                        minutes: c.minutes.unwrap_or(60).clamp(MIN_MINUTES as i64, MAX_MINUTES as i64) as u32,
                        known: c.known,
                        kind: ClassKind::Normal,
                        session_id: None,
                    }
                })
                .collect(),
        })
        .collect();
    let mut sources: Vec<RouteSource> = Vec::new();
    for i in p.used {
        let Some(h) = usize::try_from(i).ok().and_then(|i| i.checked_sub(1)).and_then(|i| hits.get(i)) else { continue };
        if !sources.iter().any(|s| s.url == h.url) {
            sources.push(RouteSource { title: clean(&h.title, 90), url: h.url.clone() });
        }
    }
    Ok(RouteProposal {
        title: clean(&p.title, 60),
        goal: clean(&p.goal, 200),
        purpose: a.purpose.trim().to_string(),
        hours_per_week: a.hours_per_week.unwrap_or(4.0),
        deadline: a.deadline.clone().filter(|d| !d.is_empty()),
        units,
        sources,
        researched: !hits.is_empty(),
        note: clean(&p.note, 240),
    })
}

fn clean(s: &str, max: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= max {
        return s;
    }
    let cut: String = s.chars().take(max).collect();
    let at = cut.rfind(' ').filter(|&i| i > max / 2).unwrap_or(cut.len());
    format!("{}…", cut[..at].trim_end())
}

/// Searches how the topic is taught and plans the route. Without a search key it
/// still plans (the card says it was not researched); it never breaks the turn.
pub async fn propose(state: &AppState, a: &ProposeArgs) -> Result<RouteProposal> {
    let model = crate::student::model(state, chrono::Local::now().date_naive());
    let mastered: Vec<String> = model.topics.iter().filter(|t| t.status == crate::student::Status::Domina).map(|t| t.name.clone()).take(25).collect();
    let hard: Vec<String> = model.topics.iter().filter(|t| t.status == crate::student::Status::LeCuesta).map(|t| t.name.clone()).take(10).collect();
    let settings = state.settings.load();
    let key = state.settings.keys().get(crate::settings::SEARCH_KEY).filter(|k| !k.is_empty()).cloned();
    let hits = match key {
        Some(key) => {
            let base = settings.search.base_url.clone();
            let found = futures_util::future::join_all(queries(a).iter().map(|q| research::search_with(&base, &key, q, true, "advanced"))).await;
            pick_hits(found.into_iter().filter_map(|r| r.ok()).flatten().collect())
        }
        None => vec![],
    };
    let input = plan_input(a, &mastered, &hard, &hits);
    crate::practice::forced_valid(state, Role::Extractor, "route_plan", plan_tool(), PLAN_TOOL, input, |raw| parse_plan(raw, a, &hits)).await
}

/// What the teacher hears back: a short summary to comment on, never the whole plan.
pub fn for_teacher(p: &RouteProposal) -> String {
    let classes: usize = p.units.iter().map(|u| u.classes.len()).sum();
    let known: Vec<&str> = p.units.iter().flat_map(|u| &u.classes).filter(|c| c.known).map(|c| c.title.as_str()).collect();
    let mut s = format!(
        "propuesta mostrada: «{}», {} unidades y {classes} clases ({}). La persona la ve en una tarjeta, la puede editar y la crea si confirma: no digas que ya está creada.",
        p.title,
        p.units.len(),
        p.units.iter().map(|u| u.title.as_str()).collect::<Vec<_>>().join(" · ")
    );
    if !known.is_empty() {
        s.push_str(&format!(" Marcadas como ya sabidas: {}.", known.join(", ")));
    }
    if p.researched {
        s.push_str(&format!(" Se basó en {} fuentes de la web.", p.sources.len()));
    } else {
        s.push_str(" No hubo búsqueda web (no está configurada): decíselo y que la ruta salió de lo que sabés.");
    }
    if !p.note.is_empty() {
        s.push_str(&format!(" Nota del planificador: {}", p.note));
    }
    s.push_str(" Contale en dos o tres frases cómo está pensada y preguntale si la quiere ajustar.");
    s
}

// ── Creating and taking a route ────────────────────────────────────────────

pub fn create(state: &AppState, p: RouteProposal) -> Result<Route> {
    let units: Vec<RouteUnit> = p.units.into_iter().filter(|u| !u.classes.is_empty()).collect();
    if units.iter().map(|u| u.classes.len()).sum::<usize>() == 0 {
        bail!("La ruta quedó sin clases.");
    }
    let now = Utc::now();
    let mut r = Route {
        id: uuid::Uuid::new_v4().simple().to_string(),
        title: clean(&p.title, 60),
        goal: p.goal,
        purpose: p.purpose,
        hours_per_week: p.hours_per_week.clamp(0.5, 60.0),
        deadline: p.deadline,
        units,
        sources: p.sources,
        researched: p.researched,
        adjustments: vec![],
        created_at: now,
        updated_at: now,
    };
    state.routes.save(&mut r)?;
    Ok(r)
}

fn class_mut<'a>(r: &'a mut Route, class_id: &str) -> Option<&'a mut RouteClass> {
    r.units.iter_mut().flat_map(|u| u.classes.iter_mut()).find(|c| c.id == class_id)
}

/// Opens the session of a class, or the one it already has (AC-216).
pub fn start_class(state: &AppState, route_id: &str, class_id: &str) -> Result<Session> {
    let mut r = state.routes.load(route_id)?;
    let class = class_mut(&mut r, class_id).ok_or_else(|| anyhow!("clase no encontrada"))?;
    if let Some(s) = class.session_id.as_deref().and_then(|id| state.sessions.load(id).ok()) {
        return Ok(s);
    }
    let mut s = Session::new(&class.title);
    s.route = Some(RouteLink { route_id: route_id.into(), class_id: class_id.into() });
    state.sessions.save(&mut s)?;
    class.session_id = Some(s.id.clone());
    state.routes.save(&mut r)?;
    Ok(s)
}

/// The class's state, from its session: done once the session closed.
fn state_of(c: &RouteClass, sessions: &dyn Fn(&str) -> Option<(Phase, DateTime<Utc>)>) -> (ClassState, Option<DateTime<Utc>>) {
    if c.known {
        return (ClassState::Known, None);
    }
    match c.session_id.as_deref().and_then(sessions) {
        Some((Phase::Done, at)) => (ClassState::Done, Some(at)),
        Some(_) => (ClassState::Started, None),
        None => (ClassState::Todo, None),
    }
}

pub fn view_with(r: &Route, sessions: &dyn Fn(&str) -> Option<(Phase, DateTime<Utc>)>) -> RouteView {
    let mut number = 0;
    let mut current: Option<String> = None;
    let mut units: Vec<UnitView> = r
        .units
        .iter()
        .map(|u| UnitView {
            id: u.id.clone(),
            title: u.title.clone(),
            classes: u
                .classes
                .iter()
                .map(|c| {
                    let (state, done_at) = state_of(c, sessions);
                    if state != ClassState::Known {
                        number += 1;
                    }
                    ClassView { class: c.clone(), state, number: if state == ClassState::Known { 0 } else { number }, done_at }
                })
                .collect(),
        })
        .collect();
    // The next class: the first one not done and not known.
    if let Some(c) = units.iter_mut().flat_map(|u| u.classes.iter_mut()).find(|c| matches!(c.state, ClassState::Todo | ClassState::Started)) {
        c.state = ClassState::Current;
        current = Some(c.class.id.clone());
    }
    let all = units.iter().flat_map(|u| &u.classes);
    let total = all.clone().filter(|c| c.state != ClassState::Known).count();
    let done = all.clone().filter(|c| c.state == ClassState::Done).count();
    let minutes_left = all.filter(|c| !matches!(c.state, ClassState::Done | ClassState::Known)).map(|c| c.class.minutes).sum();
    RouteView {
        id: r.id.clone(),
        title: r.title.clone(),
        goal: r.goal.clone(),
        purpose: r.purpose.clone(),
        hours_per_week: r.hours_per_week,
        deadline: r.deadline.clone(),
        sources: r.sources.clone(),
        researched: r.researched,
        adjustments: r.adjustments.clone(),
        units,
        total,
        done,
        minutes_left,
        current,
        created_at: r.created_at,
    }
}

pub fn view(state: &AppState, r: &Route) -> RouteView {
    view_with(r, &|id| state.sessions.load(id).ok().map(|s| (s.phase, s.updated_at)))
}

// ── The teacher, inside a class (AC-216) ───────────────────────────────────

/// The state section for a session that is a class of a route: where it stands,
/// what to cover, what came before (to review first) and what comes next.
pub fn state_section(state: &AppState, s: &Session) -> String {
    let Some(link) = &s.route else { return String::new() };
    let Ok(r) = state.routes.load(&link.route_id) else { return String::new() };
    let v = view(state, &r);
    let flat: Vec<(&UnitView, &ClassView)> = v.units.iter().flat_map(|u| u.classes.iter().map(move |c| (u, c))).collect();
    let Some(pos) = flat.iter().position(|(_, c)| c.class.id == link.class_id) else { return String::new() };
    let (unit, class) = flat[pos];
    let mut out = format!(
        "\n## Ruta de aprendizaje\nEsta sesión es la **clase {} de {}** de la ruta «{}» (unidad «{}»). Tema: **{}**.\nCubrí solo esto (el plan de la sesión sale de acá; no adelantes otras clases):\n",
        class.number, v.total, v.title, unit.title, class.class.title
    );
    for t in &class.class.topics {
        out.push_str(&format!("- {t}\n"));
    }
    let prev = flat[..pos].iter().rev().find(|(_, c)| c.state == ClassState::Done);
    match prev {
        Some((_, p)) => {
            let summary = p.class.session_id.as_deref().and_then(|id| state.sessions.load(id).ok()).and_then(|ps| ps.memory).map(|m| m.summary).filter(|x| !x.is_empty());
            out.push_str(&format!(
                "La clase anterior fue «{}»{}. **Tu primera pregunta repasa esa clase** (corta, de recuperación) antes de lo nuevo.\n",
                p.class.title,
                summary.map(|x| format!(": {x}")).unwrap_or_default()
            ));
        }
        None => out.push_str("Es la primera clase de la ruta: empezá midiendo lo que sabe del tema.\n"),
    }
    if let Some((_, next)) = flat[pos + 1..].iter().find(|(_, c)| c.state != ClassState::Known) {
        out.push_str(&format!("La próxima clase es «{}».\n", next.class.title));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(title: &str, url: &str, score: f64) -> Hit {
        Hit { title: title.into(), url: url.into(), content: "Unidad 1: regresión".into(), raw_content: None, score }
    }

    fn args() -> ProposeArgs {
        ProposeArgs { topic: "Machine Learning".into(), purpose: "cambiar de trabajo".into(), level: "programo en Python".into(), hours_per_week: Some(4.0), ..Default::default() }
    }

    fn plan(units: Value, used: Value) -> String {
        json!({ "title": "Machine Learning desde cero", "goal": "Entrenar y evaluar un modelo propio.", "units": units, "used": used, "note": "Basada en dos programas." }).to_string()
    }

    fn three() -> Value {
        json!([{ "title": "Bases", "classes": [
            { "title": "Derivadas", "topics": ["pendiente"], "minutes": 60, "known": true },
            { "title": "Vectores", "topics": ["producto punto"], "minutes": 45 },
            { "title": "Regresión lineal", "topics": ["error"], "minutes": 500 }
        ] }])
    }

    #[test]
    fn the_searches_ask_how_universities_and_known_courses_teach_it() {
        let mut a = args();
        a.queries = vec!["curso de Andrew Ng".into(), " ".into(), "fast.ai".into(), "otra".into()];
        let q = queries(&a);
        assert!(q[0].contains("Machine Learning") && q[0].contains("universidad"));
        assert!(q[1].contains("syllabus"));
        assert_eq!(q.len(), MAX_QUERIES, "the teacher adds at most 2: {q:?}");
        assert!(q.contains(&"curso de Andrew Ng".to_string()) && !q.contains(&"otra".to_string()));
    }

    #[test]
    fn only_the_sources_the_planner_used_reach_the_card_with_their_real_url() {
        let hits = vec![hit("Stanford CS229", "https://cs229.stanford.edu/syllabus", 0.9), hit("Otro", "https://ejemplo.edu/ml", 0.5)];
        let p = parse_plan(&plan(three(), json!([1, 1, 7, 0])), &args(), &hits).unwrap();
        assert_eq!(p.sources, vec![RouteSource { title: "Stanford CS229".into(), url: "https://cs229.stanford.edu/syllabus".into() }]);
        assert!(p.researched);
        assert_eq!(p.hours_per_week, 4.0);
        // Ids are stable, minutes are kept in range, and "known" is kept.
        let c: Vec<&RouteClass> = p.units.iter().flat_map(|u| &u.classes).collect();
        assert_eq!(c.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["c1", "c2", "c3"]);
        assert!(c[0].known);
        assert_eq!(c[2].minutes, MAX_MINUTES);
    }

    #[test]
    fn a_plan_out_of_shape_is_sent_back_saying_what_to_fix() {
        let few = json!([{ "title": "Bases", "classes": [{ "title": "Derivadas", "topics": [], "minutes": 60 }] }]);
        assert!(parse_plan(&plan(few, json!([])), &args(), &[]).unwrap_err().to_string().contains("de 3 a 30 clases"));
        let none = json!([]);
        assert!(parse_plan(&plan(none, json!([])), &args(), &[]).unwrap_err().to_string().contains("unidades"));
        assert!(parse_plan("no json", &args(), &[]).is_err());
        // Without a search the route still comes, marked as not researched.
        let p = parse_plan(&plan(three(), json!([1])), &args(), &[]).unwrap();
        assert!(!p.researched && p.sources.is_empty());
    }

    #[test]
    fn junk_and_repeated_pages_are_not_read() {
        let hits = pick_hits(vec![hit("A", "https://www.linkedin.com/in/x", 0.99), hit("B", "https://u.edu/ml/", 0.7), hit("B2", "https://u.edu/ml", 0.6), hit("C", "https://c.org/x", 0.8)]);
        assert_eq!(hits.iter().map(|h| h.title.as_str()).collect::<Vec<_>>(), ["C", "B"]);
    }

    #[test]
    fn the_planner_reads_the_person_what_they_master_and_the_pages() {
        let input = plan_input(&args(), &["Derivadas".into()], &["Signo del gradiente".into()], &[hit("CS229", "https://cs229.stanford.edu", 1.0)]);
        assert!(input.contains("Para qué: cambiar de trabajo"));
        assert!(input.contains("- Derivadas") && input.contains("- Signo del gradiente"));
        assert!(input.contains("[1] CS229") && input.contains("https://cs229.stanford.edu"));
        assert!(plan_input(&ProposeArgs { topic: "X".into(), ..Default::default() }, &[], &[], &[]).contains("no hubo búsqueda"));
    }

    #[test]
    fn the_teacher_passes_only_what_the_person_said() {
        assert!(parse_args(r#"{"topic":"ML","hours_per_week":4}"#).is_ok());
        assert!(parse_args(r#"{"topic":"  "}"#).unwrap_err().to_string().contains("topic"));
        assert!(parse_args(r#"{"topic":"ML","hours_per_week":0}"#).is_err());
        assert!(parse_args(r#"{"topic":"ML","deadline":"15/12/2026"}"#).unwrap_err().to_string().contains("AAAA-MM-DD"));
    }

    fn route() -> Route {
        let p = parse_plan(&plan(three(), json!([])), &args(), &[]).unwrap();
        let now = Utc::now();
        Route { id: "r1".into(), title: p.title, goal: p.goal, purpose: p.purpose, hours_per_week: 4.0, deadline: None, units: p.units, sources: vec![], researched: false, adjustments: vec![], created_at: now, updated_at: now }
    }

    #[test]
    fn where_each_class_stands_is_read_from_its_session() {
        let mut r = route();
        r.units[0].classes[1].session_id = Some("s-vec".into());
        r.units[0].classes[2].session_id = Some("s-reg".into());
        let at = Utc::now();
        let none = |_: &str| None;
        let v = view_with(&r, &none);
        // The known class is skipped: the next one is Vectores, and it is class 1 of 2.
        let states: Vec<ClassState> = v.units[0].classes.iter().map(|c| c.state).collect();
        assert_eq!(states, [ClassState::Known, ClassState::Current, ClassState::Todo]);
        assert_eq!((v.total, v.done, v.units[0].classes[1].number), (2, 0, 1));
        assert_eq!(v.minutes_left, 45 + MAX_MINUTES);
        let sessions = move |id: &str| match id {
            "s-vec" => Some((Phase::Done, at)),
            "s-reg" => Some((Phase::Teach, at)),
            _ => None,
        };
        let v = view_with(&r, &sessions);
        let states: Vec<ClassState> = v.units[0].classes.iter().map(|c| c.state).collect();
        assert_eq!(states, [ClassState::Known, ClassState::Done, ClassState::Current]);
        assert_eq!((v.done, v.current.as_deref()), (1, Some("c3")));
        assert_eq!(v.units[0].classes[1].done_at, Some(at));
    }

    #[test]
    fn a_class_opens_its_session_once_and_the_teacher_knows_where_it_stands() {
        let dir = std::env::temp_dir().join(format!("la-route-{}", uuid::Uuid::new_v4()));
        let st = AppState::new(dir.clone());
        let mut r = route();
        st.routes.save(&mut r).unwrap();
        let s = start_class(&st, "r1", "c2").unwrap();
        assert_eq!(s.route, Some(RouteLink { route_id: "r1".into(), class_id: "c2".into() }));
        assert_eq!(start_class(&st, "r1", "c2").unwrap().id, s.id, "resumed, not duplicated");
        let section = state_section(&st, &s);
        assert!(section.contains("**clase 1 de 2**"), "{section}");
        assert!(section.contains("Tema: **Vectores**") && section.contains("- producto punto"));
        assert!(section.contains("primera clase"));
        assert!(section.contains("La próxima clase es «Regresión lineal»"));
        // Once class 1 closed, class 2 reviews it first.
        let mut done = st.sessions.load(&s.id).unwrap();
        done.phase = Phase::Done;
        st.sessions.save(&mut done).unwrap();
        let next = start_class(&st, "r1", "c3").unwrap();
        let section = state_section(&st, &next);
        assert!(section.contains("**clase 2 de 2**") && section.contains("repasa esa clase") && section.contains("«Vectores»"), "{section}");
        assert!(start_class(&st, "r1", "nope").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
