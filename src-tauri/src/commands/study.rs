//! Practice, exams, learning routes, flashcards, Anki and shared decks.

use super::{err, CmdResult};
use crate::cards::{Deck, DeckSummary};
use crate::exam::{Exam, ExamSummary};
use crate::practice::{PracticeSet, PracticeSummary};
use crate::session::Session;
use crate::tools::LearnerInput;
use crate::{anki, cards, exam, practice, route, runner, share, AppState};
use std::path::PathBuf;
use tauri::{Manager, State};

// ── Practice (Phase 3) ──

#[tauri::command]
pub fn list_practice(state: State<'_, AppState>) -> Vec<PracticeSummary> {
    state.practice.list()
}

#[tauri::command]
pub fn get_practice(state: State<'_, AppState>, id: String) -> CmdResult<PracticeSet> {
    state.practice.load(&id).map_err(err)
}

/// AC-22/23: generates a practice set from chosen graph ideas.
#[tauri::command]
pub async fn create_practice(state: State<'_, AppState>, node_ids: Vec<String>, count: usize) -> CmdResult<PracticeSet> {
    practice::create(&state, &node_ids, count).await.map_err(err)
}

#[tauri::command]
pub fn reveal_hint(state: State<'_, AppState>, set_id: String, problem_id: String) -> CmdResult<PracticeSet> {
    practice::reveal_hint(&state, &set_id, &problem_id).map_err(err)
}

/// AC-167: the next problem of a set written one by one (`have` = how many the screen has).
#[tauri::command]
pub async fn next_problem(state: State<'_, AppState>, set_id: String, have: usize) -> CmdResult<PracticeSet> {
    practice::next_problem(&state, &set_id, have).await.map_err(err)
}

/// AC-173: reads the learner's own problems (a guide, an old exam) to review; nothing is saved.
#[tauri::command]
pub async fn read_own_problems(state: State<'_, AppState>, text: String, book: Option<String>) -> CmdResult<Vec<practice::OwnProblem>> {
    practice::read_own(&state, &text, book.as_deref()).await.map_err(err)
}

/// AC-173: the practice from the problems the learner kept.
#[tauri::command]
pub fn create_own_practice(state: State<'_, AppState>, title: String, problems: Vec<practice::OwnProblem>) -> CmdResult<PracticeSet> {
    practice::create_own(&state, &title, problems).map_err(err)
}

/// AC-168: a hint written for what the learner is thinking right now.
#[tauri::command]
pub async fn practice_nudge(state: State<'_, AppState>, set_id: String, problem_id: String, draft: String) -> CmdResult<practice::Nudge> {
    practice::nudge(&state, &set_id, &problem_id, &draft).await.map_err(err)
}

/// AC-25: grades one answer (nothing is saved if grading fails).
#[tauri::command]
pub async fn answer_problem(state: State<'_, AppState>, set_id: String, problem_id: String, input: LearnerInput) -> CmdResult<PracticeSet> {
    let set = practice::answer(&state, &set_id, &problem_id, &input.text, input.confidence, &input.thinking).await.map_err(err)?;
    state.activity.touch("practice");
    Ok(set)
}

#[tauri::command]
pub fn delete_practice(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.practice.delete(&id).map_err(err)
}

// ── Exams & certifications (Phase 5) ──

#[tauri::command]
pub fn list_exams(state: State<'_, AppState>) -> Vec<ExamSummary> {
    state.exams.list()
}

#[tauri::command]
pub fn get_exam(state: State<'_, AppState>, id: String) -> CmdResult<Exam> {
    state.exams.load(&id).map_err(err)
}

/// AC-32: turns a pasted exam guide into a weighted syllabus.
#[tauri::command]
pub async fn create_exam(state: State<'_, AppState>, name: String, guide: String, kind: Option<exam::ExamKind>) -> CmdResult<Exam> {
    exam::create(&state, &name, &guide, kind.unwrap_or_default()).await.map_err(err)
}

/// AC-61: a learning path for a programming language.
#[tauri::command]
pub async fn create_language_path(state: State<'_, AppState>, lang: runner::Lang, level: String, goal: String) -> CmdResult<Exam> {
    exam::create_language_path(&state, lang, &level, &goal).await.map_err(err)
}

/// AC-61: an exercise of a path's topic passed its tests.
#[tauri::command]
pub fn record_exercise(state: State<'_, AppState>, exam_id: String, topic_id: String) -> CmdResult<Exam> {
    exam::record_exercise(&state, &exam_id, &topic_id).map_err(err)
}

/// AC-51: weekly classes and study blocks of an exam or subject.
#[tauri::command]
pub fn set_exam_schedule(state: State<'_, AppState>, exam_id: String, slots: Vec<exam::Slot>) -> CmdResult<Exam> {
    exam::set_schedule(&state, &exam_id, slots).map_err(err)
}

#[tauri::command]
pub fn delete_exam(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.exams.delete(&id).map_err(err)
}

/// AC-38: finds the official exam guide on the web (to review before creating the exam).
#[tauri::command]
pub async fn find_exam_guide(state: State<'_, AppState>, name: String) -> CmdResult<exam::FoundGuide> {
    exam::find_guide(&state, &name).await.map_err(err)
}

