//! A deck to send by WhatsApp or mail, without a server (AC-154): a small
//! JSON file (`.eureka`) with the deck's name and cards, never its review
//! history. It arrives from someone else, so everything in it is checked.

use crate::cards::MAX_TEXT;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

pub const EXTENSION: &str = "eureka";
const KIND: &str = "mazo";
const VERSION: u32 = 1;
pub const MAX_SHARED_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_SHARED_CARDS: usize = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedCard {
    pub front: String,
    pub back: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedDeck {
    pub eureka: String,
    pub version: u32,
    pub name: String,
    pub cards: Vec<SharedCard>,
}

/// What the person sees before importing: the deck, and what was left out.
#[derive(Debug, Serialize, PartialEq)]
pub struct Incoming {
    pub name: String,
    pub cards: Vec<(String, String)>,
    pub skipped: usize,
}

pub fn to_file(name: &str, cards: &[(String, String)]) -> Result<Vec<u8>> {
    if cards.is_empty() {
        bail!("El mazo no tiene tarjetas para compartir.");
    }
    let deck = SharedDeck { eureka: KIND.into(), version: VERSION, name: name.trim().into(), cards: cards.iter().map(|(f, b)| SharedCard { front: f.clone(), back: b.clone() }).collect() };
    Ok(serde_json::to_vec_pretty(&deck)?)
}

pub fn from_file(bytes: &[u8]) -> Result<Incoming> {
    const NOT_A_DECK: &str = "Ese archivo no es un mazo compartido de Eureka (.eureka).";
    if bytes.len() > MAX_SHARED_BYTES {
        bail!("El mazo compartido es demasiado grande.");
    }
    let Ok(deck) = serde_json::from_slice::<SharedDeck>(bytes) else { bail!(NOT_A_DECK) };
    if deck.eureka != KIND {
        bail!(NOT_A_DECK);
    }
    if deck.version > VERSION {
        bail!("Ese mazo es de una versión más nueva de Eureka: actualizá la app para abrirlo.");
    }
    if deck.cards.len() > MAX_SHARED_CARDS {
        bail!("El mazo tiene {} tarjetas: el máximo para compartir es {MAX_SHARED_CARDS}.", deck.cards.len());
    }
    let name: String = deck.name.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    let total = deck.cards.len();
    let cards: Vec<(String, String)> = deck
        .cards
        .into_iter()
        .map(|c| (c.front.trim().to_string(), c.back.trim().to_string()))
        .filter(|(f, b)| !f.is_empty() && !b.is_empty() && f.len() <= MAX_TEXT && b.len() <= MAX_TEXT)
        .collect();
    if cards.is_empty() {
        bail!("Ese mazo no tiene tarjetas que se puedan usar.");
    }
    Ok(Incoming { name: if name.is_empty() { "Mazo compartido".into() } else { name }, skipped: total - cards.len(), cards })
}

/// A name Windows (and WhatsApp) accept for the file.
pub fn file_name(deck: &str, ext: &str) -> String {
    let base: String = deck.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c }).collect();
    let base = base.split_whitespace().collect::<Vec<_>>().join(" ");
    let base: String = base.trim_matches('.').chars().take(60).collect();
    format!("{}.{ext}", if base.is_empty() { "Mazo".into() } else { base })
}

/// The file Eureka was opened with (double click on a `.eureka`), if any.
pub fn opened_file(args: impl IntoIterator<Item = String>) -> Option<std::path::PathBuf> {
    args.into_iter().skip(1).map(std::path::PathBuf::from).find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shared_deck_goes_and_comes_back_without_its_history() {
        let cards = vec![("¿2+2?".to_string(), "4".to_string()), ("Capital de Perú".to_string(), "Lima".to_string())];
        let bytes = to_file("Repaso", &cards).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(text.contains("\"eureka\": \"mazo\"") && !text.contains("ease") && !text.contains("due"));
        assert_eq!(from_file(&bytes).unwrap(), Incoming { name: "Repaso".into(), cards, skipped: 0 });
        assert!(to_file("Vacío", &[]).is_err());
    }

    #[test]
    fn what_arrives_is_checked() {
        assert!(from_file(b"{\"hola\":1}").unwrap_err().to_string().contains(".eureka"));
        assert!(from_file(br#"{"eureka":"otro","version":1,"name":"x","cards":[]}"#).is_err());
        assert!(from_file(br#"{"eureka":"mazo","version":9,"name":"x","cards":[]}"#).unwrap_err().to_string().contains("versión más nueva"));
        let long = "a".repeat(MAX_TEXT + 1);
        let raw = format!(r#"{{"eureka":"mazo","version":1,"name":"  \u0007Mi mazo ","cards":[{{"front":"f","back":"b"}},{{"front":"","back":"b"}},{{"front":"{long}","back":"b"}}]}}"#);
        let got = from_file(raw.as_bytes()).unwrap();
        assert_eq!((got.name.as_str(), got.cards.len(), got.skipped), ("Mi mazo", 1, 2));
        let many = SharedDeck { eureka: "mazo".into(), version: 1, name: "x".into(), cards: vec![SharedCard { front: "f".into(), back: "b".into() }; MAX_SHARED_CARDS + 1] };
        assert!(from_file(&serde_json::to_vec(&many).unwrap()).is_err());
        assert!(from_file(&vec![b' '; MAX_SHARED_BYTES + 1]).is_err());
    }

    #[test]
    fn file_names_are_safe_and_the_opened_file_is_found() {
        assert_eq!(file_name("Análisis I: parcial 1/2?", "eureka"), "Análisis I parcial 1 2.eureka");
        assert_eq!(file_name("...", "apkg"), "Mazo.apkg");
        let args = ["eureka.exe", "--flag", "C:\\Users\\x\\Downloads\\Repaso.EUREKA"].map(String::from);
        assert_eq!(opened_file(args), Some(std::path::PathBuf::from("C:\\Users\\x\\Downloads\\Repaso.EUREKA")));
        assert_eq!(opened_file(["eureka.exe", "otro.apkg"].map(String::from)), None);
    }
}
