//! User settings (settings.json) and API keys.
//!
//! On desktop API keys live in the OS keystore (Windows Credential Manager,
//! macOS Keychain, Secret Service) — like subscription tokens in `accounts.rs`
//! — while a small `auth-keys.json` index tracks only which provider ids have
//! stored keys (never the secrets themselves). Existing `auth.json` files are
//! migrated on first load and removed once every key is safely stored. On
//! platforms without a usable keystore (Android, headless CI) or when
//! `EUREKA_PLAINTEXT_AUTH=1` is set, keys fall back to `auth.json`.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub base_url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelRef {
    pub provider_id: String,
    pub model: String,
    /// The model's context window in thousands of tokens (audit item 17);
    /// unset → `context::DEFAULT_BUDGET`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_k: Option<u32>,
}

/// auth.json key of the web-search API key (Phase 4).
pub const SEARCH_KEY: &str = "search";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchConfig {
    /// A Tavily-compatible API: POST {base_url}/search.
    pub base_url: String,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self { base_url: "https://api.tavily.com".into() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Roles {
    /// Measures the learner's understanding (probe phase).
    pub prober: ModelRef,
    /// Plans and teaches.
    pub teacher: ModelRef,
    /// Builds the knowledge graph (Phase 2). Empty = teacher's model.
    #[serde(default)]
    pub extractor: ModelRef,
    /// Generates and grades practice (Phase 3). Empty = teacher's model.
    #[serde(default)]
    pub practice: ModelRef,
    /// Summarizes web research (Phase 4). Empty = teacher's model.
    #[serde(default)]
    pub researcher: ModelRef,
    /// Transcribes the learner's voice (AC-65). Empty = speaking disabled.
    #[serde(default)]
    pub speech: ModelRef,
}

/// AC-73..77: access needs the learner chose. Functional, never a diagnosis:
/// "short texts", not "ADHD mode". The defaults keep today's UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Accessibility {
    /// Short sentences, one idea each, common words, terms explained.
    pub easy_reading: bool,
    /// No irony or metaphors; say what comes next before doing it.
    pub literal: bool,
    /// Short messages and small blocks with a visible goal.
    pub short_steps: bool,
    /// "Escuchar" on every teacher message, question and book section.
    pub read_aloud: bool,
    /// Speech rate for reading aloud (0.6–1.4).
    pub speech_rate: f32,
    /// "Dictar" in the answer boxes (needs the Voz role).
    pub dictation: bool,
    /// Wider letter, word and line spacing (WCAG 1.4.12) and shorter lines.
    pub spacing: bool,
    /// "normal", "large" or "larger".
    pub text_size: String,
    /// No animations, on top of the OS setting.
    pub reduce_motion: bool,
}

impl Default for Accessibility {
    fn default() -> Self {
        Self { easy_reading: false, literal: false, short_steps: false, read_aloud: false, speech_rate: 1.0, dictation: false, spacing: false, text_size: "normal".into(), reduce_motion: false }
    }
}

impl Accessibility {
    fn clamped(mut self) -> Self {
        self.speech_rate = if self.speech_rate.is_finite() { self.speech_rate.clamp(0.6, 1.4) } else { 1.0 };
        if !matches!(self.text_size.as_str(), "normal" | "large" | "larger") {
            self.text_size = "normal".into();
        }
        self
    }

    /// For the teacher's state block, in every phase. Empty when nothing
    /// changes how the teacher writes (spacing or size are the app's job).
    pub fn teacher_section(&self) -> String {
        let mut lines = Vec::new();
        if self.easy_reading {
            lines.push("- **Lectura fácil:** frases cortas, una idea por frase, palabras de uso común. Si usás un término técnico, explicalo en la misma frase. Mismo contenido y misma exigencia: cambia la forma, no se recorta lo que aprende.");
        }
        if self.literal {
            lines.push("- **Lenguaje literal:** sin ironías, metáforas, dobles sentidos ni frases hechas. Antes de cada paso decí qué va a pasar (\"ahora te hago 2 preguntas\"). Nada de sorpresas ni cambios de tema sin avisar.");
        }
        if self.short_steps {
            lines.push("- **Pasos cortos:** mensajes de 3 o 4 frases como mucho. Anunciá la meta del bloque con un número (\"3 preguntas y listo\") y decí cuánto falta. Al cerrar cada idea, ofrecé una pausa.");
        }
        if self.read_aloud {
            lines.push("- **Escucha tus mensajes en voz alta:** escribí para el oído. Evitá tablas y fórmulas largas; si las usás, decí también en palabras qué significan.");
        }
        if self.dictation {
            lines.push("- **Puede responder dictando:** la transcripción puede traer errores de ortografía o puntuación. No los corrijas ni los evalúes, salvo que la meta sea escribir.");
        }
        if lines.is_empty() {
            return String::new();
        }
        format!("\n## Ajustes de accesibilidad (los eligió el aprendiz)\nRespetalos siempre, en cada mensaje y en cada pregunta.\n{}\n", lines.join("\n"))
    }
}

/// AC-92: what the learner told the app about themself at the start. All of it
/// optional; it stays on this PC except what goes to the model (name, how to
/// address them, what they study) so it can talk to them the way they asked.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Identity {
    pub first_name: String,
    pub last_name: String,
    pub school: String,
    pub career: String,
    pub age: Option<u8>,
    /// "el", "ella", "elle", or "" for no preference.
    pub treatment: String,
    /// Free text when none of those fits ("como quieras", "sin marcar género"…).
    pub treatment_other: String,
    /// The wizard was finished, or skipped on purpose.
    pub onboarded: bool,
}

