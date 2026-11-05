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
    /// `Some` for a subscription account (ChatGPT Plus/Pro): that provider does
    /// not expose `/chat/completions` to subscriber tokens, it speaks the
    /// Responses API on its own backend. `None` is every API-key provider.
    pub subscription: Option<Subscription>,
    /// Who is calling and why, and where the call is counted (AC-186).
    pub usage: crate::usage::Tag,
}

/// What a subscription endpoint needs on every request, beyond the token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subscription {
    /// ChatGPT: `ChatGPT-Account-Id`.
    pub account_id: String,
    /// The client name the token was issued to (`originator`).
    pub originator: String,
}

/// The conversation id for calls outside a session (practice, exams…): one per run.
pub fn app_session() -> String {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| format!("eureka-{}", uuid::Uuid::new_v4().simple())).clone()
}

pub struct Completion {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    /// What the provider said this call spent; `None` when it said nothing.
    pub usage: Option<crate::usage::Usage>,
}

fn url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

/// The one HTTP client every call goes through (models, voice, search, updates).
pub(crate) fn client() -> Result<reqwest::Client> {
    let builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        // A connection silent this long is dead (the phone froze the app, the
        // network dropped): the turn ends with an error instead of hanging.
        .read_timeout(std::time::Duration::from_secs(180))
        // Our own name, not reqwest's: OpenCode Go asks clients to identify themselves.
        .user_agent(concat!("Eureka/", env!("CARGO_PKG_VERSION")));
    #[cfg(target_os = "android")]
    let builder = builder.tls_backend_preconfigured(android_tls());
    Ok(builder.build()?)
}

