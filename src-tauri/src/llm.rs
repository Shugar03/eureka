//! Minimal OpenAI-compatible chat client with streaming + tool calls.
//!
//! Every provider we support exposes an OpenAI-compatible `/chat/completions`
//! endpoint (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Groq, ...), so a
//! single client keeps the provider layer swappable through configuration.

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type", default = "function_type")]
    pub kind: String,
    pub function: FunctionCall,
}

fn function_type() -> String {
    "function".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

/// A message in OpenAI wire format, plus an app-only `meta` field that is
/// stripped before sending (used by the UI to render answers, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Msg {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
}

impl Msg {
    pub fn user(text: impl Into<String>, meta: Option<Value>) -> Self {
        Self { role: "user".into(), content: Some(text.into()), tool_calls: None, tool_call_id: None, meta }
    }
    pub fn tool(id: impl Into<String>, text: impl Into<String>, meta: Option<Value>) -> Self {
        Self { role: "tool".into(), content: Some(text.into()), tool_calls: None, tool_call_id: Some(id.into()), meta }
    }
    fn wire(&self) -> Value {
        let mut v = json!({ "role": self.role });
        // Assistant messages with tool calls may have null content.
        v["content"] = match &self.content {
            Some(c) => json!(c),
            None => Value::Null,
        };
        if let Some(tc) = &self.tool_calls {
            v["tool_calls"] = json!(tc);
        }
        if let Some(id) = &self.tool_call_id {
            v["tool_call_id"] = json!(id);
        }
        v
    }
}

pub struct Endpoint {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// Context window in tokens, for the history window.
    pub context_tokens: usize,
    /// Stable per conversation: OpenCode Go rejects requests without it
    /// (`x-opencode-session`) and uses it for routing and prompt caching.
    pub session: String,
}

/// The conversation id for calls outside a session (practice, exams…): one per run.
pub fn app_session() -> String {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| format!("eureka-{}", uuid::Uuid::new_v4().simple())).clone()
}

pub struct Completion {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

fn url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

pub(crate) fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        // Our own name, not reqwest's: OpenCode Go asks clients to identify themselves.
        .user_agent(concat!("Eureka/", env!("CARGO_PKG_VERSION")))
        .build()?)
}

/// Streams one completion. `on_text` receives text deltas as they arrive;
/// `cancelled` is polled between chunks.
pub async fn stream_chat(
    ep: &Endpoint,
    system: &str,
    messages: &[Msg],
    tools: &Value,
    tool_choice: Option<&Value>,
    mut on_text: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<Completion> {
    let mut wire = vec![json!({ "role": "system", "content": system })];
    wire.extend(messages.iter().map(Msg::wire));

    let mut body = json!({
        "model": ep.model,
        "messages": wire,
        "tools": tools,
        "stream": true,
    });
    if let Some(choice) = tool_choice {
        body["tool_choice"] = choice.clone();
    }
    // Plain chat (no tools): some providers reject an empty "tools" list.
    if tools.as_array().is_some_and(|a| a.is_empty()) {
        body.as_object_mut().unwrap().remove("tools");
    }

    let resp = client()?
        .post(url(&ep.base_url, "chat/completions"))
        .bearer_auth(&ep.api_key)
        // OpenRouter attribution headers; ignored by other providers.
        .header("HTTP-Referer", "https://github.com/eureka")
        .header("X-Title", "Eureka")
        .header("x-opencode-session", &ep.session)
        .json(&body)
        .send()
        .await
        .context("no se pudo conectar con el proveedor")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        bail!("el proveedor respondió {status}: {text}");
    }

    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancelled() {
            break;
        }
        for t in parser.push(&chunk?)? {
            on_text(&t);
        }
        if parser.done {
            break;
        }
    }
    Ok(parser.finish())
}

/// Incremental parser for an OpenAI-style SSE stream. Pure (no IO) so it can be
/// tested with arbitrary chunk boundaries. Buffers raw bytes and only decodes
/// complete lines, so multi-byte UTF-8 characters split across network chunks
/// survive intact.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    text: String,
    // Tool calls arrive fragmented, keyed by index.
    calls: Vec<ToolCall>,
    pub done: bool,
}

