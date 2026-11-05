//! Knowledge graph (Phase 2). Propositions are nodes; chains (premises →
//! conclusion) are the stored truth and edges are DERIVED from them.
//!
//! Storage is one append-only ledger, `graph/extractions.jsonl`: one line per
//! extraction (a session or imported notes). The graph is rebuilt by folding
//! the LATEST extraction of each source, so re-extracting a session replaces
//! its contribution without rewriting history.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_PROPOSITIONS: usize = 60;
pub const MAX_CHAINS: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Source {
    Session { id: String, title: String },
    Notes { id: String, title: String },
}

impl Source {
    pub fn key(&self) -> String {
        match self {
            Source::Session { id, .. } => format!("session:{id}"),
            Source::Notes { id, .. } => format!("notes:{id}"),
        }
    }
}

/// What the extractor returns; `key`s are local to one extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawProposition {
    pub key: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawChain {
    pub premises: Vec<String>,
    pub conclusion: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawExtraction {
    #[serde(default)]
    pub propositions: Vec<RawProposition>,
    #[serde(default)]
    pub chains: Vec<RawChain>,
}

/// One ledger line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extraction {
    pub source: Source,
    pub at: DateTime<Utc>,
    pub propositions: Vec<RawProposition>,
    pub chains: Vec<RawChain>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: String,
    pub text: String,
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Chain {
    pub premises: Vec<String>,
    pub conclusion: String,
    pub source: Source,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GraphView {
    pub nodes: Vec<Node>,
    pub chains: Vec<Chain>,
    pub edges: Vec<Edge>,
}

/// What a session shows after extraction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphSummary {
    pub propositions: usize,
    pub chains: usize,
    pub at: DateTime<Utc>,
    /// How many session messages the extraction saw: more now → worth re-extracting.
    #[serde(default)]
    pub messages: usize,
}

/// Lowercase, accents stripped, punctuation dropped, spaces collapsed.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars().flat_map(char::to_lowercase) {
        let c = match ch {
            'á' | 'à' | 'â' | 'ä' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        };
        if c == ' ' {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
    }
    out.trim_end().to_string()
}

/// Stable node id from the normalized text (FNV-1a, 64 bit).
pub fn node_id(text: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in normalize(text).bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("p{h:016x}")
}

/// Cleans what the model returned (NF-11). Never fails on content: invalid
/// parts are dropped. Errors only when nothing usable remains.
pub fn validate(raw: RawExtraction) -> Result<(Vec<RawProposition>, Vec<RawChain>), String> {
    let mut props: Vec<RawProposition> = Vec::new();
    // key → canonical key (duplicates by text collapse onto the first one).
    let mut alias: HashMap<String, String> = HashMap::new();
    let mut by_text: HashMap<String, String> = HashMap::new();
    for p in raw.propositions {
        let text = p.text.trim().to_string();
        let key = p.key.trim().to_string();
        let norm = normalize(&text);
        if norm.is_empty() || key.is_empty() || alias.contains_key(&key) {
            continue;
        }
        if let Some(first) = by_text.get(&norm) {
            alias.insert(key, first.clone());
            continue;
        }
        if props.len() >= MAX_PROPOSITIONS {
            break;
        }
        by_text.insert(norm, key.clone());
        alias.insert(key.clone(), key.clone());
        props.push(RawProposition { key, text });
    }
    if props.is_empty() {
        return Err("el extractor no devolvió ninguna proposición válida".into());
    }

    let mut chains: Vec<RawChain> = Vec::new();
    let mut seen: HashSet<(Vec<String>, String)> = HashSet::new();
    for c in raw.chains {
        let Some(conclusion) = alias.get(c.conclusion.trim()).cloned() else { continue };
        let mut premises: Vec<String> = c.premises.iter().filter_map(|k| alias.get(k.trim()).cloned()).collect();
        premises.sort();
        premises.dedup();
        // Every premise must exist, and a chain cannot conclude one of its premises.
        if premises.is_empty() || premises.len() != c.premises.iter().collect::<HashSet<_>>().len() || premises.contains(&conclusion) {
            continue;
        }
        if !seen.insert((premises.clone(), conclusion.clone())) {
            continue;
        }
        if chains.len() >= MAX_CHAINS {
            break;
        }
        chains.push(RawChain { premises, conclusion });
    }
    Ok((props, chains))
}

