//! The extractor role (Phase 2): turns a finished session (or pasted notes)
//! into propositions and chains, validated and appended to the graph ledger.

use crate::agent::Role;
use crate::graph::{validate, Extraction, GraphView, RawExtraction, Source};

use crate::session::Session;
use crate::AppState;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub const TOOL: &str = "record_knowledge";
/// Keep the request bounded for long sessions or huge notes.
const MAX_INPUT_CHARS: usize = 60_000;

pub fn tool_def() -> Value {
    json!({ "type": "function", "function": {
        "name": TOOL,
        "description": "Guarda las proposiciones y cadenas de razonamiento extraídas.",
        "parameters": {
            "type": "object",
            "properties": {
                "propositions": { "type": "array", "items": {
                    "type": "object",
                    "properties": { "key": { "type": "string" }, "text": { "type": "string" } },
                    "required": ["key", "text"]
                }},
                "chains": { "type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "premises": { "type": "array", "items": { "type": "string" } },
                        "conclusion": { "type": "string" }
                    },
                    "required": ["premises", "conclusion"]
                }},
                "misconceptions": { "type": "array", "description": "Confusiones que mostró el aprendiz (solo sesiones), reparadas o no.", "items": {
                    "type": "object",
                    "properties": {
                        "concept": { "type": "string" },
                        "wrong_idea": { "type": "string", "description": "Lo que creía, en una frase" },
                        "fixed": { "type": "boolean", "description": "Si quedó reparada en la sesión" }
                    },
                    "required": ["concept", "wrong_idea", "fixed"]
                }},
                "preferences": { "type": "array", "items": { "type": "string" }, "description": "Cómo aprende mejor (ej.: 'con ejemplos numéricos'), solo si se notó claramente." }
            },
            "required": ["propositions", "chains"]
        }
    }})
}

/// A readable record of the session for the extractor: goal, plan with final
/// statuses, and the conversation with questions and the learner's answers.
pub fn session_transcript(s: &Session) -> String {
    let mut out = format!("# Sesión: {}\n\nObjetivo del aprendiz: {}\n\n## Plan final\n", s.title, s.goal);
    for n in &s.plan {
        let status = format!("{:?}", n.status).to_lowercase();
        out.push_str(&format!("- [{status}] {} — {}", n.title, n.summary));
        if !n.note.is_empty() {
            out.push_str(&format!(" (nota: {})", n.note));
        }
        out.push('\n');
    }
    if !s.findings.is_empty() {
        out.push_str("\n## Diagnóstico inicial\n");
        for f in &s.findings {
            out.push_str(&format!("- {} → {:?}: {}\n", f.concept, f.level, f.evidence));
        }
    }
    out.push_str("\n## Conversación\n");
    for m in &s.messages {
        match m.role.as_str() {
            "user" => out.push_str(&format!("\nAprendiz: {}\n", m.content.as_deref().unwrap_or(""))),
            "assistant" => {
                if let Some(t) = m.content.as_deref().filter(|t| !t.trim().is_empty()) {
                    out.push_str(&format!("\nProfesor: {t}\n"));
                }
                for c in m.tool_calls.iter().flatten().filter(|c| c.function.name == "ask_question") {
                    let args: Value = serde_json::from_str(&c.function.arguments).unwrap_or_default();
                    out.push_str(&format!("\nProfesor pregunta: {}\n", args["question"].as_str().unwrap_or("")));
                }
            }
            // Only learner answers matter; tool acks ("ok") are noise.
            // Only the learner's answers; tool acks and web research are not what they said.
            "tool" if m.meta.as_ref().is_some_and(|v| v["kind"] == "answer") => out.push_str(&format!("{}\n", m.content.as_deref().unwrap_or(""))),
            _ => {}
        }
    }
    truncate_keeping_tail(out)
}

/// Long sessions: the end is what was understood, so keep the head (goal,
/// plan) and the TAIL of the conversation (audit M8).
fn truncate_keeping_tail(s: String) -> String {
    if s.len() <= MAX_INPUT_CHARS {
        return s;
    }
    let head_len = s.find("\n## Conversación\n").map_or(0, |i| i + "\n## Conversación\n".len()).min(MAX_INPUT_CHARS / 3);
    let mut head_end = head_len;
    while !s.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let keep = MAX_INPUT_CHARS - head_end - 40;
    let mut tail_start = s.len() - keep;
    while !s.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    format!("{}\n[…recortado el principio de la conversación]\n{}", &s[..head_end], &s[tail_start..])
}

pub fn truncate(mut s: String) -> String {
    if s.len() > MAX_INPUT_CHARS {
        let mut cut = MAX_INPUT_CHARS;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("\n[…recortado]");
    }
    s
}

/// Parses the forced tool call out of a completion (kept for its test).
#[cfg(test)]
pub fn parse_completion(calls: &[crate::llm::ToolCall]) -> Result<RawExtraction> {
    let call = calls.iter().find(|c| c.function.name == TOOL).ok_or_else(|| anyhow!("el extractor no devolvió {TOOL}"))?;
    serde_json::from_str(&call.function.arguments).map_err(|e| anyhow!("el extractor devolvió datos inválidos: {e}"))
}