/// Android: rustls on ring with the Mozilla roots built in (see Cargo.toml).
#[cfg(target_os = "android")]
fn android_tls() -> rustls::ClientConfig {
    let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
    let mut config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("ring supports the default TLS versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config
}

/// Streams one completion. `on_text` receives text deltas as they arrive;
/// `cancelled` is polled between chunks.
///
/// Two wire shapes reach this function: the OpenAI-compatible
/// `/chat/completions` every API-key provider serves, and the Responses API a
/// subscription account gets instead (see [`Endpoint::subscription`]).
pub async fn stream_chat(
    ep: &Endpoint,
    system: &str,
    messages: &[Msg],
    tools: &Value,
    tool_choice: Option<&Value>,
    on_text: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<Completion> {
    let started = std::time::Instant::now();
    let done = match &ep.subscription {
        Some(sub) => stream_responses(ep, sub, system, messages, tools, tool_choice, on_text, cancelled).await,
        None => stream_completions(ep, system, messages, tools, tool_choice, on_text, cancelled).await,
    };
    // AC-186: every answered call is counted here, once (retries count again: they cost again).
    if let Ok(c) = &done {
        ep.usage.record(&ep.model, &ep.base_url, started.elapsed().as_millis() as u64, c.usage.clone());
    }
    done
}

/// Providers that answered 4xx to `stream_options` (by base URL): asked
/// without it from then on, and their usage stays unknown unless they send it anyway.
static NO_STREAM_OPTIONS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// A 400/422 that names the option itself, nothing broader (a bad key or
/// model must still fail once, with its own message).
pub fn rejects_stream_options(status: u16, body: &str) -> bool {
    let b = body.to_lowercase();
    matches!(status, 400 | 422) && (b.contains("stream_options") || b.contains("include_usage"))
}

async fn stream_completions(
    ep: &Endpoint,
    system: &str,
    messages: &[Msg],
    tools: &Value,
    tool_choice: Option<&Value>,
    on_text: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<Completion> {
    // AC-186: the last chunk carries the usage (OpenAI and compatibles only send it when asked).
    let ask_usage = !NO_STREAM_OPTIONS.lock().unwrap().contains(&ep.base_url);
    let mut body = completions_body(ep, system, messages, tools, tool_choice, ask_usage);

    let send = |body: &Value| {
        client().map(|c| {
            c.post(url(&ep.base_url, "chat/completions"))
                .bearer_auth(&ep.api_key)
                // OpenRouter attribution headers; ignored by other providers.
                .header("HTTP-Referer", "https://github.com/eureka")
                .header("X-Title", "Eureka")
                .header("x-opencode-session", &ep.session)
                .json(body)
                .send()
        })
    };
    let resp = send(&body)?.await.context("no se pudo conectar con el proveedor")?;
    let resp = if resp.status().is_success() || !ask_usage {
        check_status(resp).await?
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !rejects_stream_options(status.as_u16(), &text) {
            bail!("el proveedor respondió {status}: {text}");
        }
        // Degrade: the call goes on without usage, never breaks for it.
        NO_STREAM_OPTIONS.lock().unwrap().push(ep.base_url.clone());
        body.as_object_mut().unwrap().remove("stream_options");
        check_status(send(&body)?.await.context("no se pudo conectar con el proveedor")?).await?
    };
    let mut parser = SseParser::default();
    pump(resp, &mut parser, on_text, cancelled).await?;
    Ok(parser.finish())
}

/// The `/chat/completions` request. Byte for byte what every provider got
/// before AC-186, plus `stream_options`, plus the cache marks only for Claude
/// through OpenRouter (see [`mark_cache`]).
pub fn completions_body(ep: &Endpoint, system: &str, messages: &[Msg], tools: &Value, tool_choice: Option<&Value>, ask_usage: bool) -> Value {
    let mut wire = vec![json!({ "role": "system", "content": system })];
    wire.extend(messages.iter().map(Msg::wire));

    let mut body = json!({
        "model": ep.model,
        "messages": wire,
        "tools": tools,
        "stream": true,
    });
    if ask_usage {
        body["stream_options"] = json!({ "include_usage": true });
    }
    if let Some(choice) = tool_choice {
        body["tool_choice"] = choice.clone();
    }
    // Plain chat (no tools): some providers reject an empty "tools" list.
    if tools.as_array().is_some_and(|a| a.is_empty()) {
        body.as_object_mut().unwrap().remove("tools");
    }
    if claude_via_openrouter(ep) {
        mark_cache(&mut body);
    }
    body
}

/// Claude caches only what is marked; through OpenRouter that is `cache_control`
/// on a content block. Every other provider caches by itself (or not at all).
pub fn claude_via_openrouter(ep: &Endpoint) -> bool {
    let model = ep.model.to_lowercase();
    crate::usage::host(&ep.base_url).ends_with("openrouter.ai") && (model.starts_with("anthropic/") || model.starts_with("~anthropic/") || model.contains("claude"))
}

/// AC-186: two breakpoints (Anthropic allows four). One closes the static part
/// (tools come before the system prompt, so it covers both); the other closes
/// the stable history, right before the state message that changes every step.
fn mark_cache(body: &mut Value) {
    let Some(msgs) = body["messages"].as_array_mut() else { return };
    let is_state = |m: &Value| m["role"] == "user" && m["content"].as_str().is_some_and(|c| c.starts_with("<estado_app>"));
    let history_end = match msgs.last() {
        Some(last) if is_state(last) && msgs.len() >= 3 => Some(msgs.len() - 2),
        _ => None,
    };
    mark_block(&mut msgs[0]);
    // The last message of the history that carries text (an assistant turn with only tool calls has none).
    if let Some(end) = history_end {
        if let Some(i) = (1..=end).rev().find(|&i| msgs[i]["content"].as_str().is_some_and(|c| !c.is_empty())) {
            mark_block(&mut msgs[i]);
        }
    }
}

fn mark_block(m: &mut Value) {
    if let Some(text) = m["content"].as_str().map(String::from) {
        m["content"] = json!([{ "type": "text", "text": text, "cache_control": { "type": "ephemeral" } }]);
    }
}

/// A subscription account: the provider's own backend, Responses API shape.
async fn stream_responses(
    ep: &Endpoint,
    sub: &Subscription,
    system: &str,
    messages: &[Msg],
    tools: &Value,
    tool_choice: Option<&Value>,
    on_text: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<Completion> {
    let body = responses_body(ep, system, messages, tools, tool_choice);
    let resp = client()?
        .post(url(&ep.base_url, "responses"))
        .bearer_auth(&ep.api_key)
        .header("ChatGPT-Account-Id", &sub.account_id)
        .header("originator", &sub.originator)
        .header("session-id", &ep.session)
        .json(&body)
        .send()
        .await
        .context("no se pudo conectar con el proveedor")?;

    let resp = check_status(resp).await?;
    let mut parser = ResponsesParser::default();
    pump(resp, &mut parser, on_text, cancelled).await?;
    Ok(parser.finish())
}

async fn check_status(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    bail!("el proveedor respondió {status}: {text}");
}

/// The read loop both parsers share: feed bytes, emit deltas, stop on demand.
trait StreamEvents {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>>;
    fn is_done(&self) -> bool;
}

async fn pump(
    resp: reqwest::Response,
    parser: &mut impl StreamEvents,
    mut on_text: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<()> {
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancelled() {
            break;
        }
        for t in parser.push(&chunk?)? {
            on_text(&t);
        }
        if parser.is_done() {
            break;
        }
    }
    Ok(())
}

/// Translates the chat-completions shapes Eureka already builds (`Msg`, tool
/// definitions) into the Responses API the subscription backend expects.
pub fn responses_body(ep: &Endpoint, system: &str, messages: &[Msg], tools: &Value, tool_choice: Option<&Value>) -> Value {
    let mut input = Vec::new();
    for m in messages {
        match m.role.as_str() {
            // A tool answer is its own item, not a message with a role.
            "tool" => input.push(json!({
                "type": "function_call_output",
                "call_id": m.tool_call_id.clone().unwrap_or_default(),
                "output": m.content.clone().unwrap_or_default(),
            })),
            "assistant" => {
                if let Some(t) = m.content.as_deref().filter(|t| !t.is_empty()) {
                    input.push(json!({ "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": t }] }));
                }
                for c in m.tool_calls.iter().flatten() {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": c.id,
                        "name": c.function.name,
                        "arguments": c.function.arguments,
                    }));
                }
            }
            role => input.push(json!({
                "type": "message",
                "role": role,
                "content": [{ "type": "input_text", "text": m.content.clone().unwrap_or_default() }],
            })),
        }
    }

    let mut body = json!({
        "model": ep.model,
        "instructions": system,
        "input": input,
        "store": false,
        "stream": true,
        // AC-186: same key for the whole conversation, so its calls land on the same prompt cache.
        "prompt_cache_key": ep.session,
    });
    // Same rule as chat-completions: no tools means no "tools" key at all.
    if let Some(list) = tools.as_array().filter(|a| !a.is_empty()) {
        body["tools"] = json!(list.iter().map(responses_tool).collect::<Vec<_>>());
        if let Some(choice) = tool_choice {
            body["tool_choice"] = responses_tool_choice(choice);
        }
    }
    body
}