impl Identity {
    fn clamped(mut self) -> Self {
        let cut = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
        self.first_name = cut(&self.first_name, 40);
        self.last_name = cut(&self.last_name, 60);
        self.school = cut(&self.school, 80);
        self.career = cut(&self.career, 80);
        self.treatment_other = cut(&self.treatment_other, 80);
        if !matches!(self.treatment.as_str(), "el" | "ella" | "elle") {
            self.treatment = String::new();
        }
        self.age = self.age.filter(|a| (5..=110).contains(a));
        self
    }

    /// For the model's state block, in every phase. Empty when nothing was said.
    pub fn teacher_section(&self) -> String {
        let mut lines: Vec<String> = Vec::new();
        let full = format!("{} {}", self.first_name, self.last_name).trim().to_string();
        if !self.first_name.is_empty() {
            lines.push(format!("- Se llama {full}. Usá su nombre de pila de vez en cuando, sin abusar."));
        }
        match self.treatment.as_str() {
            "el" => lines.push("- Prefiere que le hablen en masculino (él).".into()),
            "ella" => lines.push("- Prefiere que le hablen en femenino (ella).".into()),
            "elle" => lines.push("- Prefiere lenguaje neutro (elle): evitá marcas de género en cómo te dirigís a esa persona.".into()),
            _ => {}
        }
        if !self.treatment_other.is_empty() {
            lines.push(format!("- Sobre cómo tratarle, pidió: «{}».", self.treatment_other));
        }
        match (self.career.is_empty(), self.school.is_empty()) {
            (false, false) => lines.push(format!("- Estudia {} en {}.", self.career, self.school)),
            (false, true) => lines.push(format!("- Estudia {}.", self.career)),
            (true, false) => lines.push(format!("- Estudia en {}.", self.school)),
            _ => {}
        }
        if let Some(a) = self.age {
            lines.push(format!("- Tiene {a} años: ajustá ejemplos y tono, sin condescendencia."));
        }
        if lines.is_empty() {
            return String::new();
        }
        format!("\n## Quién es el aprendiz (lo contó al empezar)\nUsalo para hablarle como pidió; no se lo recites.\n{}\n", lines.join("\n"))
    }
}

