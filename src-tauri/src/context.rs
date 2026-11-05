//! What the model is sent each step (harness audit, M1–M4). Pure functions
//! over the persisted history, which is never modified:
//! - old visual payloads and research results are compacted (M1);
//! - a rough token estimate keeps the history within a budget, cutting only
//!   at safe boundaries (M2);
//! - the volatile state goes LAST, as a tagged user message, so the system
//!   prompt + history stay a cacheable prefix (M3).

use crate::llm::Msg;
use serde_json::Value;

/// Default context budget when the model's is unknown (tokens).
pub const DEFAULT_BUDGET: usize = 64_000;
/// Start dropping old messages above this share of the budget.
pub const WINDOW_SHARE: f64 = 0.6;
/// Old messages leave in blocks of about this share (AC-186): the cut stays
/// put for several turns, so the history stays a cacheable prefix.
pub const BLOCK_SHARE: f64 = 0.2;
const CODE_KEEP_LINES: usize = 20;

/// ~3.5 characters per token: rough, but enough to stay far from the limit.
pub fn estimate_tokens(messages: &[Msg]) -> usize {
    let chars: usize = messages
        .iter()
        .map(|m| m.content.as_deref().map_or(0, str::len) + m.tool_calls.iter().flatten().map(|c| c.function.arguments.len() + c.function.name.len()).sum::<usize>() + 8)
        .sum();
    (chars as f64 / 3.5).ceil() as usize
}

/// Index of the last learner input (a user message, or the answer to a question).
fn last_learner(messages: &[Msg]) -> usize {
    messages
        .iter()
        .rposition(|m| m.role == "user" || (m.role == "tool" && m.meta.as_ref().is_some_and(|v| v["kind"] == "answer")))
        .unwrap_or(0)
}

fn kb(s: &str) -> String {
    format!("{} KB", s.len().div_ceil(1024))
}

/// M1: before the learner's last input, demos and diagrams keep only their
/// title, code keeps its first lines, and research results keep the question,
/// first sentence and sources. JSON stays valid; ids are untouched.
pub fn compact(messages: &[Msg]) -> Vec<Msg> {
    let cut = last_learner(messages);
    messages
        .iter()
        .enumerate()
        .map(|(i, m)| {
            if i >= cut {
                return m.clone();
            }
            let mut m = m.clone();
            if let Some(calls) = m.tool_calls.as_mut() {
                for c in calls {
                    let Ok(mut args) = serde_json::from_str::<Value>(&c.function.arguments) else { continue };
                    let changed = match c.function.name.as_str() {
                        "show_demo" => stub(&mut args, "html", "demo ya mostrada"),
                        "show_diagram" => stub(&mut args, "mermaid", "diagrama ya mostrado"),
                        "show_code" => {
                            let code = args["code"].as_str().unwrap_or("").to_string();
                            let lines: Vec<&str> = code.lines().collect();
                            if lines.len() > CODE_KEEP_LINES {
                                args["code"] = Value::String(format!("{}\n# […{} líneas más, ya mostradas]", lines[..CODE_KEEP_LINES].join("\n"), lines.len() - CODE_KEEP_LINES));
                                true
                            } else {
                                false
                            }
                        }
                        _ => false,
                    };
                    if changed {
                        c.function.arguments = args.to_string();
                    }
                }
            }
            // AC-169: research still running keeps its «en curso» line.
            if m.role == "tool" && m.meta.as_ref().is_some_and(|v| v["kind"] == "research" && v["pending"] != true) {
                let meta = m.meta.clone().unwrap_or_default();
                let summary = meta["summary"].as_str().unwrap_or("");
                let first = summary.split_inclusive(". ").next().unwrap_or(summary).trim();
                let urls: Vec<&str> = meta["sources"].as_array().map(|a| a.iter().filter_map(|s| s["url"].as_str()).collect()).unwrap_or_default();
                m.content = Some(format!("Investigación (resumida): {} — {} Fuentes: {}", meta["question"].as_str().unwrap_or(""), first, urls.join(", ")));
            }
            m
        })
        .collect()
}