/// `{type:"function", function:{…}}` → `{type:"function", name, description, parameters}`.
fn responses_tool(tool: &Value) -> Value {
    let flat = tool.get("function").unwrap_or(tool);
    json!({
        "type": "function",
        "name": flat.get("name").cloned().unwrap_or(Value::Null),
        "description": flat.get("description").cloned().unwrap_or(Value::Null),
        "parameters": flat.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
    })
}

fn responses_tool_choice(choice: &Value) -> Value {
    match choice.get("function").and_then(|f| f.get("name")).and_then(Value::as_str) {
        Some(name) => json!({ "type": "function", "name": name }),
        None => choice.clone(),
    }
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
    /// The last non-null `usage` seen (OpenAI: a final chunk with `choices: []`;
    /// DeepSeek: on the `finish_reason` chunk).
    usage: Option<crate::usage::Usage>,
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
        // Before the delta: the usage chunk may have no choices at all.
        if let Some(u) = v.get("usage").and_then(crate::usage::parse) {
            self.usage = Some(u);
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
        normalize_calls(&mut self.calls);
        Completion { text: self.text, tool_calls: self.calls, usage: self.usage }
    }
}

impl StreamEvents for SseParser {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        SseParser::push(self, bytes)
    }
    fn is_done(&self) -> bool {
        self.done
    }
}