/// The latest extraction of each source, oldest first (a forgotten source's is empty).
pub fn latest(ledger: &[Extraction]) -> Vec<&Extraction> {
    let mut latest: BTreeMap<String, &Extraction> = BTreeMap::new();
    for e in ledger {
        let k = e.source.key();
        if latest.get(&k).is_none_or(|prev| prev.at <= e.at) {
            latest.insert(k, e);
        }
    }
    let mut extractions: Vec<&Extraction> = latest.into_values().collect();
    extractions.sort_by_key(|e| e.at);
    extractions
}

/// Rebuilds the graph from the ledger: latest extraction per source wins.
pub fn fold(ledger: &[Extraction]) -> GraphView {
    let extractions = latest(ledger);

    let mut nodes: Vec<Node> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut chains = Vec::new();
    for e in extractions {
        let mut ids: HashMap<&str, String> = HashMap::new();
        for p in &e.propositions {
            let id = node_id(&p.text);
            ids.insert(p.key.as_str(), id.clone());
            match index.get(&id) {
                Some(&i) => {
                    if !nodes[i].sources.contains(&e.source) {
                        nodes[i].sources.push(e.source.clone());
                    }
                }
                None => {
                    index.insert(id.clone(), nodes.len());
                    nodes.push(Node { id, text: p.text.clone(), sources: vec![e.source.clone()] });
                }
            }
        }
        for c in &e.chains {
            let (Some(conclusion), Some(premises)) = (
                ids.get(c.conclusion.as_str()),
                c.premises.iter().map(|k| ids.get(k.as_str()).cloned()).collect::<Option<Vec<_>>>(),
            ) else {
                continue;
            };
            chains.push(Chain { premises, conclusion: conclusion.clone(), source: e.source.clone() });
        }
    }
    let edges = derive_edges(&chains);
    GraphView { nodes, chains, edges }
}

/// Unique premise → conclusion pairs, in first-seen order.
pub fn derive_edges(chains: &[Chain]) -> Vec<Edge> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for c in chains {
        for p in &c.premises {
            if seen.insert((p.clone(), c.conclusion.clone())) {
                out.push(Edge { from: p.clone(), to: c.conclusion.clone() });
            }
        }
    }
    out
}

const STOPWORDS: &[&str] = &[
    "para", "como", "porque", "pero", "sobre", "entre", "cada", "cual", "cuando", "donde", "esta", "este", "esto", "estos",
    "esas", "esos", "eso", "una", "unos", "unas", "que", "por", "con", "los", "las", "del", "sus", "más", "mas", "muy",
    "funciona", "entender", "quiero", "saber", "hace", "tiene", "son", "ser", "qué", "cómo", "the", "what", "how", "why",
];

fn words(text: &str) -> HashSet<String> {
    normalize(text)
        .split(' ')
        .filter(|w| w.len() >= 4 && !STOPWORDS.contains(w))
        // crude stemming: "derivadas" ~ "derivada"
        .map(|w| w.strip_suffix('s').unwrap_or(w).to_string())
        .collect()
}

/// Up to `n` propositions sharing meaningful words with `query` (AC-20),
/// best first. Shared words are weighted by IDF inside the graph (audit M7):
/// a rare word ("tangente") says more than one in every idea ("derivada").
pub fn relevant<'a>(view: &'a GraphView, query: &str, n: usize) -> Vec<&'a Node> {
    let q = words(query);
    if q.is_empty() || view.nodes.is_empty() {
        return vec![];
    }
    let docs: Vec<HashSet<String>> = view.nodes.iter().map(|node| words(&node.text)).collect();
    let total = docs.len() as f64;
    let idf = |w: &String| {
        let df = docs.iter().filter(|d| d.contains(w)).count() as f64;
        (total / df.max(1.0)).ln() + 1.0
    };
    let mut scored: Vec<(f64, &Node)> = view
        .nodes
        .iter()
        .zip(&docs)
        .map(|(node, d)| (d.intersection(&q).map(idf).sum::<f64>(), node))
        .filter(|(s, _)| *s > 0.0)
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(b.1.sources.len().cmp(&a.1.sources.len())));
    scored.into_iter().take(n).map(|(_, node)| node).collect()
}

