//! Language exams (AC-65): listening passages read aloud by the UI (the
//! system's voices) with multiple-choice questions, and speaking: the
//! learner's recording is transcribed by a speech model
//! (`/audio/transcriptions`) and the teacher gives feedback on the text.

use crate::agent::{endpoint_for, Role};
use crate::exam::{validate_questions, Exam, ExamGoal, ExamKind, Question};
use crate::practice::forced_valid;
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const LISTENING_TOOL: &str = "set_listening";
pub const MAX_AUDIO: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Listening {
    pub title: String,
    /// Read aloud by the app; shown after answering.
    pub transcript: String,
    pub questions: Vec<Question>,
}

pub fn listening_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": LISTENING_TOOL,
        "description": "Entrega el ejercicio de listening.",
        "parameters": { "type": "object", "properties": {
            "title": { "type": "string" },
            "transcript": { "type": "string", "description": "El texto que se va a leer en voz alta, en el idioma practicado." },
            "questions": { "type": "array", "items": { "type": "object", "properties": {
                "stem": { "type": "string" },
                "options": { "type": "array", "items": { "type": "string" } },
                "answer": { "type": "array", "items": { "type": "integer" } },
                "explanation": { "type": "string" }
            }, "required": ["stem", "options", "answer", "explanation"] } }
        }, "required": ["title", "transcript", "questions"] }
    }})
}

pub fn listening_input(language: &str, level: &str, topic: &str) -> String {
    let topic = if topic.trim().is_empty() { "un tema cotidiano" } else { topic.trim() };
    format!("Idioma: {}\nNivel (MCER): {}\nTema: {topic}\n", language.trim(), level.trim())
}

/// Reuses the mock-exam validation (one pseudo-domain) for the questions.
pub fn validate_listening(raw: &str) -> Result<Listening> {
    let v: Value = serde_json::from_str(raw).context("el autor del listening devolvió datos inválidos")?;
    let title = v["title"].as_str().unwrap_or("").trim().to_string();
    let transcript = v["transcript"].as_str().unwrap_or("").trim().to_string();
    if title.is_empty() || transcript.split_whitespace().count() < 20 {
        bail!("El audio llegó incompleto. Probá de nuevo.");
    }
    let qs: Vec<Value> = v["questions"].as_array().cloned().unwrap_or_default().into_iter().map(|mut q| {
        q["domain_id"] = json!("l");
        q
    }).collect();
    let pseudo = Exam {
        id: "l".into(),
        name: title.clone(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        domains: vec![crate::exam::Domain { id: "l".into(), name: "Listening".into(), weight: 100.0, topics: vec![] }],
        mocks: vec![],
        review: vec![],
        goal: ExamGoal::default(),
        cheat_sheet: None,
        kind: ExamKind::Certification,
        schedule: vec![],
        lang: None,
    };
    let questions = validate_questions(&json!({ "questions": qs }).to_string(), &pseudo, 10)?;
    Ok(Listening { title, transcript, questions })
}

pub async fn listening(state: &AppState, language: &str, level: &str, topic: &str) -> Result<Listening> {
    forced_valid(state, Role::Practice, "lang_listening", listening_tool(), LISTENING_TOOL, listening_input(language, level, topic), validate_listening).await
}

/// Accepted recordings (what MediaRecorder and common uploads produce).
pub fn audio_ext(mime: &str) -> Option<&'static str> {
    Some(match mime.split(';').next().unwrap_or("").trim() {
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        _ => return None,
    })
}

pub fn parse_transcription(v: &Value) -> Result<String> {
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        bail!("el servicio de voz respondió: {msg}");
    }
    let text = v["text"].as_str().unwrap_or("").trim().to_string();
    if text.is_empty() {
        bail!("No se entendió nada en la grabación. Probá hablar más cerca del micrófono.");
    }
    Ok(text)
}