fn stub(args: &mut Value, field: &str, what: &str) -> bool {
    match args[field].as_str() {
        Some(s) if !s.starts_with("[omitido") => {
            args[field] = Value::String(format!("[omitido: {what}, {}]", kb(s)));
            true
        }
        _ => false,
    }
}

/// M2: keeps the first message (the goal) and the most recent messages that
/// fit in `share` of the budget. The cut never separates an assistant message
/// from its tool results. Returns the messages and how many were left out.
///
/// AC-186: the cut only lands on fixed block marks (every ~`BLOCK_SHARE` of
/// the budget, counted from the start of the history), so it moves once per
/// block instead of every turn, and the «Se omitieron N» note with it.
pub fn window(messages: Vec<Msg>, budget: usize) -> (Vec<Msg>, usize) {
    let limit = (budget as f64 * WINDOW_SHARE) as usize;
    if messages.len() <= 2 || estimate_tokens(&messages) <= limit {
        return (messages, 0);
    }
    let first = messages[0].clone();
    let mut start = messages.len();
    let mut used = estimate_tokens(std::slice::from_ref(&first));
    while start > 1 {
        let cost = estimate_tokens(std::slice::from_ref(&messages[start - 1]));
        if used + cost > limit {
            break;
        }
        used += cost;
        start -= 1;
    }
    // A tool result can't open the window: its assistant message would be missing.
    while start < messages.len() && messages[start].role == "tool" {
        start += 1;
    }
    // The first block mark at or after the cut that fits; none: the tight cut.
    if let Some(mark) = block_marks(&messages, budget).into_iter().find(|&m| m >= start) {
        start = mark;
    }
    let dropped = start - 1;
    if dropped == 0 {
        return (messages, 0);
    }
    let mut out = vec![first, Msg::user(format!("<nota_app>Se omitieron {dropped} mensajes anteriores de esta sesión para no exceder el contexto. El plan, el diagnóstico y «Lo que pasó antes» en el estado resumen lo importante.</nota_app>"), None)];
    out.extend(messages.into_iter().skip(start));
    (out, dropped)
}

/// Safe cut points (never a tool result, never the last message) each time the
/// history since the goal passes another `BLOCK_SHARE` of the budget. They
/// depend only on what comes before them, so new messages never move them.
fn block_marks(messages: &[Msg], budget: usize) -> Vec<usize> {
    let block = ((budget as f64 * BLOCK_SHARE) as usize).max(1);
    let mut marks = Vec::new();
    let mut acc = 0;
    let mut next = block;
    for i in 1..messages.len() {
        if acc >= next && messages[i].role != "tool" {
            marks.push(i);
            next = acc + block;
        }
        acc += estimate_tokens(std::slice::from_ref(&messages[i]));
    }
    marks
}

/// Re-summarize only once this many new messages left the window.
pub const SUMMARY_EVERY: usize = 6;
pub const SUMMARY_TOOL: &str = "submit_summary";

pub fn summary_tool() -> Value {
    serde_json::json!({ "type": "function", "function": {
        "name": SUMMARY_TOOL,
        "description": "Entrega el resumen actualizado de lo que pasó antes en la sesión.",
        "parameters": { "type": "object", "properties": {
            "summary": { "type": "string", "description": "Viñetas cortas (máximo 12)." }
        }, "required": ["summary"] }
    }})
}