pub struct GraphStore {
    file: PathBuf,
}

impl GraphStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { file: data_dir.join("graph").join("extractions.jsonl") }
    }

    pub fn ledger(&self) -> Vec<Extraction> {
        std::fs::read_to_string(&self.file)
            .map(|raw| raw.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
            .unwrap_or_default()
    }

    pub fn view(&self) -> GraphView {
        fold(&self.ledger())
    }

    /// Forgets a source: an empty extraction replaces its contribution (the
    /// ledger stays append-only).
    pub fn forget(&self, source: Source) -> Result<()> {
        self.append(&Extraction { source, at: Utc::now(), propositions: vec![], chains: vec![] })
    }

    pub fn append(&self, e: &Extraction) -> Result<()> {
        std::fs::create_dir_all(self.file.parent().unwrap())?;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.file)?;
        writeln!(f, "{}", serde_json::to_string(e)?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn p(key: &str, text: &str) -> RawProposition {
        RawProposition { key: key.into(), text: text.into() }
    }
    fn c(premises: &[&str], conclusion: &str) -> RawChain {
        RawChain { premises: premises.iter().map(|s| s.to_string()).collect(), conclusion: conclusion.into() }
    }
    fn session(id: &str) -> Source {
        Source::Session { id: id.into(), title: id.into() }
    }
    fn extraction(source: Source, minutes: i64, props: Vec<RawProposition>, chains: Vec<RawChain>) -> Extraction {
        Extraction { source, at: DateTime::<Utc>::UNIX_EPOCH + Duration::minutes(minutes), propositions: props, chains }
    }

    #[test]
    fn normalize_ignores_case_accents_punctuation_and_spaces() {
        assert_eq!(normalize("  La Pendiente   mide cuánto sube. "), "la pendiente mide cuanto sube");
        assert_eq!(normalize("¿Ñandú?"), "nandu");
        assert_eq!(normalize("áàâäã éèêë íìîï óòôöõ úùûü ç"), "aaaaa eeee iiii ooooo uuuu c");
        assert_eq!(node_id("La derivada!"), node_id("la   DERIVADA"));
        assert_ne!(node_id("a"), node_id("b"));
    }

    #[test]
    fn validate_drops_invalid_parts() {
        let raw = RawExtraction {
            propositions: vec![p("a", "Idea A"), p("b", "Idea B"), p("a", "duplicada por clave"), p("x", "   "), p("b2", "idea b.")],
            chains: vec![
                c(&["a"], "b"),      // ok
                c(&["a"], "b"),      // duplicate
                c(&["zzz"], "b"),    // unknown premise
                c(&["a", "b"], "b"), // concludes a premise
                c(&[], "a"),         // no premises
                c(&["b2"], "a"),     // b2 is an alias of b → ok
            ],
        };
        let (props, chains) = validate(raw).unwrap();
        assert_eq!(props.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(chains.len(), 2);
        assert_eq!(chains[1].premises, ["b"]);
    }

    #[test]
    fn validate_caps_sizes_and_rejects_empty() {
        let many = RawExtraction {
            propositions: (0..100).map(|i| p(&format!("k{i}"), &format!("idea {i}"))).collect(),
            chains: (1..100).map(|i| c(&["k0"], &format!("k{}", i % 60))).collect(),
        };
        let (props, chains) = validate(many).unwrap();
        assert_eq!(props.len(), MAX_PROPOSITIONS);
        assert!(chains.len() <= MAX_CHAINS);
        assert!(validate(RawExtraction::default()).is_err());
    }

    #[test]
    fn fold_merges_same_idea_across_sources() {
        let ledger = vec![
            extraction(session("s1"), 1, vec![p("a", "La pendiente mide cuánto sube"), p("b", "La derivada")], vec![c(&["a"], "b")]),
            extraction(Source::Notes { id: "n1".into(), title: "Notas".into() }, 2, vec![p("x", "la pendiente mide cuanto sube.")], vec![]),
        ];
        let g = fold(&ledger);
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.nodes[0].sources.len(), 2);
        assert_eq!(g.edges, vec![Edge { from: g.nodes[0].id.clone(), to: g.nodes[1].id.clone() }]);
    }

    #[test]
    fn latest_extraction_of_a_source_replaces_the_previous_one() {
        let ledger = vec![
            extraction(session("s1"), 1, vec![p("a", "Vieja"), p("b", "Otra")], vec![c(&["a"], "b")]),
            extraction(session("s1"), 5, vec![p("a", "Nueva")], vec![]),
        ];
        let g = fold(&ledger);
        assert_eq!(g.nodes.iter().map(|n| n.text.as_str()).collect::<Vec<_>>(), ["Nueva"]);
        assert!(g.chains.is_empty() && g.edges.is_empty());
    }

    #[test]
    fn edges_are_derived_and_unique() {
        let ledger = vec![
            extraction(session("s1"), 1, vec![p("a", "A"), p("b", "B"), p("c", "C")], vec![c(&["a", "b"], "c")]),
            extraction(session("s2"), 2, vec![p("a", "A"), p("c", "C")], vec![c(&["a"], "c")]),
        ];
        let g = fold(&ledger);
        assert_eq!(g.chains.len(), 2);
        assert_eq!(g.edges.len(), 2, "a→c appears once");
    }

    #[test]
    fn relevant_ranks_by_shared_meaningful_words() {
        let ledger = vec![extraction(
            session("s1"),
            1,
            vec![
                p("a", "La derivada es la pendiente de la recta tangente"),
                p("b", "Un límite describe a qué valor se acerca algo"),
                p("c", "Las derivadas de polinomios bajan el exponente"),
            ],
            vec![],
        )];
        let g = fold(&ledger);
        let r = relevant(&g, "Quiero entender la derivada de x al cubo", 12);
        let texts: Vec<&str> = r.iter().map(|n| n.text.as_str()).collect();
        assert!(texts.contains(&"La derivada es la pendiente de la recta tangente"));
        assert!(texts.contains(&"Las derivadas de polinomios bajan el exponente"), "plural matches");
        assert!(!texts.iter().any(|t| t.contains("límite")));
        assert!(relevant(&g, "qué es", 12).is_empty(), "only stopwords");
        assert_eq!(relevant(&g, "derivada", 1).len(), 1);
    }

    #[test]
    fn forgetting_a_source_removes_its_ideas_but_keeps_the_others() {
        let dir = std::env::temp_dir().join(format!("la-forget-{}", uuid::Uuid::new_v4().simple()));
        let st = GraphStore::new(&dir);
        st.append(&extraction(session("s1"), 1, vec![p("a", "La derivada es una pendiente")], vec![])).unwrap();
        st.append(&extraction(session("s2"), 2, vec![p("b", "Un límite es un valor al que se acerca")], vec![])).unwrap();
        st.forget(session("s1")).unwrap();
        let v = st.view();
        assert_eq!(v.nodes.iter().map(|n| n.text.as_str()).collect::<Vec<_>>(), ["Un límite es un valor al que se acerca"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rare_shared_words_rank_higher() {
        let ex = extraction(
            session("s"),
            1,
            vec![
                p("a", "La derivada mide el cambio"),
                p("b", "La derivada usa la recta tangente"),
                p("c", "La derivada de una suma"),
                p("d", "La derivada de un producto"),
            ],
            vec![],
        );
        let view = fold(&[ex]);
        let top = relevant(&view, "qué es la recta tangente de una derivada", 2);
        assert_eq!(top[0].text, "La derivada usa la recta tangente", "rare words (tangente, recta) win");
        assert!(relevant(&view, "fotosíntesis", 5).is_empty());
    }

    #[test]
    fn store_appends_and_skips_corrupt_lines() {
        let dir = std::env::temp_dir().join(format!("la-graph-{}", uuid::Uuid::new_v4().simple()));
        let st = GraphStore::new(&dir);
        assert!(st.view().nodes.is_empty());
        st.append(&extraction(session("s1"), 1, vec![p("a", "A")], vec![])).unwrap();
        std::fs::OpenOptions::new().append(true).open(dir.join("graph/extractions.jsonl")).unwrap().write_all(b"{roto\n").unwrap();
        st.append(&extraction(session("s2"), 2, vec![p("b", "B")], vec![])).unwrap();
        assert_eq!(st.ledger().len(), 2);
        assert_eq!(st.view().nodes.len(), 2);
        std::fs::remove_dir_all(dir).ok();
    }
}
