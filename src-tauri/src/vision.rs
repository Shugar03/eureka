//! Reading images (AC-63): photos of notes or whiteboards and scanned PDF
//! pages (rendered to images in the UI) are transcribed by a vision-capable
//! model through the same OpenAI-compatible endpoint (`image_url` parts).

use crate::agent::{endpoint_for, Role};
use crate::llm::Endpoint;
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};

pub const MAX_IMAGES: usize = 8;
/// Per image, as a base64 data URL.
pub const MAX_IMAGE_CHARS: usize = 8 * 1024 * 1024;
const TYPES: [&str; 3] = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"];

pub fn validate(images: &[String]) -> Result<()> {
    if images.is_empty() {
        bail!("Elegí al menos una imagen.");
    }
    if images.len() > MAX_IMAGES {
        bail!("Como mucho {MAX_IMAGES} imágenes por vez.");
    }
    for img in images {
        if !TYPES.iter().any(|t| img.starts_with(t)) {
            bail!("Solo imágenes PNG, JPG o WebP.");
        }
        if img.len() > MAX_IMAGE_CHARS {
            bail!("Una de las imágenes es demasiado grande.");
        }
    }
    Ok(())
}

/// The request: one user message with the instruction and every image.
pub fn body(model: &str, system: &str, instruction: &str, images: &[String]) -> Value {
    let mut content = vec![json!({ "type": "text", "text": instruction })];
    content.extend(images.iter().map(|url| json!({ "type": "image_url", "image_url": { "url": url } })));
    json!({
        "model": model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": content }],
        "stream": false
    })
}

pub fn instruction(purpose: &str) -> String {
    let what = match purpose {
        "guide" => "la guía oficial o el programa de un examen o materia",
        "notes" => "apuntes del aprendiz",
        // AC-151: a grid read left to right loses which column is which day.
        "timetable" => {
            return "Estas imágenes son un horario de cursada o un calendario de fechas. No transcribas la grilla de corrido:                     escribí una línea por cada bloque de clase con día, hora de inicio a fin, materia, aula y docente si figuran                     (por ejemplo «Lunes 10:00 a 12:00 · Análisis I · Aula 3 · Prof. Pérez»), y una línea por cada fecha                     (parcial, final, entrega) con su día. Seguí las reglas."
                .into()
        }
        // AC-173: whole exercises, with their data and any answer the guide gives.
        "problems" => {
            return "Estas imágenes son una guía de ejercicios, un examen o problemas copiados. Transcribí cada ejercicio completo y en orden,                     con su número o letra como figura, todos sus datos y las fórmulas con $…$; si hay una figura, describila en una línea                     como [Figura: …]. Si la guía trae la respuesta o el resultado de un ejercicio, escribilo debajo como «Respuesta: …». Seguí las reglas."
                .into()
        }
        // AC-155: one line per subject keeps its year and its correlativas together.
        "curriculum" => {
            return "Estas imágenes son el plan de estudios de una carrera. Escribí una línea por materia con año (y cuatrimestre),                     código, nombre y sus correlativas tal como figuran (para cursar y para rendir, si las distingue). Seguí las reglas."
                .into()
        }
        _ => "un documento",
    };
    format!("Estas imágenes son {what}. Transcribilas en orden, siguiendo las reglas.")
}

/// The text of `choices[0].message.content` (a string, or text parts).
pub fn parse_text(v: &Value) -> Result<String> {
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        bail!("el proveedor respondió: {msg}");
    }
    let c = v.pointer("/choices/0/message/content").ok_or_else(|| anyhow!("el modelo no devolvió texto"))?;
    let text = match c {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(""),
        _ => String::new(),
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        bail!("No pude leer texto en las imágenes. ¿El modelo del Profesor acepta imágenes?");
    }
    Ok(text)
}

async fn call(ep: &Endpoint, body: &Value) -> Result<String> {
    let resp = crate::llm::client()?
        .post(format!("{}/chat/completions", ep.base_url.trim_end_matches('/')))
        .bearer_auth(&ep.api_key)
        // OpenCode Go rejects requests without it (MissingSessionID).
        .header("x-opencode-session", &ep.session)
        .header("x-api-key", &ep.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(body)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .context("no se pudo conectar con el proveedor")?;
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
        bail!("el proveedor respondió {status}: {msg} (¿el modelo del Profesor acepta imágenes?)");
    }
    parse_text(&v)
}

pub async fn read(state: &AppState, images: &[String], purpose: &str) -> Result<String> {
    validate(images)?;
    let ep = endpoint_for(state, Role::Teacher).await?;
    let system = state.prompts.get("vision_transcribe")?;
    let text = call(&ep, &body(&ep.model, &system, &instruction(purpose), images)).await?;
    Ok(crate::extract::truncate(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";

    #[test]
    fn images_are_validated() {
        assert!(validate(&[]).is_err());
        assert!(validate(&[PNG.into()]).is_ok());
        assert!(validate(&["data:image/gif;base64,R0lG".into()]).is_err());
        assert!(validate(&["https://evil.example/x.png".into()]).is_err(), "only inline images, never URLs");
        assert!(validate(&vec![PNG.to_string(); MAX_IMAGES + 1]).is_err());
        assert!(validate(&[format!("data:image/jpeg;base64,{}", "A".repeat(MAX_IMAGE_CHARS))]).is_err());
    }

    #[test]
    fn the_request_carries_every_image_after_the_instruction() {
        let b = body("gpt-x", "sys", &instruction("guide"), &[PNG.into(), PNG.into()]);
        assert_eq!(b["stream"], false);
        assert_eq!(b["messages"][0]["content"], "sys");
        let parts = b["messages"][1]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 3);
        assert!(parts[0]["text"].as_str().unwrap().contains("guía oficial"));
        assert_eq!(parts[1]["image_url"]["url"], PNG);
    }

    #[test]
    fn a_timetable_is_read_block_by_block_and_a_curriculum_subject_by_subject() {
        let t = instruction("timetable");
        assert!(t.contains("una línea por cada bloque") && t.contains("No transcribas la grilla de corrido"), "{t}");
        assert!(instruction("curriculum").contains("una línea por materia"));
        assert!(instruction("anything").contains("un documento"));
    }

    #[test]
    fn text_comes_from_a_string_or_text_parts() {
        assert_eq!(parse_text(&json!({ "choices": [{ "message": { "content": " Dominio 1 " } }] })).unwrap(), "Dominio 1");
        assert_eq!(parse_text(&json!({ "choices": [{ "message": { "content": [{ "type": "text", "text": "a" }, { "type": "text", "text": "b" }] } }] })).unwrap(), "ab");
        assert!(parse_text(&json!({ "choices": [{ "message": { "content": "  " } }] })).unwrap_err().to_string().contains("acepta imágenes"));
        assert!(parse_text(&json!({ "error": { "message": "no vision" } })).unwrap_err().to_string().contains("no vision"));
    }
}
