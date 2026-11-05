//! Acompañamiento (AC-82..88): a listening mode and a private journal.
//!
//! Nothing here teaches, and nothing here feeds the learner profile: the
//! journal lives in its own folder, is never read by the teacher or the
//! extractor, and is left out of backups. What the person writes DOES travel
//! to the model provider (the app is local; the model is not) — the UI says so.
//!
//! Safety is not left to the model alone: a local detector reads every message
//! first (it works offline), and the model can also raise the flag with
//! `[[RIESGO]]`. Either way the UI shows the help lines.

use crate::agent::{endpoint_for, Role};
use crate::graph::normalize;
use crate::llm::{self, Msg};
use crate::AppState;
use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The model ends a message with this on its own line when it sees risk.
pub const RISK_TAG: &str = "[[RIESGO]]";
pub const ENTRY_TOOL: &str = "propose_entry";
const MAX_TURNS_SENT: usize = 40;
const MAX_MESSAGE: usize = 4000;
const MAX_ENTRIES: usize = 2000;
const MAX_EMOTIONS: usize = 6;
const MAX_INSIGHTS: usize = 200;

/// Said by the app itself, never by the model, when the detector fires.
pub const CRISIS_REPLY: &str = "Gracias por contármelo. Lo que decís me importa y quiero tomarlo en serio.\n\n¿Estás pensando en hacerte daño o en quitarte la vida? Si es así, no tenés que atravesar esto sin compañía: abajo te dejé líneas donde te atiende una persona, y si estás en peligro ahora, llamá a emergencias.\n\n¿Hay alguien de confianza cerca con quien puedas estar en este momento? Yo sigo acá, y podemos seguir hablando.";

// ── Risk ──────────────────────────────────────────────────────────────────

const RISK: &[&str] = &[
    "suicid", "quitarme la vida", "quitarse la vida", "quitar la vida", "no quiero vivir", "no quiero seguir viviendo", "no quiero seguir con vida",
    "quiero morir", "quiero morirme", "ojala me muera", "ojala no despertar", "ojala no me despierte", "no despertar mas", "acabar con mi vida",
    "terminar con mi vida", "acabar con todo", "terminar con todo", "hacerme dano", "lastimarme", "cortarme las venas", "cortar las venas",
    "no vale la pena vivir", "no vale la pena seguir viviendo", "mejor sin mi", "seria mejor si no estuviera", "desaparecer del mundo",
    "desaparecer para siempre", "matarme", "me voy a matar", "me quiero matar", "no aguanto mas vivir", "ya no quiero estar vivo", "ya no quiero estar viva",
];

/// What follows when a phrase is only a figure of speech ("me quiero morir de vergüenza").
const IDIOM_AFTER: &[&str] = &[
    "de verguenza", "de la verguenza", "de risa", "de la risa", "de sueno", "de hambre", "de calor", "de frio", "de cansancio", "de ganas", "de aburrimiento",
    "de miedo", "de nervios", "estudiando", "trabajando", "con el estudio",
];

/// True when the message may mean the person could hurt themselves. It leans
/// toward caution: a false alarm costs one caring question.
pub fn risk_signal(text: &str) -> bool {
    let t = normalize(text);
    RISK.iter().any(|pat| {
        t.match_indices(pat).any(|(i, _)| {
            let tail = t[i + pat.len()..].trim_start();
            !IDIOM_AFTER.iter().any(|s| tail.starts_with(s))
        })
    })
}

// ── Data ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    /// "user" or "assistant".
    pub role: String,
    pub text: String,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Conversation {
    #[serde(default)]
    pub turns: Vec<Turn>,
    /// Signals of risk appeared in this conversation (the help lines stay visible).
    #[serde(default)]
    pub risk: bool,
}