/// Tool calls that arrive without an id, or with empty arguments, still have to
/// be callable: the agent matches the answer back to the call by id.
fn normalize_calls(calls: &mut Vec<ToolCall>) {
    for (i, c) in calls.iter_mut().enumerate() {
        if c.id.is_empty() {
            c.id = format!("call_{}_{}", i, uuid::Uuid::new_v4().simple());
        }
        if c.function.arguments.trim().is_empty() {
            c.function.arguments = "{}".into();
        }
    }
    calls.retain(|c| !c.function.name.is_empty());
}

/// Incremental parser for the Responses API stream a subscription account gets.
///
/// Text arrives as `response.output_text.delta`. A tool call is announced by
/// `response.output_item.added`, which carries `call_id` and `name`; its
/// arguments then come either fragmented (`…function_call_arguments.delta`) or
/// complete (`…function_call_arguments.done`). There is no `[DONE]` sentinel:
/// the stream ends at `response.completed`.
#[derive(Default)]
pub struct ResponsesParser {
    buf: Vec<u8>,
    text: String,
    calls: Vec<PendingCall>,
    usage: Option<crate::usage::Usage>,
    pub done: bool,
}

struct PendingCall {
    item_id: String,
    call: ToolCall,
}

impl ResponsesParser {
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
        match v.get("type").and_then(Value::as_str).unwrap_or_default() {
            // A bare error event carries its message at the top level.
            "error" => Err(anyhow!("error del proveedor: {}", v.get("message").and_then(Value::as_str).unwrap_or("sin detalle"))),
            "response.output_text.delta" => match v.get("delta").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                Some(t) => {
                    self.text.push_str(t);
                    Ok(Some(t.to_string()))
                }
                None => Ok(None),
            },
            "response.output_item.added" => {
                let Some(item) = v.get("item").filter(|i| i.get("type").and_then(Value::as_str) == Some("function_call")) else { return Ok(None) };
                let item_id = item.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                if self.calls.iter().any(|c| c.item_id == item_id) {
                    return Ok(None);
                }
                self.calls.push(PendingCall {
                    item_id,
                    call: ToolCall {
                        id: item.get("call_id").and_then(Value::as_str).unwrap_or_default().to_string(),
                        kind: function_type(),
                        function: FunctionCall { name: item.get("name").and_then(Value::as_str).unwrap_or_default().to_string(), arguments: String::new() },
                    },
                });
                Ok(None)
            }
            "response.function_call_arguments.delta" => {
                let item_id = v.get("item_id").and_then(Value::as_str).unwrap_or_default();
                let Some(slot) = self.calls.iter_mut().find(|c| c.item_id == item_id) else { return Ok(None) };
                if let Some(d) = v.get("delta").and_then(Value::as_str) {
                    slot.call.function.arguments.push_str(d);
                }
                Ok(None)
            }
            "response.function_call_arguments.done" => {
                self.fill_call(&v, false);
                Ok(None)
            }
            "response.output_item.done" => {
                self.fill_call(&v, true);
                Ok(None)
            }
            "response.completed" => {
                // AC-186: the whole call's usage rides on the completed event.
                self.usage = v.pointer("/response/usage").and_then(crate::usage::parse);
                self.done = true;
                Ok(None)
            }
            "response.failed" => {
                let detail = v.pointer("/response/error").map(Value::to_string).unwrap_or_default();
                Err(anyhow!("el proveedor no pudo completar la respuesta: {detail}"))
            }
            _ => Ok(None),
        }
    }

    /// Copies whatever the final event knows: `arguments` (and the name, which
    /// some accounts only send the first time) into the matching call.
    fn fill_call(&mut self, v: &Value, from_item: bool) {
        let item = if from_item { v.get("item") } else { None };
        let item_id = match item {
            Some(i) if i.get("type").and_then(Value::as_str) == Some("function_call") => i.get("id").and_then(Value::as_str).unwrap_or_default(),
            Some(_) => return,
            None => v.get("item_id").and_then(Value::as_str).unwrap_or_default(),
        };
        let Some(slot) = self.calls.iter_mut().find(|c| c.item_id == item_id) else { return };
        let source = item.unwrap_or(v);
        if let Some(args) = source.get("arguments").and_then(Value::as_str).filter(|a| !a.trim().is_empty()) {
            slot.call.function.arguments = args.to_string();
        }
        if let Some(name) = source.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) {
            slot.call.function.name = name.to_string();
        }
        if let Some(id) = source.get("call_id").and_then(Value::as_str).filter(|i| !i.is_empty()) {
            slot.call.id = id.to_string();
        }
    }

    pub fn finish(mut self) -> Completion {
        // A last line without trailing newline.
        if !self.buf.is_empty() && !self.done {
            let rest = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).to_string();
            let _ = self.line(rest.trim());
        }
        let mut calls: Vec<ToolCall> = self.calls.into_iter().map(|p| p.call).collect();
        normalize_calls(&mut calls);
        Completion { text: self.text, tool_calls: calls, usage: self.usage }
    }
}

