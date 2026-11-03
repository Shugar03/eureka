//! Flashcards with spaced repetition (SM-2, Anki-style grades). A deck is
//! written by hand or generated from an exam, graph ideas or pasted notes;
//! each review reschedules one card. Dates are local calendar days
//! (YYYY-MM-DD) sent by the UI, so "today" is the learner's today.

use crate::agent::Role;
use crate::practice::forced_valid;
use crate::AppState;
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const CARDS_TOOL: &str = "set_cards";
pub const MAX_GENERATED: usize = 40;
pub const MAX_TEXT: usize = 2000;
const MIN_EASE: f64 = 1.3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grade {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Card {
    pub id: String,
    pub front: String,
    pub back: String,
    /// SM-2 ease factor (starts at 2.5, never below 1.3).
    pub ease: f64,
    /// Days until the next review after the last one.
    pub interval: u32,
    /// Successful reviews in a row (0 = new or just failed).
    pub reps: u32,
    pub lapses: u32,
    /// Next review, local date YYYY-MM-DD. New cards are due on creation.
    pub due: String,
    #[serde(default)]
    pub reviewed: Option<String>,
}

impl Card {
    pub fn new(front: &str, back: &str, today: NaiveDate) -> Self {
        Self {
            id: uuid::Uuid::new_v4().simple().to_string(),
            front: front.trim().to_string(),
            back: back.trim().to_string(),
            ease: 2.5,
            interval: 0,
            reps: 0,
            lapses: 0,
            due: today.to_string(),
            reviewed: None,
        }
    }
}

/// Where a generated deck came from (to link it back).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DeckSource {
    Manual,
    Exam { id: String },
    Graph,
    Notes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: String,
    pub name: String,
    pub source: DeckSource,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub cards: Vec<Card>,
}

#[derive(Debug, Serialize)]
pub struct DeckSummary {
    pub id: String,
    pub name: String,
    pub source: DeckSource,
    pub updated_at: DateTime<Utc>,
    pub total: usize,
    /// Cards never reviewed.
    pub new: usize,
    /// Reviewed cards due on `today` or before.
    pub due: usize,
}

impl Deck {
    pub fn summary(&self, today: NaiveDate) -> DeckSummary {
        let today = today.to_string();
        DeckSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            source: self.source.clone(),
            updated_at: self.updated_at,
            total: self.cards.len(),
            new: self.cards.iter().filter(|c| c.reviewed.is_none()).count(),
            due: self.cards.iter().filter(|c| c.reviewed.is_some() && c.due <= today).count(),
        }
    }
}

pub fn parse_day(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| anyhow!("fecha inválida: {s}"))
}

// ── Pure: scheduling (SM-2) ───────────────────────────────────────────────

/// Days until the next review if the card got `grade` now (for the buttons).
pub fn next_interval(c: &Card, grade: Grade) -> u32 {
    match grade {
        Grade::Again => 0,
        Grade::Hard => if c.reps == 0 { 1 } else { ((c.interval as f64) * 1.2).round().max(c.interval as f64 + 1.0) as u32 },
        Grade::Good => match c.reps {
            0 => 1,
            1 => 3,
            _ => ((c.interval as f64) * c.ease).round().max(c.interval as f64 + 1.0) as u32,
        },
        Grade::Easy => match c.reps {
            0 => 4,
            _ => ((c.interval as f64) * c.ease * 1.3).round().max(c.interval as f64 + 2.0) as u32,
        },
    }
}

/// Reschedules a card. "Again" keeps it due today, so it comes back in the session.
pub fn review(c: &Card, grade: Grade, today: NaiveDate) -> Card {
    let interval = next_interval(c, grade);
    let (ease, reps, lapses) = match grade {
        Grade::Again => (c.ease - 0.2, 0, c.lapses + u32::from(c.reps > 0)),
        Grade::Hard => (c.ease - 0.15, c.reps + 1, c.lapses),
        Grade::Good => (c.ease, c.reps + 1, c.lapses),
        Grade::Easy => (c.ease + 0.15, c.reps + 1, c.lapses),
    };
    Card {
        ease: ease.max(MIN_EASE),
        interval,
        reps,
        lapses,
        due: (today + Duration::days(i64::from(interval))).to_string(),
        reviewed: Some(today.to_string()),
        ..c.clone()
    }
}

