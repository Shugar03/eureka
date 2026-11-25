//! Companion, Mi cursada (academic), career plan (malla), classes and study log.

use super::{err, CmdResult};
use crate::{academic, activity, agent, career, classes, companion, exam, practice, study, AppState};
use tauri::State;

// ── Acompañamiento (AC-82..88) ──

#[tauri::command]
pub fn companion_state(state: State<'_, AppState>) -> companion::View {
    state.companion.view()
}

#[tauri::command]
pub fn companion_ack_privacy(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.ack_privacy().map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub async fn companion_send(state: State<'_, AppState>, text: String) -> CmdResult<companion::View> {
    companion::send(&state, &text).await.map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_new_conversation(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.new_conversation().map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub async fn companion_propose_entry(state: State<'_, AppState>) -> CmdResult<companion::EntryInput> {
    companion::propose_entry(&state).await.map_err(err)
}

#[tauri::command]
pub fn companion_save_entry(state: State<'_, AppState>, input: companion::EntryInput) -> CmdResult<companion::View> {
    state.companion.save_entry(input).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_delete_entry(state: State<'_, AppState>, id: String) -> CmdResult<companion::View> {
    state.companion.delete_entry(&id).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_checkin(state: State<'_, AppState>, mood: u8, emotions: Vec<String>, note: String) -> CmdResult<companion::View> {
    state.companion.add_checkin(mood, &emotions, &note).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_set_insight(state: State<'_, AppState>, key: String, verdict: Option<String>) -> CmdResult<companion::View> {
    state.companion.set_insight(&key, verdict.as_deref()).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_unlock(state: State<'_, AppState>, pin: String) -> CmdResult<companion::View> {
    state.companion.unlock(&pin).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_lock(state: State<'_, AppState>) -> companion::View {
    state.companion.lock_now();
    state.companion.view()
}

#[tauri::command]
pub fn companion_set_pin(state: State<'_, AppState>, new_pin: Option<String>, current: Option<String>) -> CmdResult<companion::View> {
    state.companion.set_pin(new_pin.as_deref(), current.as_deref()).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_save_resources(state: State<'_, AppState>, resources: Vec<companion::Resource>) -> CmdResult<companion::View> {
    state.companion.set_resources(resources).map_err(err)?;
    Ok(state.companion.view())
}

#[tauri::command]
pub fn companion_export(state: State<'_, AppState>) -> CmdResult<String> {
    state.companion.export().map_err(err)
}

#[tauri::command]
pub fn companion_erase(state: State<'_, AppState>) -> CmdResult<companion::View> {
    state.companion.erase().map_err(err)?;
    Ok(state.companion.view())
}

// ── Mi cursada (AC-99…) ──

#[tauri::command]
pub fn academic_state(state: State<'_, AppState>) -> academic::Data {
    state.academic.data()
}

#[tauri::command]
pub fn academic_save_term(state: State<'_, AppState>, input: academic::TermInput) -> CmdResult<academic::Data> {
    state.academic.save_term(input).map_err(err)
}

#[tauri::command]
pub fn academic_delete_term(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_term(&id).map_err(err)
}

/// AC-150: each linked route takes its course's next exam date (keeping
/// the rest of its goal). Called after anything that changes dates or links.
fn sync_routes(state: &AppState, d: academic::Data) -> academic::Data {
    for (exam_id, next) in academic::route_targets(&d, &activity::today()) {
        let Ok(e) = state.exams.load(&exam_id) else { continue };
        if e.goal.exam_date != next {
            let _ = exam::set_goal(state, &exam_id, exam::ExamGoal { exam_date: next, ..e.goal });
        }
    }
    d
}

/// AC-150
#[tauri::command]
pub fn academic_link_route(state: State<'_, AppState>, course_id: String, exam_id: Option<String>) -> CmdResult<academic::Data> {
    let d = state.academic.link_route(&course_id, exam_id).map_err(err)?;
    Ok(sync_routes(&state, d))
}

/// AC-145
#[tauri::command]
pub fn academic_add_breaks(state: State<'_, AppState>, term_id: String, items: Vec<academic::BreakInput>) -> CmdResult<academic::Data> {
    state.academic.add_breaks(&term_id, items).map_err(err)
}

/// AC-145
#[tauri::command]
pub fn academic_delete_break(state: State<'_, AppState>, term_id: String, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_break(&term_id, &id).map_err(err)
}

#[tauri::command]
pub fn academic_set_active(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.set_active(&id).map_err(err)
}

#[tauri::command]
pub fn academic_save_course(state: State<'_, AppState>, input: academic::CourseInput) -> CmdResult<academic::Data> {
    state.academic.save_course(input).map_err(err)
}

#[tauri::command]
pub fn academic_delete_course(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    state.academic.delete_course(&id).map_err(err)
}

#[tauri::command]
pub fn academic_save_date(state: State<'_, AppState>, input: academic::DateInput) -> CmdResult<academic::Data> {
    let d = state.academic.save_date(input).map_err(err)?;
    Ok(sync_routes(&state, d))
}

#[tauri::command]
pub fn academic_delete_date(state: State<'_, AppState>, id: String) -> CmdResult<academic::Data> {
    let d = state.academic.delete_date(&id).map_err(err)?;
    Ok(sync_routes(&state, d))
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub data: academic::Data,
    pub report: academic::ImportReport,
}

/// Applies a proposal the learner confirmed (from the chat or from "Importar horario").
#[tauri::command]
pub fn academic_import(state: State<'_, AppState>, proposal: academic::Proposal) -> CmdResult<ImportResult> {
    let (data, report) = state.academic.import(proposal).map_err(err)?;
    Ok(ImportResult { data: sync_routes(&state, data), report })
}

/// Reads a pasted timetable or list of dates into a proposal. It is NOT saved:
/// the learner reviews it first.
#[tauri::command]
pub async fn academic_parse(state: State<'_, AppState>, text: String) -> CmdResult<academic::Proposal> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Pegá tu horario o tus fechas.".into());
    }
    if text.chars().count() > 20_000 {
        return Err("Es mucho texto: pegá un período por vez.".into());
    }
    let input = format!("Hoy es {}.\n\nTexto de la persona:\n{text}", chrono::Local::now().date_naive());
    match practice::forced_valid(&state, agent::Role::Practice, "academic_parse", academic::parse_tool(), academic::TOOL, input, academic::parse_proposal).await {
        // The model found nothing: say so plainly, not with the text meant for the model.
        Err(e) if e.to_string().contains("vacía") => Err("No encontré horarios ni fechas en ese texto. Probá pegarlo tal cual te lo pasaron.".into()),
        r => r.map_err(err),
    }
}

// ── La malla de la carrera (AC-155…AC-157) ──

fn career_view(state: &AppState) -> Option<career::CareerView> {
    state.career.get().map(|c| career::view(&c, &career::cursada_keys(&state.academic.data())))
}

#[tauri::command]
pub fn career_get(state: State<'_, AppState>) -> Option<career::CareerView> {
    career_view(&state)
}

/// Reads a pasted (or transcribed) plan of studies into a proposal. Not saved:
/// the person reviews it first.
#[tauri::command]
pub async fn career_parse(state: State<'_, AppState>, text: String) -> CmdResult<career::Proposal> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Pegá el plan de estudios de tu carrera.".into());
    }
    if text.chars().count() > 40_000 {
        return Err("Es mucho texto: pegá solo el plan de estudios (las materias y sus correlativas).".into());
    }
    let input = format!("Texto de la persona:\n{text}");
    match practice::forced_valid(&state, agent::Role::Practice, "career_parse", career::parse_tool(), career::TOOL, input, career::parse_proposal).await {
        Err(e) if e.to_string().contains("no tiene materias") => Err("No encontré materias en ese texto. Probá pegar el plan tal cual lo publica tu facultad.".into()),
        r => r.map_err(err),
    }
}

/// AC-155: saves the confirmed plan; what was already marked stays.
#[tauri::command]
pub fn career_save_plan(state: State<'_, AppState>, proposal: career::Proposal) -> CmdResult<Option<career::CareerView>> {
    state.career.set_plan(proposal).map_err(err)?;
    Ok(career_view(&state))
}

/// AC-156: a subject's status, grade, aplazos and correlativas (or a new one).
#[tauri::command]
pub fn career_save_subject(state: State<'_, AppState>, input: career::SubjectInput) -> CmdResult<Option<career::CareerView>> {
    state.career.update(|c| career::save_subject(c, input)).map_err(err)?;
    Ok(career_view(&state))
}

#[tauri::command]
pub fn career_delete_subject(state: State<'_, AppState>, id: String) -> CmdResult<Option<career::CareerView>> {
    state.career.update(|c| career::delete_subject(c, &id)).map_err(err)?;
    Ok(career_view(&state))
}

#[tauri::command]
pub fn career_delete(state: State<'_, AppState>) -> CmdResult<()> {
    state.career.delete().map_err(err)
}

// ── Study log (AC-49) and recorded classes (AC-146, AC-147) ──

#[tauri::command]
pub fn log_study(state: State<'_, AppState>, entry: study::StudyInput) -> CmdResult<study::StudyEntry> {
    let e = study::validate(entry).map_err(err)?;
    state.study.append(&e).map_err(err)?;
    let _ = state.activity.record(&e.day, "focus");
    Ok(e)
}

#[tauri::command]
pub fn class_list(state: State<'_, AppState>) -> Vec<classes::ClassSummary> {
    state.classes.list()
}

#[tauri::command]
pub fn class_get(state: State<'_, AppState>, id: String) -> CmdResult<classes::ClassRecord> {
    state.classes.get(&id).map_err(err)
}

#[tauri::command]
pub fn class_start(state: State<'_, AppState>, title: String, course_id: Option<String>, day: String) -> CmdResult<classes::ClassRecord> {
    state.classes.start(&title, course_id, &day).map_err(err)
}

/// One transcribed part of the recording.
#[tauri::command]
pub fn class_append(state: State<'_, AppState>, id: String, text: String, seconds: u32) -> CmdResult<classes::ClassRecord> {
    let c = state.classes.append(&id, &text, seconds).map_err(err)?;
    if !text.trim().is_empty() {
        state.activity.touch("class");
    }
    Ok(c)
}

#[tauri::command]
pub fn class_rename(state: State<'_, AppState>, id: String, title: String) -> CmdResult<classes::ClassRecord> {
    state.classes.rename(&id, &title).map_err(err)
}

#[tauri::command]
pub fn class_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.classes.delete(&id).map_err(err)
}

#[tauri::command]
pub async fn class_notes(state: State<'_, AppState>, id: String, today: String) -> CmdResult<classes::ClassRecord> {
    classes::make_notes(&state, &id, &today).await.map_err(err)
}

/// AC-141: days with study since `since` (local YYYY-MM-DD), for the streak.
#[tauri::command]
pub fn activity_days(state: State<'_, AppState>, since: String) -> Vec<activity::DayActivity> {
    activity::days(&state, &since)
}

#[tauri::command]
pub fn study_log(state: State<'_, AppState>, since: String) -> Vec<study::StudyEntry> {
    state.study.since(&since)
}