/// AC-34: opens or resumes the study session of one topic.
#[tauri::command]
pub fn study_topic(state: State<'_, AppState>, exam_id: String, topic_id: String) -> CmdResult<Session> {
    exam::study(&state, &exam_id, &topic_id).map_err(err)
}

/// AC-35: generates a multiple-choice mock exam spread by domain weight.
#[tauri::command]
pub async fn create_mock(state: State<'_, AppState>, exam_id: String, count: usize, minutes: Option<u32>, focus: Option<exam::MockFocus>) -> CmdResult<Exam> {
    exam::create_mock(&state, &exam_id, count, minutes, &focus.unwrap_or_default()).await.map_err(err)
}

/// AC-45: the teacher answers a question about one graded question.
#[tauri::command]
pub async fn explain_question(
    state: State<'_, AppState>,
    exam_id: String,
    question: exam::Question,
    chosen: Vec<usize>,
    history: Vec<exam::ExplainTurn>,
    ask: String,
) -> CmdResult<String> {
    exam::explain(&state, &exam_id, &question, &chosen, &history, &ask).await.map_err(err)
}

/// AC-46: the learner reports a question as wrong.
#[tauri::command]
pub fn report_question(state: State<'_, AppState>, exam_id: String, mock_id: String, question_id: String, reason: String) -> CmdResult<Exam> {
    exam::report(&state, &exam_id, &mock_id, &question_id, &reason).map_err(err)
}

#[tauri::command]
pub fn report_review(state: State<'_, AppState>, exam_id: String, review_id: String) -> CmdResult<Exam> {
    exam::report_review(&state, &exam_id, &review_id).map_err(err)
}

/// AC-44: writes the final one-page review sheet.
#[tauri::command]
pub async fn create_cheat_sheet(state: State<'_, AppState>, exam_id: String) -> CmdResult<Exam> {
    exam::cheat_sheet(&state, &exam_id).await.map_err(err)
}

/// AC-36: grades a mock exam (no model call).
#[tauri::command]
pub fn submit_mock(state: State<'_, AppState>, exam_id: String, mock_id: String, answers: Vec<Vec<usize>>) -> CmdResult<Exam> {
    let e = exam::submit_mock(&state, &exam_id, &mock_id, &answers).map_err(err)?;
    state.activity.touch("exam");
    Ok(e)
}

/// AC-42: passing mark, exam date and weekly hours.
#[tauri::command]
pub fn set_exam_goal(state: State<'_, AppState>, exam_id: String, goal: exam::ExamGoal) -> CmdResult<Exam> {
    exam::set_goal(&state, &exam_id, goal).map_err(err)
}

/// AC-40: one answer while reviewing failed questions.
#[tauri::command]
pub fn answer_review(state: State<'_, AppState>, exam_id: String, review_id: String, choice: Vec<usize>) -> CmdResult<Exam> {
    let e = exam::review(&state, &exam_id, &review_id, &choice).map_err(err)?;
    state.activity.touch("exam");
    Ok(e)
}

// ── Rutas de aprendizaje (AC-214..AC-217) ──

/// AC-214: creates the route the person confirmed (edited or not) from the card.
#[tauri::command]
pub fn route_create(state: State<'_, AppState>, proposal: route::RouteProposal) -> CmdResult<route::RouteView> {
    let r = route::create(&state, proposal).map_err(err)?;
    Ok(route::view(&state, &r))
}

#[tauri::command]
pub fn route_list(state: State<'_, AppState>) -> Vec<route::RouteView> {
    state.routes.all().iter().map(|r| route::view(&state, r)).collect()
}

#[tauri::command]
pub fn route_get(state: State<'_, AppState>, id: String) -> CmdResult<route::RouteView> {
    let r = state.routes.load(&id).map_err(err)?;
    Ok(route::view(&state, &r))
}

/// AC-216: opens (or resumes) the session of one class.
#[tauri::command]
pub fn route_start_class(state: State<'_, AppState>, route_id: String, class_id: String) -> CmdResult<Session> {
    route::start_class(&state, &route_id, &class_id).map_err(err)
}

/// Deletes the route; its sessions stay, like any other session.
#[tauri::command]
pub fn route_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.routes.delete(&id).map_err(err)
}

// ── Flashcards, Anki and shared decks ──

#[tauri::command]
pub fn list_decks(state: State<'_, AppState>, today: String) -> CmdResult<Vec<DeckSummary>> {
    let today = cards::parse_day(&today).map_err(err)?;
    Ok(state.decks.all().iter().map(|d| d.summary(today)).collect())
}

#[tauri::command]
pub fn get_deck(state: State<'_, AppState>, id: String) -> CmdResult<Deck> {
    state.decks.load(&id).map_err(err)
}

#[tauri::command]
pub fn create_deck(state: State<'_, AppState>, name: String) -> CmdResult<Deck> {
    cards::create_empty(&state, &name).map_err(err)
}