/// Providers that ship with the app: id, label, base URL.
const BUILTIN: &[(&str, &str, &str)] = &[
    ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1"),
    ("openai", "OpenAI", "https://api.openai.com/v1"),
    ("anthropic", "Anthropic", "https://api.anthropic.com/v1"),
    ("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
    ("deepseek", "DeepSeek", "https://api.deepseek.com/v1"),
    ("opencode-go", "OpenCode Go", "https://opencode.ai/inference/go/v1"),
];

/// A settings.json from before `seen_builtins` existed knew these five.
fn legacy_seen() -> Vec<String> {
    BUILTIN.iter().take(5).map(|(id, ..)| id.to_string()).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub providers: Vec<Provider>,
    pub roles: Roles,
    #[serde(default)]
    pub search: SearchConfig,
    #[serde(default)]
    pub accessibility: Accessibility,
    #[serde(default)]
    pub identity: Identity,
    /// Built-in providers the learner has already been offered. A new one that
    /// ships later (OpenCode Go) is added once to existing installs; one they
    /// removed on purpose is never put back.
    #[serde(default = "legacy_seen")]
    pub seen_builtins: Vec<String>,
}

impl Settings {
    fn add_new_builtins(&mut self) {
        for (id, label, url) in BUILTIN {
            if self.seen_builtins.iter().any(|s| s == id) {
                continue;
            }
            if !self.providers.iter().any(|p| p.id == *id) {
                self.providers.push(Provider { id: id.to_string(), label: label.to_string(), base_url: url.to_string() });
            }
            self.seen_builtins.push(id.to_string());
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            providers: BUILTIN.iter().map(|(id, label, url)| Provider { id: id.to_string(), label: label.to_string(), base_url: url.to_string() }).collect(),
            seen_builtins: BUILTIN.iter().map(|(id, ..)| id.to_string()).collect(),
            roles: Roles::default(),
            search: SearchConfig::default(),
            accessibility: Accessibility::default(),
            identity: Identity::default(),
        }
    }
}

/// What the UI sees: providers carry `has_key` instead of the key itself.
#[derive(Debug, Serialize)]
pub struct ProviderView {
    #[serde(flatten)]
    pub provider: Provider,
    pub has_key: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchView {
    pub base_url: String,
    pub has_key: bool,
}

#[derive(Debug, Serialize)]
pub struct SettingsView {
    pub providers: Vec<ProviderView>,
    pub roles: Roles,
    pub search: SearchView,
    pub data_dir: String,
}

/// From the UI: `api_key` None/empty keeps the stored key; `clear_key` removes it.
#[derive(Debug, Deserialize)]
pub struct ProviderInput {
    #[serde(flatten)]
    pub provider: Provider,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_key: bool,
}

#[derive(Debug, Deserialize)]
pub struct SettingsInput {
    pub providers: Vec<ProviderInput>,
    pub roles: Roles,
    /// None keeps the current search config.
    #[serde(default)]
    pub search: Option<SearchInput>,
}

#[derive(Debug, Deserialize)]
pub struct SearchInput {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_key: bool,
}

#[allow(dead_code)]
const API_KEYS_SERVICE: &str = "eureka-api-keys";

fn keystore_available() -> bool {
    if std::env::var_os("EUREKA_PLAINTEXT_AUTH").is_some_and(|v| v == "1") {
        return false;
    }
    #[cfg(test)]
    { true }
    #[cfg(not(test))]
    {
        #[cfg(target_os = "android")]
        { false }
        #[cfg(not(target_os = "android"))]
        {
            static AVAILABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
            *AVAILABLE.get_or_init(|| {
                use keyring::Entry;
                Entry::new(API_KEYS_SERVICE, "__probe__").and_then(|e| e.set_password("probe")).is_ok()
                    && Entry::new(API_KEYS_SERVICE, "__probe__").and_then(|e| e.get_password()).is_ok()
                    && Entry::new(API_KEYS_SERVICE, "__probe__").and_then(|e| e.delete_credential()).is_ok()
            })
        }
    }
}

#[cfg(test)]
thread_local! {
    static TEST_KEYSTORE: std::cell::RefCell<HashMap<String, String>> = Default::default();
}

#[cfg(test)]
fn ks_set(account: &str, value: &str) -> bool {
    TEST_KEYSTORE.with(|s| s.borrow_mut().insert(account.to_string(), value.to_string()));
    true
}

#[cfg(test)]
fn ks_get(account: &str) -> Option<String> {
    TEST_KEYSTORE.with(|s| s.borrow().get(account).cloned())
}

#[cfg(test)]
fn ks_delete(account: &str) {
    TEST_KEYSTORE.with(|s| s.borrow_mut().remove(account));
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn ks_set(account: &str, value: &str) -> bool {
    use keyring::Entry;
    Entry::new(API_KEYS_SERVICE, account).and_then(|e| e.set_password(value)).is_ok()
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn ks_get(account: &str) -> Option<String> {
    use keyring::Entry;
    Entry::new(API_KEYS_SERVICE, account).ok()?.get_password().ok()
}

#[cfg(not(test))]
#[cfg(not(target_os = "android"))]
fn ks_delete(account: &str) {
    use keyring::Entry;
    if let Ok(entry) = Entry::new(API_KEYS_SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn ks_set(_account: &str, _value: &str) -> bool { false }

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn ks_get(_account: &str) -> Option<String> { None }

#[cfg(not(test))]
#[cfg(target_os = "android")]
fn ks_delete(_account: &str) {}

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, content)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub struct SettingsStore {
    dir: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: &Path) -> Self {
        Self { dir: dir.to_path_buf() }
    }

    fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }
    fn auth_path(&self) -> PathBuf {
        self.dir.join("auth.json")
    }
    fn auth_index_path(&self) -> PathBuf {
        self.dir.join("auth-keys.json")
    }

    /// Scopes keyring entries to this data directory so separate profiles or
    /// e2e runs (`LA_DATA_DIR`) never overwrite the user's real keys.
    fn ks_account(&self, id: &str) -> String {
        let mut h = Sha256::new();
        h.update(self.dir.to_string_lossy().as_bytes());
        let d = h.finalize();
        format!("{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}:{id}", d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7])
    }

    fn read_plaintext_auth(&self) -> Option<HashMap<String, String>> {
        std::fs::read_to_string(self.auth_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    fn read_index(&self) -> Vec<String> {
        std::fs::read_to_string(self.auth_index_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_index(&self, keys: &HashMap<String, String>) -> Result<()> {
        let mut ids: Vec<&String> = keys.keys().collect();
        ids.sort();
        if ids.is_empty() {
            let _ = std::fs::remove_file(self.auth_index_path());
            return Ok(());
        }
        write_atomic(&self.auth_index_path(), &serde_json::to_string_pretty(&ids)?)
    }

    fn persist_keys(&self, keys: &HashMap<String, String>, prev_ids: BTreeSet<String>) -> Result<()> {
        if !keystore_available() {
            return write_atomic(&self.auth_path(), &serde_json::to_string_pretty(keys)?);
        }
        let mut ok = true;
        for (id, val) in keys {
            if !ks_set(&self.ks_account(id), val) {
                ok = false;
                break;
            }
        }
        if !ok {
            // Keystore failed mid-flight: fall back to auth.json so we never lose a key.
            return write_atomic(&self.auth_path(), &serde_json::to_string_pretty(keys)?);
        }
        for old_id in prev_ids {
            if !keys.contains_key(&old_id) {
                ks_delete(&self.ks_account(&old_id));
            }
        }
        self.write_index(keys)?;
        let _ = std::fs::remove_file(self.auth_path());
        Ok(())
    }

    pub fn load(&self) -> Settings {
        let mut s: Settings = std::fs::read_to_string(self.settings_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        s.add_new_builtins();
        s
    }

    pub fn keys(&self) -> HashMap<String, String> {
        if !keystore_available() {
            return self.read_plaintext_auth().unwrap_or_default();
        }
        // Migrate legacy plaintext auth.json into the OS keystore on first read.
        if let Some(legacy) = self.read_plaintext_auth() {
            let mut merged = self.load_keystore_keys();
            for (k, v) in legacy {
                if !v.is_empty() {
                    merged.insert(k, v);
                }
            }
            let prev: BTreeSet<String> = self.read_index().into_iter().collect();
            let _ = self.persist_keys(&merged, prev);
            return merged;
        }
        self.load_keystore_keys()
    }

    fn load_keystore_keys(&self) -> HashMap<String, String> {
        let mut ids: BTreeSet<String> = self.read_index().into_iter().collect();
        for p in &self.load().providers {
            ids.insert(p.id.clone());
        }
        ids.insert(SEARCH_KEY.to_string());
        let mut out = HashMap::new();
        for id in ids {
            if let Some(val) = ks_get(&self.ks_account(&id)) {
                if !val.is_empty() {
                    out.insert(id, val);
                }
            }
        }
        out
    }

    pub fn view(&self) -> SettingsView {
        let s = self.load();
        let keys = self.keys();
        SettingsView {
            providers: s
                .providers
                .into_iter()
                .map(|p| ProviderView { has_key: keys.get(&p.id).is_some_and(|k| !k.is_empty()), provider: p })
                .collect(),
            roles: s.roles,
            search: SearchView { base_url: s.search.base_url, has_key: keys.get(SEARCH_KEY).is_some_and(|k| !k.is_empty()) },
            data_dir: self.dir.display().to_string(),
        }
    }

    pub fn save(&self, input: SettingsInput) -> Result<()> {
        let mut keys = self.keys();
        let mut prev_ids: BTreeSet<String> = keys.keys().cloned().collect();
        prev_ids.extend(self.read_index());
        let mut providers = Vec::new();
        for p in input.providers {
            if p.clear_key {
                keys.remove(&p.provider.id);
            } else if let Some(k) = p.api_key.filter(|k| !k.trim().is_empty()) {
                keys.insert(p.provider.id.clone(), k.trim().to_string());
            }
            providers.push(p.provider);
        }
        let current = self.load();
        let mut search = current.search;
        if let Some(s) = input.search {
            search.base_url = s.base_url.trim().to_string();
            if s.clear_key {
                keys.remove(SEARCH_KEY);
            } else if let Some(k) = s.api_key.filter(|k| !k.trim().is_empty()) {
                keys.insert(SEARCH_KEY.to_string(), k.trim().to_string());
            }
        }
        // Drop keys of providers that no longer exist (the search key is not a provider).
        keys.retain(|id, _| id == SEARCH_KEY || providers.iter().any(|p| &p.id == id));
        // Accessibility has its own command: a models save keeps it.
        let settings = Settings { providers, roles: input.roles, search, accessibility: current.accessibility, identity: current.identity, seen_builtins: BUILTIN.iter().map(|(id, ..)| id.to_string()).collect() };
        write_atomic(&self.settings_path(), &serde_json::to_string_pretty(&settings)?)?;
        self.persist_keys(&keys, prev_ids)?;
        Ok(())
    }

    /// A provider by id, or the built-in one if the person had removed it.
    pub fn provider_or_builtin(&self, id: &str) -> Option<Provider> {
        self.load().providers.into_iter().find(|p| p.id == id).or_else(|| BUILTIN.iter().find(|(b, ..)| *b == id).map(|(id, label, url)| Provider { id: id.to_string(), label: label.to_string(), base_url: url.to_string() }))
    }

    /// AC-159: one key and one model for everything. Only the teacher's model
    /// changes; the Voz and any role chosen in Avanzado stay as they were.
    pub fn save_quick(&self, provider: &Provider, key: &str, teacher: ModelRef) -> Result<()> {
        let mut s = self.load();
        if !s.providers.iter().any(|p| p.id == provider.id) {
            s.providers.push(provider.clone());
        }
        s.roles.teacher = teacher;
        let mut keys = self.keys();
        let prev_ids: BTreeSet<String> = keys.keys().cloned().collect();
        keys.insert(provider.id.clone(), key.to_string());
        write_atomic(&self.settings_path(), &serde_json::to_string_pretty(&s)?)?;
        self.persist_keys(&keys, prev_ids)?;
        Ok(())
    }

    pub fn save_identity(&self, i: Identity) -> Result<Identity> {
        let mut s = self.load();
        s.identity = i.clamped();
        write_atomic(&self.settings_path(), &serde_json::to_string_pretty(&s)?)?;
        Ok(s.identity)
    }

    pub fn save_accessibility(&self, a: Accessibility) -> Result<Accessibility> {
        let mut s = self.load();
        s.accessibility = a.clamped();
        write_atomic(&self.settings_path(), &serde_json::to_string_pretty(&s)?)?;
        Ok(s.accessibility)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (SettingsStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-settings-{}", uuid::Uuid::new_v4().simple()));
        (SettingsStore::new(&dir), dir)
    }

    fn input(keys: &[(&str, Option<&str>, bool)]) -> SettingsInput {
        SettingsInput {
            providers: keys
                .iter()
                .map(|(id, key, clear)| ProviderInput {
                    provider: Provider { id: id.to_string(), label: id.to_string(), base_url: "u".into() },
                    api_key: key.map(String::from),
                    clear_key: *clear,
                })
                .collect(),
            roles: Roles::default(),
            search: None,
        }
    }

    #[test]
    fn fresh_install_has_default_providers_and_no_keys() {
        let (st, _) = store();
        let v = st.view();
        let ids: Vec<&str> = v.providers.iter().map(|p| p.provider.id.as_str()).collect();
        assert_eq!(ids, ["openrouter", "openai", "anthropic", "gemini", "deepseek", "opencode-go"]);
        assert!(v.providers.iter().all(|p| !p.has_key));
        assert!(v.roles.teacher.model.is_empty());
    }

    #[test]
    fn keys_are_trimmed_kept_cleared_and_pruned() {
        let (st, dir) = store();
        st.save(input(&[("a", Some("  sk-a  "), false), ("b", Some("sk-b"), false)])).unwrap();
        assert_eq!(st.keys().get("a").map(String::as_str), Some("sk-a"));

        // Blank keeps, clear removes, a removed provider loses its key.
        st.save(input(&[("a", Some(""), false), ("b", None, true)])).unwrap();
        let k = st.keys();
        assert_eq!(k.get("a").map(String::as_str), Some("sk-a"));
        assert!(!k.contains_key("b"));
        st.save(input(&[("c", None, false)])).unwrap();
        assert!(st.keys().is_empty());

        let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!settings.contains("sk-"), "keys never go to settings.json");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn corrupt_files_fall_back_to_defaults() {
        let (st, dir) = store();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "nope").unwrap();
        std::fs::write(dir.join("auth.json"), "[]").unwrap();
        assert_eq!(st.load().providers.len(), 6);
        assert!(st.keys().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn accessibility_is_clamped_and_survives_a_models_save() {
        let (st, dir) = store();
        assert_eq!(st.load().accessibility, Accessibility::default());
        let a = Accessibility { literal: true, speech_rate: 9.0, text_size: "huge".into(), ..Default::default() };
        let saved = st.save_accessibility(a).unwrap();
        assert_eq!((saved.speech_rate, saved.text_size.as_str()), (1.4, "normal"));
        st.save(input(&[("a", Some("sk-a"), false)])).unwrap();
        assert!(st.load().accessibility.literal, "the models tab doesn't reset it");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_teacher_section_lists_only_what_changes_its_writing() {
        assert_eq!(Accessibility::default().teacher_section(), "");
        let display_only = Accessibility { spacing: true, text_size: "larger".into(), reduce_motion: true, ..Default::default() };
        assert_eq!(display_only.teacher_section(), "", "display settings are the app's job");
        let s = Accessibility { easy_reading: true, short_steps: true, ..Default::default() }.teacher_section();
        assert!(s.contains("## Ajustes de accesibilidad") && s.contains("Lectura fácil") && s.contains("3 preguntas y listo"));
        assert!(!s.contains("Lenguaje literal"));
        assert!(!s.to_lowercase().contains("dislexia") && !s.contains("TDAH"), "never a diagnosis");
    }

    /// A settings.json written before OpenCode Go shipped.
    fn legacy_file(dir: &PathBuf, ids: &[&str]) {
        std::fs::create_dir_all(dir).unwrap();
        let providers: Vec<_> = ids.iter().map(|id| json!({ "id": id, "label": id, "base_url": "u" })).collect();
        let roles = json!({ "prober": { "provider_id": "", "model": "" }, "teacher": { "provider_id": "openrouter", "model": "m" } });
        std::fs::write(dir.join("settings.json"), json!({ "providers": providers, "roles": roles }).to_string()).unwrap();
    }

    #[test]
    fn an_existing_install_gets_opencode_go_once_and_keeps_what_it_removed() {
        let (st, dir) = store();
        // Before: the learner had removed gemini and deepseek on purpose.
        legacy_file(&dir, &["openrouter", "openai", "anthropic"]);
        let ids = |st: &SettingsStore| st.load().providers.into_iter().map(|p| p.id).collect::<Vec<_>>();
        assert_eq!(ids(&st), ["openrouter", "openai", "anthropic", "opencode-go"], "added at the end, the removed ones stay removed");
        assert_eq!(st.view().providers.last().unwrap().provider.base_url, "https://opencode.ai/inference/go/v1");
        assert_eq!(st.load().roles.teacher.model, "m", "nothing else changes");

        // Saving with the list as shown keeps it; removing it afterwards is respected for good.
        st.save(input(&[("openrouter", None, false), ("opencode-go", Some("oc-key"), false)])).unwrap();
        assert_eq!(st.keys().get("opencode-go").map(String::as_str), Some("oc-key"));
        st.save(input(&[("openrouter", None, false)])).unwrap();
        assert_eq!(ids(&st), ["openrouter"], "removed on purpose, never put back");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_fresh_install_has_opencode_go_exactly_once() {
        let (st, _) = store();
        assert_eq!(st.load().providers.iter().filter(|p| p.id == "opencode-go").count(), 1);
        let (st2, dir) = store();
        st2.save(input(&[("a", None, false)])).unwrap();
        legacy_file(&dir, &["openrouter", "opencode-go"]);
        assert_eq!(st2.load().providers.iter().filter(|p| p.id == "opencode-go").count(), 1, "an install that already has it isn't doubled");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn identity_is_cleaned_survives_a_models_save_and_tells_the_model_only_what_was_said() {
        let (st, dir) = store();
        assert_eq!(st.load().identity, Identity::default());
        assert_eq!(Identity::default().teacher_section(), "");
        let saved = st
            .save_identity(Identity { first_name: "  Emanuel ".into(), last_name: "Paz".into(), career: "Ingeniería en Sistemas".into(), school: "UTN".into(), age: Some(3), treatment: "otro".into(), treatment_other: "como quieras".into(), onboarded: true })
            .unwrap();
        assert_eq!((saved.first_name.as_str(), saved.age, saved.treatment.as_str()), ("Emanuel", None, ""), "age out of range and an unknown treatment are dropped");
        st.save(input(&[("a", None, false)])).unwrap();
        assert_eq!(st.load().identity.first_name, "Emanuel", "the models tab doesn't reset it");

        let section = st.load().identity.teacher_section();
        assert!(section.contains("Se llama Emanuel Paz") && section.contains("Estudia Ingeniería en Sistemas en UTN") && section.contains("«como quieras»"), "{section}");
        assert!(!section.contains("años"), "no age, none said");
        let ella = Identity { first_name: "Jessica".into(), treatment: "ella".into(), age: Some(19), ..Default::default() }.teacher_section();
        assert!(ella.contains("femenino (ella)") && ella.contains("Tiene 19 años"));
        let elle = Identity { treatment: "elle".into(), ..Default::default() }.teacher_section();
        assert!(elle.contains("neutro (elle)") && !elle.contains("Se llama"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn keys_live_in_keystore_and_migrate_from_legacy_auth_json() {
        let (st, dir) = store();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("auth.json"), r#"{"openrouter":"sk-legacy-1","search":"tvly-legacy"}"#).unwrap();

        let loaded = st.keys();
        assert_eq!(loaded.get("openrouter").map(String::as_str), Some("sk-legacy-1"));
        assert_eq!(loaded.get(SEARCH_KEY).map(String::as_str), Some("tvly-legacy"));
        assert!(!dir.join("auth.json").exists(), "legacy plaintext auth.json must be removed after migration");
        let index = std::fs::read_to_string(dir.join("auth-keys.json")).unwrap();
        assert!(!index.contains("sk-legacy-1") && !index.contains("tvly-legacy"), "index stores only provider ids, never secrets");

        // save_quick also writes only to the keystore, never plaintext auth.json.
        st.save_quick(&Provider { id: "openai".into(), label: "OpenAI".into(), base_url: "u".into() }, "sk-quick-2", ModelRef { provider_id: "openai".into(), model: "gpt".into(), context_k: None }).unwrap();
        assert!(!dir.join("auth.json").exists());
        assert_eq!(st.keys().get("openai").map(String::as_str), Some("sk-quick-2"));
        std::fs::remove_dir_all(dir).ok();
    }
}