impl SseParser {
    /// Feeds bytes; returns the text deltas completed by this chunk.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        self.buf.extend_from_slice(bytes);
        let mut deltas = Vec::new();
        while !self.done {
            let Some(pos) = self.buf.iter().position(|&b| b == b'\n') else { break };
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            if let Some(t) = self.line(line.trim())? {
                deltas.push(t);
            }
        }
        Ok(deltas)
    }

    fn line(&mut self, line: &str) -> Result<Option<String>> {
        let Some(data) = line.strip_prefix("data:") else { return Ok(None) };
        let data = data.trim();
        if data == "[DONE]" {
            self.done = true;
            return Ok(None);
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else { return Ok(None) };
        if let Some(err) = v.get("error") {
            return Err(anyhow!("error del proveedor: {err}"));
        }
        let Some(delta) = v.pointer("/choices/0/delta") else { return Ok(None) };
        if let Some(tcs) = delta.get("tool_calls").and_then(Value::as_array) {
            for tc in tcs {
                let idx = tc.get("index").and_then(Value::as_u64).unwrap_or(self.calls.len() as u64) as usize;
                while self.calls.len() <= idx {
                    self.calls.push(ToolCall {
                        id: String::new(),
                        kind: "function".into(),
                        function: FunctionCall { name: String::new(), arguments: String::new() },
                    });
                }
                let slot = &mut self.calls[idx];
                if let Some(id) = tc.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    slot.id = id.to_string();
                }
                if let Some(f) = tc.get("function") {
                    if let Some(n) = f.get("name").and_then(Value::as_str) {
                        slot.function.name.push_str(n);
                    }
                    if let Some(a) = f.get("arguments").and_then(Value::as_str) {
                        slot.function.arguments.push_str(a);
                    }
                }
            }
        }
        match delta.get("content").and_then(Value::as_str) {
            Some(t) if !t.is_empty() => {
                self.text.push_str(t);
                Ok(Some(t.to_string()))
            }
            _ => Ok(None),
        }
    }

    pub fn finish(mut self) -> Completion {
        // A last line without trailing newline.
        if !self.buf.is_empty() && !self.done {
            let rest = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).to_string();
            let _ = self.line(rest.trim());
        }
        for (i, c) in self.calls.iter_mut().enumerate() {
            if c.id.is_empty() {
                c.id = format!("call_{}_{}", i, uuid::Uuid::new_v4().simple());
            }
            if c.function.arguments.trim().is_empty() {
                c.function.arguments = "{}".into();
            }
        }
        self.calls.retain(|c| !c.function.name.is_empty());
        Completion { text: self.text, tool_calls: self.calls }
    }
}

/// A model as `/models` lists it, with its context window when the provider says it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    /// Tokens; OpenRouter says `context_length`, others `context_window` or `max_input_tokens`.
    pub context: Option<u64>,
    /// False when the provider lists its parameters and tools are not among them (OpenRouter).
    pub tools: bool,
}

/// The models of a `/models` answer (OpenAI-compatible `data`), sorted by id.
pub fn parse_models(v: &Value) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = v
        .get("data")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(Value::as_str)?;
                    let context = ["context_length", "context_window", "max_input_tokens", "max_context_length"].iter().find_map(|k| m.get(*k).and_then(Value::as_u64)).or_else(|| m.pointer("/top_provider/context_length").and_then(Value::as_u64));
                    // Gemini prefixes ids with "models/".
                    let tools = m.get("supported_parameters").and_then(Value::as_array).is_none_or(|p| p.iter().any(|x| x == "tools"));
                    Some(ModelInfo { id: id.trim_start_matches("models/").to_string(), context, tools })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Lists the provider's models from its `/models` endpoint.
