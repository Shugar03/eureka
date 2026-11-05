//! AC-200: the memory as Markdown pages with YAML frontmatter and `[[links]]`,
//! in the style of the Open Knowledge Format (a page per thing, metadata on
//! top, links between pages), so the folder opens as an Obsidian vault.
//! Output only: the database stays the source of truth.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::{Kind, Observation, Relation, SessionRow};
use crate::graph::normalize;

/// File-safe page name: no `:` or other characters Windows refuses.
pub fn slug(title: &str) -> String {
    let s: String = normalize(title).split_whitespace().collect::<Vec<_>>().join("-").chars().take(60).collect();
    let s = s.trim_end_matches('-').to_string();
    if s.is_empty() {
        "nota".into()
    } else {
        s
    }
}

/// A YAML string, always quoted and escaped.
fn y(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace(['\n', '\r'], " "))
}

fn folder(k: Kind) -> &'static str {
    match k {
        Kind::LeCuesta => "Le cuesta",
        Kind::Confusion => "Confusiones",
        Kind::Pendiente => "Pendientes",
        Kind::Domina => "Ya lo domina",
        Kind::Preferencia => "Cómo aprende",
        Kind::Idea => "Ideas",
    }
}

fn day(d: DateTime<Utc>) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn relation_label(kind: &str, outgoing: bool) -> &'static str {
    match (kind, outgoing) {
        ("reemplaza", true) => "Reemplaza a",
        ("reemplaza", false) => "Reemplazada por",
        ("prerrequisito", true) => "Es prerrequisito de",
        ("prerrequisito", false) => "Se apoya en",
        ("contradice", _) => "En conflicto con",
        _ => "Relacionada con",
    }
}

/// (relative path, text) of every page: one per observation, one per
/// remembered session, and `Inicio.md` linking them all.
pub fn pages(obs: &[Observation], rels: &[Relation], sessions: &[SessionRow], now: DateTime<Utc>) -> Vec<(String, String)> {
    // Unique names: the first keeps the slug, the next ones get their id.
    let mut used: HashSet<String> = HashSet::new();
    let mut name: HashMap<i64, String> = HashMap::new();
    for o in obs {
        let mut n = slug(&o.title);
        if !used.insert(n.clone()) {
            n = format!("{n}-{}", o.id);
            used.insert(n.clone());
        }
        name.insert(o.id, n);
    }
    let mut session_name: HashMap<String, String> = HashMap::new();
    for s in sessions {
        let mut n = format!("sesion-{}", slug(&s.title));
        if !used.insert(n.clone()) {
            n = format!("{n}-{}", s.rowid);
            used.insert(n.clone());
        }
        session_name.insert(s.id.clone(), n);
    }
    let session_of = |source: &str| source.split_once(':').filter(|(k, _)| *k == "session" || *k == "memory").and_then(|(_, id)| session_name.get(id));

    let mut out = Vec::new();
    for o in obs {
        let n = &name[&o.id];
        let mut fm = vec![
            "---".to_string(),
            format!("id: {}", y(&format!("eureka-m{}", o.id))),
            format!("type: {}", y(o.kind.as_str())),
            format!("title: {}", y(&o.title)),
            format!("tema: {}", y(&o.topic)),
            format!("state: {}", y(&o.state)),
            format!("verified: {}", o.verified),
            format!("by_student: {}", o.by_student),
            format!("confidence: {:.2}", o.confidence),
            format!("created: {}", day(o.created_at)),
            format!("updated: {}", day(o.updated_at)),
        ];
        if let Some(d) = &o.due {
            fm.push(format!("review: {}", y(d)));
        }
        fm.push(format!("sources: [{}]", o.evidence.iter().map(|e| y(&e.label)).collect::<Vec<_>>().join(", ")));
        fm.push(format!("tags: [eureka, {}]", o.kind.as_str().replace('_', "-")));
        fm.push("---".into());
        let mut body = format!("{}\n\n# {}\n\n*{}*", fm.join("\n"), o.title, o.kind.label());
        if !o.content.is_empty() && normalize(&o.content) != normalize(&o.title) {
            body.push_str(&format!("\n\n{}", o.content));
        }
        if !o.evidence.is_empty() {
            body.push_str("\n\n## Evidencia\n");
            for e in &o.evidence {
                let link = session_of(&e.source).map(|s| format!(" ([[{s}]])")).unwrap_or_default();
                body.push_str(&format!("\n- {} · {}{link}", day(e.at), e.label));
            }
        }
        let mine: Vec<String> = rels
            .iter()
            .filter_map(|r| {
                let (other, outgoing) = if r.from == o.id { (r.to, true) } else if r.to == o.id { (r.from, false) } else { return None };
                name.get(&other).map(|n| format!("- {} [[{n}]]{}", relation_label(&r.kind, outgoing), if r.reason.is_empty() { String::new() } else { format!(" ({})", r.reason) }))
            })
            .collect();
        if !mine.is_empty() {
            body.push_str(&format!("\n\n## Relaciones\n\n{}", mine.join("\n")));
        }
        body.push('\n');
        out.push((format!("{}/{n}.md", folder(o.kind)), body));
    }
    for s in sessions {
        let n = &session_name[&s.id];
        let linked: Vec<String> = obs.iter().filter(|o| o.evidence.iter().any(|e| session_of(&e.source) == Some(n))).map(|o| format!("- {}: [[{}]]", o.kind.label(), name[&o.id])).collect();
        let mut body = format!(
            "---\nid: {}\ntype: \"sesion\"\ntitle: {}\ndate: {}\ntags: [eureka, sesion]\n---\n\n# {}\n\n{}",
            y(&format!("eureka-s{}", s.rowid)),
            y(&s.title),
            day(s.at),
            s.title,
            s.summary
        );
        if !s.pending.is_empty() {
            body.push_str(&format!("\n\n**Pendiente:** {}", s.pending.join("; ")));
        }
        if !s.struggled.is_empty() {
            body.push_str(&format!("\n\n**Le costó:** {}", s.struggled.join("; ")));
        }
        if !linked.is_empty() {
            body.push_str(&format!("\n\n## Lo que dejó\n\n{}", linked.join("\n")));
        }
        body.push('\n');
        out.push((format!("Sesiones/{n}.md"), body));
    }
    let mut index = format!("---\ntitle: \"Lo que Eureka sabe de vos\"\ntype: \"indice\"\ncreated: {}\ntags: [eureka]\n---\n\n# Lo que Eureka sabe de vos\n\nExportado de Eureka el {}. Cada página es una observación; los enlaces llevan a su evidencia y a las relacionadas.\n", day(now), now.format("%d/%m/%Y"));
    for k in Kind::ALL {
        let of: Vec<&Observation> = obs.iter().filter(|o| o.kind == k).collect();
        if of.is_empty() {
            continue;
        }
        index.push_str(&format!("\n## {} ({})\n\n", k.label(), of.len()));
        for o in of {
            index.push_str(&format!("- [[{}|{}]]\n", name[&o.id], o.title.replace(['[', ']', '|'], " ")));
        }
    }
    if !sessions.is_empty() {
        index.push_str(&format!("\n## Sesiones ({})\n\n", sessions.len()));
        for s in sessions {
            index.push_str(&format!("- [[{}|{}]]\n", session_name[&s.id], s.title.replace(['[', ']', '|'], " ")));
        }
    }
    out.push(("Inicio.md".into(), index));
    out
}