/// A CBT-style thought record (AC-93): what happened, what I thought, how
/// strongly it hit, what speaks for and against it, and another way to see it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ThoughtRecord {
    pub situation: String,
    pub thought: String,
    /// How strongly it felt, 0–100, before looking at it…
    pub before: u8,
    /// …and after (optional).
    #[serde(default)]
    pub after: Option<u8>,
    #[serde(default)]
    pub for_it: String,
    #[serde(default)]
    pub against: String,
    #[serde(default)]
    pub alternative: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub at: DateTime<Utc>,
    /// "entry" (from a conversation or written by hand), "checkin" or "thought".
    pub kind: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub mood: Option<u8>,
    #[serde(default)]
    pub emotions: Vec<String>,
    #[serde(default)]
    pub helped: Vec<String>,
    #[serde(default)]
    pub record: Option<ThoughtRecord>,
}

/// What the UI sends (and what the model proposes). `id` set = edit.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EntryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub mood: Option<u8>,
    #[serde(default)]
    pub emotions: Vec<String>,
    #[serde(default)]
    pub helped: Vec<String>,
    /// Only the person writes these: the model never proposes one.
    #[serde(default)]
    pub record: Option<ThoughtRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resource {
    pub name: String,
    pub detail: String,
}

fn default_resources() -> Vec<Resource> {
    vec![
        Resource { name: "Centro de Asistencia al Suicida (Argentina)".into(), detail: "Línea 135 (gratis desde CABA y el Gran Buenos Aires) · (011) 5275-1135 desde todo el país · asistenciaalsuicida.org.ar".into() },
        Resource { name: "Emergencias".into(), detail: "911 en Argentina. En otro país, el número de emergencias de ahí.".into() },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pin {
    salt: String,
    hash: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    privacy_ack: bool,
    #[serde(default)]
    resources: Option<Vec<Resource>>,
    #[serde(default)]
    pin: Option<Pin>,
    /// What the person said about each pattern the app noticed (AC-95):
    /// key → "confirmed" | "rejected".
    #[serde(default)]
    insights: std::collections::HashMap<String, String>,
}

/// What the screen shows. While locked, only what is needed to unlock.
#[derive(Debug, Serialize)]
pub struct View {
    pub locked: bool,
    pub has_pin: bool,
    pub privacy_ack: bool,
    pub resources: Vec<Resource>,
    pub conversation: Conversation,
    pub entries: Vec<Entry>,
    pub insights: std::collections::HashMap<String, String>,
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut h = Sha256::digest(format!("{salt}:{pin}").as_bytes());
    for _ in 0..20_000 {
        h = Sha256::digest(h);
    }
    h.iter().map(|b| format!("{b:02x}")).collect()
}

fn clean_list(v: &[String], max: usize, len: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in v {
        let s: String = s.trim().to_lowercase().chars().take(len).collect();
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    out.truncate(max);
    out
}

fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

/// Cleans a thought record; the situation and the thought are required.
fn clean_record(r: &ThoughtRecord) -> Result<ThoughtRecord> {
    let c = ThoughtRecord { situation: clip(&r.situation, 600), thought: clip(&r.thought, 600), before: r.before, after: r.after, for_it: clip(&r.for_it, 800), against: clip(&r.against, 800), alternative: clip(&r.alternative, 800) };
    if c.situation.is_empty() || c.thought.is_empty() {
        bail!("Contá qué pasó y qué pensaste.");
    }
    if c.before > 100 || c.after.is_some_and(|a| a > 100) {
        bail!("La intensidad va de 0 a 100.");
    }
    Ok(c)
}

/// The readable text of a thought record (what the diary shows and exports).
pub fn thought_text(r: &ThoughtRecord) -> String {
    let mut out = vec![format!("Situación: {}", r.situation), format!("Pensé: {} ({}/100)", r.thought, r.before)];
    if !r.for_it.is_empty() {
        out.push(format!("Lo que lo apoya: {}", r.for_it));
    }
    if !r.against.is_empty() {
        out.push(format!("Lo que no encaja: {}", r.against));
    }
    if !r.alternative.is_empty() {
        out.push(format!("Otra mirada: {}", r.alternative));
    }
    if let Some(a) = r.after {
        out.push(format!("Después, la intensidad: {a}/100"));
    }
    out.join("\n")
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    std::fs::create_dir_all(path.parent().unwrap())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

// ── Store ─────────────────────────────────────────────────────────────────

pub struct CompanionStore {
    dir: PathBuf,
    unlocked: Mutex<bool>,
    lock: Mutex<()>,
}

impl CompanionStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("companion"), unlocked: Mutex::new(false), lock: Mutex::new(()) }
    }

    fn read<T: for<'de> Deserialize<'de> + Default>(&self, name: &str) -> T {
        std::fs::read_to_string(self.dir.join(name)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    fn config(&self) -> Config {
        self.read("settings.json")
    }

    fn entries(&self) -> Vec<Entry> {
        self.read("journal.json")
    }

    pub fn conversation(&self) -> Conversation {
        self.read("conversation.json")
    }

    pub fn is_locked(&self) -> bool {
        self.config().pin.is_some() && !*self.unlocked.lock().unwrap()
    }

    /// Every command that touches the journal or the conversation starts here.
    pub fn guard(&self) -> Result<()> {
        if self.is_locked() {
            bail!("El diario está bloqueado. Ingresá tu PIN.");
        }
        Ok(())
    }

    pub fn view(&self) -> View {
        let c = self.config();
        let locked = self.is_locked();
        View {
            locked,
            has_pin: c.pin.is_some(),
            privacy_ack: c.privacy_ack,
            resources: c.resources.unwrap_or_else(default_resources),
            conversation: if locked { Conversation::default() } else { self.conversation() },
            entries: if locked { vec![] } else { self.entries() },
            insights: if locked { Default::default() } else { c.insights },
        }
    }

    pub fn ack_privacy(&self) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.config();
        c.privacy_ack = true;
        write_json(&self.dir.join("settings.json"), &c)
    }

    pub fn set_resources(&self, list: Vec<Resource>) -> Result<()> {
        let list: Vec<Resource> = list
            .into_iter()
            .map(|r| Resource { name: r.name.trim().chars().take(80).collect(), detail: r.detail.trim().chars().take(240).collect() })
            .filter(|r| !r.name.is_empty())
            .take(8)
            .collect();
        let _g = self.lock.lock().unwrap();
        let mut c = self.config();
        c.resources = Some(list);
        write_json(&self.dir.join("settings.json"), &c)
    }

    /// Sets, changes or (with `new = None`) removes the PIN. Changing or
    /// removing needs the current one. It keeps the screen private from
    /// whoever sits at the PC; it does not encrypt the files.
    pub fn set_pin(&self, new: Option<&str>, current: Option<&str>) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut c = self.config();
        if let Some(p) = &c.pin {
            if hash_pin(&p.salt, current.unwrap_or("")) != p.hash {
                bail!("El PIN actual no es correcto.");
            }
        }
        c.pin = match new {
            None => None,
            Some(pin) => {
                let pin = pin.trim();
                if !(4..=12).contains(&pin.chars().count()) {
                    bail!("El PIN debe tener entre 4 y 12 caracteres.");
                }
                let salt = uuid::Uuid::new_v4().simple().to_string();
                Some(Pin { hash: hash_pin(&salt, pin), salt })
            }
        };
        write_json(&self.dir.join("settings.json"), &c)?;
        *self.unlocked.lock().unwrap() = true;
        Ok(())
    }

    pub fn unlock(&self, pin: &str) -> Result<()> {
        let c = self.config();
        match c.pin {
            Some(p) if hash_pin(&p.salt, pin.trim()) != p.hash => bail!("PIN incorrecto."),
            _ => {
                *self.unlocked.lock().unwrap() = true;
                Ok(())
            }
        }
    }

    pub fn lock_now(&self) {
        *self.unlocked.lock().unwrap() = false;
    }

    pub fn save_conversation(&self, c: &Conversation) -> Result<()> {
        write_json(&self.dir.join("conversation.json"), c)
    }

    pub fn new_conversation(&self) -> Result<()> {
        self.guard()?;
        self.save_conversation(&Conversation::default())
    }

    /// Creates an entry, or edits the one with `input.id`.
    pub fn save_entry(&self, input: EntryInput) -> Result<Entry> {
        self.guard()?;
        let record = input.record.as_ref().map(clean_record).transpose()?;
        let title: String = input.title.trim().chars().take(80).collect();
        let text: String = match &record {
            Some(r) => thought_text(r),
            None => input.text.trim().chars().take(4000).collect(),
        };
        if text.is_empty() {
            bail!("Escribí algo para guardar.");
        }
        if input.mood.is_some_and(|m| !(1..=5).contains(&m)) {
            bail!("El ánimo va de 1 a 5.");
        }
        let _g = self.lock.lock().unwrap();
        let mut all = self.entries();
        let (emotions, helped) = (clean_list(&input.emotions, MAX_EMOTIONS, 30), clean_list(&input.helped, 3, 80));
        let entry = match input.id.as_deref().and_then(|id| all.iter_mut().find(|e| e.id == id)) {
            Some(e) => {
                (e.title, e.text, e.mood, e.emotions, e.helped) = (if title.is_empty() { e.title.clone() } else { title }, text, input.mood, emotions, helped);
                if record.is_some() {
                    e.record = record;
                }
                e.clone()
            }
            None => {
                let (kind, fallback) = if record.is_some() { ("thought", "Registro de pensamientos") } else { ("entry", "Mi día") };
                let e = Entry { id: uuid::Uuid::new_v4().simple().to_string(), at: Utc::now(), kind: kind.into(), title: if title.is_empty() { fallback.into() } else { title }, text, mood: input.mood, emotions, helped, record };
                all.insert(0, e.clone());
                all.truncate(MAX_ENTRIES);
                e
            }
        };
        write_json(&self.dir.join("journal.json"), &all)?;
        Ok(entry)
    }

    pub fn add_checkin(&self, mood: u8, emotions: &[String], note: &str) -> Result<Entry> {
        self.guard()?;
        if !(1..=5).contains(&mood) {
            bail!("El ánimo va de 1 a 5.");
        }
        let _g = self.lock.lock().unwrap();
        let mut all = self.entries();
        let e = Entry {
            id: uuid::Uuid::new_v4().simple().to_string(),
            at: Utc::now(),
            kind: "checkin".into(),
            title: "Check-in".into(),
            text: note.trim().chars().take(1000).collect(),
            mood: Some(mood),
            emotions: clean_list(emotions, MAX_EMOTIONS, 30),
            helped: vec![],
            record: None,
        };
        all.insert(0, e.clone());
        all.truncate(MAX_ENTRIES);
        write_json(&self.dir.join("journal.json"), &all)?;
        Ok(e)
    }

    pub fn delete_entry(&self, id: &str) -> Result<()> {
        self.guard()?;
        let _g = self.lock.lock().unwrap();
        let mut all = self.entries();
        all.retain(|e| e.id != id);
        write_json(&self.dir.join("journal.json"), &all)
    }

    /// "confirmed", "rejected" or `None` (take the answer back) for one noticed pattern.
    pub fn set_insight(&self, key: &str, verdict: Option<&str>) -> Result<()> {
        self.guard()?;
        if key.is_empty() || key.len() > 60 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            bail!("Esa observación no es válida.");
        }
        if verdict.is_some_and(|v| v != "confirmed" && v != "rejected") {
            bail!("La respuesta debe ser «me suena» o «no es así».");
        }
        let _g = self.lock.lock().unwrap();
        let mut c = self.config();
        match verdict {
            Some(v) => {
                if c.insights.len() >= MAX_INSIGHTS && !c.insights.contains_key(key) {
                    bail!("Hay demasiadas observaciones guardadas.");
                }
                c.insights.insert(key.to_string(), v.to_string());
            }
            None => {
                c.insights.remove(key);
            }
        }
        write_json(&self.dir.join("settings.json"), &c)
    }

    /// Everything, as JSON the person can keep.
    pub fn export(&self) -> Result<String> {
        self.guard()?;
        Ok(serde_json::to_string_pretty(&json!({ "exportado": Utc::now(), "entradas": self.entries(), "conversacion": self.conversation(), "lo_que_note": self.config().insights }))?)
    }

    /// Deletes everything (entries, conversation, PIN, settings). Allowed while
    /// locked: a forgotten PIN must never trap the person's own data.
    pub fn erase(&self) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        match std::fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        *self.unlocked.lock().unwrap() = false;
        Ok(())
    }
}