// ── Pure: generation ──────────────────────────────────────────────────────

pub fn cards_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": CARDS_TOOL,
        "description": "Guarda las tarjetas.",
        "parameters": { "type": "object", "properties": { "cards": { "type": "array", "items": {
            "type": "object",
            "properties": {
                "front": { "type": "string", "description": "Pregunta o pista corta" },
                "back": { "type": "string", "description": "Respuesta breve" }
            },
            "required": ["front", "back"]
        }}}, "required": ["cards"] }
    }})
}

/// Keeps cards with both sides, without repeated fronts, capped.
pub fn validate_cards(raw: &str, today: NaiveDate) -> Result<Vec<Card>> {
    #[derive(Deserialize)]
    struct Raw {
        cards: Vec<RawCard>,
    }
    #[derive(Deserialize)]
    struct RawCard {
        front: String,
        back: String,
    }
    let r: Raw = serde_json::from_str(raw).context("el generador de tarjetas devolvió datos inválidos")?;
    let mut seen = HashSet::new();
    let cards: Vec<Card> = r
        .cards
        .into_iter()
        .filter(|c| {
            let (f, b) = (c.front.trim(), c.back.trim());
            !f.is_empty() && !b.is_empty() && f.len() <= MAX_TEXT && b.len() <= MAX_TEXT && seen.insert(f.to_lowercase())
        })
        .take(MAX_GENERATED)
        .map(|c| Card::new(&c.front, &c.back, today))
        .collect();
    if cards.is_empty() {
        return Err(anyhow!("El generador no devolvió tarjetas válidas."));
    }
    Ok(cards)
}

/// What to make cards from (AC-47).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CardSource {
    Exam { id: String },
    Graph { node_ids: Vec<String> },
    Notes { text: String },
}

pub fn cards_input(material: &str, count: usize) -> String {
    format!("Escribí {count} tarjetas de memoria a partir de este material.\n\n{material}")
}

// ── Store ──────────────────────────────────────────────────────────────────

pub struct DeckStore {
    dir: PathBuf,
}

impl DeckStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("decks") }
    }

    fn path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<Deck> {
        Ok(serde_json::from_str(&std::fs::read_to_string(self.path(id)).context("mazo no encontrado")?)?)
    }

    pub fn save(&self, d: &mut Deck) -> Result<()> {
        d.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&d.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(d)?)?;
        std::fs::rename(tmp, self.path(&d.id))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    pub fn all(&self) -> Vec<Deck> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<Deck> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Deck>(&raw).ok())
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }
}

// ── Commands' logic ────────────────────────────────────────────────────────

fn new_deck(name: &str, source: DeckSource, cards: Vec<Card>) -> Result<Deck> {
    let name = name.trim();
    if name.is_empty() {
        return Err(anyhow!("Poné un nombre al mazo."));
    }
    let now = Utc::now();
    Ok(Deck { id: uuid::Uuid::new_v4().simple().to_string(), name: name.chars().take(80).collect(), source, created_at: now, updated_at: now, cards })
}

pub fn create_empty(state: &AppState, name: &str) -> Result<Deck> {
    let mut d = new_deck(name, DeckSource::Manual, vec![])?;
    state.decks.save(&mut d)?;
    Ok(d)
}

/// AC-47: generates a deck from an exam's syllabus and failures, graph ideas or notes.
pub async fn generate(state: &AppState, name: &str, source: CardSource, count: usize, today: &str) -> Result<Deck> {
    let today = parse_day(today)?;
    let count = count.clamp(1, MAX_GENERATED);
    let (material, deck_source) = match &source {
        CardSource::Exam { id } => {
            let exam = state.exams.load(id)?;
            (crate::exam::sheet_input(&exam, &[]), DeckSource::Exam { id: id.clone() })
        }
        CardSource::Graph { node_ids } => {
            let view = state.graph.view();
            let ideas: Vec<String> = view.nodes.iter().filter(|n| node_ids.contains(&n.id)).map(|n| format!("- {}", n.text)).collect();
            if ideas.is_empty() {
                return Err(anyhow!("Elegí al menos una idea del grafo."));
            }
            (format!("## Ideas que el aprendiz ya entendió\n{}", ideas.join("\n")), DeckSource::Graph)
        }
        CardSource::Notes { text } => {
            if text.trim().is_empty() {
                return Err(anyhow!("Pegá el texto de tus apuntes."));
            }
            (crate::extract::truncate(format!("## Apuntes del aprendiz\n{}", text.trim())), DeckSource::Notes)
        }
    };
    let mut deck = new_deck(name, deck_source, vec![])?;
    deck.cards = forced_valid(state, Role::Practice, "cards_generate", cards_tool(), CARDS_TOOL, cards_input(&material, count), |raw| validate_cards(raw, today)).await?;
    state.decks.save(&mut deck)?;
    Ok(deck)
}

