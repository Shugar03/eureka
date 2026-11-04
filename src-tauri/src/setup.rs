//! One key and done (AC-158, AC-159): the person pastes a key and Eureka finds
//! the provider by the key's format, lists that provider's models, picks one
//! for everything, checks it really answers with tools, and saves it.
//!
//! The key is only ever sent to the provider its format points to: when the
//! format fits several (a bare `sk-` is OpenAI or DeepSeek) the person picks,
//! and nothing is tried on the others.

use crate::llm::{self, Endpoint, ModelInfo, Msg};
use crate::settings::ModelRef;
use crate::AppState;
use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::json;

/// What people paste: the key, maybe with `Bearer `, quotes or a line break.
pub fn clean_key(raw: &str) -> String {
    let k = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`').trim();
    let k = k.strip_prefix("Bearer ").or_else(|| k.strip_prefix("bearer ")).unwrap_or(k);
    k.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The providers a key's format points to (built-in ids), most likely first.
/// Empty when the format is unknown: the person picks the service.
pub fn detect(key: &str) -> Vec<&'static str> {
    let hex32 = |s: &str| s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit());
    if key.starts_with("sk-or-") {
        vec!["openrouter"]
    } else if key.starts_with("sk-ant-") {
        vec!["anthropic"]
    } else if key.starts_with("AIza") {
        vec!["gemini"]
    } else if key.starts_with("oc_") {
        vec!["opencode-go"]
    } else if ["sk-proj-", "sk-svcacct-", "sk-admin-"].iter().any(|p| key.starts_with(p)) {
        vec!["openai"]
    } else if let Some(rest) = key.strip_prefix("sk-") {
        // DeepSeek keys are `sk-` and 32 hex digits; older OpenAI keys are `sk-` too.
        if hex32(rest) {
            vec!["deepseek", "openai"]
        } else {
            vec!["openai", "deepseek"]
        }
    } else {
        vec![]
    }
}

/// Models known to teach well with tools, per provider, best first. Only the
/// ones that were seen in a real listing; for the rest, `choose` decides.
const PREFERRED: &[(&str, &[&str])] = &[("opencode-go", &["deepseek-v4.1-flash", "deepseek-v4-pro", "glm-5.3", "kimi-k3", "qwen3.8-max"])];

/// Ids that are not chat models (embeddings, voice, images…).
const NOT_CHAT: &[&str] = &["embed", "whisper", "tts", "transcribe", "audio", "realtime", "image", "dall-e", "moderation", "search", "rerank", "speech", "vision-preview", "davinci", "babbage"];
/// Cheap and fast variants: what a learning app spends the most on.
const LIGHT: &[&str] = &["flash", "mini", "haiku", "lite", "chat", "small", "turbo"];

pub fn is_chat(m: &ModelInfo) -> bool {
    let id = m.id.to_lowercase();
    m.tools && !NOT_CHAT.iter().any(|w| id.contains(w))
}

/// The models to try, best first: the provider's preferred ones if listed,
/// then light chat models, then the rest; newer-looking ids first.
pub fn choose(provider: &str, models: &[ModelInfo]) -> Vec<ModelInfo> {
    let mut chat: Vec<&ModelInfo> = models.iter().filter(|m| is_chat(m)).collect();
    let preferred: &[&str] = PREFERRED.iter().find(|(p, _)| *p == provider).map_or(&[], |(_, l)| l);
    let rank = |m: &ModelInfo| {
        let id = m.id.to_lowercase();
        let pref = preferred.iter().position(|p| *p == m.id).unwrap_or(usize::MAX);
        let light = !LIGHT.iter().any(|w| id.contains(w));
        let odd = ["preview", "exp", "beta", "test", "free"].iter().any(|w| id.contains(w)) && provider != "openrouter";
        (pref, odd, light)
    };
    chat.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| b.id.cmp(&a.id)));
    chat.into_iter().cloned().collect()
}

/// The context window to save, in thousands of tokens: only what the provider
/// said, between 8k and 1M; otherwise none (the app uses its safe default).
pub fn context_k(m: &ModelInfo) -> Option<u32> {
    m.context.filter(|c| (8_000..=1_000_000).contains(c)).map(|c| (c / 1000) as u32)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Outcome {
    /// The format fits several services (or none): the person picks.
    Choose { candidates: Vec<String>, reason: String },
    Done(Done),
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Done {
    pub provider_id: String,
    pub provider: String,
    pub model: String,
    /// Thousands of tokens, when the provider said it.
    pub context_k: Option<u32>,
    /// Other chat models of the provider, to change it with one click.
    pub alternatives: Vec<String>,
    /// The Voz was already chosen (kept as it was).
    pub speech_ready: bool,
    /// The test call used a tool (some providers answer in text instead).
    pub tools_ok: bool,
}

/// One small real call with a tool: listing a model is not proof it chats.
async fn tool_check(ep: &Endpoint) -> Result<bool> {
    let tools = json!([{ "type": "function", "function": { "name": "listo", "description": "Confirma que la conexión anda.", "parameters": { "type": "object", "properties": {} } } }]);
    let msgs = [Msg::user("Prueba de conexión de Eureka: llamá a la herramienta `listo`.", None)];
    let c = llm::stream_chat(ep, "Sos una prueba de conexión. Solo llamá a la herramienta.", &msgs, &tools, Some(&json!("auto")), |_| {}, || false).await?;
    Ok(c.tool_calls.iter().any(|t| t.function.name == "listo"))
}

/// Plain words for what went wrong asking the provider.
fn friendly(e: &anyhow::Error) -> String {
    let t = e.to_string();
    let l = t.to_lowercase();
    if ["401", "403", "unauthor", "invalid", "api key"].iter().any(|w| l.contains(w)) {
        "La clave no funcionó con ese servicio. Revisá que la copiaste completa, o elegí otro servicio.".into()
    } else if ["402", "429", "quota", "credit", "insufficient"].iter().any(|w| l.contains(w)) {
        "El servicio dice que no tenés saldo o llegaste al límite.".into()
    } else {
        format!("No pude conectarme con el servicio: {t}")
    }
}

/// AC-158/159: from a pasted key to a working setup. `provider` is the
/// person's pick when the format was not enough.
pub async fn run(state: &AppState, raw_key: &str, provider: Option<&str>) -> Result<Outcome> {
    let key = clean_key(raw_key);
    if key.len() < 8 {
        return Err(anyhow!("Pegá la clave completa."));
    }
    let candidates: Vec<String> = match provider {
        Some(p) => vec![p.to_string()],
        None => detect(&key).into_iter().map(String::from).collect(),
    };
    if candidates.len() != 1 {
        let reason = if candidates.is_empty() { "No reconozco el formato de esa clave: elegí de qué servicio es." } else { "Esa clave puede ser de más de un servicio: elegí de cuál es (solo se la mando a ese)." };
        let all = if candidates.is_empty() { state.settings.load().providers.into_iter().map(|p| p.id).collect() } else { candidates };
        return Ok(Outcome::Choose { candidates: all, reason: reason.into() });
    }
    let provider_id = candidates[0].clone();
    let p = state.settings.provider_or_builtin(&provider_id).ok_or_else(|| anyhow!("No conozco el servicio «{provider_id}»."))?;
    let models = match llm::list_model_infos(&p.base_url, &key).await {
        Ok(m) => m,
        // Only the format pointed here: let the person say which service it is.
        Err(e) if provider.is_none() => return Ok(Outcome::Choose { candidates: state.settings.load().providers.into_iter().map(|p| p.id).collect(), reason: format!("{} ¿Es de otro servicio?", friendly(&e)) }),
        Err(e) => return Err(anyhow!(friendly(&e))),
    };
    let ranked = choose(&provider_id, &models);
    if ranked.is_empty() {
        return Err(anyhow!("{} no ofrece ningún modelo de chat con esa clave.", p.label));
    }
    let mut last = None;
    for m in ranked.iter().take(3) {
        let ep = Endpoint { base_url: p.base_url.clone(), api_key: key.clone(), model: m.id.clone(), context_tokens: crate::context::DEFAULT_BUDGET, session: llm::app_session(), subscription: None };
        match tool_check(&ep).await {
            Ok(tools_ok) => {
                let teacher = ModelRef { provider_id: provider_id.clone(), model: m.id.clone(), context_k: context_k(m) };
                state.settings.save_quick(&p, &key, teacher)?;
                let speech_ready = !state.settings.load().roles.speech.model.is_empty();
                let alternatives = ranked.iter().filter(|x| x.id != m.id).take(6).map(|x| x.id.clone()).collect();
                return Ok(Outcome::Done(Done { provider_id, provider: p.label.clone(), model: m.id.clone(), context_k: context_k(m), alternatives, speech_ready, tools_ok }));
            }
            Err(e) => last = Some(e),
        }
    }
    Err(anyhow!(friendly(&last.unwrap_or_else(|| anyhow!("sin respuesta")))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str) -> ModelInfo {
        ModelInfo { id: id.into(), context: None, tools: true }
    }

    #[test]
    fn a_pasted_key_is_cleaned() {
        assert_eq!(clean_key("  \"Bearer oc_abc123def\"\n"), "oc_abc123def");
        assert_eq!(clean_key("sk-or-v1-aa bb\r\n"), "sk-or-v1-aabb");
    }

    #[test]
    fn the_format_points_to_the_provider_and_ambiguity_is_never_guessed() {
        assert_eq!(detect("oc_9f8e7d6c5b4a"), ["opencode-go"]);
        assert_eq!(detect("sk-or-v1-0123"), ["openrouter"]);
        assert_eq!(detect("sk-ant-api03-xyz"), ["anthropic"]);
        assert_eq!(detect("AIzaSyD-abc"), ["gemini"]);
        assert_eq!(detect("sk-proj-abc"), ["openai"]);
        assert_eq!(detect(&format!("sk-{}", "a1".repeat(16))), ["deepseek", "openai"], "two candidates: the person picks");
        assert_eq!(detect("sk-viejo-de-prueba-sin-formato"), ["openai", "deepseek"]);
        assert!(detect("gsk_groq").is_empty());
    }

    #[test]
    fn a_chat_model_with_tools_is_chosen_and_the_favourite_first() {
        let list = [m("text-embedding-3-small"), m("whisper-1"), m("glm-5.3"), m("deepseek-v4-pro"), m("deepseek-v4.1-flash"), ModelInfo { tools: false, ..m("no-tools-model") }];
        let ids: Vec<String> = choose("opencode-go", &list).into_iter().map(|x| x.id).collect();
        assert_eq!(ids, ["deepseek-v4.1-flash", "deepseek-v4-pro", "glm-5.3"]);
        let ids: Vec<String> = choose("openai", &[m("gpt-6"), m("gpt-6-mini"), m("gpt-5-mini"), m("gpt-6-mini-preview"), m("tts-1"), m("gpt-image-2")]).into_iter().map(|x| x.id).collect();
        assert_eq!(ids, ["gpt-6-mini", "gpt-5-mini", "gpt-6", "gpt-6-mini-preview"], "light first, newer first, previews last");
        assert!(choose("x", &[m("whisper-1")]).is_empty());
    }

    #[test]
    fn the_context_is_what_the_provider_said_or_nothing() {
        assert_eq!(context_k(&ModelInfo { context: Some(131_072), ..m("a") }), Some(131));
        assert_eq!(context_k(&m("a")), None, "unknown: the app's safe default");
        assert_eq!(context_k(&ModelInfo { context: Some(2_000), ..m("a") }), None, "absurd numbers are ignored");
        let v = json!({ "data": [
            { "id": "deepseek/deepseek-v4", "context_length": 163840, "supported_parameters": ["tools", "temperature"] },
            { "id": "some/no-tools", "context_length": 8192, "supported_parameters": ["temperature"] },
            { "id": "models/gemini-3-flash" }
        ] });
        let got = llm::parse_models(&v);
        assert_eq!(got[0], ModelInfo { id: "deepseek/deepseek-v4".into(), context: Some(163_840), tools: true });
        assert_eq!(got[1].id, "gemini-3-flash");
        assert!(!got[2].tools);
    }
}

/// The real check (AC-159), with the person's own key and nothing else:
/// `LA_REAL_AUTH=<auth.json> cargo test --lib setup::real -- --ignored --nocapture`.
/// Works on a fresh data folder that is removed at the end.
#[cfg(test)]
mod real {
    #[tokio::test]
    #[ignore]
    async fn one_real_key_sets_everything_up() {
        let Ok(path) = std::env::var("LA_REAL_AUTH") else { return };
        let keys: std::collections::HashMap<String, String> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let key = keys.get("opencode-go").expect("an OpenCode Go key").clone();
        let dir = std::env::temp_dir().join(format!("la-setup-real-{}", uuid::Uuid::new_v4().simple()));
        let st = crate::AppState::new(dir.clone());
        let t = std::time::Instant::now();
        let out = super::run(&st, &key, None).await;
        std::fs::remove_dir_all(&dir).ok();
        println!("{:?} in {:.1}s", out.as_ref().map_err(|e| e.to_string()), t.elapsed().as_secs_f32());
        assert!(matches!(out, Ok(super::Outcome::Done(_))));
    }
}