// ── The conversation ──────────────────────────────────────────────────────

async fn model_reply(state: &AppState, conv: &Conversation, text: &str) -> Result<(String, bool)> {
    let mut ep = endpoint_for(state, Role::Teacher).await?;
    ep.session = "eureka-companion".into();
    // AC-186: counted like any call, but the journal's words never reach the log.
    ep.usage.purpose = "companion".into();
    let system = state.prompts.get("companion")?;
    let mut msgs: Vec<Msg> = conv
        .turns
        .iter()
        .rev()
        .take(MAX_TURNS_SENT)
        .rev()
        .map(|t| {
            if t.role == "assistant" {
                Msg { role: "assistant".into(), content: Some(t.text.clone()), tool_calls: None, tool_call_id: None, meta: None }
            } else {
                Msg::user(t.text.clone(), None)
            }
        })
        .collect();
    msgs.push(Msg::user(text.to_string(), None));
    // The state comes last, as in the teacher's loop: accessibility settings, and a risk note.
    let prefs = state.settings.load();
    let mut note = prefs.accessibility.teacher_section();
    note.push_str(&prefs.identity.teacher_section());
    if conv.risk {
        note.push_str("\n## Nota de riesgo\nAntes, en esta charla, hubo señales de que la persona podría hacerse daño. Seguí con ese cuidado.\n");
    }
    if !note.is_empty() {
        msgs.push(crate::context::state_message(&note));
    }
    let c = llm::stream_chat(&ep, &system, &msgs, &json!([]), None, |_| {}, || false).await?;
    let raw = c.text.trim();
    if raw.is_empty() {
        bail!("No recibí respuesta del modelo. Probá de nuevo.");
    }
    let risk = raw.contains(RISK_TAG);
    let clean = raw.replace(RISK_TAG, "").trim().to_string();
    Ok((if clean.is_empty() { CRISIS_REPLY.to_string() } else { clean }, risk))
}

