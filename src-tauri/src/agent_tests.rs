//! Integration tests of the real agent loop against an in-process fake
//! provider (HTTP + SSE): no network, no model, deterministic.

use super::*;
use crate::session::{NodeStatus, Session};
use crate::settings::{Provider, ProviderInput, Roles, SettingsInput};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone)]
enum Reply {
    /// SSE events (one `data:` line each), then [DONE].
    Sse(Vec<Value>),
    Status(u16, &'static str),
    /// A plain JSON 200 (e.g. the search API).
    Json(Value),
}

struct Fake {
    base_url: String,
    requests: Arc<Mutex<Vec<Value>>>,
}

fn text(t: &str) -> Value {
    json!({ "choices": [{ "delta": { "content": t } }] })
}

fn tool(index: u32, id: &str, name: &str, args: Value) -> Value {
    json!({ "choices": [{ "delta": { "tool_calls": [
        { "index": index, "id": id, "function": { "name": name, "arguments": args.to_string() } }
    ] } }] })
}

async fn read_request(sock: &mut tokio::net::TcpStream) -> Option<Value> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let mut headers = serde_json::Map::new();
    let (head_end, len) = loop {
        let n = sock.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
            for (k, v) in head.lines().skip(1).filter_map(|l| l.split_once(':')) {
                headers.insert(k.trim().to_string(), json!(v.trim()));
            }
            let len: usize = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0);
            break (p + 4, len);
        }
    };
    while buf.len() < head_end + len {
        let n = sock.read(&mut tmp).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
    }
    // Headers ride along under "_headers" (lowercased), for the tests that check them.
    let mut v: Value = serde_json::from_slice(&buf[head_end..]).ok()?;
    if let Some(o) = v.as_object_mut() {
        o.insert("_headers".into(), Value::Object(headers));
    }
    Some(v)
}