pub async fn transcribe(state: &AppState, audio: Vec<u8>, mime: &str, language: &str) -> Result<String> {
    if audio.is_empty() || audio.len() > MAX_AUDIO {
        bail!("La grabación está vacía o es demasiado larga.");
    }
    let ext = audio_ext(mime).ok_or_else(|| anyhow!("Formato de audio no soportado ({mime})."))?;
    let ep = endpoint_for(state, Role::Speech).await?;
    let part = reqwest::multipart::Part::bytes(audio).file_name(format!("grabacion.{ext}")).mime_str(mime.split(';').next().unwrap_or("audio/webm"))?;
    let mut form = reqwest::multipart::Form::new().text("model", ep.model.clone()).part("file", part);
    if let Some(code) = iso_code(language) {
        form = form.text("language", code);
    }
    let resp = crate::llm::client()?
        .post(format!("{}/audio/transcriptions", ep.base_url.trim_end_matches('/')))
        .bearer_auth(&ep.api_key)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .context("no se pudo conectar con el servicio de voz")?;
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!("el servicio de voz respondió {status}: {}", v.pointer("/error/message").and_then(Value::as_str).unwrap_or(""));
    }
    parse_transcription(&v)
}

/// ISO 639-1 for the transcription hint.
pub fn iso_code(language: &str) -> Option<&'static str> {
    match language.trim().to_lowercase().as_str() {
        "inglés" | "ingles" | "english" => Some("en"),
        "portugués" | "portugues" => Some("pt"),
        "francés" | "frances" => Some("fr"),
        "alemán" | "aleman" => Some("de"),
        "italiano" => Some("it"),
        "español" => Some("es"),
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpeakingInput {
    pub language: String,
    pub level: String,
    pub task: String,
    pub transcript: String,
    pub seconds: f64,
}

pub fn speaking_input(s: &SpeakingInput) -> String {
    let words = s.transcript.split_whitespace().count();
    let wpm = if s.seconds > 0.0 { (words as f64 * 60.0 / s.seconds).round() } else { 0.0 };
    format!(
        "Idioma: {}\nNivel objetivo (MCER): {}\n\n## Consigna\n{}\n\n## Transcripción automática de lo que dijo ({words} palabras en {:.0} s ≈ {wpm} palabras por minuto)\n{}\n",
        s.language.trim(),
        s.level.trim(),
        s.task.trim(),
        s.seconds,
        s.transcript.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listening_is_validated_like_a_mock() {
        let long = "word ".repeat(25);
        let raw = json!({ "title": " A call ", "transcript": long, "questions": [
            { "stem": "Who called?", "options": ["Ann", "Bob", "Carl"], "answer": [1], "explanation": "Bob says hi." },
            { "stem": "Bad", "options": ["x"], "answer": [0], "explanation": "" }
        ]}).to_string();
        let l = validate_listening(&raw).unwrap();
        assert_eq!((l.title.as_str(), l.questions.len(), l.questions[0].answer.clone()), ("A call", 1, vec![1]));
        assert!(validate_listening(&json!({ "title": "x", "transcript": "too short", "questions": [] }).to_string()).is_err());
        assert_eq!(listening_input("inglés", "B2", " "), "Idioma: inglés\nNivel (MCER): B2\nTema: un tema cotidiano\n");
    }

    #[test]
    fn audio_formats_and_transcriptions() {
        assert_eq!(audio_ext("audio/webm;codecs=opus"), Some("webm"));
        assert_eq!(audio_ext("audio/wav"), Some("wav"));
        assert_eq!(audio_ext("video/mp4"), None);
        assert_eq!(parse_transcription(&json!({ "text": " I like trains. " })).unwrap(), "I like trains.");
        assert!(parse_transcription(&json!({ "text": "" })).is_err());
        assert!(parse_transcription(&json!({ "error": { "message": "bad model" } })).unwrap_err().to_string().contains("bad model"));
        assert_eq!((iso_code("Inglés"), iso_code("klingon")), (Some("en"), None));
    }

    #[test]
    fn speaking_input_counts_words_per_minute() {
        let s = SpeakingInput { language: "inglés".into(), level: "B2".into(), task: "Describe your weekend.".into(), transcript: "I go to the park and I play football".into(), seconds: 6.0 };
        let t = speaking_input(&s);
        assert!(t.contains("(9 palabras en 6 s ≈ 90 palabras por minuto)"), "{t}");
        assert!(t.contains("## Consigna\nDescribe your weekend."));
    }
}
