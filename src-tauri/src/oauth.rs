//! ChatGPT (Codex) sign-in: PKCE, loopback callback and token exchange.
//!
//! This is the flow OpenAI's own Codex CLI uses, validated against a real
//! Plus account. The client id is registered with one exact redirect, so the
//! port is fixed at 1455 and the authorize request must match it byte for byte.
//!
//! Nothing here touches `settings.json` or `auth.json`: the caller persists the
//! returned [`Account`] through [`crate::accounts::AccountsStore`].

use crate::accounts::Account;
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub const ISSUER: &str = "https://auth.openai.com";
pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
/// Where a ChatGPT subscription is actually served: not `api.openai.com`,
/// and not `/chat/completions` (that answers 401 to a subscriber token).
pub const API_BASE: &str = "https://chatgpt.com/backend-api/codex";
/// The client id is registered with this exact redirect, port included.
pub const CALLBACK_PORT: u16 = 1455;
pub const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
/// How we name ourselves to OpenAI. Never another client's name.
pub const ORIGINATOR: &str = "eureka";
pub const SCOPE: &str = "openid profile email offline_access";

/// How long the browser window has to come back before we give up.
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);
/// A page that asks for a favicon, or a retry, is not the callback: keep waiting.
const MAX_CONNECTIONS: usize = 16;

/// The provider id an account of this kind is stored under.
pub const PROVIDER_ID: &str = "openai";

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// 43 characters of the unreserved set, and their S256 challenge.
pub fn pkce() -> Pkce {
    let verifier = random_chars(43);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    Pkce { verifier, challenge }
}

/// The URL to hand to the browser. `originator` is how we identify ourselves
/// in OpenAI's logs; it is `eureka`, never another client's name.
pub fn authorize_url(pkce: &Pkce, state: &str, originator: &str) -> String {
    let params = [
        ("response_type", "code"),
        ("client_id", CLIENT_ID),
        ("redirect_uri", REDIRECT_URI),
        ("scope", SCOPE),
        ("code_challenge", pkce.challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("state", state),
        ("originator", originator),
    ];
    format!("{ISSUER}/oauth/authorize?{}", form_body(&params))
}

/// Waits for the callback in the browser, then exchanges the code.
/// `open` is called with the URL so this module stays free of Tauri.
pub async fn connect(originator: &str, open: impl FnOnce(&str) -> Result<()>) -> Result<Account> {
    let listener = TcpListener::bind(("127.0.0.1", CALLBACK_PORT)).await.map_err(|_| {
        anyhow!("El puerto {CALLBACK_PORT} está ocupado. Cerrá la otra app que lo esté usando (Codex, OpenCode) y reintentá.")
    })?;
    let pkce = pkce();
    let state = random_chars(32);
    let url = authorize_url(&pkce, &state, originator);
    open(&url)?;
    let code = wait_for_code(listener, &state).await?;
    let tokens = exchange(&code, &pkce.verifier).await?;
    tokens.into_account(originator)
}

/// Accepts connections until one of them is the real callback (right path,
/// right state). Anything else gets a 404 and the loop continues.
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String> {
    let waiting = async {
        for _ in 0..MAX_CONNECTIONS {
            let (mut socket, _) = listener.accept().await.context("no se pudo aceptar la conexión del navegador")?;
            let mut buf = vec![0u8; 8192];
            let read = socket.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..read]);
            let query = request.lines().next().and_then(callback_query);
            let reply = match &query {
                Some(q) => match (q.get("error").or_else(|| q.get("error_description")), q.get("code"), q.get("state")) {
                    (Some(e), ..) => (400, format!("<h2>No se pudo conectar</h2><p>{}</p>", escape(e))),
                    (None, Some(_), Some(s)) if s == state => (200, PAGE_OK.to_string()),
                    (None, Some(_), _) => (400, "<h2>Respuesta inválida</h2><p>El estado no coincide. Probá de nuevo.</p>".into()),
                    (None, None, _) => (400, "<h2>Respuesta inválida</h2><p>Faltó el código.</p>".into()),
                },
                None => (404, "<h2>No encontrado</h2>".into()),
            };
            let body = format!("<!doctype html><meta charset=utf-8><title>Eureka</title>{}</html>", reply.1);
            let response = format!("HTTP/1.1 {} {}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}", reply.0, status_text(reply.0), body.len(), body);
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
            let Some(q) = query else { continue };
            if q.contains_key("error") || q.contains_key("error_description") {
                let message = q.get("error_description").or_else(|| q.get("error")).cloned().unwrap_or_default();
                bail!("OpenAI canceló el inicio de sesión: {message}");
            }
            if let Some(code) = q.get("code").filter(|_| q.get("state").is_some_and(|s| s == state)) {
                return Ok(code.clone());
            }
        }
        bail!("El navegador no volvió a Eureka. Probá de nuevo.")
    };
    tokio::time::timeout(CALLBACK_TIMEOUT, waiting).await.map_err(|_| anyhow!("Pasaron cinco minutos sin respuesta del navegador. Probá de nuevo."))?
}

