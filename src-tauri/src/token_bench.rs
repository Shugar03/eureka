//! AC-186: token benchmark with no network. A scripted session runs through
//! the REAL agent loop against the fake provider of `agent_tests`, so what is
//! counted is exactly the request body Eureka sends (system prompt, tool
//! schemas for the phase, compacted history, state message). Counted with
//! tiktoken o200k_base as a proxy: each provider has its own tokenizer, and
//! tool schemas count as their JSON (providers render them in their own way).
//!
//! `token_budget` fails when a number grows more than 10 % over
//! `bench/token_baseline.json`. To accept new numbers:
//! `TOKEN_BASELINE_UPDATE=1 cargo test --lib token_budget -- --nocapture`

use super::*;
use std::collections::BTreeMap;

const TOLERANCE: f64 = 0.10;

fn bpe() -> &'static tiktoken_rs::CoreBPE {
    static BPE: std::sync::OnceLock<tiktoken_rs::CoreBPE> = std::sync::OnceLock::new();
    BPE.get_or_init(|| tiktoken_rs::o200k_base().unwrap())
}

fn toks(text: &str) -> u64 {
    bpe().encode_ordinary(text).len() as u64
}

fn toks_json(v: &Value) -> u64 {
    match v {
        Value::Null => 0,
        Value::Array(a) if a.is_empty() => 0,
        _ => toks(&v.to_string()),
    }
}

/// One request body, split the way the cache sees it.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
struct Parts {
    system: u64,
    tools: u64,
    history: u64,
    state: u64,
    total: u64,
}

impl Parts {
    fn add(&mut self, o: &Parts) {
        self.system += o.system;
        self.tools += o.tools;
        self.history += o.history;
        self.state += o.state;
        self.total += o.total;
    }
}

/// The messages as sent (system first), the state message last when there is one.
fn messages(req: &Value) -> Vec<Value> {
    req["messages"].as_array().cloned().unwrap_or_default()
}

fn is_state(m: &Value) -> bool {
    m["role"] == "user" && m["content"].as_str().is_some_and(|c| c.starts_with("<estado_app>"))
}

fn parts(req: &Value) -> Parts {
    let msgs = messages(req);
    let system = msgs.first().map_or(0, |m| toks(m["content"].as_str().unwrap_or("")));
    let tools = toks_json(&req["tools"]);
    let state = msgs.last().filter(|m| is_state(m)).map_or(0, |m| toks(m["content"].as_str().unwrap_or("")));
    let end = if msgs.last().is_some_and(is_state) { msgs.len() - 1 } else { msgs.len() };
    let history: u64 = msgs.get(1..end).unwrap_or(&[]).iter().map(toks_json).sum();
    Parts { system, tools, history, state, total: system + tools + history + state }
}

