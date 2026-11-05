//! The student model (AC-111..113): one picture of what the person masters,
//! what is hard, what is pending and what is coming, built on the fly from every
//! source the app already keeps — sessions, practice, confusions, exams, cards,
//! session memories, Mi cursada. No file of its own, so there is no second truth.
//!
//! The agent sees a short version in every phase; Home turns it into a plan for
//! today; "Mi progreso" shows it whole and lets the person correct it.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

use crate::graph::normalize;
use crate::session::{NodeStatus, Phase, Session};
use crate::AppState;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    LeCuesta,
    Pendiente,
    Practicando,
    Domina,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TopicState {
    pub key: String,
    pub name: String,
    pub status: Status,
    /// Why, in the person's words ("práctica: acertaste 2 de 3").
    pub evidence: Vec<String>,
    pub at: DateTime<Utc>,
    /// Where it came from: "sesión", "práctica", "confusión", "examen", "tarjetas", "memoria".
    pub sources: Vec<String>,
    /// An open confusion behind it (so "Esto ya lo sé" can repair it).
    pub confusion: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Upcoming {
    pub title: String,
    pub date: String,
    pub days: i64,
    /// "exams" or "academic": where it lives.
    pub screen: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Pending {
    pub item: String,
    pub session_id: String,
    pub session_title: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct StudentModel {
    pub topics: Vec<TopicState>,
    pub pending: Vec<Pending>,
    pub upcoming: Vec<Upcoming>,
    pub preferences: Vec<String>,
    pub cards_due: usize,
    pub minutes_7d: f64,
}

const MAX_EVIDENCE: usize = 3;
/// Dates further away than this aren't "coming" yet.
const HORIZON_DAYS: i64 = 30;
/// New cards a day, as in the cards screen (src/lib/cards.ts NEW_PER_DAY).
const NEW_PER_DAY: usize = 20;
/// A deck with this many forgotten cards is something that is hard.
const LAPSES_HARD: u32 = 3;
const DEFAULT_PASS_PCT: f64 = 70.0;

fn words(s: &str) -> HashSet<String> {
    normalize(s).split_whitespace().filter(|w| w.len() > 3).map(String::from).collect()
}

/// Two names talk about the same thing: same key, or most of the shorter one's words in the other.
fn same_topic(a: &str, b: &str) -> bool {
    if normalize(a) == normalize(b) {
        return true;
    }
    let (wa, wb) = (words(a), words(b));
    let small = wa.len().min(wb.len());
    small > 0 && wa.intersection(&wb).count() * 2 > small
}

#[derive(Default)]
struct Builder {
    topics: Vec<TopicState>,
}

impl Builder {
    /// Adds a signal; the newest signal about a topic decides its status, evidence accumulates.
    fn add(&mut self, name: &str, status: Status, evidence: String, at: DateTime<Utc>, source: &str, confusion: bool) {
        let name = name.trim();
        if name.is_empty() {
            return;
        }
        if let Some(t) = self.topics.iter_mut().find(|t| same_topic(&t.name, name)) {
            if at >= t.at {
                t.status = status;
                t.at = at;
                t.evidence.insert(0, evidence);
            } else {
                t.evidence.push(evidence);
            }
            t.evidence.dedup();
            t.evidence.truncate(MAX_EVIDENCE);
            if !t.sources.iter().any(|s| s == source) {
                t.sources.push(source.into());
            }
            t.confusion |= confusion;
            return;
        }
        self.topics.push(TopicState { key: normalize(name), name: name.chars().take(140).collect(), status, evidence: vec![evidence], at, sources: vec![source.into()], confusion });
    }
}

fn date_label(at: DateTime<Utc>) -> String {
    at.with_timezone(&chrono::Local).format("%d/%m").to_string()
}

pub fn model(state: &AppState, today: NaiveDate) -> StudentModel {
    let sessions = state.sessions.all();
    let graph = state.graph.view();
    let mut b = Builder::default();

    // Sessions with a goal: finished, in progress, and the steps that needed repair.
    for s in sessions.iter().filter(|s| s.phase != Phase::Chat && !s.goal.trim().is_empty()) {
        let ideas = graph.nodes.iter().filter(|n| n.sources.iter().any(|src| matches!(src, crate::graph::Source::Session { id, .. } if id == &s.id))).count();
        let (done, total) = (s.plan.iter().filter(|n| n.status == NodeStatus::Understood).count(), s.plan.iter().filter(|n| n.status != NodeStatus::Known).count());
        match s.phase {
            Phase::Done => b.add(&s.goal, Status::Domina, format!("terminaste la sesión del {}{}", date_label(s.updated_at), if ideas > 0 { format!(" ({ideas} ideas en tu grafo)") } else { String::new() }), s.updated_at, "sesión", false),
            _ if total > 0 => b.add(&s.goal, Status::Practicando, format!("sesión en curso: {done} de {total} pasos"), s.updated_at, "sesión", false),
            _ => {}
        }
        for n in s.plan.iter().filter(|n| n.status == NodeStatus::Repair) {
            b.add(&n.title, Status::LeCuesta, format!("hubo que repararlo en «{}»", s.title), s.updated_at, "sesión", false);
        }
    }

    // Practice: per idea, how the last attempts went.
    for set in state.practice.all() {
        let mut per: HashMap<String, (usize, usize, Option<(crate::practice::Verdict, DateTime<Utc>)>)> = HashMap::new();
        for p in &set.problems {
            let Some(last) = p.attempts.last() else { continue };
            for t in &p.targets {
                let e = per.entry(t.clone()).or_default();
                e.1 += 1;
                if last.verdict == crate::practice::Verdict::Correct {
                    e.0 += 1;
                }
                if e.2.as_ref().is_none_or(|(_, at)| last.at > *at) {
                    e.2 = Some((last.verdict, last.at));
                }
            }
        }
        for (target, (right, tried, last)) in per {
            let (Some(t), Some((verdict, at))) = (set.targets.iter().find(|x| x.id == target), last) else { continue };
            let status = match verdict {
                crate::practice::Verdict::Correct => Status::Domina,
                crate::practice::Verdict::Partial => Status::Practicando,
                crate::practice::Verdict::Incorrect => Status::LeCuesta,
            };
            b.add(&t.text, status, format!("práctica: acertaste {right} de {tried}"), at, "práctica", false);
        }
    }

    // Confusions: open ones are hard, repaired ones are being practised.
    let profile = state.learner.load();
    for m in &profile.misconceptions {
        if m.fixed {
            b.add(&m.concept, Status::Practicando, format!("la confusión «{}» quedó reparada", m.wrong_idea.chars().take(80).collect::<String>()), m.at, "confusión", false);
        } else {
            b.add(&m.concept, Status::LeCuesta, format!("confusión: {}", m.wrong_idea.chars().take(100).collect::<String>()), m.at, "confusión", true);
        }
    }

    // Exams: the latest full mock, domain by domain, against the passing mark.
    let exams = state.exams.all();
    for e in &exams {
        let pass = e.goal.passing_pct.unwrap_or(DEFAULT_PASS_PCT);
        if let Some(r) = e.mocks.iter().filter(|m| m.focus.is_none()).filter_map(|m| m.result.as_ref()).max_by_key(|r| r.at) {
            for d in &r.by_domain {
                let Some(dom) = e.domains.iter().find(|x| x.id == d.domain_id) else { continue };
                if d.total == 0 {
                    continue;
                }
                let pct = 100.0 * d.correct as f64 / d.total as f64;
                let status = if pct < pass { Status::LeCuesta } else { Status::Domina };
                b.add(&dom.name, status, format!("simulacro de {}: {} de {}", e.name, d.correct, d.total), r.at, "examen", false);
            }
        }
    }

    // Cards: a deck whose cards keep being forgotten.
    let decks = state.decks.all();
    for d in &decks {
        let lapses: u32 = d.cards.iter().map(|c| c.lapses).sum();
        if lapses >= LAPSES_HARD {
            let topic = d.name.trim_start_matches("Falladas: ").trim_start_matches("Sesión: ");
            b.add(topic, Status::LeCuesta, format!("tarjetas: {lapses} olvidos en «{}»", d.name), d.updated_at, "tarjetas", false);
        }
    }

    // Session memories: what was hard, and what was left for later.
    let mut pending = Vec::new();
    for s in &sessions {
        let Some(m) = s.memory.as_ref().filter(|m| !m.summary.is_empty()) else { continue };
        for x in &m.struggled {
            b.add(x, Status::LeCuesta, format!("le costó en «{}» ({})", s.title, date_label(m.at)), m.at, "memoria", false);
        }
        for x in &m.pending {
            b.add(x, Status::Pendiente, format!("quedó pendiente en «{}»", s.title), m.at, "memoria", false);
            pending.push(Pending { item: x.clone(), session_id: s.id.clone(), session_title: s.title.clone(), at: m.at });
        }
    }
    pending.sort_by(|a, b| b.at.cmp(&a.at));

    // What is coming: exam dates and Mi cursada's dates.
    let mut upcoming = Vec::new();
    let days_to = |d: &str| d.parse::<NaiveDate>().ok().map(|d| (d - today).num_days());
    for e in &exams {
        if let Some((date, days)) = e.goal.exam_date.as_deref().and_then(|d| days_to(d).map(|n| (d.to_string(), n))) {
            if (0..=HORIZON_DAYS).contains(&days) {
                upcoming.push(Upcoming { title: e.name.clone(), date, days, screen: "exams".into(), id: e.id.clone() });
            }
        }
    }
    let acad = state.academic.data();
    for d in acad.dates.iter().filter(|d| !d.done) {
        let Some(days) = days_to(&d.date) else { continue };
        if (0..=HORIZON_DAYS).contains(&days) {
            let course = acad.courses.iter().find(|c| Some(&c.id) == d.course_id.as_ref()).map(|c| c.name.as_str());
            let title = match course {
                Some(c) if !d.title.to_lowercase().contains(&c.to_lowercase()) => format!("{} de {c}", d.title),
                _ => d.title.clone(),
            };
            upcoming.push(Upcoming { title, date: d.date.clone(), days, screen: "academic".into(), id: d.id.clone() });
        }
    }
    upcoming.sort_by_key(|u| u.days);

    let today_s = today.to_string();
    let cards_due = decks
        .iter()
        .map(|d| d.cards.iter().filter(|c| c.reviewed.is_some() && c.due <= today_s).count() + d.cards.iter().filter(|c| c.reviewed.is_none()).count().min(NEW_PER_DAY))
        .sum();
    let week_ago = (today - chrono::Duration::days(6)).to_string();
    let minutes_7d = state.study.since(&week_ago).iter().map(|e| e.minutes).sum();

    let mut topics = b.topics;
    let mut preferences: Vec<String> = profile.preferences.iter().map(|p| p.text.clone()).collect();
    // AC-199: what the student corrected or deleted in «Lo que Eureka sabe de vos» wins.
    if let Ok((mine, gone)) = state.memdb.overrides() {
        apply_overrides(&mut topics, &mut preferences, &mut pending, &mine, &gone);
    }
    topics.sort_by(|a, b| a.status.cmp(&b.status).then(b.at.cmp(&a.at)));
    StudentModel { topics, pending, upcoming, preferences, cards_due, minutes_7d }
}

/// The student's word over the computed signals: their own observations set
/// the status of a topic; what they deleted leaves (unless newer evidence came).
fn apply_overrides(topics: &mut Vec<TopicState>, preferences: &mut Vec<String>, pending: &mut Vec<Pending>, mine: &[crate::memdb::Observation], gone: &[(String, crate::memdb::Kind, DateTime<Utc>)]) {
    use crate::memdb::{same_topic, topic, Kind};
    let concept = |name: &str| topic(Kind::LeCuesta, name);
    // A deleted observation takes out only its own effect: that status of that topic.
    for (t, kind, at) in gone {
        match kind {
            Kind::Preferencia => preferences.retain(|p| !same_topic(&topic(Kind::Preferencia, p), t)),
            Kind::Idea => {}
            Kind::Pendiente => {
                pending.retain(|p| !(same_topic(&concept(&p.item), t) && p.at <= *at));
                topics.retain(|x| !(x.status == Status::Pendiente && same_topic(&concept(&x.name), t) && x.at <= *at));
            }
            Kind::Domina => topics.retain(|x| !(x.status == Status::Domina && same_topic(&concept(&x.name), t) && x.at <= *at)),
            // «Le cuesta» from memory or sessions; an open confusion behind the topic is another observation.
            Kind::LeCuesta => topics.retain(|x| !(x.status == Status::LeCuesta && !x.confusion && same_topic(&concept(&x.name), t) && x.at <= *at)),
            // A confusion leaves the profile when deleted; here only a topic that was nothing but it.
            Kind::Confusion => topics.retain(|x| !(x.status == Status::LeCuesta && x.confusion && x.sources.iter().all(|s| s == "confusión") && same_topic(&concept(&x.name), t) && x.at <= *at)),
        }
    }
    for o in mine {
        let status = match o.kind {
            Kind::Domina => Status::Domina,
            Kind::LeCuesta | Kind::Confusion => Status::LeCuesta,
            Kind::Pendiente => Status::Pendiente,
            Kind::Preferencia => {
                // The student's wording replaces the old one.
                match preferences.iter_mut().find(|p| same_topic(&topic(Kind::Preferencia, p), &o.topic)) {
                    Some(p) => *p = o.title.clone(),
                    None => preferences.insert(0, o.title.clone()),
                }
                continue;
            }
            Kind::Idea => continue,
        };
        let evidence = if o.content.is_empty() || o.content == o.title { "lo corregiste vos".to_string() } else { format!("lo corregiste vos: {}", o.content.chars().take(100).collect::<String>()) };
        topics.retain(|x| !same_topic(&concept(&x.name), &o.topic) || x.status == status);
        match topics.iter_mut().find(|x| same_topic(&concept(&x.name), &o.topic)) {
            Some(x) => {
                x.name = o.title.clone();
                x.evidence.insert(0, evidence);
                x.evidence.truncate(MAX_EVIDENCE);
                x.at = o.updated_at;
                x.confusion = false;
                if !x.sources.iter().any(|s| s == "vos") {
                    x.sources.push("vos".into());
                }
            }
            None => topics.push(TopicState { key: normalize(&o.title), name: o.title.clone(), status, evidence: vec![evidence], at: o.updated_at, sources: vec!["vos".into()], confusion: false }),
        }
    }
}

/// "## Lo que sabemos de vos" for the agent, in every phase: what relates to this
/// session first, then what is hard, pending and coming. At most 10 lines.
pub fn state_section(m: &StudentModel, s: &Session) -> String {
    let goal = words(&format!("{} {} {}", s.goal, s.title, s.exam.as_ref().map(|e| e.objectives.join(" ")).unwrap_or_default()));
    let related = |t: &TopicState| !goal.is_empty() && !words(&t.name).is_disjoint(&goal);
    let pick = |status: Status, n: usize, only_related: bool| -> Vec<&TopicState> {
        let mut v: Vec<&TopicState> = m.topics.iter().filter(|t| t.status == status && (!only_related || related(t))).collect();
        v.sort_by_key(|t| !related(t));
        v.into_iter().take(n).collect()
    };
    let mut lines: Vec<String> = m.preferences.iter().take(2).map(|p| format!("- Prefiere: {p}")).collect();
    for t in pick(Status::LeCuesta, 4, false) {
        lines.push(format!("- Le cuesta: {} ({})", t.name, t.evidence[0]));
    }
    for t in pick(Status::Practicando, 2, false) {
        lines.push(format!("- Practicando: {} ({})", t.name, t.evidence[0]));
    }
    for t in pick(Status::Domina, 2, true) {
        lines.push(format!("- Ya domina: {} ({})", t.name, t.evidence[0]));
    }
    for p in m.pending.iter().filter(|p| p.session_id != s.id).take(2) {
        lines.push(format!("- Pendiente de «{}»: {}", p.session_title, p.item));
    }
    if !m.upcoming.is_empty() {
        let soon: Vec<String> = m.upcoming.iter().take(2).map(|u| format!("{} {}", u.title, when(u.days))).collect();
        lines.push(format!("- Se viene: {}", soon.join("; ")));
    }
    if m.cards_due > 0 {
        lines.push(format!("- Hoy tiene {} tarjetas para repasar.", m.cards_due));
    }
    lines.truncate(10);
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "\n## Lo que sabemos de vos (modelo del estudiante)\nUsalo para elegir por dónde empezar y qué ejemplos dar; si viene al caso, nombralo con naturalidad (\"la última vez te costó…\"). No inventes nada que no esté acá.\n{}\n",
        lines.join("\n")
    )
}

pub fn when(days: i64) -> String {
    match days {
        0 => "hoy".into(),
        1 => "mañana".into(),
        n => format!("en {n} días"),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Suggestion {
    pub title: String,
    pub reason: String,
    /// "exams" | "academic" | "cards" | "session" | "chat"
    pub screen: String,
    pub target_id: Option<String>,
    /// For "chat": what the new conversation starts with.
    pub prompt: Option<String>,
}

const TODAY_MAX: usize = 3;
const SOON_DAYS: i64 = 7;

/// AC-112: up to three things worth doing today, each with its reason. No model call.
pub fn today(m: &StudentModel) -> Vec<Suggestion> {
    let mut out = Vec::new();
    let hard: Vec<&TopicState> = m.topics.iter().filter(|t| t.status == Status::LeCuesta).collect();
    // 1. Something close, and what is hard about it.
    if let Some(u) = m.upcoming.iter().find(|u| u.days <= SOON_DAYS) {
        let weak = hard.iter().find(|t| !words(&t.name).is_disjoint(&words(&u.title))).or(hard.first());
        let reason = match weak {
            Some(t) => format!("{} {}; te cuesta {}.", u.title, when(u.days), t.name),
            None => format!("{} {}.", u.title, when(u.days)),
        };
        out.push(Suggestion { title: format!("Prepará {}", u.title), reason, screen: u.screen.clone(), target_id: Some(u.id.clone()), prompt: None });
    }
    // 2. Cards that are due.
    if m.cards_due > 0 {
        out.push(Suggestion { title: format!("Repasá {} tarjetas", m.cards_due), reason: "Tocan hoy: si las dejás, se acumulan.".into(), screen: "cards".into(), target_id: None, prompt: None });
    }
    // 3. What a recent session left pending.
    if let Some(p) = m.pending.first() {
        out.push(Suggestion { title: format!("Retomá: {}", p.item), reason: format!("Quedó pendiente en «{}».", p.session_title), screen: "session".into(), target_id: Some(p.session_id.clone()), prompt: None });
    }
    // 4. The oldest open confusion.
    if let Some(t) = m.topics.iter().filter(|t| t.confusion && t.status == Status::LeCuesta).min_by_key(|t| t.at) {
        out.push(Suggestion { title: format!("Repasá {}", t.name), reason: t.evidence[0].clone(), screen: "chat".into(), target_id: None, prompt: Some(format!("Quiero repasar {}: la última vez me confundí.", t.name)) });
    }
    out.truncate(TODAY_MAX);
    out
}

/// The plan for today in the agent's state block (chat only).
pub fn today_section(plan: &[Suggestion]) -> String {
    if plan.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = plan.iter().map(|x| format!("- {} — {}", x.title, x.reason)).collect();
    format!("
## Plan de hoy (lo calculó la app)
Si la persona saluda o no trae un tema, ofrecéselo con `propose_action` (uno o dos botones), sin insistir.
{}
", lines.join("
"))
}

/// "Esto ya lo sé": repairs the open confusion behind a topic. False when there was none.
pub fn mark_known(state: &AppState, name: &str) -> anyhow::Result<bool> {
    let _ = state.memdb.repair(name);
    state.learner.update(|p| {
        let open: Vec<String> = p.misconceptions.iter().filter(|m| !m.fixed && same_topic(&m.concept, name)).map(|m| m.concept.clone()).collect();
        open.iter().fold(false, |any, c| crate::learner::mark_fixed(p, c, "Lo marcaste vos") || any)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::Msg;

    fn st() -> (AppState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-student-{}", uuid::Uuid::new_v4()));
        (AppState::new(dir.clone()), dir)
    }

    fn topic<'a>(m: &'a StudentModel, name: &str) -> &'a TopicState {
        m.topics.iter().find(|t| same_topic(&t.name, name)).unwrap_or_else(|| panic!("no topic {name}: {:?}", m.topics.iter().map(|t| &t.name).collect::<Vec<_>>()))
    }

    fn day() -> NaiveDate {
        chrono::Local::now().date_naive()
    }

    #[test]
    fn what_the_student_corrects_or_deletes_wins_in_the_model() {
        let (st, dir) = st();
        st.learner.update(|p| crate::learner::add_misconception(p, "La derivada", "es el área", false, "Sesión: a")).unwrap();
        crate::memdb::migrate(&st).unwrap();
        let id = st.memdb.list().unwrap()[0].id;
        // As the command does: the confusion is the student's «domina» now.
        st.learner.update(|p| crate::memdb::strip_from_profile(p, crate::memdb::Kind::Confusion, &st.memdb.get(id).unwrap().unwrap().topic)).unwrap();
        st.memdb.edit(id, "La derivada", "ya la entiendo", crate::memdb::Kind::Domina).unwrap();
        let t = topic(&model(&st, day()), "derivada").clone();
        assert_eq!(t.status, Status::Domina);
        assert_eq!(t.evidence[0], "lo corregiste vos: ya la entiendo");
        st.memdb.delete(id).unwrap();
        assert!(!model(&st, day()).topics.iter().any(|t| same_topic(&t.name, "derivada")), "deleted: the old confusion doesn't show either");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deleting_one_observation_removes_only_its_own_effect() {
        let (st, dir) = st();
        // «Le cuesta» from a session memory, «Ya lo domina» from a finished session, and an open confusion.
        let mut chat = Session::new_chat("charla");
        chat.messages.push(Msg::user("hola", None));
        chat.memory = Some(crate::memory::SessionMemory { summary: "Vimos límites y fracciones.".into(), pending: vec![], struggled: vec!["los límites".into(), "las fracciones".into()], messages: 2, at: Utc::now() - chrono::Duration::days(3) });
        st.sessions.save(&mut chat).unwrap();
        let mut done = Session::new("límites");
        done.phase = Phase::Done;
        st.sessions.save(&mut done).unwrap();
        st.learner.update(|p| crate::learner::add_misconception(p, "Integrales", "son derivadas", false, "Sesión: x")).unwrap();
        crate::memdb::migrate(&st).unwrap();
        let rows = st.memdb.list().unwrap();
        let find = |title: &str| rows.iter().find(|o| o.title == title).unwrap().clone();
        st.memdb.delete(find("los límites").id).unwrap();
        st.memdb.delete(find("las fracciones").id).unwrap();
        let m = model(&st, day());
        assert_eq!(topic(&m, "límites").status, Status::Domina, "the finished session still says domina");
        assert!(!m.topics.iter().any(|t| same_topic(&t.name, "fracciones")), "that «le cuesta» was all there was");
        assert_eq!(topic(&m, "Integrales").status, Status::LeCuesta, "another observation: untouched");
        // The profile loses only the deleted entry.
        let mut p = st.learner.load();
        crate::memdb::strip_from_profile(&mut p, crate::memdb::Kind::LeCuesta, "concepto:integral");
        assert_eq!(p.misconceptions.len(), 1, "deleting a «le cuesta» never touches a confusion");
        crate::memdb::strip_from_profile(&mut p, crate::memdb::Kind::Confusion, "concepto:integral");
        assert!(p.misconceptions.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn same_topic_matches_names_not_short_words() {
        assert!(same_topic("La derivada", "la DERIVADA"));
        assert!(same_topic("derivada de una función", "la derivada de la función compuesta"));
        assert!(!same_topic("derivadas", "integrales"));
        assert!(!same_topic("la de", "el de"), "short words alone don't make a topic");
    }

    #[test]
    fn an_empty_app_has_an_empty_model_and_says_nothing() {
        let (st, dir) = st();
        let m = model(&st, day());
        assert_eq!(m, StudentModel::default());
        assert_eq!(state_section(&m, &Session::new_chat("hola")), "");
        assert!(super::today(&m).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn confusions_are_hard_until_repaired_and_marking_known_repairs_them() {
        let (st, dir) = st();
        st.learner.update(|p| crate::learner::add_misconception(p, "La derivada", "es el área bajo la curva", false, "Sesión: a")).unwrap();
        let m = model(&st, day());
        let t = topic(&m, "derivada");
        assert_eq!((t.status, t.confusion), (Status::LeCuesta, true));
        assert!(t.evidence[0].contains("es el área"));
        assert!(mark_known(&st, "la derivada").unwrap());
        assert!(!mark_known(&st, "la derivada").unwrap(), "nothing left to repair");
        assert_eq!(topic(&model(&st, day()), "derivada").status, Status::Practicando);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sessions_memories_and_cards_feed_the_model() {
        let (st, dir) = st();
        let mut done = Session::new("triángulos equiláteros");
        done.phase = Phase::Done;
        st.sessions.save(&mut done).unwrap();
        let mut chat = Session::new_chat("charla de física");
        chat.messages.push(Msg::user("más", None));
        chat.memory = Some(crate::memory::SessionMemory { summary: "Vimos fuerzas.".into(), pending: vec!["el plano inclinado".into()], struggled: vec!["descomponer fuerzas".into()], messages: 2, at: Utc::now() });
        st.sessions.save(&mut chat).unwrap();
        let mut deck = crate::cards::create_empty(&st, "Falladas: Química").unwrap();
        for c in 0..3 {
            deck.cards.push(crate::cards::Card { id: format!("c{c}"), front: "f".into(), back: "b".into(), ease: 2.0, interval: 1, reps: 0, lapses: 1, due: "2000-01-01".into(), reviewed: Some("2000-01-01".into()) });
        }
        st.decks.save(&mut deck).unwrap();

        let m = model(&st, day());
        assert_eq!(topic(&m, "triángulos equiláteros").status, Status::Domina);
        assert_eq!(topic(&m, "descomponer fuerzas").status, Status::LeCuesta);
        assert_eq!(topic(&m, "Química").status, Status::LeCuesta);
        assert_eq!(m.pending[0].item, "el plano inclinado");
        assert_eq!(topic(&m, "el plano inclinado").status, Status::Pendiente);
        assert_eq!(m.cards_due, 3);
        assert_eq!(m.topics.first().unwrap().status, Status::LeCuesta, "hard things first");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn practice_and_mocks_feed_the_model() {
        let (st, dir) = st();
        let now = Utc::now().to_rfc3339();
        let mut set: crate::practice::PracticeSet = serde_json::from_value(serde_json::json!({
            "id": "p1", "title": "Derivadas", "created_at": now, "updated_at": now,
            "targets": [{ "id": "n1", "text": "la regla de la cadena" }, { "id": "n2", "text": "derivada del producto" }],
            "problems": [
                { "id": "q1", "statement": "x", "targets": ["n1"], "hints": [], "solution": "", "attempts": [{ "answer": "a", "hints_used": 0, "verdict": "incorrect", "feedback": "", "at": now }] },
                { "id": "q2", "statement": "y", "targets": ["n2"], "hints": [], "solution": "", "attempts": [{ "answer": "b", "hints_used": 0, "verdict": "correct", "feedback": "", "at": now }] }
            ]
        })).unwrap();
        st.practice.save(&mut set).unwrap();
        let mut exam: crate::exam::Exam = serde_json::from_value(serde_json::json!({
            "id": "e1", "name": "AWS", "created_at": now, "updated_at": now,
            "domains": [{ "id": "d1", "name": "Seguridad en la nube", "weight": 50.0, "topics": [] }, { "id": "d2", "name": "Costos", "weight": 50.0, "topics": [] }],
            "mocks": [{ "id": "m1", "created_at": now, "questions": [], "result": { "answers": [], "correct": 9, "total": 14, "by_domain": [{ "domain_id": "d1", "correct": 2, "total": 7 }, { "domain_id": "d2", "correct": 7, "total": 7 }], "at": now } }],
            "goal": { "passing_pct": 70.0, "exam_date": (day() + chrono::Duration::days(5)).to_string() }
        })).unwrap();
        st.exams.save(&mut exam).unwrap();

        let m = model(&st, day());
        assert_eq!(topic(&m, "la regla de la cadena").status, Status::LeCuesta);
        assert_eq!(topic(&m, "derivada del producto").status, Status::Domina);
        assert!(topic(&m, "derivada del producto").evidence[0].contains("acertaste 1 de 1"));
        assert_eq!(topic(&m, "Seguridad en la nube").status, Status::LeCuesta);
        assert!(topic(&m, "Seguridad en la nube").evidence[0].contains("2 de 7"));
        assert_eq!(topic(&m, "Costos").status, Status::Domina);
        assert_eq!((m.upcoming[0].title.as_str(), m.upcoming[0].days, m.upcoming[0].screen.as_str()), ("AWS", 5, "exams"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_newest_signal_decides_and_evidence_accumulates() {
        let mut b = Builder::default();
        let old = Utc::now() - chrono::Duration::days(3);
        b.add("Derivadas", Status::LeCuesta, "confusión".into(), old, "confusión", true);
        b.add("las derivadas", Status::Domina, "práctica: acertaste 3 de 3".into(), Utc::now(), "práctica", false);
        b.add("derivadas", Status::LeCuesta, "vieja".into(), old - chrono::Duration::days(1), "memoria", false);
        assert_eq!(b.topics.len(), 1);
        let t = &b.topics[0];
        assert_eq!(t.status, Status::Domina);
        assert_eq!(t.evidence, vec!["práctica: acertaste 3 de 3", "confusión", "vieja"]);
        assert_eq!(t.sources, vec!["confusión", "práctica", "memoria"]);
        assert!(t.confusion);
    }

    fn sample() -> StudentModel {
        let now = Utc::now();
        let t = |name: &str, status, ev: &str, confusion| TopicState { key: normalize(name), name: name.into(), status, evidence: vec![ev.into()], at: now, sources: vec![], confusion };
        StudentModel {
            topics: vec![
                t("derivadas", Status::LeCuesta, "confusión: es el área", true),
                t("fuerzas", Status::LeCuesta, "le costó en «física»", false),
                t("límites", Status::Practicando, "práctica: acertaste 1 de 2", false),
                t("triángulos", Status::Domina, "terminaste la sesión", false),
            ],
            pending: vec![Pending { item: "la demostración".into(), session_id: "s9".into(), session_title: "geometría".into(), at: now }],
            upcoming: vec![Upcoming { title: "Parcial de Análisis derivadas".into(), date: "2026-11-02".into(), days: 3, screen: "academic".into(), id: "d1".into() }],
            preferences: vec!["ejemplos visuales".into()],
            cards_due: 12,
            minutes_7d: 30.0,
        }
    }

    #[test]
    fn the_agent_sees_what_relates_first_and_never_more_than_ten_lines() {
        let m = sample();
        let s = Session::new("triángulos y su altura");
        let block = state_section(&m, &s);
        assert!(block.contains("Prefiere: ejemplos visuales"));
        assert!(block.contains("Le cuesta: derivadas (confusión: es el área)"));
        assert!(block.contains("Ya domina: triángulos"), "related mastery is shown");
        assert!(block.contains("Pendiente de «geometría»: la demostración"));
        assert!(block.contains("Se viene: Parcial de Análisis derivadas en 3 días"));
        assert!(block.contains("12 tarjetas"));
        assert!(block.lines().filter(|l| l.starts_with("- ")).count() <= 10);
        let other = state_section(&m, &Session::new("historia"));
        assert!(!other.contains("Ya domina"), "unrelated mastery stays out: {other}");
    }

    #[test]
    fn today_puts_the_close_date_first_with_its_reason() {
        let plan = super::today(&sample());
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].title, "Prepará Parcial de Análisis derivadas");
        assert_eq!(plan[0].reason, "Parcial de Análisis derivadas en 3 días; te cuesta derivadas.");
        assert_eq!((plan[0].screen.as_str(), plan[0].target_id.as_deref()), ("academic", Some("d1")));
        assert_eq!(plan[1].title, "Repasá 12 tarjetas");
        assert_eq!((plan[2].screen.as_str(), plan[2].target_id.as_deref()), ("session", Some("s9")));
        let mut far = sample();
        far.upcoming[0].days = 20;
        far.cards_due = 0;
        far.pending.clear();
        let plan = super::today(&far);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].screen, "chat");
        assert!(plan[0].prompt.as_deref().unwrap().contains("derivadas"));
        assert_eq!(when(0), "hoy");
        assert_eq!(when(1), "mañana");
    }
}