impl StreamEvents for ResponsesParser {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        ResponsesParser::push(self, bytes)
    }
    fn is_done(&self) -> bool {
        self.done
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

/// The models a subscription account may use. Its `/models` answers
/// `{models:[{slug, visibility, supported_in_api, …}]}` instead of the `data[]`
/// an API-key provider returns, and it only lists a plan's models, so this is
/// the only honest source — it changes with the subscription.
pub async fn list_chatgpt_models(ep: &Endpoint) -> Result<Vec<ModelInfo>> {
    let Some(sub) = &ep.subscription else { bail!("Esta cuenta no es una suscripción.") };
    // `client_version` is required by the endpoint; any value it can parse works.
    let resp = client()?
        .get(format!("{}?client_version=0.0.0", url(&ep.base_url, "models")))
        .bearer_auth(&ep.api_key)
        .header("ChatGPT-Account-Id", &sub.account_id)
        .header("originator", &sub.originator)
        .header("session-id", &ep.session)
        .send()
        .await
        .context("no se pudo conectar con el proveedor")?;
    let resp = check_status(resp).await?;
    Ok(parse_subscription_models(&resp.json().await?))
}

/// Keeps the models the account can call: `visibility=="list"` and
/// `supported_in_api`, when the provider says.
pub fn parse_subscription_models(v: &Value) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = v
        .get("models")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    let id = m.get("slug").and_then(Value::as_str)?;
                    if m.get("visibility").and_then(Value::as_str).is_some_and(|v| v != "list") {
                        return None;
                    }
                    if m.get("supported_in_api").and_then(Value::as_bool) == Some(false) {
                        return None;
                    }
                    Some(ModelInfo { id: id.to_string(), context: m.get("context_window").and_then(Value::as_u64), tools: true })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
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
    fn openai_usage_arrives_in_a_final_chunk_without_choices() {
        let bytes = sse(&[
            json!({ "choices": [{ "delta": { "content": "hola" } }], "usage": null }),
            json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }], "usage": null }),
            json!({ "choices": [], "usage": { "prompt_tokens": 1500, "completion_tokens": 7, "prompt_tokens_details": { "cached_tokens": 1280 }, "completion_tokens_details": { "reasoning_tokens": 0 } } }),
        ]);
        let (_, c) = run(&bytes, 11);
        assert_eq!(c.text, "hola");
        let u = c.usage.unwrap();
        assert_eq!((u.input, u.output, u.cached, u.reasoning), (Some(1500), Some(7), Some(1280), Some(0)));
    }

    #[test]
    fn deepseek_usage_rides_on_the_finish_reason_chunk() {
        let bytes = sse(&[
            text_ev("ok"),
            json!({ "choices": [{ "index": 0, "delta": { "content": "" }, "finish_reason": "stop" }],
                "usage": { "prompt_tokens": 900, "completion_tokens": 3, "total_tokens": 903, "prompt_cache_hit_tokens": 768, "prompt_cache_miss_tokens": 132,
                    "prompt_tokens_details": { "cached_tokens": 768 }, "completion_tokens_details": { "reasoning_tokens": 120 } } }),
        ]);
        let u = run(&bytes, 4).1.usage.unwrap();
        assert_eq!((u.input, u.cached, u.reasoning), (Some(900), Some(768), Some(120)));
    }

    #[test]
    fn openrouter_usage_brings_the_cost() {
        let bytes = sse(&[text_ev("x"), json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }], "usage": { "prompt_tokens": 40, "completion_tokens": 2, "total_tokens": 42, "cost": 0.0000123 } })]);
        assert_eq!(run(&bytes, 64).1.usage.unwrap().cost, Some(0.0000123));
    }

    #[test]
    fn a_provider_that_sends_no_usage_leaves_it_unknown() {
        let (_, c) = run(&sse(&[text_ev("sin datos")]), 5);
        assert_eq!(c.text, "sin datos");
        assert!(c.usage.is_none(), "unknown, never zero");
    }

    #[test]
    fn only_a_complaint_about_stream_options_degrades() {
        assert!(rejects_stream_options(400, r#"{"error":{"message":"Unrecognized request argument supplied: stream_options"}}"#));
        assert!(rejects_stream_options(422, "include_usage is not allowed"));
        assert!(!rejects_stream_options(401, "stream_options"), "a bad key fails as before");
        assert!(!rejects_stream_options(400, "model not found"));
    }

    #[test]
    fn responses_usage_comes_with_the_completed_event() {
        let bytes = responses_sse(&[
            json!({ "type": "response.output_text.delta", "delta": "ok" }),
            json!({ "type": "response.completed", "response": { "id": "r1", "usage": { "input_tokens": 3200, "input_tokens_details": { "cached_tokens": 3072 }, "output_tokens": 90, "output_tokens_details": { "reasoning_tokens": 64 }, "total_tokens": 3290 } } }),
        ]);
        let u = run_responses(&bytes, 13).1.usage.unwrap();
        assert_eq!((u.input, u.output, u.cached, u.reasoning, u.cost), (Some(3200), Some(90), Some(3072), Some(64), None));
        let bare = responses_sse(&[json!({ "type": "response.completed" })]);
        assert!(run_responses(&bare, 8).1.usage.is_none());
    }

    fn endpoint(base_url: &str, model: &str) -> Endpoint {
        Endpoint { base_url: base_url.into(), api_key: "k".into(), model: model.into(), context_tokens: 64_000, session: "eureka-s1".into(), subscription: None, usage: Default::default() }
    }

    fn turn() -> Vec<Msg> {
        vec![
            Msg::user("Quiero entender: x", None),
            Msg { role: "assistant".into(), content: None, tool_calls: Some(vec![ToolCall { id: "c1".into(), kind: "function".into(), function: FunctionCall { name: "recall".into(), arguments: "{}".into() } }]), tool_call_id: None, meta: None },
            Msg::tool("c1", "nada", None),
            Msg::user("<estado_app>\nfase\n</estado_app>", None),
        ]
    }

    #[test]
    fn claude_through_openrouter_gets_two_cache_breakpoints() {
        let tools = json!([{ "type": "function", "function": { "name": "recall" } }]);
        let body = completions_body(&endpoint("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-5.5"), "sos un tutor", &turn(), &tools, None, true);
        let m = body["messages"].as_array().unwrap();
        assert_eq!(m[0]["content"], json!([{ "type": "text", "text": "sos un tutor", "cache_control": { "type": "ephemeral" } }]), "closes tools + system");
        assert_eq!(m[3]["content"][0]["cache_control"]["type"], "ephemeral", "closes the stable history: the last tool result");
        assert!(m[2]["content"].is_null(), "an assistant turn with only tool calls stays as it was");
        assert!(m[4]["content"].is_string(), "the state, which changes every step, is never marked");
        assert_eq!(body.to_string().matches("cache_control").count(), 2);
        // A forced call (no state): only the static part.
        let one = completions_body(&endpoint("https://openrouter.ai/api/v1", "anthropic/claude-haiku-5.5"), "s", &[Msg::user("x", None)], &tools, None, true);
        assert_eq!(one.to_string().matches("cache_control").count(), 1);
    }

    #[test]
    fn other_providers_get_exactly_the_body_they_got_before() {
        let tools = json!([{ "type": "function", "function": { "name": "recall" } }]);
        for (base, model) in [("https://openrouter.ai/api/v1", "openai/gpt-6"), ("https://api.anthropic.com/v1", "claude-sonnet-5.5"), ("https://api.deepseek.com", "deepseek-v4"), ("https://opencode.ai/zen/go/v1", "deepseek-v4.1-flash")] {
            let body = completions_body(&endpoint(base, model), "sos un tutor", &turn(), &tools, None, true);
            let mut wire = vec![json!({ "role": "system", "content": "sos un tutor" })];
            wire.extend(turn().iter().map(Msg::wire));
            assert_eq!(body, json!({ "model": model, "messages": wire, "tools": tools, "stream": true, "stream_options": { "include_usage": true } }), "{base}");
        }
    }

    #[test]
    fn responses_body_has_a_stable_prompt_cache_key() {
        let ep = subscription_endpoint();
        assert_eq!(responses_body(&ep, "s", &[Msg::user("x", None)], &json!([]), None)["prompt_cache_key"], "eureka-1");
    }

    #[test]
    fn wire_format_strips_meta() {
        let m = Msg::tool("call_1", "ok", Some(json!({ "kind": "answer" })));
        let w = m.wire();
        assert_eq!(w["role"], "tool");
        assert_eq!(w["tool_call_id"], "call_1");
        assert!(w.get("meta").is_none());
    }

    fn subscription_endpoint() -> Endpoint {
        Endpoint {
            base_url: crate::oauth::API_BASE.into(),
            api_key: "token".into(),
            model: "gpt-5.6-terra".into(),
            context_tokens: 100_000,
            session: "eureka-1".into(),
            subscription: Some(Subscription { account_id: "acc".into(), originator: "eureka".into() }),
            usage: Default::default(),
        }
    }

    fn responses_sse(events: &[Value]) -> Vec<u8> {
        events.iter().map(|e| format!("event: response.x\ndata: {e}\n\n")).collect::<String>().into_bytes()
    }

    fn run_responses(bytes: &[u8], size: usize) -> (String, Completion) {
        let mut p = ResponsesParser::default();
        let mut seen = String::new();
        for chunk in bytes.chunks(size) {
            for d in p.push(chunk).unwrap() {
                seen.push_str(&d);
            }
        }
        (seen, p.finish())
    }

    #[test]
    fn responses_reassembles_text_split_inside_multibyte_chars() {
        let bytes = responses_sse(&[
            json!({ "type": "response.output_text.delta", "delta": "¿Qué " }),
            json!({ "type": "response.output_text.delta", "delta": "año → ñandú?" }),
            json!({ "type": "response.completed" }),
        ]);
        for size in 1..=7 {
            let (seen, c) = run_responses(&bytes, size);
            assert_eq!(c.text, "¿Qué año → ñandú?", "chunk size {size}");
            assert_eq!(seen, c.text);
            assert!(!c.text.contains('\u{FFFD}'));
        }
    }

    #[test]
    fn responses_collects_a_tool_call_fragmented_in_three_events() {
        let bytes = responses_sse(&[
            json!({ "type": "response.output_item.added", "item": { "type": "function_call", "id": "fc_1", "call_id": "call_a", "name": "record", "arguments": "" } }),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{\"con" }),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "cept\": \"x\"}" }),
            json!({ "type": "response.completed" }),
        ]);
        let (_, c) = run_responses(&bytes, 9);
        assert_eq!(c.tool_calls.len(), 1);
        assert_eq!(c.tool_calls[0].id, "call_a");
        assert_eq!(c.tool_calls[0].function.name, "record");
        assert_eq!(c.tool_calls[0].function.arguments, "{\"concept\": \"x\"}");
    }

    #[test]
    fn responses_prefers_the_complete_arguments_of_the_final_event() {
        let bytes = responses_sse(&[
            json!({ "type": "response.output_item.added", "item": { "type": "function_call", "id": "fc_1", "call_id": "call_b", "name": "ask", "arguments": "" } }),
            json!({ "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{\"a\"" }),
            json!({ "type": "response.function_call_arguments.done", "item_id": "fc_1", "arguments": "{\"a\":1}" }),
            json!({ "type": "response.completed" }),
        ]);
        let (_, c) = run_responses(&bytes, 5);
        assert_eq!(c.tool_calls[0].function.arguments, "{\"a\":1}");
    }

    #[test]
    fn responses_error_event_fails_instead_of_returning_an_empty_answer() {
        let bytes = responses_sse(&[json!({ "type": "error", "message": "cuota agotada" })]);
        let mut p = ResponsesParser::default();
        let err = p.push(&bytes).unwrap_err();
        assert!(err.to_string().contains("cuota agotada"));
    }

    #[test]
    fn responses_ignores_the_reasoning_and_message_items() {
        let bytes = responses_sse(&[
            json!({ "type": "response.output_item.added", "item": { "type": "reasoning", "id": "rs_1" } }),
            json!({ "type": "response.output_item.added", "item": { "type": "message", "id": "msg_1" } }),
            json!({ "type": "response.output_text.delta", "delta": "ok" }),
            json!({ "type": "response.completed" }),
        ]);
        let (_, c) = run_responses(&bytes, 4);
        assert!(c.tool_calls.is_empty());
        assert_eq!(c.text, "ok");
    }

    #[test]
    fn responses_body_translates_messages_and_tools() {
        let ep = subscription_endpoint();
        let msgs = vec![
            Msg::user("hola", None),
            Msg {
                role: "assistant".into(),
                content: Some("pienso".into()),
                tool_calls: Some(vec![ToolCall { id: "call_a".into(), kind: "function".into(), function: FunctionCall { name: "record".into(), arguments: "{\"x\":1}".into() } }]),
                tool_call_id: None,
                meta: None,
            },
            Msg::tool("call_a", "ok", None),
        ];
        let tools = json!([{ "type": "function", "function": { "name": "record", "description": "d", "parameters": { "type": "object" } } }]);
        let choice = json!({ "type": "function", "function": { "name": "record" } });
        let body = responses_body(&ep, "sos un tutor", &msgs, &tools, Some(&choice));

        assert_eq!(body["model"], "gpt-5.6-terra");
        assert_eq!(body["instructions"], "sos un tutor");
        assert_eq!(body["store"], false, "una cuenta de suscripción no guarda el turno");
        assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(body["input"][0]["content"][0]["text"], "hola");
        assert_eq!(body["input"][1]["content"][0]["type"], "output_text");
        assert_eq!(body["input"][2]["type"], "function_call");
        assert_eq!(body["input"][2]["call_id"], "call_a");
        assert_eq!(body["input"][3]["type"], "function_call_output");
        assert_eq!(body["input"][3]["output"], "ok");
        assert_eq!(body["tools"][0]["name"], "record");
        assert!(body["tools"][0].get("function").is_none(), "las tools van planas");
        assert_eq!(body["tool_choice"], json!({ "type": "function", "name": "record" }));
    }

    #[test]
    fn responses_body_has_no_tools_key_when_there_are_none() {
        let body = responses_body(&subscription_endpoint(), "", &[Msg::user("x", None)], &json!([]), Some(&json!("auto")));
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
    }

    #[test]
    fn subscription_models_keep_only_the_callable_ones() {
        let v = json!({ "models": [
            { "slug": "gpt-b", "visibility": "list", "supported_in_api": true, "context_window": 400000 },
            { "slug": "gpt-a", "visibility": "list", "supported_in_api": true },
            { "slug": "gpt-oculta", "visibility": "hide", "supported_in_api": true },
            { "slug": "gpt-sin-api", "visibility": "list", "supported_in_api": false },
        ]});
        let models = parse_subscription_models(&v);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["gpt-a", "gpt-b"]);
        assert_eq!(models[1].context, Some(400000));
    }
}