const PAGE_OK: &str = "<h2>Listo</h2><p>Ya podés volver a Eureka.</p>";

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    }
}

/// `GET /auth/callback?code=…&state=… HTTP/1.1` → the query, or None if the
/// request is not our callback path.
pub fn callback_query(request_line: &str) -> Option<HashMap<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?')?;
    if !path.ends_with("/auth/callback") {
        return None;
    }
    Some(
        query
            .split('&')
            .filter(|pair| !pair.is_empty())
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                (pct_decode(k), pct_decode(v))
            })
            .collect(),
    )
}

#[derive(Debug, Deserialize)]
struct Tokens {
    access_token: String,
    /// A refresh answer may leave this out (RFC 6749 §6): the old one stays valid.
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

impl Tokens {
    fn into_account(self, originator: &str) -> Result<Account> {
        let id_token = self.id_token.ok_or_else(|| anyhow!("OpenAI no devolvió el token de identidad. Probá de nuevo."))?;
        let refresh = self.refresh_token.ok_or_else(|| anyhow!("OpenAI no devolvió el token de renovación. Probá de nuevo."))?;
        let account_id = account_id(&id_token).ok_or_else(|| anyhow!("La cuenta de ChatGPT no informó su identificador. Probá con otra cuenta."))?;
        Ok(Account {
            kind: "chatgpt".into(),
            account_id,
            email: claim(&id_token, "email"),
            access: self.access_token,
            refresh,
            expires: expires_at(self.expires_in),
            originator: originator.to_string(),
            base_url: API_BASE.to_string(),
        })
    }
}

fn expires_at(expires_in: Option<i64>) -> i64 {
    chrono::Utc::now().timestamp_millis() + expires_in.unwrap_or(3600).max(60) * 1000
}

async fn exchange(code: &str, verifier: &str) -> Result<Tokens> {
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", CLIENT_ID),
        ("code_verifier", verifier),
    ];
    post_tokens(&params).await
}

/// A fresh access token. `account_id` and `email` survive even when the
/// refresh answer omits the id token.
pub async fn refresh(account: &Account) -> Result<Account> {
    let params = [("grant_type", "refresh_token"), ("refresh_token", account.refresh.as_str()), ("client_id", CLIENT_ID)];
    let tokens = post_tokens(&params).await?;
    let account_id = tokens.id_token.as_deref().and_then(account_id).unwrap_or_else(|| account.account_id.clone());
    let email = tokens.id_token.as_deref().and_then(|t| claim(t, "email")).or_else(|| account.email.clone());
    let mut next = account.clone();
    next.access = tokens.access_token;
    next.refresh = tokens.refresh_token.unwrap_or_else(|| account.refresh.clone());
    next.expires = expires_at(tokens.expires_in);
    next.account_id = account_id;
    next.email = email;
    Ok(next)
}

async fn post_tokens(params: &[(&str, &str)]) -> Result<Tokens> {
    let resp = crate::llm::client()?
        .post(format!("{ISSUER}/oauth/token"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form_body(params))
        .send()
        .await
        .context("no se pudo conectar con OpenAI")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("OpenAI rechazó el inicio de sesión ({status}): {}", error_hint(&body));
    }
    resp.json().await.context("OpenAI devolvió una respuesta inesperada")
}

/// Turns the OAuth error body into something a learner can act on.
pub fn error_hint(body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    let detail = v.get("error_description").and_then(|x| x.as_str()).or_else(|| v.get("error").and_then(|x| x.as_str())).unwrap_or("respuesta sin detalle");
    match detail {
        "invalid_grant" => "el código venció o ya se usó. Probá de nuevo.".into(),
        other => other.to_string(),
    }
}

/// The ChatGPT account id, from whichever claim shape the token uses.
pub fn account_id(id_token: &str) -> Option<String> {
    let claims: serde_json::Value = serde_json::from_str(&jwt_payload(id_token)?).ok()?;
    claims
        .get("chatgpt_account_id")
        .and_then(|x| x.as_str())
        .or_else(|| claims.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id").and_then(|x| x.as_str()))
        .or_else(|| claims.pointer("/organizations/0/id").and_then(|x| x.as_str()))
        .map(str::to_string)
}

fn claim(id_token: &str, key: &str) -> Option<String> {
    let claims: serde_json::Value = serde_json::from_str(&jwt_payload(id_token)?).ok()?;
    claims.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

fn jwt_payload(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    String::from_utf8(b64url_decode(payload)?).ok()
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn form_body(params: &[(&str, &str)]) -> String {
    params.iter().map(|(k, v)| format!("{}={}", pct_encode(k), pct_encode(v))).collect::<Vec<_>>().join("&")
}

/// Percent-encoding for the query and the form body. Space is `%20`, which both
/// the authorize endpoint and the token endpoint accept.
pub fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn pct_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/// Unreserved characters, drawn from UUIDv4 (122 random bits each).
pub fn random_chars(n: usize) -> String {
    let mut out = String::with_capacity(n);
    while out.len() < n {
        out.extend(uuid::Uuid::new_v4().as_bytes().iter().map(|b| CHARS[*b as usize % CHARS.len()] as char));
    }
    out.truncate(n);
    out
}

pub fn b64url(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = u32::from(b[0]) << 16 | u32::from(b[1]) << 8 | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[n as usize & 63] as char);
        }
    }
    out
}