/// Runs the extractor and appends the result. The ledger is untouched on error.
pub async fn extract(state: &AppState, source: Source, input: String) -> Result<(GraphView, usize, usize)> {
    let (raw, args) = crate::practice::forced_valid(state, Role::Extractor, "extract", tool_def(), TOOL, truncate(input), |raw| {
        let parsed: RawExtraction = serde_json::from_str(raw).map_err(|e| anyhow!("el extractor devolvió datos inválidos: {e}"))?;
        // Validate now so a bad answer gets its one retry; validated again below.
        validate(parsed.clone()).map_err(|e| anyhow!(e))?;
        Ok((parsed, raw.to_string()))
    })
    .await?;
    // Audit M5: confusions and preferences go to the learner profile (same call, no extra cost).
    if let Source::Session { title, .. } = &source {
        if let Ok(args) = serde_json::from_str::<Value>(&args) {
            let _ = state.learner.update(|p| crate::learner::merge_extraction(p, &args, &format!("Sesión: {title}")));
        }
    }
    let (propositions, chains) = validate(raw).map_err(|e| anyhow!(e))?;
    let counts = (propositions.len(), chains.len());
    let at = chrono::Utc::now();
    // AC-196: the same result in the student's memory, under stable topics (no extra call).
    let extra = if matches!(source, Source::Session { .. }) { serde_json::from_str::<Value>(&args).unwrap_or_default() } else { Value::Null };
    if let Err(e) = state.memdb.record_extraction(&source, &propositions, &chains, &extra, at) {
        eprintln!("memoria del estudiante: {e}");
    }
    state.graph.append(&Extraction { source, at, propositions, chains })?;
    Ok((state.graph.view(), counts.0, counts.1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{FunctionCall, Msg, ToolCall};
    use crate::tools::{add_learner_input, apply, LearnerInput};

    #[test]
    fn transcript_has_goal_plan_questions_and_answers_but_no_acks() {
        let mut s = Session::new("qué es una derivada");
        let ask = ToolCall {
            id: "q1".into(),
            kind: "function".into(),
            function: FunctionCall { name: "ask_question".into(), arguments: json!({ "question": "¿Qué es la pendiente?", "purpose": "probe" }).to_string() },
        };
        s.messages.push(Msg { role: "assistant".into(), content: Some("Veamos.".into()), tool_calls: Some(vec![ask.clone()]), tool_call_id: None, meta: None });
        apply(&mut s, &ask);
        add_learner_input(&mut s, LearnerInput { text: "cuánto sube".into(), confidence: Some(4), ..Default::default() });
        s.messages.push(Msg::tool("x", "ok", None));

        let t = session_transcript(&s);
        assert!(t.contains("Objetivo del aprendiz: qué es una derivada"));
        assert!(t.contains("Profesor: Veamos."));
        assert!(t.contains("Profesor pregunta: ¿Qué es la pendiente?"));
        assert!(t.contains("Respuesta del aprendiz: cuánto sube"));
        assert!(!t.lines().any(|l| l.trim() == "ok"));
    }

    #[test]
    fn long_sessions_keep_the_end_of_the_conversation() {
        let mut s = Session::new("x");
        s.messages.push(Msg::user("PRIMERO", None));
        for i in 0..4000 {
            s.messages.push(Msg::user(format!("línea {i} ñ"), None));
        }
        s.messages.push(Msg::user("ÚLTIMO", None));
        s.messages.push(Msg::tool("r", "Investigación: algo de la web", Some(json!({ "kind": "research" }))));
        let t = session_transcript(&s);
        assert!(t.len() <= MAX_INPUT_CHARS + 60);
        assert!(t.contains("Objetivo del aprendiz: x"), "the head stays");
        assert!(t.contains("ÚLTIMO") && !t.contains("PRIMERO"), "the tail stays");
        assert!(t.contains("[…recortado el principio"));
        assert!(!t.contains("algo de la web"), "research is not the learner's");
    }

    #[test]
    fn long_inputs_are_truncated_on_a_char_boundary() {
        let t = truncate("ñ".repeat(MAX_INPUT_CHARS));
        assert!(t.ends_with("[…recortado]"));
        assert!(t.len() <= MAX_INPUT_CHARS + 20);

        // The cut lands inside a two-byte char: it must back off by one byte.
        let t = truncate(format!("a{}", "ñ".repeat(MAX_INPUT_CHARS)));
        assert_eq!(t.len(), MAX_INPUT_CHARS - 1 + "\n[…recortado]".len());

        let exact = "a".repeat(MAX_INPUT_CHARS);
        assert_eq!(truncate(exact.clone()), exact, "at the limit nothing is cut");
    }

    #[test]
    fn plan_notes_appear_only_when_present() {
        let mut s = Session::new("x");
        for (id, note) in [("a", "repasar"), ("b", "")] {
            s.plan.push(crate::session::PlanNode {
                id: id.into(),
                title: id.into(),
                summary: String::new(),
                depends_on: vec![],
                status: crate::session::NodeStatus::Pending,
                note: note.into(),
            });
        }
        let t = session_transcript(&s);
        assert!(t.contains("(nota: repasar)"));
        assert_eq!(t.matches("(nota:").count(), 1);
    }

    #[test]
    fn parse_requires_the_tool_and_valid_json() {
        let call = |name: &str, args: &str| ToolCall { id: "c".into(), kind: "function".into(), function: FunctionCall { name: name.into(), arguments: args.into() } };
        assert!(parse_completion(&[]).is_err());
        assert!(parse_completion(&[call("otra", "{}")]).is_err());
        assert!(parse_completion(&[call(TOOL, "{roto")]).is_err());
        let ok = parse_completion(&[call(TOOL, r#"{"propositions":[{"key":"a","text":"A"}],"chains":[]}"#)]).unwrap();
        assert_eq!(ok.propositions.len(), 1);
    }
}