/// One message in, one reply out. Nothing is stored if the model fails, so
/// the person can send the same message again.
pub async fn send(state: &AppState, text: &str) -> Result<Conversation> {
    let st = &state.companion;
    st.guard()?;
    let text = text.trim();
    if text.is_empty() {
        bail!("Escribí algo para empezar.");
    }
    if text.chars().count() > MAX_MESSAGE {
        bail!("Es un mensaje largo: probá contarlo en partes.");
    }
    let mut conv = st.conversation();
    let (reply, risk) = if risk_signal(text) { (CRISIS_REPLY.to_string(), true) } else { model_reply(state, &conv, text).await? };
    let now = Utc::now();
    conv.turns.push(Turn { role: "user".into(), text: text.to_string(), at: now });
    conv.turns.push(Turn { role: "assistant".into(), text: reply, at: now });
    conv.risk |= risk;
    st.save_conversation(&conv)?;
    Ok(conv)
}

// ── The journal entry the model proposes ──────────────────────────────────

pub fn entry_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": ENTRY_TOOL,
        "description": "Propone la entrada del diario, en primera persona.",
        "parameters": { "type": "object", "properties": {
            "title": { "type": "string" },
            "text": { "type": "string" },
            "mood": { "type": "integer", "minimum": 1, "maximum": 5 },
            "emotions": { "type": "array", "items": { "type": "string" } },
            "helped": { "type": "array", "items": { "type": "string" } }
        }, "required": ["title", "text"] }
    } })
}