/// Tokens of `b` that repeat `a` byte for byte from the start (tools, system,
/// then whole messages): what a prefix cache could serve. The state message never counts.
fn common_prefix(a: &Value, b: &Value) -> u64 {
    if a["tools"] != b["tools"] {
        return 0;
    }
    let (ma, mb) = (messages(a), messages(b));
    if ma.first() != mb.first() {
        return 0;
    }
    let mut out = toks_json(&b["tools"]) + mb.first().map_or(0, |m| toks(m["content"].as_str().unwrap_or("")));
    for (x, y) in ma.iter().zip(mb.iter()).skip(1) {
        if x != y || is_state(y) {
            break;
        }
        out += toks_json(y);
    }
    out
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
struct TurnReport {
    phases: Vec<String>,
    calls: usize,
    per_call: Vec<Parts>,
    turn: Parts,
    /// Tokens each call shares with the call before it (the same session).
    cached_prefix: u64,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
struct Report {
    turns: BTreeMap<String, TurnReport>,
    tools: BTreeMap<String, u64>,
    /// The default prompts (`prompts/*.md`), in tokens.
    #[serde(default)]
    prompts: BTreeMap<String, u64>,
}

fn phase_of(req: &Value) -> String {
    let sys = messages(req).first().and_then(|m| m["content"].as_str().map(String::from)).unwrap_or_default();
    for (mark, name) in [("Fase: MEDIR", "probe"), ("Fase: PLANIFICAR", "plan"), ("Fase: ENSEÑAR", "teach"), ("Fase: TERMINADA", "done")] {
        if sys.contains(mark) {
            return name.into();
        }
    }
    if sys.contains("Fase: Charla") {
        return "chat".into();
    }
    match req["tool_choice"]["function"]["name"].as_str() {
        Some(name) => format!("forced:{name}"),
        None => "other".into(),
    }
}

fn answer(st: &AppState, id: &str, text: &str) {
    let mut s = st.sessions.load(id).unwrap();
    crate::tools::add_learner_input(&mut s, crate::tools::LearnerInput { text: text.into(), confidence: Some(3), thinking: "creo que sí".into(), ..Default::default() });
    st.sessions.save(&mut s).unwrap();
}

fn q(id: &str, question: &str, purpose: &str, of: u8) -> Value {
    tool(9, id, "ask_question", json!({ "question": question, "purpose": purpose, "of": of }))
}

const PARA: &str = "La integral definida suma infinitos rectángulos muy finos bajo la curva; cuanto más finos, más se acerca al área exacta. ";

/// A demo the size a real one has (~3.5 KB of HTML).
fn demo_html() -> String {
    let mut h = String::from("<!doctype html><html><head><style>body{font-family:sans-serif;margin:0;padding:16px}canvas{border:1px solid #ccc}label{display:block;margin:8px 0}</style></head><body>");
    h.push_str("<h3>Pendiente de la recta secante</h3><canvas id=c width=420 height=300></canvas><label>h = <input id=h type=range min=0.01 max=2 step=0.01 value=1><span id=v>1</span></label><p id=out></p><script>");
    for i in 0..30 {
        h.push_str(&format!("function f{i}(x){{return x*x+{i}*0;}}\n"));
    }
    h.push_str("const c=document.getElementById('c').getContext('2d');const h=document.getElementById('h');function draw(){const k=+h.value;document.getElementById('v').textContent=k;c.clearRect(0,0,420,300);c.beginPath();for(let x=-3;x<=3;x+=0.05){const px=210+x*60,py=280-f0(x)*30;x===-3?c.moveTo(px,py):c.lineTo(px,py)}c.stroke();const m=(f0(1+k)-f0(1))/k;document.getElementById('out').textContent='pendiente secante: '+m.toFixed(3)}h.oninput=draw;draw();</script></body></html>");
    h
}

/// The scripted session: chat → probe → plan → teach (diagram + demo) → done,
/// then the background memory pass and a practice set. Real loop, fake model.
async fn scripted() -> (Vec<(String, Vec<Value>)>, Value) {
    let plan = json!({ "nodes": [
        { "id": "pend", "title": "Pendiente de una recta", "depends_on": [], "status": "known" },
        { "id": "sec", "title": "Recta secante y su pendiente", "depends_on": ["pend"], "status": "pending" },
        { "id": "lim", "title": "Límite de la pendiente secante", "depends_on": ["sec"], "status": "pending" },
        { "id": "der", "title": "La derivada como pendiente de la tangente", "depends_on": ["lim"], "status": "pending" }
    ] });
    let diagram = "graph LR; A[Recta secante] -->|h tiende a 0| B[Recta tangente]; B --> C[Pendiente = derivada]; A --> D[Pendiente = cociente incremental]";
    let replies = vec![
        // chat: one plain answer
        Reply::Sse(vec![text("¡Hola! Puedo explicarte temas, armarte práctica, tarjetas y simulacros. ¿Qué querés entender hoy?")]),
        // chat → probe: begin_learning, then the first probe question
        Reply::Sse(vec![tool(0, "b1", "begin_learning", json!({ "goal": "qué es una derivada" }))]),
        Reply::Sse(vec![text("Primero veamos de dónde partís."), q("q1", "Si una recta pasa por (0,1) y (2,5), ¿cuál es su pendiente?", "probe", 1)]),
        // probe: finding + next question
        Reply::Sse(vec![tool(0, "f1", "record_finding", json!({ "concept": "pendiente de una recta", "level": "solid", "evidence": "calculó 2 sin dudar" })), q("q2", "¿Qué te imaginás que es la recta tangente a una curva en un punto?", "probe", 2)]),
        // probe → plan
        Reply::Sse(vec![tool(0, "f2", "record_finding", json!({ "concept": "recta tangente", "level": "partial", "evidence": "dice que toca en un punto, sin idea de límite" })), tool(1, "p1", "set_phase", json!({ "phase": "plan" }))]),
        Reply::Sse(vec![tool(0, "p2", "set_plan", plan), text("Este es el plan: de la pendiente que ya sabés, a la secante, al límite y a la derivada."), q("q3", "¿Arrancamos por la secante?", "check", 1)]),
        // plan → teach: diagram + demo + predict
        Reply::Sse(vec![tool(0, "t0", "set_phase", json!({ "phase": "teach" }))]),
        Reply::Sse(vec![
            tool(0, "u1", "update_node", json!({ "id": "sec", "status": "current" })),
            tool(1, "d1", "show_diagram", json!({ "title": "De la secante a la tangente", "mermaid": diagram })),
            tool(2, "d2", "show_demo", json!({ "title": "Mové h", "html": demo_html() })),
            text("La secante une dos puntos de la curva. Mové h en la demo y mirá qué pasa con la pendiente."),
            q("q4", "Si h se hace muy chico, ¿qué creés que pasa con la pendiente de la secante en x=1 para f(x)=x²?", "predict", 1),
        ]),
        // teach: check
        Reply::Sse(vec![tool(0, "u2", "update_node", json!({ "id": "sec", "status": "understood" })), tool(1, "u3", "update_node", json!({ "id": "lim", "status": "current" })), text("Exacto: se acerca a 2. Eso es el límite."), q("q5", "¿Cuánto vale la pendiente de la tangente a x² en x=3?", "check", 1)]),
        // teach → done
        Reply::Sse(vec![tool(0, "u4", "update_node", json!({ "id": "lim", "status": "understood" })), tool(1, "u5", "update_node", json!({ "id": "der", "status": "understood" })), tool(2, "t1", "set_phase", json!({ "phase": "done" }))]),
        Reply::Sse(vec![text("Llegaste: la derivada es la pendiente de la tangente, el límite de las secantes. Repasalo mañana con tarjetas.")]),
        // done: one plain answer
        Reply::Sse(vec![text("¡De nada! Cuando quieras practicamos.")]),
        // memory pass (background): remember_session, then the extractor
        Reply::Sse(vec![tool(0, "m1", crate::memory::TOOL, json!({ "summary": "Vio de la pendiente a la derivada.", "pending": ["practicar"], "struggled": ["límite"] }))]),
        Reply::Sse(vec![knowledge(&[("a", "La derivada es la pendiente de la tangente"), ("b", "La tangente es el límite de las secantes")], &[(&["b"], "a")])]),
        // a long session, two turns in a row: the history window slides
        // (answers as long as a real explanation, so each turn pushes old messages out)
        Reply::Sse(vec![text(&PARA.repeat(9))]),
        Reply::Sse(vec![text(&PARA.repeat(9))]),
        // practice: one forced call
        Reply::Sse(vec![tool(0, "g", crate::practice::GENERATE_TOOL, json!({ "problems": [{ "statement": "¿Pendiente de $x^2$ en 3?", "targets": ["__ID__"], "hints": ["Tangente"], "solution": "6" }] }))]),
    ];
    let f = fake(replies).await;
    let (st, dir) = state(&f, true, "");
    let mut s = crate::session::Session::new_chat("hola, ¿qué podés hacer?");
    st.sessions.save(&mut s).unwrap();
    let id = s.id.clone();

    let mut turns = Vec::new();
    let mut seen = 0;
    let mut take = |name: &str, turns: &mut Vec<(String, Vec<Value>)>| {
        let reqs = f.requests.lock().unwrap();
        turns.push((name.to_string(), reqs[seen..].to_vec()));
        seen = reqs.len();
    };
    run(&st, &id).await.0.unwrap();
    take("01-chat", &mut turns);
    let mut s = st.sessions.load(&id).unwrap();
    s.messages.push(crate::llm::Msg::user("quiero entender qué es una derivada", None));
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();
    take("02-chat-a-diagnostico", &mut turns);
    answer(&st, &id, "2, sube 4 en 2");
    run(&st, &id).await.0.unwrap();
    take("03-diagnostico", &mut turns);
    answer(&st, &id, "una recta que toca la curva en un solo punto");
    run(&st, &id).await.0.unwrap();
    take("04-diagnostico-a-plan", &mut turns);
    answer(&st, &id, "sí, dale");
    run(&st, &id).await.0.unwrap();
    take("05-ensenar-diagrama-demo", &mut turns);
    answer(&st, &id, "se acerca a 2");
    run(&st, &id).await.0.unwrap();
    take("06-ensenar-chequeo", &mut turns);
    answer(&st, &id, "6");
    run(&st, &id).await.0.unwrap();
    take("07-ensenar-a-cierre", &mut turns);
    let mut s = st.sessions.load(&id).unwrap();
    s.messages.push(crate::llm::Msg::user("gracias", None));
    st.sessions.save(&mut s).unwrap();
    run(&st, &id).await.0.unwrap();
    take("08-cierre", &mut turns);
    crate::memory::consolidate(&st, &id).await.unwrap();
    take("09-memoria-en-segundo-plano", &mut turns);
    // A session past the window (default budget 64k → ~38k estimated tokens kept).
    let mut long = crate::session::Session::new("qué es una integral");
    long.phase = crate::session::Phase::Teach;
    long.plan = vec![crate::session::PlanNode { id: "int".into(), title: "Integral como área".into(), summary: String::new(), depends_on: vec![], status: crate::session::NodeStatus::Current, note: String::new() }];
    // No summary in this measurement (it would be one more forced call).
    long.summarized_upto = 100_000;
    let para = PARA;
    for i in 0..100 {
        long.messages.push(crate::llm::Msg::user(format!("Pregunta {i}: ¿y si la función es negativa en un tramo? {}", &para[..120]), None));
        long.messages.push(crate::llm::Msg { role: "assistant".into(), content: Some(format!("Respuesta {i}: {}", para.repeat(9))), tool_calls: None, tool_call_id: None, meta: None });
    }
    st.sessions.save(&mut long).unwrap();
    for name in ["11-sesion-larga-a", "12-sesion-larga-b"] {
        let mut l = st.sessions.load(&long.id).unwrap();
        l.messages.push(crate::llm::Msg::user("¿y la primitiva?", None));
        st.sessions.save(&mut l).unwrap();
        run(&st, &long.id).await.0.unwrap();
        take(name, &mut turns);
    }
    let node = seed_graph(&st);
    let _ = crate::practice::create(&st, &[node], 3).await;
    // The queued problem is invalid on purpose: only the first (real-shaped) request counts.
    let reqs = f.requests.lock().unwrap();
    turns.push(("10-practica".into(), reqs[seen..seen + 1].to_vec()));
    drop(reqs);
    std::fs::remove_dir_all(dir).ok();
    (turns, crate::tools::definitions())
}

fn report(turns: &[(String, Vec<Value>)], defs: &Value) -> Report {
    let mut out = Report::default();
    let mut prev: Option<&Value> = None;
    for (name, reqs) in turns {
        let mut t = TurnReport { calls: reqs.len(), ..Default::default() };
        for r in reqs {
            let p = parts(r);
            t.turn.add(&p);
            t.per_call.push(p);
            t.phases.push(phase_of(r));
            // Only the agent loop shares a conversation from call to call.
            if !name.starts_with("09-") && !name.starts_with("10-") {
                t.cached_prefix += prev.map_or(0, |a| common_prefix(a, r));
                prev = Some(r);
            }
        }
        out.turns.insert(name.clone(), t);
    }
    for d in defs.as_array().unwrap() {
        out.tools.insert(d["function"]["name"].as_str().unwrap().to_string(), toks_json(d));
    }
    let prompts = crate::prompts::Prompts::new(std::path::Path::new("sin-carpeta"));
    for p in prompts.list() {
        out.prompts.insert(p.name.clone(), toks(&p.default_content));
    }
    out
}

fn print(r: &Report) {
    println!("\n| turno | fases | llamadas | sistema | tools | historial | estado | total turno | prefijo repetido |");
    println!("|---|---|---:|---:|---:|---:|---:|---:|---:|");
    for (name, t) in &r.turns {
        println!("| {name} | {} | {} | {} | {} | {} | {} | {} | {} |", t.phases.join(" → "), t.calls, t.turn.system, t.turn.tools, t.turn.history, t.turn.state, t.turn.total, t.cached_prefix);
    }
    println!("\nPor llamada:");
    for (name, t) in &r.turns {
        for (i, p) in t.per_call.iter().enumerate() {
            println!("  {name} #{i} [{}]: sistema {} · tools {} · historial {} · estado {} · total {}", t.phases[i], p.system, p.tools, p.history, p.state, p.total);
        }
    }
    println!("
Estático (sistema + tools) contra volátil (historial + estado), por turno:");
    for (name, t) in &r.turns {
        let fixed = t.turn.system + t.turn.tools;
        println!("  {name}: estático {fixed} ({:.0} %), volátil {} · prefijo repetido {:.0} %", 100.0 * fixed as f64 / t.turn.total as f64, t.turn.history + t.turn.state, 100.0 * t.cached_prefix as f64 / t.turn.total as f64);
    }
    let mut prompts: Vec<(&String, &u64)> = r.prompts.iter().collect();
    prompts.sort_by(|a, b| b.1.cmp(a.1));
    println!("
Prompts (tokens):");
    for (n, t) in prompts {
        println!("  {n}: {t}");
    }
    let mut tools: Vec<(&String, &u64)> = r.tools.iter().collect();
    tools.sort_by(|a, b| b.1.cmp(a.1));
    println!("\nTools (tokens del JSON):");
    for (n, t) in tools {
        println!("  {n}: {t}");
    }
}

fn baseline_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("bench").join("token_baseline.json")
}

/// Every number of `now` against the same one in `base`: more than 10 % over fails.
fn over_budget(base: &Report, now: &Report) -> Vec<String> {
    let mut bad = Vec::new();
    let mut check = |what: String, b: u64, n: u64| {
        // A small absolute margin so a date in the state (a few tokens) never fails a tiny number.
        if n as f64 > b as f64 * (1.0 + TOLERANCE) + 8.0 {
            bad.push(format!("{what}: {n} > {b} + 10 %"));
        }
    };
    for (name, t) in &now.turns {
        let Some(b) = base.turns.get(name) else {
            check(format!("{name} (no está en la línea base)"), 0, u64::MAX);
            continue;
        };
        check(format!("{name} llamadas"), b.calls as u64, t.calls as u64);
        for (field, bv, nv) in [("sistema", b.turn.system, t.turn.system), ("tools", b.turn.tools, t.turn.tools), ("historial", b.turn.history, t.turn.history), ("estado", b.turn.state, t.turn.state), ("total", b.turn.total, t.turn.total)] {
            check(format!("{name} {field}"), bv, nv);
        }
        for (i, (bp, np)) in b.per_call.iter().zip(&t.per_call).enumerate() {
            check(format!("{name} #{i} total"), bp.total, np.total);
        }
    }
    for (tool, n) in &now.tools {
        check(format!("tool {tool}"), base.tools.get(tool).copied().unwrap_or(0), *n);
    }
    for (prompt, n) in &now.prompts {
        check(format!("prompt {prompt}"), base.prompts.get(prompt).copied().unwrap_or(0), *n);
    }
    bad
}

#[tokio::test]
async fn token_budget() {
    let (turns, defs) = scripted().await;
    let now = report(&turns, &defs);
    print(&now);
    let path = baseline_path();
    if std::env::var_os("TOKEN_BASELINE_UPDATE").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_string_pretty(&now).unwrap() + "\n").unwrap();
        println!("\nLínea base actualizada: {}", path.display());
        return;
    }
    let base: Report = serde_json::from_str(&std::fs::read_to_string(&path).expect("falta bench/token_baseline.json: corré con TOKEN_BASELINE_UPDATE=1")).unwrap();
    let bad = over_budget(&base, &now);
    assert!(bad.is_empty(), "el presupuesto de tokens creció más de 10 %:\n{}\nSi es a propósito: TOKEN_BASELINE_UPDATE=1 cargo test --lib token_budget", bad.join("\n"));
}

/// Inside one turn, each step resends the previous step's request (minus the
/// state) byte for byte, as long as the phase does not change: a prefix cache hits.
#[tokio::test]
async fn the_static_prefix_is_byte_stable_between_steps() {
    let (turns, _) = scripted().await;
    for (name, reqs) in turns.iter().filter(|(n, _)| !n.starts_with("09-") && !n.starts_with("10-")) {
        for w in reqs.windows(2) {
            if phase_of(&w[0]) != phase_of(&w[1]) {
                continue;
            }
            let (a, b) = (messages(&w[0]), messages(&w[1]));
            assert_eq!(w[0]["tools"], w[1]["tools"], "{name}: same phase, same tools in the same order");
            assert_eq!(a[..a.len() - 1], b[..a.len() - 1], "{name}: the history before the state repeats unchanged");
        }
    }
    // Across turns too: same system prompt and tools for the same phase, every time.
    let mut by_phase: BTreeMap<String, (Value, Value)> = BTreeMap::new();
    for r in turns.iter().filter(|(n, _)| !n.starts_with("09-") && !n.starts_with("10-")).flat_map(|(_, r)| r) {
        let key = (messages(r)[0].clone(), r["tools"].clone());
        let seen = by_phase.entry(phase_of(r)).or_insert_with(|| key.clone());
        assert_eq!(*seen, key, "phase {}: system prompt and tools are identical in every turn", phase_of(r));
    }
}

#[test]
fn the_budget_check_catches_growth_and_ignores_noise() {
    let mut base = Report::default();
    base.turns.insert("t".into(), TurnReport { calls: 1, per_call: vec![Parts { total: 1000, ..Default::default() }], turn: Parts { system: 500, total: 1000, ..Default::default() }, ..Default::default() });
    let mut now = Report::default();
    now.turns.insert("t".into(), TurnReport { calls: 1, per_call: vec![Parts { total: 1090, ..Default::default() }], turn: Parts { system: 540, total: 1090, ..Default::default() }, ..Default::default() });
    assert!(over_budget(&base, &now).is_empty(), "+9 % passes");
    now.turns.get_mut("t").unwrap().turn.system = 600;
    assert_eq!(over_budget(&base, &now), vec!["t sistema: 600 > 500 + 10 %".to_string()]);
}