/// The summarizer's input: the previous summary plus the newly dropped messages.
pub fn summary_input(previous: &str, dropped: &[Msg]) -> String {
    let mut out = String::new();
    if !previous.trim().is_empty() {
        out.push_str(&format!("## Resumen anterior\n{}\n\n", previous.trim()));
    }
    out.push_str("## Mensajes nuevos\n");
    for m in dropped {
        let text: String = m.content.as_deref().unwrap_or("").chars().take(600).collect();
        let who = match m.role.as_str() {
            "user" => "Aprendiz",
            "assistant" => "Tutor",
            _ => "Resultado",
        };
        if !text.trim().is_empty() {
            out.push_str(&format!("{who}: {}\n", text.trim()));
        }
        for c in m.tool_calls.iter().flatten() {
            let args: Value = serde_json::from_str(&c.function.arguments).unwrap_or_default();
            if let Some(q) = args["question"].as_str() {
                out.push_str(&format!("Tutor (pregunta): {q}\n"));
            }
        }
    }
    out
}

pub fn parse_summary(raw: &str) -> anyhow::Result<String> {
    let v: Value = serde_json::from_str(raw)?;
    let s = v["summary"].as_str().unwrap_or("").trim().to_string();
    if s.is_empty() {
        anyhow::bail!("el resumen llegó vacío");
    }
    Ok(s.chars().take(3000).collect())
}

/// M3: the state block as the last message, marked as written by the app.
pub fn state_message(block: &str) -> Msg {
    Msg::user(format!("<estado_app>\n(Este bloque lo genera la app en cada paso; no lo escribió el aprendiz.)\n\n{block}\n</estado_app>"), None)
}