pub fn parse_entry(raw: &str) -> Result<EntryInput> {
    let mut e: EntryInput = serde_json::from_str(raw).map_err(|_| anyhow!("la entrada vino incompleta"))?;
    e.id = None;
    e.record = None;
    e.title = e.title.trim().to_string();
    e.text = e.text.trim().to_string();
    if e.text.is_empty() {
        bail!("la entrada no tiene texto");
    }
    if e.mood.is_some_and(|m| !(1..=5).contains(&m)) {
        e.mood = None;
    }
    e.emotions = clean_list(&e.emotions, 4, 30);
    e.helped = clean_list(&e.helped, 3, 80);
    Ok(e)
}

/// A draft diary entry for the current conversation. NOT saved: the person
/// reads it, edits it and decides.
pub async fn propose_entry(state: &AppState) -> Result<EntryInput> {
    let st = &state.companion;
    st.guard()?;
    let conv = st.conversation();
    if conv.turns.iter().filter(|t| t.role == "user").count() < 2 {
        bail!("Todavía no hay mucho para guardar. Charlemos un poco más.");
    }
    let mut input: String = conv.turns.iter().map(|t| format!("{}: {}\n", if t.role == "user" { "Persona" } else { "Eureka" }, t.text)).collect();
    if conv.risk {
        input.push_str("\n(En esta charla hubo señales de riesgo.)\n");
    }
    crate::practice::forced_valid(state, Role::Teacher, "companion_entry", entry_tool(), ENTRY_TOOL, input, parse_entry).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (CompanionStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-companion-{}", uuid::Uuid::new_v4().simple()));
        (CompanionStore::new(&dir), dir)
    }

    #[test]
    fn the_detector_catches_real_signals_and_lets_figures_of_speech_pass() {
        for yes in [
            "quiero morirme",
            "A veces pienso en suicidarme",
            "No quiero vivir más",
            "ojalá no despertar mañana",
            "estoy pensando en quitarme la vida",
            "ya no quiero estar vivo",
            "me voy a matar",
            "pienso en hacerme daño",
            "Me quiero morir. No doy más.",
        ] {
            assert!(risk_signal(yes), "debería detectar: {yes}");
        }
        for no in [
            "me quiero morir de la vergüenza",
            "me muero de sueño",
            "me voy a matar estudiando para el parcial",
            "estoy cansado de estudiar",
            "mató el final, estuvo difícil",
            "me quiero cortar el pelo",
            "Hoy me fue bien en el examen",
            "",
        ] {
            assert!(!risk_signal(no), "no debería detectar: {no}");
        }
    }

    #[test]
    fn crisis_reply_asks_directly_and_points_to_people() {
        assert!(CRISIS_REPLY.contains("¿Estás pensando en hacerte daño o en quitarte la vida?"));
        assert!(CRISIS_REPLY.contains("emergencias") && CRISIS_REPLY.contains("persona"));
        assert!(!CRISIS_REPLY.contains(RISK_TAG));
    }

    #[test]
    fn entries_are_created_edited_and_deleted_and_inputs_are_cleaned() {
        let (st, dir) = store();
        let e = st
            .save_entry(EntryInput { title: " Un día largo ".into(), text: "  Me costó.  ".into(), mood: Some(2), emotions: vec!["Cansancio".into(), "cansancio".into(), " ".into()], helped: vec![], id: None, record: None })
            .unwrap();
        assert_eq!((e.title.as_str(), e.text.as_str(), e.emotions.clone()), ("Un día largo", "Me costó.", vec!["cansancio".to_string()]));
        let edited = st.save_entry(EntryInput { id: Some(e.id.clone()), title: "".into(), text: "Mejoró a la tarde.".into(), mood: Some(4), ..Default::default() }).unwrap();
        assert_eq!((edited.title.as_str(), edited.mood, edited.at), ("Un día largo", Some(4), e.at), "same entry, kept date and title");
        assert_eq!(st.view().entries.len(), 1);
        assert!(st.save_entry(EntryInput { text: "x".into(), mood: Some(9), ..Default::default() }).is_err());
        assert!(st.save_entry(EntryInput { text: "  ".into(), ..Default::default() }).is_err());
        let c = st.add_checkin(3, &["calma".into()], "").unwrap();
        assert_eq!((c.kind.as_str(), c.mood), ("checkin", Some(3)));
        assert!(st.add_checkin(0, &[], "").is_err());
        st.delete_entry(&e.id).unwrap();
        assert_eq!(st.view().entries.len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_pin_locks_the_view_and_every_command_until_it_is_entered() {
        let (st, dir) = store();
        st.save_entry(EntryInput { text: "privado".into(), ..Default::default() }).unwrap();
        assert!(st.set_pin(Some("12"), None).is_err(), "too short");
        st.set_pin(Some("4321"), None).unwrap();
        assert!(!st.is_locked(), "setting it unlocks this run");
        st.lock_now();
        let v = st.view();
        assert!(v.locked && v.entries.is_empty() && v.conversation.turns.is_empty());
        assert!(st.save_entry(EntryInput { text: "x".into(), ..Default::default() }).is_err());
        assert!(st.export().is_err() && st.add_checkin(3, &[], "").is_err() && st.new_conversation().is_err());
        assert!(st.unlock("0000").is_err());
        st.unlock("4321").unwrap();
        assert_eq!(st.view().entries.len(), 1);
        assert!(st.set_pin(None, Some("nope")).is_err(), "removing needs the current one");
        st.set_pin(None, Some("4321")).unwrap();
        st.lock_now();
        assert!(!st.is_locked(), "no PIN, no lock");
        let raw = std::fs::read_to_string(dir.join("companion").join("settings.json")).unwrap();
        assert!(!raw.contains("4321"), "the PIN is never stored");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn erasing_deletes_everything_even_when_locked() {
        let (st, dir) = store();
        st.save_entry(EntryInput { text: "privado".into(), ..Default::default() }).unwrap();
        st.save_conversation(&Conversation { turns: vec![Turn { role: "user".into(), text: "hola".into(), at: Utc::now() }], risk: true }).unwrap();
        st.set_pin(Some("4321"), None).unwrap();
        st.lock_now();
        st.erase().unwrap();
        assert!(!dir.join("companion").exists());
        let v = st.view();
        assert!(!v.locked && !v.has_pin && !v.privacy_ack && v.entries.is_empty() && v.conversation.turns.is_empty());
        st.erase().unwrap();
    }

    #[test]
    fn resources_default_to_argentina_and_can_be_edited() {
        let (st, dir) = store();
        assert!(st.view().resources[0].detail.contains("135"));
        st.set_resources(vec![Resource { name: " Mi línea ".into(), detail: "123".into() }, Resource { name: "".into(), detail: "x".into() }]).unwrap();
        assert_eq!(st.view().resources, vec![Resource { name: "Mi línea".into(), detail: "123".into() }]);
        std::fs::remove_dir_all(dir).ok();
    }

    fn record() -> ThoughtRecord {
        ThoughtRecord { situation: " Me fue mal en el parcial ".into(), thought: "Soy un desastre".into(), before: 80, after: Some(45), for_it: "Me equivoqué en dos ejercicios".into(), against: "Aprobé los dos anteriores".into(), alternative: "Un parcial no dice quién soy".into() }
    }

    #[test]
    fn a_thought_record_becomes_a_readable_entry_and_is_validated() {
        let (st, dir) = store();
        let e = st.save_entry(EntryInput { record: Some(record()), emotions: vec!["Angustia".into()], ..Default::default() }).unwrap();
        assert_eq!((e.kind.as_str(), e.title.as_str()), ("thought", "Registro de pensamientos"));
        assert!(e.text.starts_with("Situación: Me fue mal en el parcial\nPensé: Soy un desastre (80/100)"), "{}", e.text);
        assert!(e.text.contains("Otra mirada: Un parcial no dice quién soy") && e.text.ends_with("Después, la intensidad: 45/100"));
        assert_eq!(e.record.as_ref().unwrap().situation, "Me fue mal en el parcial", "trimmed");
        assert_eq!(e.emotions, vec!["angustia".to_string()]);
        // Only the optional parts may be empty.
        let min = ThoughtRecord { situation: "x".into(), thought: "y".into(), before: 10, ..Default::default() };
        assert_eq!(st.save_entry(EntryInput { record: Some(min.clone()), ..Default::default() }).unwrap().text, "Situación: x\nPensé: y (10/100)");
        for bad in [ThoughtRecord { thought: "".into(), ..record() }, ThoughtRecord { situation: " ".into(), ..record() }, ThoughtRecord { before: 101, ..record() }, ThoughtRecord { after: Some(200), ..record() }] {
            assert!(st.save_entry(EntryInput { record: Some(bad), ..Default::default() }).is_err());
        }
        // Editing keeps it a thought record; deleting works like any entry.
        let edited = st.save_entry(EntryInput { id: Some(e.id.clone()), record: Some(ThoughtRecord { after: Some(30), ..record() }), ..Default::default() }).unwrap();
        assert_eq!((edited.kind.as_str(), edited.record.unwrap().after), ("thought", Some(30)));
        st.delete_entry(&e.id).unwrap();
        assert_eq!(st.view().entries.len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_model_never_proposes_a_thought_record() {
        let e = parse_entry(r#"{"title":"T","text":"Hoy.","record":{"situation":"a","thought":"b","before":50}}"#).unwrap();
        assert!(e.record.is_none());
    }

    #[test]
    fn what_the_person_says_about_a_noticed_pattern_is_kept_and_can_be_taken_back() {
        let (st, dir) = store();
        st.set_insight("weekday-low-0", Some("confirmed")).unwrap();
        st.set_insight("trend-down", Some("rejected")).unwrap();
        let v = st.view().insights;
        assert_eq!((v.get("weekday-low-0").map(String::as_str), v.get("trend-down").map(String::as_str)), (Some("confirmed"), Some("rejected")));
        st.set_insight("trend-down", None).unwrap();
        assert!(!st.view().insights.contains_key("trend-down"));
        for bad in ["", "con espacios", "a/b", &"x".repeat(61)] {
            assert!(st.set_insight(bad, Some("confirmed")).is_err(), "{bad}");
        }
        assert!(st.set_insight("ok", Some("quizás")).is_err());
        assert!(st.export().unwrap().contains("weekday-low-0"));
        st.set_pin(Some("4321"), None).unwrap();
        st.lock_now();
        assert!(st.view().insights.is_empty() && st.set_insight("ok", Some("confirmed")).is_err(), "locked: nothing is shown or changed");
        st.erase().unwrap();
        assert!(st.view().insights.is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_proposed_entry_is_validated() {
        let e = parse_entry(r#"{"title":" T ","text":" Hoy me costó. ","mood":7,"emotions":["Cansancio","cansancio","a","b","c","d"],"helped":["caminar"]}"#).unwrap();
        assert_eq!((e.title.as_str(), e.mood, e.emotions.len(), e.id.is_none()), ("T", None, 4, true), "a wild mood is dropped, not trusted");
        assert!(parse_entry(r#"{"title":"T","text":"  "}"#).is_err());
        assert!(parse_entry("no json").is_err());
    }
}