#[tauri::command]
pub async fn generate_deck(state: State<'_, AppState>, name: String, source: cards::CardSource, count: usize, today: String) -> CmdResult<Deck> {
    cards::generate(&state, &name, source, count, &today).await.map_err(err)
}

#[tauri::command]
pub fn delete_deck(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.decks.delete(&id).map_err(err)
}

#[tauri::command]
pub fn save_card(state: State<'_, AppState>, deck_id: String, card_id: Option<String>, front: String, back: String, today: String) -> CmdResult<Deck> {
    cards::upsert_card(&state, &deck_id, card_id.as_deref(), &front, &back, &today).map_err(err)
}

#[tauri::command]
pub fn delete_card(state: State<'_, AppState>, deck_id: String, card_id: String) -> CmdResult<Deck> {
    cards::delete_card(&state, &deck_id, &card_id).map_err(err)
}

/// AC-57: saves an explained console error as a flashcard.
#[tauri::command]
pub fn save_code_card(state: State<'_, AppState>, lang: runner::Lang, front: String, back: String, today: String) -> CmdResult<usize> {
    let today = cards::parse_day(&today).map_err(err)?;
    let name = format!("Errores de {}", lang.label());
    cards::add_to_named_deck(&state.decks, &name, cards::DeckSource::Manual, &[(front, back)], today).map_err(err)
}

#[tauri::command]
pub fn grade_card(state: State<'_, AppState>, deck_id: String, card_id: String, grade: cards::Grade, today: String) -> CmdResult<Deck> {
    let d = cards::grade_card(&state, &deck_id, &card_id, grade, &today).map_err(err)?;
    let _ = state.activity.record(&today, "cards");
    Ok(d)
}

/// Creates a deck from imported cards (Anki's plain text or .apkg, a shared deck).
#[tauri::command]
pub fn import_cards(state: State<'_, AppState>, name: String, cards: Vec<(String, String)>, today: String) -> CmdResult<String> {
    let today = cards::parse_day(&today).map_err(err)?;
    let (deck, _) = cards::import_deck(&state.decks, &name, &cards, today).map_err(err)?;
    Ok(deck.id)
}

/// The bytes of a file the screen sent as the raw request body.
fn raw_body<'a>(request: &'a tauri::ipc::Request<'_>) -> CmdResult<&'a [u8]> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b),
        _ => Err("Elegí un archivo.".into()),
    }
}

/// A file in Downloads that does not overwrite another one.
fn free_download(app: &tauri::AppHandle, name: &str) -> CmdResult<PathBuf> {
    let dir = app.path().download_dir().map_err(err)?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let mut path = dir.join(name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    Ok(path)
}

fn deck_pairs(state: &AppState, deck_id: &str) -> CmdResult<(String, Vec<(String, String)>)> {
    let d = state.decks.load(deck_id).map_err(err)?;
    Ok((d.name, d.cards.into_iter().map(|c| (c.front, c.back)).collect()))
}

/// AC-152: the cards of an Anki package, to review before importing.
#[tauri::command]
pub fn read_apkg(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<anki::Imported> {
    anki::read_apkg(raw_body(&request)?, &state.data_dir.join("tmp")).map_err(err)
}

/// AC-153: the deck as an .apkg in Downloads; returns its path.
#[tauri::command]
pub fn export_apkg(app: tauri::AppHandle, state: State<'_, AppState>, deck_id: String) -> CmdResult<String> {
    let (name, cards) = deck_pairs(&state, &deck_id)?;
    let bytes = anki::write_apkg(&name, &cards, &state.data_dir.join("tmp")).map_err(err)?;
    let path = free_download(&app, &share::file_name(&name, "apkg"))?;
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// AC-154: the deck as a `.eureka` file in Downloads, to send; returns its path.
#[tauri::command]
pub fn share_deck(app: tauri::AppHandle, state: State<'_, AppState>, deck_id: String) -> CmdResult<String> {
    let (name, cards) = deck_pairs(&state, &deck_id)?;
    let bytes = share::to_file(&name, &cards).map_err(err)?;
    let path = free_download(&app, &share::file_name(&name, share::EXTENSION))?;
    std::fs::write(&path, bytes).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// AC-154: a shared deck picked in the screen, to review before importing.
#[tauri::command]
pub fn read_shared_deck(request: tauri::ipc::Request<'_>) -> CmdResult<share::Incoming> {
    share::from_file(raw_body(&request)?).map_err(err)
}

/// AC-154: the `.eureka` Eureka was opened with (double click), once.
#[tauri::command]
pub fn opened_deck(state: State<'_, AppState>) -> CmdResult<Option<share::Incoming>> {
    let Some(path) = state.opened.lock().unwrap_or_else(|p| p.into_inner()).take() else { return Ok(None) };
    let meta = std::fs::metadata(&path).map_err(|_| "No encontré el mazo que abriste.".to_string())?;
    if meta.len() as usize > share::MAX_SHARED_BYTES {
        return Err("El mazo compartido es demasiado grande.".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "No pude leer el mazo que abriste.".to_string())?;
    share::from_file(&bytes).map(Some).map_err(err)
}