/// M4: a nudge when the turn is about to hit the step cap.
pub fn steps_note(step: usize, max: usize) -> Option<String> {
    let left = max.saturating_sub(step + 1);
    (left <= 2).then(|| format!("\n## Pasos\nTe quedan {left} pasos en este turno: cerrá con `ask_question` o con un mensaje para el aprendiz.\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{FunctionCall, ToolCall};
    use serde_json::json;

    fn call(id: &str, name: &str, args: Value) -> ToolCall {
        ToolCall { id: id.into(), kind: "function".into(), function: FunctionCall { name: name.into(), arguments: args.to_string() } }
    }

    fn assistant(calls: Vec<ToolCall>) -> Msg {
        Msg { role: "assistant".into(), content: None, tool_calls: Some(calls), tool_call_id: None, meta: None }
    }

    #[test]
    fn old_payloads_are_stubbed_but_the_latest_turn_is_intact() {
        let code: String = (1..=30).map(|i| format!("print({i})\n")).collect();
        let msgs = vec![
            Msg::user("Quiero entender: x", None),
            assistant(vec![call("d1", "show_demo", json!({ "title": "D", "html": "x".repeat(5000) })), call("c1", "show_code", json!({ "title": "C", "language": "python", "code": code }))]),
            Msg::tool("d1", "demo mostrada", None),
            Msg::tool("c1", "código mostrado", None),
            Msg::tool("r1", "Investigación larga…", Some(json!({ "kind": "research", "question": "¿q?", "summary": "Primera. Segunda oración larga.", "sources": [{ "title": "T", "url": "https://a.example" }] }))),
            Msg::user("sigo", None),
            assistant(vec![call("d2", "show_demo", json!({ "title": "D2", "html": "y".repeat(5000) }))]),
        ];
        let out = compact(&msgs);
        let demo: Value = serde_json::from_str(&out[1].tool_calls.as_ref().unwrap()[0].function.arguments).unwrap();
        assert_eq!(demo["html"], "[omitido: demo ya mostrada, 5 KB]");
        assert_eq!(demo["title"], "D", "title kept");
        let c: Value = serde_json::from_str(&out[1].tool_calls.as_ref().unwrap()[1].function.arguments).unwrap();
        assert!(c["code"].as_str().unwrap().starts_with("print(1)\n") && c["code"].as_str().unwrap().ends_with("[…10 líneas más, ya mostradas]"));
        assert_eq!(out[4].content.as_deref(), Some("Investigación (resumida): ¿q? — Primera. Fuentes: https://a.example"));
        assert_eq!(out[4].tool_call_id, msgs[4].tool_call_id, "pairing kept");
        assert_eq!(out[6].tool_calls.as_ref().unwrap()[0].function.arguments, msgs[6].tool_calls.as_ref().unwrap()[0].function.arguments, "after the last learner input: untouched");
        assert!(estimate_tokens(&out) + 1000 < estimate_tokens(&msgs), "the old demo no longer weighs");
        // An answer to a question also counts as the learner's input.
        let answered = vec![assistant(vec![call("d", "show_diagram", json!({ "title": "G", "mermaid": "graph TD; A-->B" }))]), Msg::tool("q", "sí", Some(json!({ "kind": "answer" })))];
        let a: Value = serde_json::from_str(&compact(&answered)[0].tool_calls.as_ref().unwrap()[0].function.arguments).unwrap();
        assert!(a["mermaid"].as_str().unwrap().starts_with("[omitido: diagrama"));
    }

    #[test]
    fn the_window_keeps_the_goal_and_recent_messages_without_orphan_tool_results() {
        let mut msgs = vec![Msg::user("Quiero entender: x", None)];
        for i in 0..40 {
            msgs.push(assistant(vec![call(&format!("c{i}"), "record_finding", json!({ "concept": "z".repeat(400) }))]));
            msgs.push(Msg::tool(&format!("c{i}"), "ok", None));
        }
        let total = estimate_tokens(&msgs);
        let (out, dropped) = window(msgs.clone(), total); // budget = total → keep 60 %
        assert!(dropped > 0);
        assert_eq!(out[0].content, msgs[0].content);
        assert!(out[1].content.as_deref().unwrap().contains(&format!("Se omitieron {dropped} mensajes")));
        assert_eq!(out[2].role, "assistant", "never starts with an orphan tool result");
        assert!(estimate_tokens(&out) <= (total as f64 * 0.62) as usize);
        assert_eq!(window(msgs.clone(), total * 10).1, 0, "fits: nothing dropped");
    }

    #[test]
    fn the_window_moves_in_blocks_so_consecutive_turns_share_the_prefix() {
        let mut msgs = vec![Msg::user("Quiero entender: x", None)];
        let budget = 20_000;
        let limit = (budget as f64 * WINDOW_SHARE) as usize;
        let mut cuts = Vec::new();
        for i in 0..200 {
            msgs.push(Msg::user(format!("pregunta {i} {}", "p".repeat(200)), None));
            msgs.push(assistant(vec![call(&format!("c{i}"), "record_finding", json!({ "concept": "z".repeat(600) }))]));
            msgs.push(Msg::tool(&format!("c{i}"), "ok", None));
            let (out, dropped) = window(msgs.clone(), budget);
            assert!(estimate_tokens(&out) <= limit + 100, "the 60 % ceiling holds");
            assert_ne!(out[2].role, "tool", "still cut at a safe boundary");
            cuts.push(dropped);
        }
        let moves = cuts.windows(2).filter(|w| w[0] != w[1]).count();
        let tight = cuts.iter().filter(|&&d| d > 0).count();
        assert!(moves * 8 < tight, "the cut moves once per block ({moves} moves in {tight} turns over budget)");
        // Between moves, the kept history is the same prefix plus the new messages.
        let (a, da) = window(msgs[..msgs.len() - 3].to_vec(), budget);
        let (b, db) = window(msgs.clone(), budget);
        if da == db {
            assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b[..a.len()]).unwrap());
        }
    }

    #[test]
    fn state_and_steps_notes() {
        let m = state_message("# Estado");
        assert_eq!(m.role, "user");
        assert!(m.content.as_deref().unwrap().starts_with("<estado_app>") && m.content.as_deref().unwrap().ends_with("</estado_app>"));
        assert_eq!(steps_note(0, 12), None);
        assert!(steps_note(9, 12).unwrap().contains("Te quedan 2 pasos"));
        assert!(steps_note(11, 12).unwrap().contains("Te quedan 0 pasos"));
    }
}
