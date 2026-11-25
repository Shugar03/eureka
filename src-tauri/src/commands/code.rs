//! Code console, multi-file projects, vision and language/speech commands.

use super::{err, CmdResult};
use crate::{agent, language, llm, local_speech, practice, project, runner, vision, AppState};
use tauri::ipc::Channel;
use tauri::State;

// ── Code console (AC-53) ──

async fn runtimes(state: &AppState, refresh: bool) -> Vec<runner::Runtime> {
    let mut cached = state.runtimes.lock().await;
    if refresh || cached.is_none() {
        *cached = Some(runner::detect().await);
    }
    cached.clone().unwrap_or_default()
}

#[tauri::command]
pub async fn code_runtimes(state: State<'_, AppState>, refresh: bool) -> CmdResult<Vec<runner::Runtime>> {
    Ok(runtimes(&state, refresh).await)
}

/// Runs the learner's code. Only the UI calls this (an explicit "Run"); no agent tool can.
#[tauri::command]
pub async fn run_code(state: State<'_, AppState>, lang: runner::Lang, code: String, stdin: String, tests: Option<String>) -> CmdResult<runner::RunResult> {
    let rts = runtimes(&state, false).await;
    // AC-55: "Probar" joins the exercise's tests in the order the language needs.
    let code = match tests.filter(|t| !t.trim().is_empty()) {
        Some(t) => runner::with_tests(lang, &code, &t),
        None => code,
    };
    runner::run(&rts, &state.runs_dir, lang, &code, &stdin).await.map_err(err)
}

/// AC-55: a practice exercise with hidden tests.
#[tauri::command]
pub async fn generate_code_exercise(state: State<'_, AppState>, lang: runner::Lang, topic: String, level: String) -> CmdResult<runner::CodeExercise> {
    if topic.trim().is_empty() {
        return Err("Escribí el tema que querés practicar.".into());
    }
    practice::forced_valid(&state, agent::Role::Practice, "code_exercise", runner::exercise_tool(), runner::EXERCISE_TOOL, runner::exercise_input(lang, &topic, &level), |raw| runner::validate_exercise(raw, lang))
        .await
        .map_err(err)
}

/// One plain answer from the teacher (no tools) with the given prompt.
async fn teacher_answer(state: &AppState, prompt: &str, input: String) -> CmdResult<String> {
    let mut ep = agent::endpoint_for(state, agent::Role::Teacher).await.map_err(err)?;
    ep.usage.purpose = prompt.into();
    let system = state.prompts.get(prompt).map_err(err)?;
    // Code help and speaking feedback are read by the learner (AC-75).
    let input = practice::with_access(state, input);
    let c = llm::stream_chat(&ep, &system, &[llm::Msg::user(input, None)], &serde_json::json!([]), None, |_| {}, || false).await.map_err(err)?;
    let text = c.text.trim().to_string();
    if text.is_empty() {
        return Err("El profesor no respondió. Probá de nuevo.".into());
    }
    Ok(text)
}

/// AC-54: the teacher explains a run's error (or answers about the code).
#[tauri::command]
pub async fn explain_code(state: State<'_, AppState>, lang: runner::Lang, code: String, output: String, ask: String) -> CmdResult<String> {
    teacher_answer(&state, "code_explain", runner::explain_input(lang, &code, &output, &ask)).await
}

/// AC-58: a senior-style review of working code.
#[tauri::command]
pub async fn review_code(state: State<'_, AppState>, lang: runner::Lang, code: String, focus: String) -> CmdResult<String> {
    runner::validate(&code, "").map_err(err)?;
    teacher_answer(&state, "code_review", runner::review_input(lang, &code, &focus)).await
}

/// AC-63: transcribes photos or scanned pages with a vision-capable model.
#[tauri::command]
pub async fn read_images(state: State<'_, AppState>, images: Vec<String>, purpose: String) -> CmdResult<String> {
    vision::read(&state, &images, &purpose).await.map_err(err)
}

// ── Language exams & speech (AC-65, AC-106) ──

#[tauri::command]
pub async fn generate_listening(state: State<'_, AppState>, language: String, level: String, topic: String) -> CmdResult<language::Listening> {
    language::listening(&state, &language, &level, &topic).await.map_err(err)
}

/// Transcribes a recording with the configured speech model.
#[tauri::command]
pub async fn transcribe_audio(state: State<'_, AppState>, audio: Vec<u8>, mime: String, language: String) -> CmdResult<String> {
    let speech = state.settings.load().roles.speech;
    if speech.provider_id == local_speech::PROVIDER {
        return transcribe_local(&state, audio, &mime, language, &speech.model).await.map_err(err);
    }
    language::transcribe(&state, audio, &mime, &language).await.map_err(err)
}