pub async fn list_model_infos(base_url: &str, api_key: &str) -> Result<Vec<ModelInfo>> {
    let resp = client()?
        .get(url(base_url, "models"))
        .bearer_auth(api_key)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        // OpenCode Go rejects requests without it (MissingSessionID).
        .header("x-opencode-session", app_session())
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        bail!("el proveedor respondió {status}: {}", resp.text().await.unwrap_or_default());
    }
    Ok(parse_models(&resp.json().await?))
}

/// Lists model ids from the provider's `/models` endpoint.
pub async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>> {
    Ok(list_model_infos(base_url, api_key).await?.into_iter().map(|m| m.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sse(events: &[Value]) -> Vec<u8> {
        let mut out = String::new();
        for e in events {
            out.push_str(&format!("data: {e}\n\n"));
        }
        out.push_str("data: [DONE]\n\n");
        out.into_bytes()
    }

    fn text_ev(t: &str) -> Value {
        json!({ "choices": [{ "delta": { "content": t } }] })
    }

    /// Feeds `bytes` in chunks of `size` and returns (deltas joined, completion).
    fn run(bytes: &[u8], size: usize) -> (String, Completion) {
        let mut p = SseParser::default();
        let mut seen = String::new();
        for chunk in bytes.chunks(size) {
            for d in p.push(chunk).unwrap() {
                seen.push_str(&d);
            }
        }
        (seen, p.finish())
    }

    #[test]
    fn reassembles_text_split_inside_multibyte_chars() {
        let bytes = sse(&[text_ev("¿Qué "), text_ev("año"), text_ev(" → ñandú?")]);
        for size in 1..=7 {
            let (seen, c) = run(&bytes, size);
            assert_eq!(c.text, "¿Qué año → ñandú?", "chunk size {size}");
            assert_eq!(seen, c.text);
            assert!(!c.text.contains('\u{FFFD}'));
        }
    }

    #[test]
    fn accumulates_fragmented_tool_calls_by_index() {
        let bytes = sse(&[
            json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "function": { "name": "record_", "arguments": "{\"con" } }
            ] } }] }),
            json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "name": "finding", "arguments": "cept\":\"x\"}" } },
                { "index": 1, "id": "call_b", "function": { "name": "ask_question", "arguments": "" } }
            ] } }] }),
        ]);
        let (_, c) = run(&bytes, 5);
        assert_eq!(c.tool_calls.len(), 2);
        assert_eq!(c.tool_calls[0].id, "call_a");
        assert_eq!(c.tool_calls[0].function.name, "record_finding");
        assert_eq!(c.tool_calls[0].function.arguments, "{\"concept\":\"x\"}");
        assert_eq!(c.tool_calls[1].function.arguments, "{}", "empty args normalized");
    }

    #[test]
    fn stops_at_done_and_ignores_noise() {
        let mut bytes = b": keep-alive comment\n\nevent: ping\n\n".to_vec();
        bytes.extend(sse(&[text_ev("hola")]));
        bytes.extend(b"data: {\"choices\":[{\"delta\":{\"content\":\"tarde\"}}]}\n\n");
        let (_, c) = run(&bytes, 3);
        assert_eq!(c.text, "hola");
    }

    #[test]
    fn empty_content_deltas_are_not_emitted() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n").unwrap().is_empty());
    }

    #[test]
    fn last_line_without_newline_is_still_parsed() {
        let mut p = SseParser::default();
        p.push(format!("data: {}", text_ev("fin")).as_bytes()).unwrap();
        assert_eq!(p.finish().text, "fin");
    }

    #[test]
    fn surfaces_provider_errors() {
        let mut p = SseParser::default();
        let err = p.push(b"data: {\"error\":{\"message\":\"rate limited\"}}\n").unwrap_err();
        assert!(err.to_string().contains("rate limited"));
    }

    #[test]
    fn wire_format_strips_meta() {
        let m = Msg::tool("call_1", "ok", Some(json!({ "kind": "answer" })));
        let w = m.wire();
        assert_eq!(w["role"], "tool");
        assert_eq!(w["tool_call_id"], "call_1");
        assert!(w.get("meta").is_none());
    }
}