pub fn upsert_card(state: &AppState, deck_id: &str, card_id: Option<&str>, front: &str, back: &str, today: &str) -> Result<Deck> {
    let (front, back) = (front.trim(), back.trim());
    if front.is_empty() || back.is_empty() {
        return Err(anyhow!("La tarjeta necesita frente y dorso."));
    }
    if front.len() > MAX_TEXT || back.len() > MAX_TEXT {
        return Err(anyhow!("La tarjeta es demasiado larga (máximo {MAX_TEXT} caracteres por lado)."));
    }
    let mut deck = state.decks.load(deck_id)?;
    match card_id {
        Some(id) => {
            let c = deck.cards.iter_mut().find(|c| c.id == id).ok_or_else(|| anyhow!("tarjeta no encontrada"))?;
            c.front = front.to_string();
            c.back = back.to_string();
        }
        None => deck.cards.push(Card::new(front, back, parse_day(today)?)),
    }
    state.decks.save(&mut deck)?;
    Ok(deck)
}

/// AC-60/152/154: a new deck from cards that came from outside (Anki, a
/// shared file). Repeated fronts and sides that are empty or too long are left
/// out; returns the deck and how many were left out.
pub fn import_deck(store: &DeckStore, name: &str, cards: &[(String, String)], today: NaiveDate) -> Result<(Deck, usize)> {
    let mut seen = HashSet::new();
    let kept: Vec<Card> = cards
        .iter()
        .map(|(f, b)| (f.trim(), b.trim()))
        .filter(|(f, b)| !f.is_empty() && !b.is_empty() && f.len() <= MAX_TEXT && b.len() <= MAX_TEXT && seen.insert(f.to_lowercase()))
        .map(|(f, b)| Card::new(f, b, today))
        .collect();
    if kept.is_empty() {
        return Err(anyhow!("No encontré tarjetas en el archivo."));
    }
    let skipped = cards.len() - kept.len();
    let mut deck = new_deck(name, DeckSource::Manual, kept)?;
    store.save(&mut deck)?;
    Ok((deck, skipped))
}

/// AC-57: adds cards to the deck called `name` (created if missing),
/// skipping fronts already there. Returns how many were added.
pub fn add_to_named_deck(store: &DeckStore, name: &str, source: DeckSource, cards: &[(String, String)], today: NaiveDate) -> Result<usize> {
    let mut deck = match store.all().into_iter().find(|d| d.name == name && d.source == source) {
        Some(d) => d,
        None => new_deck(name, source, vec![])?,
    };
    let mut seen: HashSet<String> = deck.cards.iter().map(|c| c.front.to_lowercase()).collect();
    let mut added = 0;
    for (front, back) in cards {
        let (f, b) = (front.trim(), back.trim());
        if f.is_empty() || b.is_empty() || !seen.insert(f.to_lowercase()) {
            continue;
        }
        deck.cards.push(Card::new(f, b, today));
        added += 1;
    }
    if added > 0 {
        store.save(&mut deck)?;
    }
    Ok(added)
}

/// A failed mock question as a card: the question with its options on the
/// front, the right option(s) and the explanation on the back.
pub fn question_card(q: &crate::exam::Question) -> (String, String) {
    let letter = |i: usize| (b'A' + i as u8) as char;
    let mut front = q.stem.trim().to_string();
    if q.answer.len() > 1 {
        front.push_str(&format!("\n\n*(Elegí {})*", q.answer.len()));
    }
    for (i, o) in q.options.iter().enumerate() {
        front.push_str(&format!("\n- {}) {o}", letter(i)));
    }
    let right: Vec<String> = q.answer.iter().filter_map(|&i| q.options.get(i).map(|o| format!("{}) {o}", letter(i)))).collect();
    let mut back = format!("**{}**", right.join(" · "));
    if !q.explanation.trim().is_empty() {
        back.push_str(&format!("\n\n{}", q.explanation.trim()));
    }
    (front, back)
}