async fn transcribe_local(state: &AppState, audio: Vec<u8>, mime: &str, language: String, model: &str) -> anyhow::Result<String> {
    let info = local_speech::model(model).ok_or_else(|| anyhow::anyhow!("Elegí un modelo de voz local en Ajustes → Modelos → Voz."))?;
    if !mime.starts_with("audio/wav") {
        anyhow::bail!("No pude preparar la grabación para la voz local. Probá de nuevo.");
    }
    let samples = local_speech::wav_samples(&audio)?;
    let (engine, data_dir) = (state.local_speech.clone(), state.data_dir.clone());
    // CPU-heavy: off the async runtime. The model stays loaded for the next dictation.
    tokio::task::spawn_blocking(move || {
        let mut slot = engine.lock().unwrap_or_else(|p| p.into_inner());
        if slot.as_ref().map(|e| e.id) != Some(info.id) {
            *slot = Some(local_speech::Engine::load(&data_dir, info)?);
        }
        let eng = slot.as_mut().ok_or_else(|| anyhow::anyhow!("El motor de voz local no se pudo inicializar."))?;
        eng.transcribe(&samples, &language)
    })
    .await?
}

#[tauri::command]
pub fn local_speech_status(state: State<'_, AppState>) -> Vec<local_speech::ModelStatus> {
    local_speech::status(&state.data_dir)
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub done: u64,
    pub total: u64,
}

#[tauri::command]
pub async fn local_speech_download(state: State<'_, AppState>, model: String, on_progress: Channel<DownloadProgress>) -> CmdResult<Vec<local_speech::ModelStatus>> {
    let info = local_speech::model(&model).ok_or("Ese modelo no existe.")?;
    let mut last = 0u64;
    local_speech::download(&state.data_dir, info, |done, total| {
        // About every 2 MB: enough for a smooth bar without flooding the IPC.
        if done - last >= 2_000_000 || done >= total {
            last = done;
            let _ = on_progress.send(DownloadProgress { done, total });
        }
    })
    .await
    .map_err(err)?;
    Ok(local_speech::status(&state.data_dir))
}

#[tauri::command]
pub fn local_speech_remove(state: State<'_, AppState>, model: String) -> CmdResult<Vec<local_speech::ModelStatus>> {
    let info = local_speech::model(&model).ok_or("Ese modelo no existe.")?;
    let mut slot = state.local_speech.lock().unwrap_or_else(|p| p.into_inner());
    if slot.as_ref().map(|e| e.id) == Some(info.id) {
        *slot = None;
    }
    drop(slot);
    local_speech::remove(&state.data_dir, info).map_err(err)?;
    Ok(local_speech::status(&state.data_dir))
}

/// Feedback on what the learner said (from the transcript).
#[tauri::command]
pub async fn speaking_feedback(state: State<'_, AppState>, input: language::SpeakingInput) -> CmdResult<String> {
    if input.transcript.trim().is_empty() {
        return Err("No hay nada para corregir: grabá tu respuesta primero.".into());
    }
    teacher_answer(&state, "lang_speaking", language::speaking_input(&input)).await
}

// ── Projects (AC-64) ──

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Vec<project::ProjectSummary> {
    state.projects.list()
}

#[tauri::command]
pub fn get_project(state: State<'_, AppState>, id: String) -> CmdResult<project::Project> {
    state.projects.load(&id).map_err(err)
}

#[tauri::command]
pub fn save_project(state: State<'_, AppState>, project: project::Project) -> CmdResult<project::Project> {
    let mut p = project;
    if p.id.trim().is_empty() {
        p.id = uuid::Uuid::new_v4().simple().to_string();
    }
    state.projects.save(&mut p).map_err(err)?;
    Ok(p)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.projects.delete(&id).map_err(err)
}

/// Runs or tests the project's files as they are in the editor (only on the learner's click).
#[tauri::command]
pub async fn run_project(state: State<'_, AppState>, lang: runner::Lang, files: Vec<project::ProjectFile>, mode: project::Mode, stdin: String) -> CmdResult<runner::RunResult> {
    let rts = runtimes(&state, false).await;
    project::run(&rts, &state.runs_dir, lang, &files, mode, &stdin).await.map_err(err)
}

/// A mini project with failing tests, proposed by the teacher (TDD).
#[tauri::command]
pub async fn generate_project(state: State<'_, AppState>, lang: runner::Lang, topic: String, level: String) -> CmdResult<project::Project> {
    if topic.trim().is_empty() {
        return Err("Escribí de qué querés que sea el proyecto.".into());
    }
    let mut p = practice::forced_valid(&state, agent::Role::Practice, "code_project", project::project_tool(), project::PROJECT_TOOL, project::project_input(lang, &topic, &level), |raw| project::validate_project(raw, lang))
        .await
        .map_err(err)?;
    state.projects.save(&mut p).map_err(err)?;
    Ok(p)
}