pub fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut have = 0u32;
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(v);
        have += 6;
        if have >= 8 {
            have -= 8;
            out.push((bits >> have) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_jwt(claims: serde_json::Value) -> String {
        format!("e30.{}.sig", b64url(claims.to_string().as_bytes()))
    }

    #[test]
    fn authorize_url_carries_the_registered_flow_and_nothing_else() {
        let p = Pkce { verifier: "v".into(), challenge: "CHAL".into() };
        let url = authorize_url(&p, "ST", "eureka");
        for expected in [
            "client_id=app_EMoamEEZ73f0CkXaXp7hrann",
            "redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
            "code_challenge=CHAL",
            "code_challenge_method=S256",
            "state=ST",
            "originator=eureka",
            "id_token_add_organizations=true",
            "codex_cli_simplified_flow=true",
        ] {
            assert!(url.contains(expected), "falta {expected} en {url}");
        }
        assert!(!url.contains("resource="), "el flujo de token sharing no aplica");
        assert!(!url.contains("nonce="));
        assert!(url.starts_with("https://auth.openai.com/oauth/authorize?"));
    }

    #[test]
    fn pkce_verifier_is_43_unreserved_chars() {
        let p = pkce();
        assert_eq!(p.verifier.len(), 43);
        assert!(p.verifier.bytes().all(|b| CHARS.contains(&b)));
        // RFC 7636 example: S256 of a known verifier.
        let known = Pkce { verifier: "abc".into(), challenge: b64url(&Sha256::digest(b"abc")) };
        assert_eq!(known.challenge, "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    }

    #[test]
    fn base64url_roundtrips_and_drops_padding() {
        for raw in [b"".as_slice(), b"a", b"ab", b"abc", b"\xff\x00\xfe"] {
            let encoded = b64url(raw);
            assert!(!encoded.contains('='));
            assert_eq!(b64url_decode(&encoded).as_deref(), Some(raw));
        }
    }

    #[test]
    fn reads_the_account_id_from_all_three_claim_shapes() {
        let flat = fake_jwt(serde_json::json!({ "chatgpt_account_id": "acc-1" }));
        assert_eq!(account_id(&flat).as_deref(), Some("acc-1"));
        let nested = fake_jwt(serde_json::json!({ "https://api.openai.com/auth": { "chatgpt_account_id": "acc-2" } }));
        assert_eq!(account_id(&nested).as_deref(), Some("acc-2"));
        let orgs = fake_jwt(serde_json::json!({ "organizations": [{ "id": "acc-3" }] }));
        assert_eq!(account_id(&orgs).as_deref(), Some("acc-3"));
        assert_eq!(account_id("not-a-jwt"), None);
    }

    #[test]
    fn callback_query_ignores_other_paths() {
        assert!(callback_query("GET /favicon.ico HTTP/1.1").is_none());
        assert!(callback_query("GET /auth/callback HTTP/1.1").is_none());
        let q = callback_query("GET /auth/callback?code=abc%2F1&state=xyz HTTP/1.1").unwrap();
        assert_eq!(q.get("code").map(String::as_str), Some("abc/1"));
        assert_eq!(q.get("state").map(String::as_str), Some("xyz"));
    }

    #[test]
    fn the_exchange_body_never_sends_resource() {
        let body = form_body(&[("grant_type", "authorization_code"), ("code", "a b"), ("client_id", CLIENT_ID)]);
        assert_eq!(body, "grant_type=authorization_code&code=a%20b&client_id=app_EMoamEEZ73f0CkXaXp7hrann");
        assert!(!body.contains("resource"));
    }

    #[test]
    fn a_refresh_answer_without_a_new_refresh_token_still_parses() {
        let t: Tokens = serde_json::from_str(r#"{"access_token":"a","expires_in":3600}"#).unwrap();
        assert!(t.refresh_token.is_none());
        let full: Tokens = serde_json::from_str(r#"{"access_token":"a","refresh_token":"r"}"#).unwrap();
        assert_eq!(full.refresh_token.as_deref(), Some("r"));
    }

    #[test]
    fn error_hint_explains_a_used_code() {
        assert!(error_hint(r#"{"error":"invalid_grant"}"#).contains("venció"));
        assert_eq!(error_hint(r#"{"error_description":"boom"}"#), "boom");
        assert_eq!(error_hint("<html>"), "respuesta sin detalle");
    }

    #[test]
    fn percent_encoding_keeps_the_unreserved_set() {
        assert_eq!(pct_encode("a-b_c.d~e f/g"), "a-b_c.d~e%20f%2Fg");
        assert_eq!(pct_decode("a%20b%2Fc+d"), "a b/c d");
        assert_eq!(pct_decode("100%"), "100%");
    }
}