fn render(reply: Reply) -> String {
    match reply {
        Reply::Sse(events) => {
            let mut body = String::new();
            for e in events {
                body.push_str(&format!("data: {e}\n\n"));
            }
            body.push_str("data: [DONE]\n\n");
            format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n{body}")
        }
        Reply::Json(v) => {
            let body = v.to_string();
            format!("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
        }
        Reply::Status(code, body) => format!(
            "HTTP/1.1 {code} Error\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        ),
    }
}

/// Serves replies in order; the last one repeats once the queue runs out.
async fn fake(replies: Vec<Reply>) -> Fake {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let queue = Arc::new(Mutex::new(VecDeque::from(replies)));
    let reqs = requests.clone();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let reqs = reqs.clone();
            let queue = queue.clone();
            tokio::spawn(async move {
                if let Some(v) = read_request(&mut sock).await {
                    reqs.lock().unwrap().push(v);
                }
                let reply = {
                    let mut q = queue.lock().unwrap();
                    if q.len() > 1 { q.pop_front().unwrap() } else { q.front().unwrap().clone() }
                };
                let _ = sock.write_all(render(reply).as_bytes()).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    Fake { base_url: format!("http://{addr}/v1"), requests }
}

/// AppState in a temp dir, configured for the fake provider.
fn state(f: &Fake, key: bool, prober_model: &str) -> (AppState, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("la-agent-{}", uuid::Uuid::new_v4().simple()));
    let st = AppState::new(dir.clone());
    let prober_provider = if prober_model.is_empty() { "" } else { "fake" };
    st.settings
        .save(SettingsInput {
            search: None,
            providers: vec![ProviderInput {
                provider: Provider { id: "fake".into(), label: "Fake".into(), base_url: f.base_url.clone() },
                api_key: key.then(|| "sk-fake".into()),
                clear_key: false,
            }],
            roles: Roles {
                teacher: ModelRef { provider_id: "fake".into(), model: "t-model".into(), ..Default::default() },
                prober: ModelRef { provider_id: prober_provider.into(), model: prober_model.into(), ..Default::default() },
                extractor: ModelRef::default(),
                practice: ModelRef::default(),
                researcher: ModelRef::default(),
                speech: ModelRef::default(),
            },
        })
        .unwrap();
    (st, dir)
}

fn channel() -> (Channel<AgentEvent>, Arc<Mutex<Vec<Value>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = seen.clone();
    let ch = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(j) = body {
            s.lock().unwrap().push(serde_json::from_str(&j).unwrap());
        }
        Ok(())
    });
    (ch, seen)
}

fn new_session(st: &AppState) -> String {
    let mut s = Session::new("qué es una derivada");
    st.sessions.save(&mut s).unwrap();
    s.id
}

async fn run(st: &AppState, id: &str) -> (Result<()>, Vec<Value>) {
    let (ch, seen) = channel();
    let r = run_turn(st, id, &ch, Arc::new(AtomicBool::new(false))).await;
    let events = seen.lock().unwrap().clone();
    (r, events)
}

#[tokio::test]
async fn text_only_reply_ends_turn_and_persists() {
    let f = fake(vec![Reply::Sse(vec![text("¡Ho"), text("la!")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let (r, events) = run(&st, &id).await;
    r.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.messages.last().unwrap().content.as_deref(), Some("¡Hola!"));
    assert_eq!(f.requests.lock().unwrap().len(), 1);
    let deltas: String = events.iter().filter(|e| e["type"] == "text").map(|e| e["delta"].as_str().unwrap()).collect();
    assert_eq!(deltas, "¡Hola!");
    assert!(events.iter().any(|e| e["type"] == "session"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn question_pauses_turn_until_the_learner_answers() {
    let f = fake(vec![
        Reply::Sse(vec![text("Veamos."), tool(0, "q1", "ask_question", json!({ "question": "¿Pendiente?", "purpose": "probe" }))]),
        Reply::Sse(vec![text("Gracias.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    assert_eq!(st.sessions.load(&id).unwrap().pending_question.as_deref(), Some("q1"));
    assert_eq!(f.requests.lock().unwrap().len(), 1, "the loop stops at the question");

    // The answer travels as the tool result of q1 (OpenAI wire rule).
    let mut s = st.sessions.load(&id).unwrap();
    crate::tools::add_learner_input(
        &mut s,
        crate::tools::LearnerInput { text: "sube 2".into(), confidence: Some(4), thinking: "creo".into(), ..Default::default() },
    );
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();

    let reqs = f.requests.lock().unwrap();
    let msgs = reqs[1]["messages"].as_array().unwrap();
    assert_eq!(msgs[0]["role"], "system");
    let assistant = msgs.iter().find(|m| m["tool_calls"].is_array()).unwrap();
    assert_eq!(assistant["tool_calls"][0]["id"], "q1");
    let answer = msgs.iter().find(|m| m["role"] == "tool").unwrap();
    assert_eq!(answer["tool_call_id"], "q1");
    let body = answer["content"].as_str().unwrap();
    assert!(body.contains("sube 2") && body.contains("4/5") && body.contains("creo"));
    assert!(msgs.iter().all(|m| m.get("meta").is_none()), "app-only meta never reaches the provider");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn phase_change_switches_prompt_and_model_within_one_turn() {
    let plan = json!({ "nodes": [
        { "id": "a", "title": "A", "depends_on": [], "status": "known" },
        { "id": "b", "title": "B", "depends_on": ["a"], "status": "pending" }
    ] });
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "c1", "set_plan", plan), tool(1, "c2", "set_phase", json!({ "phase": "teach" }))]),
        Reply::Sse(vec![text("Arrancamos.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "p-model");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();

    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0]["model"], "p-model", "probe phase uses the prober model");
    assert!(reqs[0]["messages"][0]["content"].as_str().unwrap().contains("Fase: MEDIR"));
    assert_eq!(reqs[0]["tools"].as_array().unwrap().len(), crate::tools::definitions_for(Phase::Probe).as_array().unwrap().len(), "probe sees only its tools");
    assert!(reqs[0]["tools"].as_array().unwrap().len() < crate::tools::definitions().as_array().unwrap().len() / 2);
    assert_eq!(reqs[1]["tools"], crate::tools::definitions_for(Phase::Teach), "teach sees its own tools (AC-186)");
    assert_eq!(reqs[1]["model"], "t-model", "teach phase uses the teacher model");
    let sys = reqs[1]["messages"][0]["content"].as_str().unwrap();
    assert!(sys.contains("Fase: ENSEÑAR"));
    let state_msg = reqs[1]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(state_msg.contains("`b` B ← a"), "state block (last message) reflects the new plan");
    assert_eq!(st.sessions.load(&id).unwrap().plan[0].status, NodeStatus::Known);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn runaway_model_is_capped_at_max_steps() {
    let f = fake(vec![Reply::Sse(vec![tool(
        0,
        "x",
        "record_finding",
        json!({ "concept": "c", "level": "solid", "evidence": "e" }),
    )])])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let err = run(&st, &id).await.0.unwrap_err();
    assert!(err.to_string().contains("límite"));
    assert_eq!(f.requests.lock().unwrap().len(), MAX_STEPS);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn invalid_tool_arguments_are_returned_to_the_model() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "bad", "set_plan", json!({ "nodes": "nope" }))]),
        Reply::Sse(vec![text("Corrijo.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    let msgs = reqs[1]["messages"].as_array().unwrap();
    let tool_msg = msgs.iter().find(|m| m["role"] == "tool").unwrap();
    assert!(tool_msg["content"].as_str().unwrap().starts_with("error"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn provider_http_errors_surface_with_status() {
    let f = fake(vec![Reply::Status(401, r#"{"error":{"message":"bad key"}}"#)]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let err = run(&st, &id).await.0.unwrap_err().to_string();
    assert!(err.contains("401") && err.contains("bad key"), "{err}");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn sse_error_mid_stream_surfaces() {
    let f = fake(vec![Reply::Sse(vec![text("Empie"), json!({ "error": { "message": "overloaded" } })])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let err = run(&st, &id).await.0.unwrap_err().to_string();
    assert!(err.contains("overloaded"), "{err}");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn missing_key_fails_before_any_request() {
    let f = fake(vec![Reply::Sse(vec![text("x")])]).await;
    let (st, dir) = state(&f, false, "");
    let id = new_session(&st);
    let err = run(&st, &id).await.0.unwrap_err().to_string();
    assert!(err.contains("Falta la API key"), "{err}");
    assert!(f.requests.lock().unwrap().is_empty());
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn cancelled_turn_makes_no_request() {
    let f = fake(vec![Reply::Sse(vec![text("x")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let (ch, _) = channel();
    run_turn(&st, &id, &ch, Arc::new(AtomicBool::new(true))).await.unwrap();
    assert!(f.requests.lock().unwrap().is_empty());
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn empty_completion_ends_turn_without_a_message() {
    let f = fake(vec![Reply::Sse(vec![])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    // Audit M4: a silent first step is reported, not swallowed.
    let err = run(&st, &id).await.0.unwrap_err();
    assert!(err.to_string().contains("El modelo no respondió"));
    assert_eq!(st.sessions.load(&id).unwrap().messages.len(), 1);
    std::fs::remove_dir_all(dir).ok();
}

// ── Extractor (Phase 2) ────────────────────────────────────────────────────

fn knowledge(props: &[(&str, &str)], chains: &[(&[&str], &str)]) -> Value {
    let args = json!({
        "propositions": props.iter().map(|(k, t)| json!({ "key": k, "text": t })).collect::<Vec<_>>(),
        "chains": chains.iter().map(|(p, c)| json!({ "premises": p, "conclusion": c })).collect::<Vec<_>>(),
    });
    tool(0, "k1", crate::extract::TOOL, args)
}

#[tokio::test]
async fn extraction_forces_the_tool_validates_and_appends() {
    let f = fake(vec![Reply::Sse(vec![knowledge(
        &[("a", "La pendiente mide cuánto sube"), ("b", "La derivada es la pendiente de la tangente"), ("c", "   ")],
        &[(&["a"], "b"), (&["zzz"], "b")],
    )])])
    .await;
    let (st, dir) = state(&f, true, "");
    let source = crate::graph::Source::Session { id: "s1".into(), title: "derivadas".into() };
    let (view, props, chains) = crate::extract::extract(&st, source, "transcripción".into()).await.unwrap();
    assert_eq!((props, chains), (2, 1), "blank text and the dangling chain are dropped");
    assert_eq!(view.nodes.len(), 2);
    assert_eq!(view.edges.len(), 1);
    assert_eq!(st.graph.ledger().len(), 1);

    let req = &f.requests.lock().unwrap()[0];
    assert_eq!(req["tool_choice"]["function"]["name"], crate::extract::TOOL);
    assert_eq!(req["tools"].as_array().unwrap().len(), 1);
    assert!(req["messages"][0]["content"].as_str().unwrap().contains("Extractor de conocimiento"));
    assert_eq!(req["messages"][1]["content"], "transcripción");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn failed_extraction_leaves_the_ledger_untouched() {
    let f = fake(vec![Reply::Sse(vec![text("no voy a llamar a la herramienta")])]).await;
    let (st, dir) = state(&f, true, "");
    let source = crate::graph::Source::Notes { id: "n".into(), title: "x".into() };
    let err = crate::extract::extract(&st, source.clone(), "x".into()).await.unwrap_err();
    assert!(err.to_string().contains(crate::extract::TOOL));

    let f2 = fake(vec![Reply::Sse(vec![knowledge(&[("a", "  ")], &[])])]).await;
    let (st2, dir2) = state(&f2, true, "");
    assert!(crate::extract::extract(&st2, source, "x".into()).await.is_err(), "nothing valid");
    assert!(st.graph.ledger().is_empty() && st2.graph.ledger().is_empty());
    std::fs::remove_dir_all(dir).ok();
    std::fs::remove_dir_all(dir2).ok();
}

#[tokio::test]
async fn probe_prompt_includes_related_graph_knowledge() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.graph
        .append(&crate::graph::Extraction {
            source: crate::graph::Source::Session { id: "old".into(), title: "old".into() },
            at: chrono::Utc::now(),
            propositions: vec![
                crate::graph::RawProposition { key: "a".into(), text: "La derivada es la pendiente de la tangente".into() },
                crate::graph::RawProposition { key: "b".into(), text: "La entropía mide el desorden".into() },
            ],
            chains: vec![],
        })
        .unwrap();
    let id = new_session(&st); // goal: "qué es una derivada"
    run(&st, &id).await.0.unwrap();
    // Audit M3: the state block is the last message, tagged; the system prompt stays stable.
    let req = f.requests.lock().unwrap()[0].clone();
    let msgs = req["messages"].as_array().unwrap();
    assert!(!msgs[0]["content"].as_str().unwrap().contains("## Ya en el grafo"), "not in the system prompt");
    let last = msgs.last().unwrap();
    assert_eq!(last["role"], "user");
    let sys = last["content"].as_str().unwrap().to_string();
    assert!(sys.starts_with("<estado_app>"));
    assert!(sys.contains("## Ya en el grafo"));
    assert!(sys.contains("La derivada es la pendiente de la tangente"));
    assert!(!sys.contains("entropía"), "only related knowledge");
    std::fs::remove_dir_all(dir).ok();
}

// ── Practice (Phase 3) ─────────────────────────────────────────────────────

fn seed_graph(st: &AppState) -> String {
    st.graph
        .append(&crate::graph::Extraction {
            source: crate::graph::Source::Session { id: "s".into(), title: "derivadas".into() },
            at: chrono::Utc::now(),
            propositions: vec![crate::graph::RawProposition { key: "a".into(), text: "La derivada es la pendiente de la tangente".into() }],
            chains: vec![],
        })
        .unwrap();
    st.graph.view().nodes[0].id.clone()
}

#[tokio::test]
async fn practice_generate_hint_and_grade_through_forced_tools() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "g", crate::practice::GENERATE_TOOL, json!({ "problems": [
            { "statement": "¿Pendiente de $x^2$ en 3?", "targets": ["__ID__"], "hints": ["Pensá en la tangente", "Derivá"], "solution": "6" }
        ]}))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let node = seed_graph(&st);
    let err = crate::practice::create(&st, &["nope".into()], 3).await.unwrap_err();
    assert!(err.to_string().contains("al menos una idea"), "unknown ids are rejected before calling the model");
    assert!(f.requests.lock().unwrap().is_empty());

    // Real call: the queued problem targets "__ID__", which is not a chosen idea → invalid.
    let err = crate::practice::create(&st, &[node.clone()], 3).await.unwrap_err();
    assert!(err.to_string().contains("ningún problema válido"));
    let req = f.requests.lock().unwrap()[0].clone();
    assert_eq!(req["tool_choice"]["function"]["name"], crate::practice::GENERATE_TOOL);
    assert!(req["messages"][1]["content"].as_str().unwrap().contains(&format!("- {node}: La derivada es la pendiente")));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn practice_full_cycle_and_failed_grade_keeps_the_set() {
    let dir = std::env::temp_dir().join(format!("la-pr-{}", uuid::Uuid::new_v4().simple()));
    let st0 = AppState::new(dir.clone());
    let node = seed_graph(&st0);
    let generated = Reply::Sse(vec![tool(0, "g", crate::practice::GENERATE_TOOL, json!({ "problems": [
        { "statement": "¿Pendiente de $x^2$ en 3?", "targets": [node.clone()], "hints": ["Pensá en la tangente", "Derivá"], "solution": "6" }
    ]}))]);
    let f = fake(vec![
        generated,
        Reply::Status(503, r#"{"error":{"message":"caído"}}"#),
        Reply::Sse(vec![tool(0, "r", crate::practice::GRADE_TOOL, json!({ "verdict": "correct", "feedback": "Bien razonado." }))]),
    ])
    .await;
    let (st, dir2) = state(&f, true, "");
    let node2 = seed_graph(&st);
    assert_eq!(node, node2, "node ids are stable across stores");

    let set = crate::practice::create(&st, &[node.clone()], 3).await.unwrap();
    assert_eq!(set.problems.len(), 1);
    let pid = set.problems[0].id.clone();

    let set = crate::practice::reveal_hint(&st, &set.id, &pid).unwrap();
    assert_eq!(set.problems[0].hints_shown, 1);
    for _ in 0..5 {
        crate::practice::reveal_hint(&st, &set.id, &pid).unwrap();
    }
    assert_eq!(st.practice.load(&set.id).unwrap().problems[0].hints_shown, 2, "capped at the number of hints");

    assert!(crate::practice::answer(&st, &set.id, &pid, "   ", None, "").await.is_err(), "blank answers are rejected");
    let err = crate::practice::answer(&st, &set.id, &pid, "6", Some(4), "derivé").await.unwrap_err();
    assert!(err.to_string().contains("503"));
    assert!(st.practice.load(&set.id).unwrap().problems[0].attempts.is_empty(), "a failed grade writes nothing");

    let set = crate::practice::answer(&st, &set.id, &pid, "6", Some(4), "derivé").await.unwrap();
    let a = &set.problems[0].attempts[0];
    assert_eq!((a.verdict, a.hints_used, a.feedback.as_str()), (crate::practice::Verdict::Correct, 2, "Bien razonado."));
    let grade_req = f.requests.lock().unwrap().last().unwrap().clone();
    assert_eq!(grade_req["tool_choice"]["function"]["name"], crate::practice::GRADE_TOOL);
    assert!(grade_req["messages"][1]["content"].as_str().unwrap().contains("Pistas usadas: 2 de 2"));
    assert_eq!(st.practice.list()[0].correct, 1);
    std::fs::remove_dir_all(dir).ok();
    std::fs::remove_dir_all(dir2).ok();
}

#[tokio::test]
async fn own_problems_are_read_reviewed_and_practiced() {
    // AC-173
    let dir = std::env::temp_dir().join(format!("la-own-{}", uuid::Uuid::new_v4().simple()));
    let node = seed_graph(&AppState::new(dir.clone()));
    std::fs::remove_dir_all(&dir).ok();
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "o", crate::practice::OWN_TOOL, json!({ "problems": [
            { "statement": "1) ¿Pendiente de $x^2$ en 3?", "solution": "6", "given": true, "hints": ["Derivá"], "ideas": [node.clone(), "inventada"] },
            { "statement": "2) ¿Y en 5?", "solution": "10", "given": false, "hints": [] }
        ]}))]),
        Reply::Sse(vec![tool(0, "r", crate::practice::GRADE_TOOL, json!({ "verdict": "correct", "feedback": "Bien, y la referencia coincide." }))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    seed_graph(&st);
    assert!(crate::practice::read_own(&st, "   ", None).await.is_err(), "nothing pasted, nothing asked");
    assert!(crate::practice::read_own(&st, "", Some("No existe")).await.unwrap_err().to_string().contains("No encontré «No existe»"), "AC-174: a document that is not there");
    assert!(f.requests.lock().unwrap().is_empty());

    let read = crate::practice::read_own(&st, "Guía 3: derivadas\n1) ¿Pendiente de x² en 3? Rta: 6\n2) ¿Y en 5?", None).await.unwrap();
    assert_eq!(read.len(), 2);
    assert_eq!(read[0].ideas, vec![node.clone()], "only ideas that exist");
    let req = f.requests.lock().unwrap()[0].clone();
    assert_eq!(req["tool_choice"]["function"]["name"], crate::practice::OWN_TOOL);
    let input = req["messages"][1]["content"].as_str().unwrap();
    assert!(input.contains("Guía 3: derivadas") && input.contains(&format!("- {node}: La derivada es la pendiente")), "{input}");
    assert!(st.practice.list().is_empty(), "reading saves nothing");

    // The person edits the second one and keeps both.
    let mut kept = read.clone();
    kept[1].statement = "2) ¿Y la pendiente en 5?".into();
    assert!(crate::practice::create_own(&st, "", vec![]).is_err());
    let set = crate::practice::create_own(&st, "Guía 3", kept).unwrap();
    assert!(set.own && set.planned.is_none());
    assert_eq!((set.title.as_str(), set.problems.len(), set.targets.len()), ("Guía 3", 2, 1));
    assert_eq!((set.problems[0].solution_by_model, set.problems[1].solution_by_model), (false, true));
    assert_eq!(set.problems[1].statement, "2) ¿Y la pendiente en 5?");

    let set = crate::practice::answer(&st, &set.id, "q2", "10", Some(4), "derivé").await.unwrap();
    assert_eq!(set.problems[1].attempts[0].verdict, crate::practice::Verdict::Correct);
    let grade = f.requests.lock().unwrap().last().unwrap()["messages"][1]["content"].as_str().unwrap().to_string();
    assert!(grade.contains("la escribió un modelo"), "{grade}");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn practice_is_written_one_by_one_and_hints_start_from_the_thinking() {
    // AC-167, AC-168
    let dir = std::env::temp_dir().join(format!("la-pr1-{}", uuid::Uuid::new_v4().simple()));
    let node = seed_graph(&AppState::new(dir.clone()));
    std::fs::remove_dir_all(&dir).ok();
    let problem = |statement: &str| Reply::Sse(vec![tool(0, "g", crate::practice::GENERATE_TOOL, json!({ "problems": [{ "statement": statement, "targets": [node.clone()], "hints": ["h"], "solution": "6" }] }))]);
    let f = fake(vec![
        problem("¿Pendiente de $x^2$ en 3?"),
        Reply::Sse(vec![tool(0, "n", crate::practice::HINT_TOOL, json!({ "hint": "Ya derivaste: mirá qué vale en 3.", "solved": false }))]),
        Reply::Sse(vec![tool(0, "n2", crate::practice::HINT_TOOL, json!({ "hint": "Eso ya lo resuelve: mandalo.", "solved": true }))]),
        Reply::Sse(vec![tool(0, "r", crate::practice::GRADE_TOOL, json!({ "verdict": "correct", "feedback": "Bien." }))]),
        // The repeated statement is refused once, and the model writes another.
        problem("¿Pendiente de $x^2$ en 3?"),
        problem("Un auto recorre $t^2$ metros: ¿qué tan rápido va en $t=5$?"),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    seed_graph(&st);

    let set = crate::practice::create(&st, &[node.clone()], 3).await.unwrap();
    assert_eq!((set.problems.len(), set.total(), set.problems[0].level), (1, 3, 1), "only the first, easy");
    let pid = set.problems[0].id.clone();

    assert!(crate::practice::nudge(&st, &set.id, &pid, "  ").await.is_err(), "no thinking, no nudge");
    let n = crate::practice::nudge(&st, &set.id, &pid, "derivé y me dio 2x").await.unwrap();
    assert_eq!((n.solved, n.set.problems[0].nudges.len()), (false, 1));
    let req = f.requests.lock().unwrap().last().unwrap().clone();
    assert!(req["messages"][1]["content"].as_str().unwrap().contains("Lo que viene pensando\nderivé y me dio 2x"));
    let n = crate::practice::nudge(&st, &set.id, &pid, "2 por 3 es 6, listo").await.unwrap();
    assert!(n.solved && n.set.problems[0].nudges.len() == 1, "a solved one is said, not counted");

    let set = crate::practice::answer(&st, &set.id, &pid, "6", Some(5), "").await.unwrap();
    assert_eq!(set.problems[0].attempts[0].hints_used, 1, "the nudge counts as a hint");
    assert_eq!(crate::practice::next_problem(&st, &set.id, 0).await.unwrap().problems.len(), 1, "a stale count writes nothing");
    let asked = f.requests.lock().unwrap().len();
    let set = crate::practice::next_problem(&st, &set.id, 1).await.unwrap();
    assert_eq!(set.problems.len(), 2);
    assert_eq!((set.problems[1].id.as_str(), set.problems[1].level), ("q2", 2), "right with one hint and sure → up");
    assert!(set.problems[1].statement.starts_with("Un auto"));
    let reqs = f.requests.lock().unwrap().clone();
    assert_eq!(reqs.len(), asked + 2, "the repeat was sent back once");
    let input = reqs[asked]["messages"][1]["content"].as_str().unwrap();
    assert!(input.contains("Cómo le fue hasta ahora") && input.contains("Correct, 1 pistas, confianza 5/5") && input.contains("Nivel 2"), "{input}");
    assert_eq!(crate::practice::next_problem(&st, &set.id, 1).await.unwrap().problems.len(), 2, "asked again → the same set");
    assert_eq!(f.requests.lock().unwrap().len(), asked + 2);
    std::fs::remove_dir_all(dir).ok();
}

// ── Research (Phase 4) ─────────────────────────────────────────────────────

#[tokio::test]
async fn research_runs_in_the_background_and_arrives_once() {
    // AC-169
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "r1", crate::research::TOOL, json!({ "question": "¿para qué sirve la derivada?" }))]),
        Reply::Sse(vec![text("Mientras eso se investiga, sigamos con la pendiente.")]),
        Reply::Json(json!({ "results": [
            { "title": "Física", "url": "https://fisica.test/velocidad", "content": "la velocidad es una derivada" },
            { "title": "Economía", "url": "https://eco.test/marginal", "content": "costo marginal" }
        ]})),
        Reply::Sse(vec![tool(0, "s1", crate::research::SUMMARY_TOOL, json!({ "summary": "Sirve para la velocidad [1].", "used": [1] }))]),
        Reply::Sse(vec![text("Llegó lo investigado: sirve para la velocidad [1].")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    st.settings
        .save(SettingsInput {
            providers: vec![ProviderInput {
                provider: Provider { id: "fake".into(), label: "Fake".into(), base_url: f.base_url.clone() },
                api_key: None,
                clear_key: false,
            }],
            roles: st.settings.load().roles,
            search: Some(crate::settings::SearchInput { base_url: f.base_url.clone(), api_key: Some("sk-search".into()), clear_key: false }),
        })
        .unwrap();
    let id = new_session(&st);
    // The turn does not wait: the teacher gets «en curso» and keeps going.
    run(&st, &id).await.0.unwrap();
    assert_eq!(f.requests.lock().unwrap().len(), 2, "teacher → teacher, no search yet");
    let s = st.sessions.load(&id).unwrap();
    let m = s.messages.iter().find(|m| m.role == "tool").unwrap();
    assert!(m.content.as_deref().unwrap().starts_with("Investigación en curso"));
    assert_eq!(m.meta.as_ref().unwrap()["pending"], true);

    // The worker runs it; a turn running in that session makes it wait.
    let jobs = st.research.take();
    assert_eq!(jobs.len(), 1);
    st.running.lock().unwrap().insert(id.clone(), Arc::new(AtomicBool::new(false)));
    crate::research::run_job(&st, jobs[0].clone()).await;
    assert_eq!(st.sessions.load(&id).unwrap().messages.iter().find(|m| m.role == "tool").unwrap().meta.as_ref().unwrap()["pending"], true, "not written while the turn runs");
    st.running.lock().unwrap().remove(&id);
    assert!(crate::agent::deliver_research(&st, &id, false).unwrap());
    assert!(!crate::agent::deliver_research(&st, &id, false).unwrap(), "exactly once");
    {
        let reqs = f.requests.lock().unwrap();
        assert_eq!(reqs[2]["query"], "¿para qué sirve la derivada?");
        assert_eq!(reqs[2]["api_key"], "sk-search");
        assert_eq!(reqs[3]["tool_choice"]["function"]["name"], crate::research::SUMMARY_TOOL);
    }
    // AC-186: the background summary counts for the session that asked.
    assert!(st.usage.all().iter().any(|e| e.purpose == "research" && e.session_id.as_deref() == Some(id.as_str())));
    let s = st.sessions.load(&id).unwrap();
    let meta = s.messages.iter().find(|m| m.role == "tool").unwrap().meta.clone().unwrap();
    assert_eq!((meta["kind"].as_str(), meta["told"].as_bool(), meta["sources"].as_array().unwrap().len()), (Some("research"), Some(false), 1), "only cited sources");

    // The next turn: in its history and, once, as «Llegó una investigación».
    let mut s = st.sessions.load(&id).unwrap();
    crate::tools::add_learner_input(&mut s, crate::tools::LearnerInput { text: "dale".into(), ..Default::default() });
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    let wire = reqs[4]["messages"].as_array().unwrap();
    assert!(wire.iter().any(|m| m["role"] == "tool" && m["content"].as_str().unwrap().contains("https://fisica.test/velocidad")));
    let note = wire.last().unwrap()["content"].as_str().unwrap();
    assert!(note.contains("## Llegó una investigación") && note.contains("[1] Física — https://fisica.test/velocidad"), "{note}");
    assert_eq!(st.sessions.load(&id).unwrap().messages.iter().find(|m| m.role == "tool").unwrap().meta.as_ref().unwrap()["told"], true);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn research_cut_by_closing_the_app_says_so() {
    // AC-169: after a restart nothing is running.
    let dir = std::env::temp_dir().join(format!("la-rc-{}", uuid::Uuid::new_v4().simple()));
    let st = AppState::new(dir.clone());
    let mut s = Session::new("x");
    s.messages.push(Msg::tool("c1", crate::research::pending_text("¿q?"), Some(crate::research::pending_meta("¿q?"))));
    st.sessions.save(&mut s).unwrap();
    assert_eq!(crate::research::recover(&st), 1);
    let m = st.sessions.load(&s.id).unwrap().messages.last().unwrap().clone();
    assert!(m.content.unwrap().contains("se cortó"));
    assert_eq!(m.meta.as_ref().unwrap()["pending"], Value::Null);
    assert_eq!(crate::research::recover(&st), 0, "nothing left to cut");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn research_without_search_key_tells_the_teacher_and_continues() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "r1", crate::research::TOOL, json!({ "question": "x" }))]),
        Reply::Sse(vec![text("Sigo sin investigar.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2, "no search call");
    let tool_msg = reqs[1]["messages"].as_array().unwrap().iter().find(|m| m["role"] == "tool").unwrap().clone();
    assert!(tool_msg["content"].as_str().unwrap().contains("búsqueda web no configurada"));
    assert_eq!(st.sessions.load(&id).unwrap().messages.last().unwrap().content.as_deref(), Some("Sigo sin investigar."));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_model_without_provider_is_not_configured() {
    let f = fake(vec![Reply::Json(json!({}))]).await;
    let (st, dir) = state(&f, true, "");
    let mut input = SettingsInput {
        search: None,
        providers: vec![ProviderInput {
            provider: Provider { id: "fake".into(), label: "Fake".into(), base_url: f.base_url.clone() },
            api_key: None,
            clear_key: false,
        }],
        roles: Roles::default(),
    };
    input.roles.teacher = ModelRef { provider_id: String::new(), model: "t-model".into(), ..Default::default() };
    st.settings.save(input).unwrap();
    let err = endpoint_for(&st, Role::Teacher).await.err().expect("must fail");
    assert!(err.to_string().contains("No hay modelo configurado"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn list_models_strips_gemini_prefix_and_sorts() {
    let f = fake(vec![Reply::Json(json!({ "data": [{ "id": "models/b-model" }, { "id": "a-model" }, { "name": "sin id" }] }))]).await;
    let ids = crate::llm::list_models(&f.base_url, "sk").await.unwrap();
    assert_eq!(ids, vec!["a-model".to_string(), "b-model".to_string()]);
}

// ── Una sola key (AC-158, AC-159) ─────────────────────────────────────────

#[tokio::test]
async fn one_key_picks_a_model_checks_it_with_a_tool_and_keeps_the_voice() {
    let f = fake(vec![
        Reply::Json(json!({ "data": [{ "id": "whisper-1" }, { "id": "big-model" }, { "id": "fast-flash", "context_length": 131072 }] })),
        Reply::Sse(vec![tool(0, "c1", "listo", json!({}))]),
    ])
    .await;
    let (st, dir) = state(&f, false, "");
    let mut s = st.settings.load();
    s.roles.speech = ModelRef { provider_id: "local".into(), model: "whisper-base".into(), ..Default::default() };
    s.roles.practice = ModelRef { provider_id: "fake".into(), model: "chosen-in-avanzado".into(), ..Default::default() };
    st.settings
        .save(SettingsInput { search: None, providers: s.providers.iter().map(|p| ProviderInput { provider: p.clone(), api_key: None, clear_key: false }).collect(), roles: s.roles.clone() })
        .unwrap();

    let out = crate::setup::run(&st, "  Bearer my-fake-key-123
", Some("fake")).await.unwrap();
    let crate::setup::Outcome::Done(done) = out else { panic!("{out:?}") };
    assert_eq!((done.model.as_str(), done.context_k, done.tools_ok, done.speech_ready), ("fast-flash", Some(131), true, true));
    assert_eq!(done.alternatives, vec!["big-model".to_string()], "whisper is not a chat model");
    let saved = st.settings.load();
    assert_eq!(saved.roles.teacher.model, "fast-flash");
    assert_eq!(saved.roles.speech.model, "whisper-base", "the Voz stays");
    assert_eq!(saved.roles.practice.model, "chosen-in-avanzado", "a role chosen in Avanzado stays");
    assert_eq!(st.settings.keys().get("fake").map(String::as_str), Some("my-fake-key-123"), "cleaned before saving");
    {
        let reqs = f.requests.lock().unwrap();
        let check = reqs.iter().find(|r| r.get("model").is_some()).unwrap();
        assert_eq!(check["model"], "fast-flash");
        assert_eq!(check["tools"][0]["function"]["name"], "listo", "a real call with a tool");
    }

    // A key whose format fits two services: nothing is sent, the person picks.
    let n = f.requests.lock().unwrap().len();
    let out = crate::setup::run(&st, &format!("sk-{}", "ab".repeat(16)), None).await.unwrap();
    assert!(matches!(out, crate::setup::Outcome::Choose { ref candidates, .. } if candidates == &["deepseek", "openai"]), "{out:?}");
    assert_eq!(f.requests.lock().unwrap().len(), n);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn exam_guide_is_found_on_the_web_with_full_page_text() {
    let f = fake(vec![
        Reply::Json(json!({ "results": [
            { "title": "Guía oficial CLF-C02", "url": "https://aws.test/clf-c02.pdf", "content": "resumen", "raw_content": "Domain 1: Cloud Concepts (24%)" },
            { "title": "Blog", "url": "https://blog.test/clf", "content": "opiniones" }
        ]})),
        Reply::Sse(vec![tool(0, "g1", crate::exam::GUIDE_TOOL, json!({ "guide": "Dominio 1: Conceptos de la nube (24%)\n- Beneficios", "used": [1] }))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let err = crate::exam::find_guide(&st, "AWS CCP").await.unwrap_err();
    assert!(err.to_string().contains("búsqueda web no está configurada"), "{err}");
    st.settings
        .save(SettingsInput {
            providers: vec![ProviderInput {
                provider: Provider { id: "fake".into(), label: "Fake".into(), base_url: f.base_url.clone() },
                api_key: None,
                clear_key: false,
            }],
            roles: st.settings.load().roles,
            search: Some(crate::settings::SearchInput { base_url: f.base_url.clone(), api_key: Some("sk-search".into()), clear_key: false }),
        })
        .unwrap();

    let g = crate::exam::find_guide(&st, "  AWS CCP ").await.unwrap();
    assert!(g.guide.starts_with("Dominio 1: Conceptos de la nube (24%)"));
    assert_eq!(g.sources.len(), 1);
    assert_eq!(g.sources[0].url, "https://aws.test/clf-c02.pdf");

    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs[0]["query"], "AWS CCP official exam guide domains weighting objectives");
    assert_eq!(reqs[0]["include_raw_content"], true);
    assert_eq!(reqs[1]["tool_choice"]["function"]["name"], crate::exam::GUIDE_TOOL);
    let input = reqs[1]["messages"].as_array().unwrap().iter().find(|m| m["role"] == "user").unwrap()["content"].as_str().unwrap().to_string();
    assert!(input.contains("Domain 1: Cloud Concepts (24%)"), "the full page text reaches the model");
    std::fs::remove_dir_all(dir).ok();
}

// ── Harness audit ─────────────────────────────────────────────────────────

#[tokio::test]
async fn calls_after_a_question_in_the_same_batch_are_ignored() {
    let f = fake(vec![Reply::Sse(vec![
        tool(0, "q1", "ask_question", json!({ "question": "¿Qué es la pendiente?", "purpose": "probe" })),
        tool(1, "f1", "record_finding", json!({ "concept": "x", "level": "solid", "evidence": "e" })),
    ])])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.pending_question.as_deref(), Some("q1"));
    assert!(s.findings.is_empty(), "the finding was not applied before the answer");
    let ignored = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("f1")).unwrap();
    assert!(ignored.content.as_deref().unwrap().starts_with("ignorada: ya hiciste una pregunta"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn research_is_capped_per_turn() {
    let r = |i: u32, id: &str| tool(i, id, crate::research::TOOL, json!({ "question": "algo" }));
    let f = fake(vec![Reply::Sse(vec![r(0, "r1"), r(1, "r2"), r(2, "r3")]), Reply::Sse(vec![text("Listo.")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    let r3 = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("r3")).unwrap();
    assert!(r3.content.as_deref().unwrap().contains("ya investigaste 2 veces"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn make_cards_fills_the_session_deck() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "m1", "make_cards", json!({ "cards": [{ "front": "¿Qué mide la derivada?", "back": "El cambio instantáneo" }] }))]),
        Reply::Sse(vec![text("Guardé una tarjeta.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let decks = st.decks.all();
    assert_eq!(decks.len(), 1);
    assert_eq!(decks[0].name, "Sesión: qué es una derivada");
    assert_eq!(decks[0].cards[0].back, "El cambio instantáneo");
    let s = st.sessions.load(&id).unwrap();
    assert!(s.messages.iter().any(|m| m.content.as_deref().is_some_and(|c| c.starts_with("1 tarjetas agregadas"))));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_teacher_sees_the_learner_profile_while_measuring() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.learner.update(|p| crate::learner::add_misconception(p, "Derivada", "cree que es un cociente fijo", false, "Sesión: vieja")).unwrap();
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let req = f.requests.lock().unwrap()[0].clone();
    let last = req["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(last.contains("## Lo que sabemos de vos"));
    assert!(last.contains("cree que es un cociente fijo"));
    std::fs::remove_dir_all(dir).ok();
}

/// AC-111: the student model reaches the agent in every phase, not only while measuring.
#[tokio::test]
async fn the_student_model_reaches_teaching_and_chat_too() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.learner.update(|p| crate::learner::add_misconception(p, "Derivada", "cree que es un cociente fijo", false, "Sesión: vieja")).unwrap();
    let mut teach = Session::new("derivadas");
    teach.phase = crate::session::Phase::Teach;
    st.sessions.save(&mut teach).unwrap();
    run(&st, &teach.id).await.0.unwrap();
    let id = new_chat(&st, "hola");
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap().clone();
    let last = |i: usize| reqs[i]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(last(0).contains("Le cuesta: Derivada"), "teach: {}", last(0));
    assert!(last(1).contains("Le cuesta: Derivada"));
    assert!(last(1).contains("## Plan de hoy") && last(1).contains("Repasá Derivada"), "chat gets the plan: {}", last(1));
    assert!(!last(0).contains("## Plan de hoy"), "only the chat gets the plan");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_extractor_also_records_confusions_and_preferences() {
    let f = fake(vec![Reply::Sse(vec![tool(0, "k1", crate::extract::TOOL, json!({
        "propositions": [{ "key": "a", "text": "La derivada es la pendiente de la tangente" }],
        "chains": [],
        "misconceptions": [{ "concept": "Secante", "wrong_idea": "toca un solo punto", "fixed": true }],
        "preferences": ["entiende mejor con ejemplos numéricos"]
    }))])])
    .await;
    let (st, dir) = state(&f, true, "");
    let source = crate::graph::Source::Session { id: "s1".into(), title: "derivadas".into() };
    crate::extract::extract(&st, source, "# Sesión: derivadas".into()).await.unwrap();
    let p = st.learner.load();
    assert_eq!(p.misconceptions[0].source, "Sesión: derivadas");
    assert!(p.misconceptions[0].fixed);
    assert_eq!(p.preferences[0].text, "entiende mejor con ejemplos numéricos");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn recall_answers_from_graph_profile_and_exam_failures() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "r1", "recall", json!({ "query": "tangente pendiente" }))]),
        Reply::Sse(vec![text("Bien.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    st.graph
        .append(&crate::graph::Extraction {
            source: crate::graph::Source::Session { id: "old".into(), title: "derivadas".into() },
            at: chrono::Utc::now(),
            propositions: vec![crate::graph::RawProposition { key: "a".into(), text: "La pendiente de la tangente es la derivada".into() }],
            chains: vec![],
        })
        .unwrap();
    st.learner.update(|p| crate::learner::add_misconception(p, "Tangente", "cree que corta la curva en dos puntos", false, "s")).unwrap();
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    let r = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("r1")).unwrap().content.clone().unwrap();
    assert!(r.contains("Idea entendida: La pendiente de la tangente es la derivada (de «derivadas»)"), "{r}");
    assert!(r.contains("Confusión abierta: «Tangente»"), "{r}");
    let empty = recall(&st, &s, r#"{"query": "fotosíntesis"}"#);
    assert!(empty.starts_with("Nada en la memoria"));
    assert!(recall(&st, &s, "{}").starts_with("error"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_recorded_class_becomes_notes_through_the_forced_tool() {
    let notes = json!({ "summary": "### Límites\n- Un límite describe a qué valor se acerca f(x) cuando x se acerca a un punto.", "key_points": ["Un límite describe a qué se acerca f(x)"], "questions": [], "dates": [{ "title": "Primer parcial", "date": "2026-11-12", "kind": "parcial" }] });
    let f = fake(vec![Reply::Sse(vec![tool(0, "n1", crate::classes::TOOL, notes)])]).await;
    let (st, dir) = state(&f, true, "");
    let c = st.classes.start("Análisis · teórica", None, "2026-10-29").unwrap();
    assert!(crate::classes::make_notes(&st, &c.id, "2026-10-29").await.is_err(), "nothing transcribed yet: no model call");
    st.classes.append(&c.id, "Hoy vemos límites. Un límite describe a qué valor se acerca una función cuando x se acerca a un punto. El primer parcial es el 12 de noviembre.", 55).unwrap();
    let c = crate::classes::make_notes(&st, &c.id, "2026-10-29").await.unwrap();
    let n = c.notes.unwrap();
    assert_eq!(n.dates[0].date, "2026-11-12");
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0]["tool_choice"]["function"]["name"], crate::classes::TOOL);
    assert!(reqs[0]["messages"][1]["content"].as_str().unwrap().contains("El primer parcial es el 12 de noviembre"));
    assert!(st.classes.get(&c.id).unwrap().notes.is_some(), "saved");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_provider_that_refuses_to_force_a_tool_gets_a_looser_tool_choice() {
    // DeepSeek in thinking mode (OpenCode Go) refuses a named tool_choice, and here "required" too.
    let refused = r#"{"error":{"type":"invalid_request_error","message":"Upstream request failed: Thinking mode does not support this tool_choice"}}"#;
    let f = fake(vec![Reply::Status(400, refused), Reply::Status(400, refused), Reply::Sse(vec![tool(0, "x1", "x", json!({ "ok": true }))])]).await;
    let (st, dir) = state(&f, true, "");
    let t = json!({ "type": "function", "function": { "name": "x", "parameters": { "type": "object" } } });
    let raw = crate::practice::forced(&st, Role::Practice, "practice_generate", t.clone(), "x", "entrada".into()).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(), json!({ "ok": true }));
    let choices: Vec<Value> = f.requests.lock().unwrap().iter().map(|r| r["tool_choice"].clone()).collect();
    assert_eq!(choices, vec![json!({ "type": "function", "function": { "name": "x" } }), json!("required"), json!("auto")]);

    // Any other error is not retried with another tool_choice.
    let g = fake(vec![Reply::Status(503, r#"{"error":{"message":"caído"}}"#)]).await;
    let (st2, dir2) = state(&g, true, "");
    assert!(crate::practice::forced(&st2, Role::Practice, "practice_generate", t, "x", "entrada".into()).await.is_err());
    assert_eq!(g.requests.lock().unwrap().len(), 1);
    std::fs::remove_dir_all(dir).ok();
    std::fs::remove_dir_all(dir2).ok();
}

#[tokio::test]
async fn forced_roles_get_one_retry_with_the_validation_error() {
    let words = "The train to the city leaves at nine every morning and the trip takes about forty minutes so many people read or sleep on the way";
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "l1", crate::language::LISTENING_TOOL, json!({ "title": "Train", "transcript": "Too short.", "questions": [] }))]),
        Reply::Sse(vec![tool(0, "l2", crate::language::LISTENING_TOOL, json!({ "title": "Train", "transcript": words, "questions": [
            { "stem": "When does the train leave?", "options": ["At eight", "At nine", "At ten", "At noon"], "answer": [1], "explanation": "It says nine." }
        ]}))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let l = crate::language::listening(&st, "inglés", "B1", "viajes").await.unwrap();
    assert_eq!(l.questions.len(), 1, "the corrected answer is the one kept");
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2, "exactly one retry");
    let msgs = reqs[1]["messages"].as_array().unwrap();
    assert!(msgs.iter().any(|m| m["role"] == "assistant" && m["tool_calls"][0]["id"] == "l1"), "the model sees its failed call");
    assert!(msgs.iter().any(|m| m["role"] == "tool" && m["content"].as_str().unwrap().contains("incompleto")), "and the concrete error");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn practice_exams_and_cards_get_the_accessibility_settings_but_internal_calls_dont() {
    let t = |name: &str| json!({ "type": "function", "function": { "name": name, "parameters": { "type": "object" } } });
    let f = fake(vec![Reply::Sse(vec![tool(0, "c1", "x", json!({}))])]).await;
    let (st, dir) = state(&f, true, "");
    st.settings.save_accessibility(crate::settings::Accessibility { easy_reading: true, ..Default::default() }).unwrap();
    for prompt in ["practice_grade", "cards_generate", "exam_questions", "extract", "exam_syllabus"] {
        crate::practice::forced(&st, Role::Practice, prompt, t("x"), "x", format!("entrada de {prompt}")).await.unwrap();
    }
    let reqs = f.requests.lock().unwrap();
    let got: Vec<bool> = reqs.iter().map(|r| r["messages"][1]["content"].as_str().unwrap().contains("Lectura fácil")).collect();
    assert_eq!(got, [true, true, true, false, false], "only what the learner reads");
    assert!(reqs[0]["messages"][0]["content"].as_str().unwrap().len() > 0 && !reqs[0]["messages"][0]["content"].as_str().unwrap().contains("Lectura fácil"), "the system prompt stays stable");
    drop(reqs);
    st.settings.save_accessibility(Default::default()).unwrap();
    assert_eq!(crate::practice::with_access(&st, "igual".into()), "igual", "nothing chosen, nothing added");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn long_sessions_keep_a_rolling_summary_of_what_left_the_window() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "s1", crate::context::SUMMARY_TOOL, json!({ "summary": "- Dijo que la derivada es un área (incorrecto)." }))]),
        Reply::Sse(vec![text("Sigamos.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    let mut s = st.sessions.load(&id).unwrap();
    for i in 0..30 {
        s.messages.push(Msg::user(format!("respuesta {i}: {}", "x".repeat(6000)), None));
        s.messages.push(Msg { role: "assistant".into(), content: Some(format!("explicación {i}")), tool_calls: None, tool_call_id: None, meta: None });
    }
    s.messages.push(Msg::user("¿y ahora?", None));
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();

    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.summary, "- Dijo que la derivada es un área (incorrecto).");
    assert!(s.summarized_upto > 1, "remembers how far the summary goes");
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs[0]["tool_choice"]["function"]["name"], crate::context::SUMMARY_TOOL);
    assert!(reqs[0]["messages"][1]["content"].as_str().unwrap().contains("Aprendiz: respuesta 0"), "the oldest dropped message is summarized");
    let teacher = reqs[1]["messages"].as_array().unwrap();
    let state_msg = teacher.last().unwrap()["content"].as_str().unwrap();
    assert!(state_msg.contains("## Lo que pasó antes en esta sesión\n- Dijo que la derivada es un área"), "{state_msg}");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_history_window_uses_the_models_context_size() {
    let f = fake(vec![Reply::Sse(vec![text("ok")])]).await;
    let (st, dir) = state(&f, true, "");
    assert_eq!(endpoint_for(&st, Role::Teacher).await.unwrap().context_tokens, crate::context::DEFAULT_BUDGET);
    let m = |k| ModelRef { provider_id: "p".into(), model: "m".into(), context_k: k };
    assert_eq!(context_tokens(&m(Some(200))), 200_000);
    assert_eq!(context_tokens(&m(Some(1))), crate::context::DEFAULT_BUDGET, "absurd sizes fall back");
    assert_eq!(context_tokens(&m(None)), crate::context::DEFAULT_BUDGET);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_teacher_searches_the_library_and_cites_numbered_passages() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "l1", "library_search", json!({ "query": "pendiente tangente" }))]),
        Reply::Sse(vec![tool(0, "l2", "library_read", json!({ "ref": "L1" })), tool(1, "l3", "library_read", json!({ "ref": "L9" }))]),
        Reply::Sse(vec![text("Según tu libro, es la pendiente [L1].")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    st.library
        .import("Cálculo I", "c.pdf", "<!-- p:1 -->\n\n# Derivadas\n\nIntro.\n\n<!-- p:2 -->\n\n## Recta tangente\n\nLa pendiente de la recta tangente es la derivada.", 2, vec![], None)
        .unwrap();
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    let found = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("l1")).unwrap();
    let r = found.content.clone().unwrap();
    assert!(r.contains("[L1] «Cálculo I» · Derivadas › Recta tangente · p. 2 · coincide: pendiente, tangente\nLa pendiente de la recta tangente"), "{r}");
    assert_eq!(found.meta.as_ref().unwrap()["refs"][0]["page"], 2);
    let read = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("l2")).unwrap().content.clone().unwrap();
    assert!(read.contains("(p. 2)") && read.contains("Citá esta sección como [L1]"), "{read}");
    let bad = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("l3")).unwrap().content.clone().unwrap();
    assert!(bad.starts_with("error: ese fragmento no existe"));
    let reqs = f.requests.lock().unwrap();
    let state_msg = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(state_msg.contains("## Biblioteca del aprendiz\n- «Cálculo I»"), "{state_msg}");
    // A second search keeps numbering: refs are unique within the session.
    let (_, meta) = library_search(&st, &s, r#"{"query": "derivada"}"#);
    assert_eq!(meta["refs"][0]["n"], 2);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_teachers_state_carries_the_accessibility_settings_in_every_phase() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")]), Reply::Sse(vec![text("Seguimos.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.settings.save_accessibility(crate::settings::Accessibility { literal: true, short_steps: true, ..Default::default() }).unwrap();
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let mut s = st.sessions.load(&id).unwrap();
    s.phase = Phase::Teach;
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    for r in reqs.iter() {
        let block = r["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap();
        assert!(block.contains("## Ajustes de accesibilidad") && block.contains("Lenguaje literal") && block.contains("Pasos cortos"), "{block}");
    }
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn every_request_names_its_conversation_for_opencode_go() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let h = f.requests.lock().unwrap()[0]["_headers"].clone();
    assert_eq!(h["x-opencode-session"], format!("eureka-{id}"), "stable per session: Go rejects requests without it");
    assert!(h["user-agent"].as_str().unwrap().starts_with("eureka/"), "{h}"); // lowercased by the fake
    assert!(crate::llm::app_session().starts_with("eureka-") && crate::llm::app_session() == crate::llm::app_session());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn a_weak_library_search_asks_for_one_reformulation_then_to_move_on() {
    // AC-189
    let dir = std::env::temp_dir().join(format!("la-retry-{}", uuid::Uuid::new_v4().simple()));
    let st = AppState::new(dir.clone());
    st.library.import("Cálculo I", "c.pdf", "# Derivadas\n\nLa pendiente de la recta tangente es la derivada de la función en ese punto.\n\n# Integrales\n\nLa integral acumula el área bajo la curva.", 0, vec![], None).unwrap();
    let mut s = Session::new("prueba");
    s.messages.push(Msg::user("¿qué es la derivada?".to_string(), None));
    let search = |s: &Session, q: &str| library_search(&st, s, &json!({ "query": q }).to_string());

    // A good match: no hint, nothing to retry.
    let (text, meta) = search(&s, "pendiente recta tangente derivada");
    assert!(!text.contains("buscá una vez más") && meta["retry"] == false, "{text}");
    // The best passage shares 1 of 4 words: one more search, in other words.
    let (text, meta) = search(&s, "derivada polinomio cociente exponente");
    assert!(text.contains("Antes de concluir que no está, buscá una vez más con sinónimos"), "{text}");
    assert_eq!(meta["retry"], true);
    s.messages.push(Msg::tool("a", text, Some(meta)));
    // Still weak in the same turn: say so instead of searching in circles.
    let (text, _) = search(&s, "fotosíntesis clorofila");
    assert!(text.starts_with("La biblioteca no tiene nada sobre «fotosíntesis clorofila»: probablemente la biblioteca no trata esto. Decilo"), "{text}");
    // A new question starts over.
    s.messages.push(Msg::user("¿y la fotosíntesis?".to_string(), None));
    let (text, meta) = search(&s, "fotosíntesis clorofila");
    assert!(text.contains("buscá una vez más") && meta["retry"] == true, "{text}");
    std::fs::remove_dir_all(dir).ok();
}

/// NF-22: the library benchmark, retrieval half. Indexes the Markdown the
/// conversion benchmark wrote (`bookText.bench.test.ts`) and asks every
/// question in two phrasings, measuring what the teacher would receive.
#[test]
fn editorial_benchmark() {
    use std::time::Instant;
    let fix = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
    let md = std::fs::read_to_string(fix.join("libro-editorial.md")).expect("run the Vitest benchmark first (npm run bench:library)");
    let q: Value = serde_json::from_str(&std::fs::read_to_string(fix.join("libro-editorial.questions.json")).unwrap()).unwrap();
    let dir = std::env::temp_dir().join(format!("la-bench-{}", uuid::Uuid::new_v4().simple()));
    let st = AppState::new(dir.clone());

    let t = Instant::now();
    st.library.import("Fermentación en la cocina andina", "libro-editorial.pdf", &md, q["pages"].as_u64().unwrap() as u32, vec![], None).unwrap();
    let import_ms = t.elapsed().as_secs_f64() * 1000.0;
    let t = Instant::now();
    st.library.index();
    let index_ms = t.elapsed().as_secs_f64() * 1000.0;
    let s = Session::new("benchmark");
    let squash = |x: &str| x.split_whitespace().collect::<Vec<_>>().join(" ");

    // AC-189: one fixed reformulation per hard question and negative, as the teacher would
    // write it after the hint (generic synonyms, never the book's invented names). Used only
    // when the first result carries the hint, which the teacher sees; never from the answer key.
    let retry: Value = serde_json::from_str(&std::fs::read_to_string(fix.join("libro-editorial.retry.json")).unwrap()).unwrap();
    let mut report = serde_json::Map::new();
    let mut lines = vec![format!("importar {import_ms:.1} ms · indexar {index_ms:.1} ms · tokens del modelo al indexar: 0")];
    for (mode, set, field) in [("search", "questions", "search"), ("question", "questions", "question"), ("hard", "hard", "question")] {
        let (mut top1, mut top4, mut answer_in, mut page_ok, mut rr, mut tokens, mut ms) = (0, 0, 0, 0, 0.0, 0usize, 0.0);
        let (mut asked, mut top1_r, mut top4_r, mut answer_r, mut tokens_r) = (0, 0, 0, 0, 0usize);
        let qs = q[set].as_array().unwrap();
        for item in qs {
            let t = Instant::now();
            let hits = st.library.search(item[field].as_str().unwrap(), crate::agent::LIBRARY_HITS);
            ms += t.elapsed().as_secs_f64() * 1000.0;
            let (text, meta) = crate::agent::library_search(&st, &s, &json!({ "query": item[field] }).to_string());
            let cost = crate::context::estimate_tokens(&[Msg::tool("x", text.clone(), None)]);
            tokens += cost;
            let want = item["section"].as_str().unwrap();
            let answer = squash(item["answer"].as_str().unwrap());
            let rank = hits.iter().position(|h| h.section.ends_with(want));
            if let Some(rank) = rank {
                top4 += 1;
                rr += 1.0 / (rank as f64 + 1.0);
                if rank == 0 {
                    top1 += 1;
                }
            }
            let has_answer = |hs: &[crate::library::Hit]| hs.iter().any(|h| squash(&h.text).contains(&answer));
            if let Some(h) = hits.iter().find(|h| squash(&h.text).contains(&answer)) {
                answer_in += 1;
                let page = item["page"].as_u64().unwrap() as u32;
                if h.page.is_some_and(|p| p == page || p + 1 == page) {
                    page_ok += 1;
                }
            }
            // With the hint the teacher searches once more and sees both results.
            let mut again: Vec<crate::library::Hit> = vec![];
            tokens_r += cost;
            if meta["retry"] == true {
                asked += 1;
                if let Some(r) = retry[set][item[field].as_str().unwrap()].as_str() {
                    again = st.library.search(r, crate::agent::LIBRARY_HITS);
                    let mut s2 = s.clone();
                    s2.messages.push(Msg::tool("x", text, Some(meta)));
                    let (text2, _) = crate::agent::library_search(&st, &s2, &json!({ "query": r }).to_string());
                    tokens_r += crate::context::estimate_tokens(&[Msg::tool("y", text2, None)]);
                }
            }
            let rank2 = again.iter().position(|h| h.section.ends_with(want));
            if rank.is_some() || rank2.is_some() {
                top4_r += 1;
            }
            if if again.is_empty() { rank == Some(0) } else { rank2 == Some(0) } {
                top1_r += 1;
            }
            if has_answer(&hits) || has_answer(&again) {
                answer_r += 1;
            }
        }
        let n = qs.len() as f64;
        let m = json!({
            "questions": qs.len(),
            "section_at_1": top1 as f64 / n,
            "section_at_4": top4 as f64 / n,
            "mrr": rr / n,
            "answer_in_passages": answer_in as f64 / n,
            "page_right": page_ok as f64 / n,
            "tokens_per_query": tokens as f64 / n,
            "query_ms": ms / n,
            "retry_hint": asked as f64 / n,
        });
        lines.push(format!(
            "{mode:>8}: sección@1 {:.0}% · sección@4 {:.0}% · MRR {:.2} · respuesta en lo enviado {:.0}% · página {:.0}% · {:.0} tokens/consulta · {:.2} ms · pide reformular {:.0}%",
            m["section_at_1"].as_f64().unwrap() * 100.0,
            m["section_at_4"].as_f64().unwrap() * 100.0,
            m["mrr"].as_f64().unwrap(),
            m["answer_in_passages"].as_f64().unwrap() * 100.0,
            m["page_right"].as_f64().unwrap() * 100.0,
            m["tokens_per_query"].as_f64().unwrap(),
            m["query_ms"].as_f64().unwrap(),
            m["retry_hint"].as_f64().unwrap() * 100.0
        ));
        report.insert(mode.into(), m);
        if mode == "hard" {
            let r = json!({
                "section_at_1": top1_r as f64 / n,
                "section_at_4": top4_r as f64 / n,
                "answer_in_passages": answer_r as f64 / n,
                "tokens_per_query": tokens_r as f64 / n,
            });
            lines.push(format!(
                "hard + 1 reformulación (simulada): sección@1 {:.0}% · sección@4 {:.0}% · respuesta en lo enviado {:.0}% · {:.0} tokens/consulta",
                r["section_at_1"].as_f64().unwrap() * 100.0,
                r["section_at_4"].as_f64().unwrap() * 100.0,
                r["answer_in_passages"].as_f64().unwrap() * 100.0,
                r["tokens_per_query"].as_f64().unwrap()
            ));
            report.insert("hard_reformulated".into(), r);
        }
    }
    let negatives: Vec<Value> = q["negative"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            let hits = st.library.search(n["search"].as_str().unwrap(), 4);
            let again = st.library.search(retry["negative"][n["search"].as_str().unwrap()].as_str().unwrap(), 4);
            json!({ "query": n["search"], "hits": hits.len(), "all_weak": hits.iter().all(|h| h.weak), "reformulated_all_weak": again.iter().all(|h| h.weak) })
        })
        .collect();
    lines.push(format!("negativas (el libro no las responde): {negatives:?}"));
    let book_tokens = crate::context::estimate_tokens(&[Msg::user(md.clone(), None)]);
    report.insert("book_tokens".into(), json!(book_tokens));
    report.insert("import_ms".into(), json!(import_ms));
    report.insert("index_ms".into(), json!(index_ms));
    report.insert("negative".into(), json!(negatives));
    std::fs::write(fix.join("libro-editorial.retrieval.json"), serde_json::to_string_pretty(&report).unwrap()).unwrap();
    eprintln!("\n── Benchmark biblioteca (libro de {book_tokens} tokens) ──\n{}\n", lines.join("\n"));

    assert!(report["search"]["section_at_4"].as_f64().unwrap() >= 0.9, "{lines:?}");
    assert!(report["search"]["answer_in_passages"].as_f64().unwrap() >= 0.9, "{lines:?}");
    assert!(report["question"]["section_at_4"].as_f64().unwrap() >= 0.75, "{lines:?}");
    assert!(report["hard"]["section_at_4"].as_f64().unwrap() >= 0.8, "paraphrases: {lines:?}");
    assert!(negatives.iter().all(|n| n["all_weak"] == true && n["reformulated_all_weak"] == true), "what the book doesn't answer reads as weak, also in other words: {negatives:?}");
    assert_eq!(report["search"]["retry_hint"], 0.0, "keyword searches that work don't ask to reformulate");
    assert!(report["hard_reformulated"]["section_at_4"].as_f64().unwrap() >= report["hard"]["section_at_4"].as_f64().unwrap(), "{lines:?}");
    std::fs::remove_dir_all(dir).ok();
}
// ── Acompañamiento (AC-82..88) ─────────────────────────────────────────────

fn system_of(r: &Value) -> String {
    r["messages"][0]["content"].as_str().unwrap_or_default().to_string()
}

#[tokio::test]
async fn the_companion_listens_without_teaching_tools_or_the_teachers_prompt() {
    let f = fake(vec![Reply::Sse(vec![text("Suena a que venís cargado. ¿Qué fue lo más pesado de hoy?")])]).await;
    let (st, dir) = state(&f, true, "");
    let conv = crate::companion::send(&st, "  Estoy re cansado con los parciales  ").await.unwrap();
    assert_eq!(conv.turns.len(), 2);
    assert_eq!((conv.turns[0].text.as_str(), conv.turns[0].role.as_str(), conv.risk), ("Estoy re cansado con los parciales", "user", false));
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 1);
    assert!(system_of(&reqs[0]).contains("Acompañamiento") && !system_of(&reqs[0]).contains("harness de aprendizaje"));
    assert!(reqs[0].get("tools").is_none(), "no tools: nothing to teach, plan or record");
    assert_eq!(reqs[0]["_headers"]["x-opencode-session"], "eureka-companion");
    assert_eq!(st.companion.conversation().turns.len(), 2, "persisted");
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_detector_answers_by_itself_and_the_model_then_carries_a_risk_note() {
    let f = fake(vec![Reply::Sse(vec![text("Acá estoy. ¿Querés contarme más?")])]).await;
    let (st, dir) = state(&f, true, "");
    let conv = crate::companion::send(&st, "a veces pienso en quitarme la vida").await.unwrap();
    assert!(conv.risk);
    assert_eq!(conv.turns[1].text, crate::companion::CRISIS_REPLY);
    assert_eq!(f.requests.lock().unwrap().len(), 0, "the safety reply never depends on the model or the network");
    let conv = crate::companion::send(&st, "no sé, me siento mal").await.unwrap();
    assert!(conv.risk, "the help lines stay for the whole conversation");
    let reqs = f.requests.lock().unwrap();
    let last = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(last.contains("Nota de riesgo"), "{last}");
    drop(reqs);
    // A new conversation starts clean.
    st.companion.new_conversation().unwrap();
    assert!(!st.companion.view().conversation.risk && st.companion.view().conversation.turns.is_empty());
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_model_can_raise_the_flag_and_the_tag_never_reaches_the_screen() {
    let f = fake(vec![Reply::Sse(vec![text("Me preocupa lo que contás. ¿Estás pensando en hacerte daño?\n[[RIESGO]]")])]).await;
    let (st, dir) = state(&f, true, "");
    let conv = crate::companion::send(&st, "siento que ya no tiene sentido nada").await.unwrap();
    assert!(conv.risk);
    assert!(!conv.turns[1].text.contains("RIESGO") && conv.turns[1].text.starts_with("Me preocupa"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_failed_call_stores_nothing_so_the_message_can_be_sent_again() {
    let f = fake(vec![Reply::Status(500, "boom")]).await;
    let (st, dir) = state(&f, true, "");
    assert!(crate::companion::send(&st, "hola").await.is_err());
    assert!(st.companion.conversation().turns.is_empty());
    assert!(crate::companion::send(&st, "   ").await.is_err(), "empty is refused before any call");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_companion_follows_the_accessibility_settings() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.settings.save_accessibility(crate::settings::Accessibility { easy_reading: true, ..Default::default() }).unwrap();
    crate::companion::send(&st, "hola").await.unwrap();
    let reqs = f.requests.lock().unwrap();
    let last = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(last.contains("Lectura fácil"));
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_locked_journal_refuses_to_talk() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.companion.set_pin(Some("4321"), None).unwrap();
    st.companion.lock_now();
    let e = crate::companion::send(&st, "hola").await.unwrap_err().to_string();
    assert!(e.contains("bloqueado"), "{e}");
    assert!(crate::companion::propose_entry(&st).await.is_err());
    assert_eq!(f.requests.lock().unwrap().len(), 0);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_model_drafts_a_diary_entry_that_is_not_saved_until_the_person_says_so() {
    let f = fake(vec![
        Reply::Sse(vec![text("¿Qué fue lo más pesado?")]),
        Reply::Sse(vec![text("Tiene sentido. ¿Y qué te ayudó?")]),
        Reply::Sse(vec![tool(0, "e1", crate::companion::ENTRY_TOOL, json!({ "title": "Una semana de parciales", "text": "Estuve muy cansado. Salir a caminar me ayudó.", "mood": 2, "emotions": ["cansancio"], "helped": ["salir a caminar"] }))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    assert!(crate::companion::propose_entry(&st).await.is_err(), "nothing to save yet");
    crate::companion::send(&st, "estoy cansado de tanto parcial").await.unwrap();
    assert!(crate::companion::propose_entry(&st).await.is_err(), "one message is not enough");
    crate::companion::send(&st, "caminar me ayudó").await.unwrap();
    let draft = crate::companion::propose_entry(&st).await.unwrap();
    assert_eq!((draft.title.as_str(), draft.mood, draft.helped.clone()), ("Una semana de parciales", Some(2), vec!["salir a caminar".to_string()]));
    assert!(st.companion.view().entries.is_empty(), "a draft is not an entry");
    let reqs = f.requests.lock().unwrap();
    assert!(system_of(&reqs[2]).contains("Entrada del diario"));
    drop(reqs);
    st.companion.save_entry(draft).unwrap();
    assert_eq!(st.companion.view().entries.len(), 1);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_journal_never_reaches_the_teacher_the_profile_or_the_backups() {
    let f = fake(vec![Reply::Sse(vec![text("Hola.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.companion.save_entry(crate::companion::EntryInput { title: "Secreto".into(), text: "palabraultrasecreta".into(), ..Default::default() }).unwrap();
    st.companion.add_checkin(2, &["tristeza".into()], "notaprivadisima").unwrap();
    let before = serde_json::to_string(&st.learner.load()).unwrap();
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let all = serde_json::to_string(&*f.requests.lock().unwrap()).unwrap();
    assert!(!all.contains("palabraultrasecreta") && !all.contains("notaprivadisima") && !all.contains("tristeza"), "the teacher never sees the journal");
    assert_eq!(serde_json::to_string(&st.learner.load()).unwrap(), before, "and the learner profile doesn't change");
    let files = crate::backup::entries(&dir);
    assert!(files.iter().all(|f| !f.contains("companion")), "{files:?}");
    assert!(dir.join("companion").join("journal.json").exists());
    std::fs::remove_dir_all(dir).ok();
}
// ── Chat libre y herramientas (AC-89, AC-90) ───────────────────────────────

fn new_chat(st: &AppState, message: &str) -> String {
    let mut s = Session::new_chat(message);
    st.sessions.save(&mut s).unwrap();
    s.id
}

fn tool_names(r: &Value) -> Vec<String> {
    r["tools"].as_array().map(|a| a.iter().map(|t| t["function"]["name"].as_str().unwrap().to_string()).collect()).unwrap_or_default()
}

#[tokio::test]
async fn a_chat_just_talks_with_its_own_tools_and_no_method_until_asked() {
    let f = fake(vec![Reply::Sse(vec![text("¡Hola! Contame, ¿en qué te ayudo hoy?")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "hola");
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!((s.phase, s.goal.as_str(), s.pending_question.is_none()), (Phase::Chat, "", true), "a greeting starts nothing");
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 1);
    let tools = tool_names(&reqs[0]);
    assert!(tools.contains(&"begin_learning".to_string()) && tools.contains(&"propose_action".to_string()) && tools.contains(&"research".to_string()));
    assert!(!tools.contains(&"ask_question".to_string()) && !tools.contains(&"set_plan".to_string()), "the method's tools wait for begin_learning: {tools:?}");
    let sys = system_of(&reqs[0]);
    assert!(sys.contains("Fase: Charla") && sys.contains("harness de aprendizaje"));
    let state_msg = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(state_msg.contains("chat (conversación libre)") && state_msg.contains("Todavía no hay un objetivo"), "{state_msg}");
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_agent_starts_the_method_by_itself_when_the_person_asks_to_learn() {
    let f = fake(vec![
        Reply::Sse(vec![text("Dale, armamos eso."), tool(0, "b1", "begin_learning", json!({ "goal": "Entender funciones, listas y bucles en Python", "topics": ["funciones", "listas", " ", "bucles"] }))]),
        Reply::Sse(vec![tool(0, "q1", "ask_question", json!({ "question": "¿Qué creés que hace `print(2 + 3)`?", "purpose": "probe" }))]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "hola! quiero aprender python: funciones, listas y bucles");
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.phase, Phase::Probe);
    assert_eq!(s.title, "Entender funciones, listas y bucles en Python");
    assert!(s.goal.contains("temas: funciones; listas; bucles"), "{}", s.goal);
    assert!(s.pending_question.is_some(), "the same turn went on to measure");
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2, "one turn: the tool, then the first diagnostic question");
    assert!(tool_names(&reqs[1]).contains(&"ask_question".to_string()) && !tool_names(&reqs[1]).contains(&"begin_learning".to_string()));
    assert!(system_of(&reqs[1]).contains("Fase: MEDIR"));
    drop(reqs);
    let result = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("b1")).unwrap().content.clone().unwrap();
    assert!(result.contains("Empezó la sesión de aprendizaje") && result.contains("probe"), "{result}");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_methods_tools_are_refused_in_a_chat_and_begin_learning_in_a_session() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "p1", "set_phase", json!({ "phase": "plan" })), tool(1, "b0", "begin_learning", json!({ "goal": "   " }))]),
        Reply::Sse(vec![text("Ok, ¿qué te gustaría aprender?")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "hola");
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.phase, Phase::Chat);
    let r = |id: &str| s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some(id)).unwrap().content.clone().unwrap();
    assert!(r("p1").contains("todavía no empezó el aprendizaje"), "{}", r("p1"));
    assert!(r("b0").contains("contá qué quiere entender"), "{}", r("b0"));
    // Inside a learning session, begin_learning is an error and the goal is untouched.
    let mut learning = Session::new("qué es una derivada");
    let call = crate::llm::ToolCall { id: "x".into(), kind: "function".into(), function: crate::llm::FunctionCall { name: "begin_learning".into(), arguments: json!({ "goal": "otra cosa" }).to_string() } };
    assert!(matches!(crate::tools::apply(&mut learning, &call), crate::tools::Outcome::Result(r) if r.contains("ya hay una sesión")));
    assert_eq!(learning.goal, "qué es una derivada");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn proposed_actions_are_validated_and_only_shown_never_run() {
    let f = fake(vec![
        Reply::Sse(vec![
            tool(0, "a1", "propose_action", json!({ "kind": "open_screen", "screen": "library", "label": "Abrir la biblioteca" })),
            tool(1, "a2", "propose_action", json!({ "kind": "open_screen", "screen": "bank", "label": "Abrir el banco" })),
            tool(2, "a3", "propose_action", json!({ "kind": "start_pomodoro", "minutes": 25, "label": "Pomodoro de 25 min" })),
            tool(3, "a4", "propose_action", json!({ "kind": "start_pomodoro", "minutes": 500, "label": "Pomodoro eterno" })),
            tool(4, "a5", "propose_action", json!({ "kind": "set_reminders", "stand_minutes": 25, "water_minutes": 60, "label": "Recordatorios" })),
            tool(5, "a6", "propose_action", json!({ "kind": "set_reminders", "label": "Sin minutos" })),
            tool(6, "a7", "propose_action", json!({ "kind": "format_disk", "label": "No" })),
        ]),
        Reply::Sse(vec![text("Te dejé los botones.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "ayudame a organizarme");
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    let r = |id: &str| s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some(id)).unwrap().content.clone().unwrap();
    for ok in ["a1", "a3", "a5"] {
        assert!(r(ok).starts_with("botón mostrado") && r(ok).contains("No digas que ya está hecho"), "{ok}: {}", r(ok));
    }
    for (bad, why) in [("a2", "screen tiene que ser"), ("a4", "minutes va de 5 a 90"), ("a6", "indicá stand_minutes"), ("a7", "tipo de acción desconocido")] {
        assert!(r(bad).starts_with("error:") && r(bad).contains(why), "{bad}: {}", r(bad));
    }
    assert_eq!(s.phase, Phase::Chat, "an action never changes the session by itself");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_agent_knows_how_the_person_asked_to_be_addressed_in_every_phase() {
    let f = fake(vec![Reply::Sse(vec![text("Hola, Jessica.")])]).await;
    let (st, dir) = state(&f, true, "");
    st.settings.save_identity(crate::settings::Identity { first_name: "Jessica".into(), treatment: "ella".into(), career: "Medicina".into(), onboarded: true, ..Default::default() }).unwrap();
    let id = new_chat(&st, "hola");
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    let state_msg = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(state_msg.contains("Se llama Jessica") && state_msg.contains("femenino (ella)") && state_msg.contains("Estudia Medicina"), "{state_msg}");
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

// ── Mi cursada (AC-101, AC-102) ──────────────────────────────────────────────

#[tokio::test]
async fn pasting_a_timetable_in_the_chat_becomes_a_proposal_that_is_not_saved_until_confirmed() {
    let proposal = json!({
        "term": { "name": "2.º cuatrimestre 2026", "kind": "cuatrimestre" },
        "courses": [{ "name": "Análisis I", "professor": "Pérez", "slots": [{ "weekday": 1, "start": "10:00", "end": "12:00", "room": "Aula 3" }] }],
        "dates": [{ "course": "Análisis I", "kind": "parcial", "title": "Primer parcial", "date": "2026-11-12" }]
    });
    let f = fake(vec![
        Reply::Sse(vec![
            tool(0, "t1", "propose_timetable", proposal),
            tool(1, "t2", "propose_timetable", json!({ "courses": [{ "name": "Física", "slots": [{ "weekday": 2, "start": "12:00", "end": "10:00" }] }] })),
            tool(2, "t3", "propose_timetable", json!({})),
        ]),
        Reply::Sse(vec![text("Te lo dejé para que lo revises y lo guardes.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "mi horario: lunes de 10 a 12 Análisis I con Pérez, aula 3");
    run(&st, &id).await.0.unwrap();
    let s = st.sessions.load(&id).unwrap();
    let r = |id: &str| s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some(id)).unwrap().content.clone().unwrap();
    assert!(r("t1").starts_with("propuesta mostrada: 1 materias y 1 fechas") && r("t1").contains("no digas que ya están guardadas"), "{}", r("t1"));
    assert!(r("t2").starts_with("error:") && r("t2").contains("Física") && r("t2").contains("terminar después de empezar"), "{}", r("t2"));
    assert!(r("t3").starts_with("error:") && r("t3").contains("vacía"), "{}", r("t3"));
    assert!(st.academic.data().terms.is_empty(), "a proposal is shown, never saved by the agent");
    // The same thing the chat offers, applied once the person confirms.
    let call = s.messages.iter().flat_map(|m| m.tool_calls.clone().unwrap_or_default()).find(|c| c.id == "t1").unwrap();
    let (data, report) = st.academic.import(serde_json::from_str(&call.function.arguments).unwrap()).unwrap();
    assert_eq!((report.courses_added, report.dates_added, data.courses[0].slots[0].room.as_str()), (1, 1, "Aula 3"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_agent_knows_the_persons_courses_today_and_what_is_coming() {
    let f = fake(vec![Reply::Sse(vec![text("Mañana tenés Física.")]), Reply::Sse(vec![text("Ok.")])]).await;
    let (st, dir) = state(&f, true, "");
    // Nothing loaded: the chat is told how to help, a learning session is not bothered.
    let chat = new_chat(&st, "¿qué tengo hoy?");
    run(&st, &chat).await.0.unwrap();
    let learning = new_session(&st);
    {
        let reqs = f.requests.lock().unwrap();
        let block = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
        assert!(block.contains("## Cursada del aprendiz") && block.contains("Hoy es ") && block.contains("propose_timetable"), "{block}");
    }
    let today = chrono::Local::now().date_naive();
    let soon = (today + chrono::Duration::days(3)).format("%Y-%m-%d").to_string();
    st.academic
        .import(serde_json::from_value(json!({
            "term": { "name": "Cuatrimestre actual" },
            "courses": [{ "name": "Física I", "professor": "Gómez", "slots": [{ "weekday": 1, "start": "08:00", "end": "10:00" }] }],
            "dates": [{ "course": "Física I", "kind": "parcial", "title": "Parcial de Física", "date": soon }]
        })).unwrap())
        .unwrap();
    run(&st, &learning).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    let block = reqs[1]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(block.contains("Período activo: Cuatrimestre actual") && block.contains("Física I · prof. Gómez") && block.contains("Parcial de Física") && block.contains("en 3 días"), "{block}");
    assert!(!block.contains("Todavía no cargó"), "{block}");
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

// ── La malla de la carrera (AC-157) ────────────────────────────────────────

#[tokio::test]
async fn the_agent_knows_the_career_and_what_the_person_can_take_next() {
    let f = fake(vec![Reply::Sse(vec![text("El próximo cuatrimestre podés cursar Análisis II.")])]).await;
    let (st, dir) = state(&f, true, "");
    let plan: crate::career::Proposal = serde_json::from_value(json!({
        "name": "Ingeniería en Sistemas", "institution": "UTN",
        "subjects": [
            { "name": "Análisis I", "year": 1 },
            { "name": "Análisis II", "year": 2, "para_cursar": ["Análisis I"], "para_rendir": ["Análisis I"] }
        ]
    }))
    .unwrap();
    st.career.set_plan(plan).unwrap();
    st.career
        .update(|c| {
            c.subjects[0].status = crate::career::Status::Aprobada;
            c.subjects[0].grade = Some(9.0);
            Ok(())
        })
        .unwrap();
    let chat = new_chat(&st, "¿qué curso el cuatrimestre que viene?");
    run(&st, &chat).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    let block = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(block.contains("## Su carrera") && block.contains("Ingeniería en Sistemas (UTN): 1 de 2 materias aprobadas, promedio 9.") && block.contains("- Puede cursar: Análisis II."), "{block}");
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
}

// ── El asistente maneja la app (AC-122, AC-123) ────────────────────────────

#[tokio::test]
async fn a_control_the_person_asked_for_reaches_the_screen_as_an_event_once_validated() {
    let f = fake(vec![
        Reply::Sse(vec![
            tool(0, "u1", "ui_command", json!({ "command": "pomodoro_pause" })),
            tool(1, "u2", "ui_command", json!({ "command": "set_theme", "theme": "light" })),
            tool(2, "u3", "ui_command", json!({ "command": "set_theme", "theme": "rojo" })),
        ]),
        Reply::Sse(vec![text("Listo: pausé el pomodoro y puse el modo claro.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_chat(&st, "pausá el pomodoro y poné el modo claro");
    let (r, events) = run(&st, &id).await;
    r.unwrap();
    let ui: Vec<&Value> = events.iter().filter(|e| e["type"] == "ui").collect();
    assert_eq!(ui.len(), 2, "only the two valid ones reach the screen: {events:?}");
    assert_eq!(ui[0]["command"], json!({ "command": "pomodoro_pause" }));
    assert_eq!(ui[1]["command"], json!({ "command": "set_theme", "theme": "light" }));
    let s = st.sessions.load(&id).unwrap();
    let r = |id: &str| s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some(id)).unwrap().content.clone().unwrap();
    assert_eq!(r("u1"), "ejecutado: pomodoro en pausa");
    assert!(r("u3").starts_with("error:") && r("u3").contains("theme tiene que ser"), "{}", r("u3"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_agent_knows_what_is_on_screen_and_can_read_how_the_person_is_doing() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "s1", "app_status", json!({}))]),
        Reply::Sse(vec![text("Tenés AWS el 15/12 y 3 tarjetas para hoy.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    st.set_ui_snapshot("- Pomodoro: corriendo, foco, quedan 18:20\n- Tema: oscuro");
    // An exam with a date, a deck with a due card, and some study time.
    let mut exam = crate::exam::Exam { id: "e1".into(), name: "AWS Certified AI Practitioner".into(), created_at: chrono::Utc::now(), updated_at: chrono::Utc::now(), domains: vec![], mocks: vec![], review: vec![], goal: crate::exam::ExamGoal { passing_pct: None, exam_date: Some((chrono::Local::now().date_naive() + chrono::Duration::days(20)).to_string()), hours_per_week: None }, cheat_sheet: None, kind: crate::exam::ExamKind::Certification, schedule: vec![], lang: None };
    st.exams.save(&mut exam).unwrap();
    crate::cards::create_empty(&st, "Python").unwrap();
    let id = new_chat(&st, "¿cómo vengo?");
    run(&st, &id).await.0.unwrap();

    let reqs = f.requests.lock().unwrap();
    let state_msg = reqs[0]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().to_string();
    assert!(state_msg.contains("## La app ahora") && state_msg.contains("quedan 18:20"), "{state_msg}");
    assert!(tool_names(&reqs[0]).contains(&"app_status".to_string()) && tool_names(&reqs[0]).contains(&"ui_command".to_string()));
    drop(reqs);
    let s = st.sessions.load(&id).unwrap();
    let status = s.messages.iter().find(|m| m.tool_call_id.as_deref() == Some("s1")).unwrap().content.clone().unwrap();
    assert!(status.contains("Pomodoro: corriendo") && status.contains("AWS Certified AI Practitioner") && status.contains("faltan 20 días") && status.contains("1 mazo") && status.contains("hoy 0 min"), "{status}");
    assert!(!status.contains("\\n"), "real line breaks, not escaped ones: {status}");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn the_screen_snapshot_is_kept_short() {
    let dir = std::env::temp_dir().join(format!("la-ui-{}", uuid::Uuid::new_v4().simple()));
    let st = AppState::new(dir.clone());
    st.set_ui_snapshot(&"x".repeat(5000));
    assert_eq!(st.ui_snapshot().chars().count(), 1200);
    st.set_ui_snapshot("  \n ");
    assert_eq!(st.ui_snapshot(), "");
    std::fs::remove_dir_all(dir).ok();
}

// ── Memoria entre sesiones (AC-108, AC-109) ──

fn quiet_chat(st: &AppState) -> String {
    let mut s = Session::new_chat("explicame qué es un triángulo equilátero");
    for i in 0..5 {
        s.messages.push(Msg::user(format!("pregunta {i}"), None));
    }
    st.sessions.save(&mut s).unwrap();
    s.updated_at = chrono::Utc::now() - chrono::Duration::minutes(crate::memory::IDLE_MINUTES + 1);
    st.sessions.save_quiet(&s).unwrap();
    s.id
}

#[tokio::test]
async fn a_quiet_chat_is_folded_into_memory_and_the_graph_in_the_background() {
    let remember = tool(0, "m1", crate::memory::TOOL, json!({ "summary": "Vimos el triángulo equilátero y su altura.", "pending": ["la demostración"], "struggled": ["la altura"] }));
    let f = fake(vec![Reply::Sse(vec![remember]), Reply::Sse(vec![knowledge(&[("a", "Un triángulo equilátero tiene tres lados iguales")], &[])])]).await;
    let (st, dir) = state(&f, true, "");
    let id = quiet_chat(&st);
    let before = st.sessions.load(&id).unwrap().updated_at;
    crate::memory::pass(&st, &crate::memory::Backoff::default()).await;

    let s = st.sessions.load(&id).unwrap();
    let m = s.memory.as_ref().expect("memory written");
    assert_eq!(m.summary, "Vimos el triángulo equilátero y su altura.");
    assert_eq!((m.pending.clone(), m.messages), (vec!["la demostración".to_string()], s.messages.len()));
    assert_eq!(s.graph.as_ref().map(|g| g.propositions), Some(1), "chats reach the graph too");
    assert_eq!(s.updated_at, before, "the pass isn't activity");
    let reqs = f.requests.lock().unwrap().clone();
    assert_eq!(reqs[0]["tool_choice"]["function"]["name"], crate::memory::TOOL);
    assert!(reqs[0]["messages"][0]["content"].as_str().unwrap().contains("memoria de Eureka"));

    // Nothing new: the next pass makes no request.
    let n = reqs.len();
    crate::memory::pass(&st, &crate::memory::Backoff::default()).await;
    assert_eq!(f.requests.lock().unwrap().len(), n);

    // Another session's turn sees it.
    let mut other = Session::new_chat("hola");
    st.sessions.save(&mut other).unwrap();
    let block = crate::memory::state_section(&st.sessions.all(), &other);
    assert!(block.contains("Pendiente: la demostración."), "{block}");
    assert!(crate::agent::recall(&st, &other, r#"{"query":"triángulo","kind":"sesiones"}"#).contains("Sesión «explicame qué es un triángulo equilátero»"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_failed_pass_waits_before_retrying_that_session() {
    let f = fake(vec![Reply::Status(500, "{}".into())]).await;
    let (st, dir) = state(&f, true, "");
    let id = quiet_chat(&st);
    let backoff = crate::memory::Backoff::default();
    crate::memory::pass(&st, &backoff).await;
    assert!(st.sessions.load(&id).unwrap().memory.is_none());
    let n = f.requests.lock().unwrap().len();
    assert!(n > 0);
    crate::memory::pass(&st, &backoff).await;
    assert_eq!(f.requests.lock().unwrap().len(), n, "no retry storm");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn without_a_key_the_pass_does_nothing() {
    let f = fake(vec![Reply::Status(500, "{}".into())]).await;
    let (st, dir) = state(&f, false, "");
    quiet_chat(&st);
    crate::memory::pass(&st, &crate::memory::Backoff::default()).await;
    assert!(f.requests.lock().unwrap().is_empty());
    std::fs::remove_dir_all(dir).ok();
}

/// A state whose provider is a subscription account pointing at the fake.
/// The base URL lives in the account so the fake can stand in for the backend.
fn subscription_state(f: &Fake) -> (AppState, std::path::PathBuf) {
    let (st, dir) = state(f, false, "");
    let account = crate::accounts::Account {
        kind: "chatgpt".into(),
        account_id: "acc-test".into(),
        email: None,
        access: "sk-fake".into(),
        refresh: "r".into(),
        expires: i64::MAX,
        originator: "eureka".into(),
        base_url: f.base_url.clone(),
    };
    st.accounts.put("fake", &account).unwrap();
    (st, dir)
}

#[tokio::test]
async fn subscription_reply_ends_turn_and_persists() {
    let f = fake(vec![Reply::Sse(vec![
        json!({ "type": "response.output_text.delta", "delta": "¡Ho" }),
        json!({ "type": "response.output_text.delta", "delta": "la!" }),
        json!({ "type": "response.completed" }),
    ])])
    .await;
    let (st, dir) = subscription_state(&f);
    let id = new_session(&st);
    let (r, events) = run(&st, &id).await;
    r.unwrap();
    let s = st.sessions.load(&id).unwrap();
    assert_eq!(s.messages.last().unwrap().content.as_deref(), Some("¡Hola!"));
    assert_eq!(f.requests.lock().unwrap().len(), 1);
    let deltas: String = events.iter().filter(|e| e["type"] == "text").map(|e| e["delta"].as_str().unwrap()).collect();
    assert_eq!(deltas, "¡Hola!");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn subscription_question_pauses_turn_until_the_learner_answers() {
    let f = fake(vec![
        Reply::Sse(vec![
            json!({ "type": "response.output_item.added", "item": { "type": "function_call", "id": "fc_1", "call_id": "q1", "name": "ask_question", "arguments": "" } }),
            json!({ "type": "response.function_call_arguments.done", "item_id": "fc_1", "arguments": "{\"question\":\"¿Pendiente?\",\"purpose\":\"probe\"}" }),
            json!({ "type": "response.completed" }),
        ]),
        Reply::Sse(vec![
            json!({ "type": "response.output_text.delta", "delta": "Gracias." }),
            json!({ "type": "response.completed" }),
        ]),
    ])
    .await;
    let (st, dir) = subscription_state(&f);
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    assert_eq!(st.sessions.load(&id).unwrap().pending_question.as_deref(), Some("q1"));

    let mut s = st.sessions.load(&id).unwrap();
    crate::tools::add_learner_input(
        &mut s,
        crate::tools::LearnerInput { text: "sube 2".into(), confidence: Some(4), thinking: "creo".into(), ..Default::default() },
    );
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();

    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 2);
    // The second request must carry the answer as a function_call_output item.
    let second = &reqs[1];
    let input = second["input"].as_array().unwrap();
    assert!(input.iter().any(|i| i["type"] == "function_call_output" && i["call_id"] == "q1"));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn every_model_call_is_counted_with_its_turn_step_and_session() {
    // AC-186: the usage chunk is asked for and read; a call without one is counted as unknown.
    let usage = json!({ "choices": [], "usage": { "prompt_tokens": 1000, "completion_tokens": 20, "prompt_tokens_details": { "cached_tokens": 900 } } });
    let f = fake(vec![Reply::Sse(vec![tool(0, "c1", "recall", json!({ "query": "derivada" })), usage]), Reply::Sse(vec![text("Listo.")])]).await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs[0]["stream_options"], json!({ "include_usage": true }));
    let events = st.usage.all();
    assert_eq!(events.len(), 2);
    let (a, b) = (&events[0], &events[1]);
    assert_eq!((a.known, a.input, a.output, a.cached), (true, Some(1000), Some(20), Some(900)));
    assert_eq!((a.purpose.as_str(), a.phase.as_deref(), a.step, a.session_id.as_deref()), ("turn", Some("probe"), Some(0), Some(id.as_str())));
    assert_eq!((a.role.as_str(), a.model.as_str()), ("prober", "t-model"));
    assert!(a.provider.starts_with("127.0.0.1:"), "the host only, never the path or the key");
    assert_eq!((b.known, b.input, b.step), (false, None, Some(1)));
    let raw = std::fs::read_to_string(dir.join(crate::usage::FILE)).unwrap();
    assert!(!raw.contains("derivada") && !raw.contains("sk-fake"), "counts only: no text, no key");
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn a_provider_that_rejects_stream_options_still_answers() {
    // AC-186: degrade, never break: asked again without the option, and not asked again after that.
    let f = fake(vec![
        Reply::Status(400, r#"{"error":{"message":"Unrecognized request argument supplied: stream_options"}}"#),
        Reply::Sse(vec![text("Hola.")]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    run(&st, &id).await.0.unwrap();
    run(&st, &id).await.0.unwrap();
    let reqs = f.requests.lock().unwrap();
    assert_eq!(reqs.len(), 3);
    assert!(reqs[0].get("stream_options").is_some());
    assert!(reqs[1].get("stream_options").is_none() && reqs[2].get("stream_options").is_none());
    assert_eq!(st.sessions.load(&id).unwrap().messages.last().unwrap().content.as_deref(), Some("Hola."));
    assert!(st.usage.all().iter().all(|e| !e.known));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn forced_calls_are_counted_by_their_prompt() {
    let f = fake(vec![Reply::Sse(vec![tool(0, "s1", crate::context::SUMMARY_TOOL, json!({ "summary": "- algo" })), json!({ "choices": [], "usage": { "prompt_tokens": 50, "completion_tokens": 5, "cost": 0.001 } })])]).await;
    let (st, dir) = state(&f, true, "");
    let r = crate::usage::in_session("s-x", crate::practice::forced_valid(&st, Role::Extractor, "summarize_history", crate::context::summary_tool(), crate::context::SUMMARY_TOOL, "x".into(), crate::context::parse_summary)).await;
    r.unwrap();
    let e = &st.usage.all()[0];
    assert_eq!((e.purpose.as_str(), e.role.as_str(), e.session_id.as_deref(), e.cost), ("summarize_history", "extractor", Some("s-x"), Some(0.001)));
    std::fs::remove_dir_all(dir).ok();
}

#[tokio::test]
async fn the_background_memory_pass_counts_for_its_session() {
    let f = fake(vec![
        Reply::Sse(vec![tool(0, "m1", crate::memory::TOOL, json!({ "summary": "Vio la pendiente." }))]),
        Reply::Sse(vec![knowledge(&[("a", "La pendiente mide cuánto sube")], &[])]),
    ])
    .await;
    let (st, dir) = state(&f, true, "");
    let id = new_session(&st);
    crate::memory::consolidate(&st, &id).await.unwrap();
    let events = st.usage.all();
    assert_eq!(events.iter().map(|e| e.purpose.as_str()).collect::<Vec<_>>(), vec!["remember_session", "extract"]);
    assert!(events.iter().all(|e| e.session_id.as_deref() == Some(id.as_str()) && e.role == "extractor"));
    std::fs::remove_dir_all(dir).ok();
}

#[path = "token_bench.rs"]
mod token_bench;