pub fn delete_card(state: &AppState, deck_id: &str, card_id: &str) -> Result<Deck> {
    let mut deck = state.decks.load(deck_id)?;
    deck.cards.retain(|c| c.id != card_id);
    state.decks.save(&mut deck)?;
    Ok(deck)
}

pub fn grade_card(state: &AppState, deck_id: &str, card_id: &str, grade: Grade, today: &str) -> Result<Deck> {
    let today = parse_day(today)?;
    let mut deck = state.decks.load(deck_id)?;
    let c = deck.cards.iter_mut().find(|c| c.id == card_id).ok_or_else(|| anyhow!("tarjeta no encontrada"))?;
    *c = review(c, grade, today);
    state.decks.save(&mut deck)?;
    Ok(deck)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    #[test]
    fn a_new_card_climbs_1_3_then_by_ease() {
        let today = day("2026-10-27");
        let c = Card::new(" ¿Puerto de HTTPS? ", " 443 ", today);
        assert_eq!((c.front.as_str(), c.back.as_str(), c.due.as_str()), ("¿Puerto de HTTPS?", "443", "2026-10-27"));
        let c1 = review(&c, Grade::Good, today);
        assert_eq!((c1.interval, c1.reps, c1.due.as_str()), (1, 1, "2026-10-28"));
        let c2 = review(&c1, Grade::Good, day("2026-10-28"));
        assert_eq!((c2.interval, c2.due.as_str()), (3, "2026-10-31"));
        let c3 = review(&c2, Grade::Good, day("2026-10-31"));
        assert_eq!(c3.interval, 8, "3 × 2.5 = 7.5 → 8");
        assert_eq!(c3.reviewed.as_deref(), Some("2026-10-31"));
    }

    #[test]
    fn again_resets_and_lowers_ease_but_not_below_the_floor() {
        let today = day("2026-10-27");
        let mut c = review(&review(&Card::new("a", "b", today), Grade::Good, today), Grade::Good, today);
        c = review(&c, Grade::Again, today);
        assert_eq!((c.interval, c.reps, c.lapses, c.due.as_str()), (0, 0, 1, "2026-10-27"), "back in today's session");
        assert!((c.ease - 2.3).abs() < 1e-9);
        let fresh_fail = review(&Card::new("x", "y", today), Grade::Again, today);
        assert_eq!(fresh_fail.lapses, 0, "failing a new card is not a lapse");
        for _ in 0..20 {
            c = review(&c, Grade::Again, today);
        }
        assert_eq!(c.ease, MIN_EASE);
    }

    #[test]
    fn hard_and_easy_bracket_good() {
        let today = day("2026-10-27");
        let mut c = Card::new("a", "b", today);
        c.reps = 3;
        c.interval = 10;
        assert_eq!([next_interval(&c, Grade::Again), next_interval(&c, Grade::Hard), next_interval(&c, Grade::Good), next_interval(&c, Grade::Easy)], [0, 12, 25, 33]);
        assert_eq!(next_interval(&Card::new("a", "b", today), Grade::Easy), 4);
        assert!((review(&c, Grade::Easy, today).ease - 2.65).abs() < 1e-9);
        assert!((review(&c, Grade::Hard, today).ease - 2.35).abs() < 1e-9);
        c.interval = 1;
        c.ease = 1.3;
        assert_eq!(next_interval(&c, Grade::Good), 2, "always at least one more day");
    }

    #[test]
    fn summary_counts_new_and_due_on_the_local_day() {
        let today = day("2026-10-27");
        let mut d = new_deck(" AWS ", DeckSource::Manual, vec![Card::new("n", "1", today)]).unwrap();
        d.cards.push(review(&Card::new("tomorrow", "2", today), Grade::Good, today));
        d.cards.push(review(&Card::new("today", "3", today), Grade::Again, today));
        let s = d.summary(today);
        assert_eq!((s.name.as_str(), s.total, s.new, s.due), ("AWS", 3, 1, 1));
        assert_eq!(d.summary(day("2026-10-28")).due, 2);
        assert!(new_deck("  ", DeckSource::Manual, vec![]).is_err());
    }

    #[test]
    fn generated_cards_are_validated() {
        let today = day("2026-10-27");
        let raw = json!({ "cards": [
            { "front": "¿S3?", "back": "Almacenamiento de objetos" },
            { "front": " ", "back": "x" },
            { "front": "sin dorso", "back": "" },
            { "front": "¿s3?", "back": "repetida" },
            { "front": "¿EC2?", "back": "Cómputo" }
        ]})
        .to_string();
        let cards = validate_cards(&raw, today).unwrap();
        assert_eq!(cards.iter().map(|c| c.front.as_str()).collect::<Vec<_>>(), ["¿S3?", "¿EC2?"]);
        assert!(cards.iter().all(|c| c.reviewed.is_none() && c.due == "2026-10-27"));
        assert!(validate_cards(r#"{"cards":[]}"#, today).is_err());
        let many = json!({ "cards": (0..60).map(|i| json!({ "front": format!("f{i}"), "back": "b" })).collect::<Vec<_>>() }).to_string();
        assert_eq!(validate_cards(&many, today).unwrap().len(), MAX_GENERATED);
        assert!(cards_input("material", 12).starts_with("Escribí 12 tarjetas"));
        assert!(parse_day("2026-13-01").is_err());
    }

    #[test]
    fn named_decks_collect_new_cards_once() {
        let dir = std::env::temp_dir().join(format!("la-decks-{}", uuid::Uuid::new_v4().simple()));
        let st = DeckStore::new(&dir);
        let today = day("2026-10-27");
        let src = DeckSource::Exam { id: "e1".into() };
        let c = |f: &str| (f.to_string(), "b".to_string());
        assert_eq!(add_to_named_deck(&st, "Falladas: AWS", src.clone(), &[c("uno"), c("dos"), c(" ")], today).unwrap(), 2);
        assert_eq!(add_to_named_deck(&st, "Falladas: AWS", src.clone(), &[c("UNO"), c("tres")], today).unwrap(), 1, "same front not twice");
        assert_eq!(add_to_named_deck(&st, "Falladas: AWS", src, &[c("uno")], today).unwrap(), 0);
        let all = st.all();
        assert_eq!((all.len(), all[0].cards.len()), (1, 3));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_failed_question_becomes_a_card() {
        let q = crate::exam::Question { id: "m1".into(), domain_id: "d1".into(), topic_id: None, stem: "¿Cuál?".into(), options: vec!["S3".into(), "EC2".into(), "IAM".into()], answer: vec![0, 2], explanation: "Porque sí.".into(), reported: None };
        let (f, b) = question_card(&q);
        assert_eq!(f, "¿Cuál?\n\n*(Elegí 2)*\n- A) S3\n- B) EC2\n- C) IAM");
        assert_eq!(b, "**A) S3 · C) IAM**\n\nPorque sí.");
    }

    #[test]
    fn an_imported_deck_is_new_even_with_a_repeated_name_and_leaves_bad_cards_out() {
        let dir = std::env::temp_dir().join(format!("la-import-{}", uuid::Uuid::new_v4().simple()));
        let store = DeckStore::new(&dir);
        let today = day("2026-10-29");
        let cards = vec![("Hola".into(), "Hello".into()), ("hola".into(), "Hi".into()), ("".into(), "x".into()), ("Largo".into(), "a".repeat(MAX_TEXT + 1))];
        let (first, skipped) = import_deck(&store, "Inglés", &cards, today).unwrap();
        assert_eq!((first.cards.len(), skipped), (1, 3));
        let (second, _) = import_deck(&store, "Inglés", &cards, today).unwrap();
        assert_ne!(first.id, second.id, "a second import never fills the first deck");
        assert_eq!(store.all().len(), 2);
        assert!(import_deck(&store, "Nada", &[("".into(), "".into())], today).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("la-decks-{}", uuid::Uuid::new_v4().simple()));
        let st = DeckStore::new(&dir);
        let mut d = new_deck("Mazo", DeckSource::Exam { id: "e1".into() }, vec![]).unwrap();
        st.save(&mut d).unwrap();
        assert_eq!(st.load(&d.id).unwrap().source, DeckSource::Exam { id: "e1".into() });
        assert_eq!(st.all().len(), 1);
        assert_eq!(serde_json::to_value(&d.source).unwrap(), json!({ "kind": "exam", "id": "e1" }));
        st.delete(&d.id).unwrap();
        assert!(st.all().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }
}
