mod academic;
mod accounts;
mod activity;
mod agent;
mod anki;
mod backup;
mod cards;
mod career;
mod classes;
mod commands;
mod companion;
mod context;
mod documents;
mod exam;
mod extract;
mod folders;
mod graph;
mod language;
mod learner;
mod library;
mod llm;
mod local_speech;
mod memdb;
mod memory;
mod oauth;
mod ocr;
mod office;
mod practice;
mod project;
mod prompts;
mod research;
mod route;
mod runner;
mod session;
mod settings;
mod setup;
mod share;
mod sql;
mod student;
mod study;
mod tools;
mod update;
mod usage;
mod vision;

use cards::DeckStore;
use exam::ExamStore;
use graph::GraphStore;
use practice::PracticeStore;
use prompts::Prompts;
use session::SessionStore;
use settings::SettingsStore;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub sessions: SessionStore,
    pub settings: SettingsStore,
    /// Subscription accounts (ChatGPT Plus/Pro); tokens live in the OS keystore.
    pub accounts: accounts::AccountsStore,
    pub prompts: Prompts,
    pub graph: GraphStore,
    pub practice: PracticeStore,
    pub exams: ExamStore,
    pub routes: route::RouteStore,
    pub folders: folders::FolderStore,
    pub decks: DeckStore,
    pub study: study::StudyLog,
    /// AC-141: days with study, for the kind streak.
    pub activity: activity::ActivityLog,
    pub classes: classes::ClassStore,
    pub projects: project::ProjectStore,
    pub learner: learner::LearnerStore,
    /// AC-195: the student's memory (observations with stable topics), opened on first use.
    pub memdb: memdb::MemoryDb,
    pub library: library::LibraryStore,
    /// Mi cursada: terms, courses, class slots and the dates that matter.
    pub academic: academic::AcademicStore,
    /// AC-155: the plan of studies (malla), its correlativas and grades.
    pub career: career::CareerStore,
    /// The journal and listening mode: private, apart from everything the teacher reads.
    pub companion: companion::CompanionStore,
    pub data_dir: PathBuf,
    /// Where code runs get their (temporary) folders.
    pub runs_dir: PathBuf,
    /// Toolchains found on this PC (detected once, on demand).
    pub(crate) runtimes: tokio::sync::Mutex<Option<Vec<runner::Runtime>>>,
    /// Cancel flags of sessions with a turn in progress.
    pub(crate) running: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// The local speech model (Parakeet or Whisper), loaded on the first dictation and kept for the next ones.
    pub(crate) local_speech: Arc<Mutex<Option<local_speech::Engine>>>,
    /// AC-187: the OCR sessions, created on the first scanned page and kept.
    pub(crate) ocr: Arc<Mutex<Option<ocr::Engine>>>,
    /// What the screen last said it is doing (pomodoro, theme, reminders…): lives only in memory.
    pub(crate) ui: Mutex<String>,
    /// AC-154: a `.eureka` Eureka was opened with, until the screen asks for it.
    pub(crate) opened: Mutex<Option<PathBuf>>,
    /// AC-169: research running in the background.
    pub research: research::Background,
    /// AC-186: what each model call spent, only on this PC.
    pub usage: Arc<usage::UsageLog>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            sessions: SessionStore::new(&data_dir),
            settings: SettingsStore::new(&data_dir),
            accounts: accounts::AccountsStore::new(&data_dir),
            prompts: Prompts::new(&data_dir),
            graph: GraphStore::new(&data_dir),
            practice: PracticeStore::new(&data_dir),
            exams: ExamStore::new(&data_dir),
            routes: route::RouteStore::new(&data_dir),
            folders: folders::FolderStore::new(&data_dir),
            decks: DeckStore::new(&data_dir),
            study: study::StudyLog::new(&data_dir),
            activity: activity::ActivityLog::new(&data_dir),
            classes: classes::ClassStore::new(&data_dir),
            projects: project::ProjectStore::new(&data_dir),
            learner: learner::LearnerStore::new(&data_dir),
            memdb: memdb::MemoryDb::new(&data_dir),
            library: library::LibraryStore::new(&data_dir),
            academic: academic::AcademicStore::new(&data_dir),
            career: career::CareerStore::new(&data_dir),
            companion: companion::CompanionStore::new(&data_dir),
            runs_dir: data_dir.join("runs"),
            data_dir: data_dir.clone(),
            runtimes: tokio::sync::Mutex::new(None),
            running: Mutex::new(HashMap::new()),
            local_speech: Arc::new(Mutex::new(None)),
            ocr: Arc::new(Mutex::new(None)),
            ui: Mutex::new(String::new()),
            opened: Mutex::new(None),
            research: research::Background::default(),
            usage: Arc::new(usage::UsageLog::new(&data_dir)),
        }
    }

    pub fn ui_snapshot(&self) -> String {
        self.ui.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    pub fn set_ui_snapshot(&self, s: &str) {
        // A few short lines, never the whole screen: it goes in every prompt.
        *self.ui.lock().unwrap_or_else(|p| p.into_inner()) = s.trim().chars().take(1200).collect();
    }

    /// A turn of this session is in progress (the memory pass waits for it).
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap_or_else(|p| p.into_inner()).contains_key(id)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // AC-154: one Eureka on the real data; a second launch (double click on a
    // `.eureka`) hands its file to the open window. Tests use their own data
    // folder (LA_DATA_DIR) and never reach the person's Eureka.
    #[cfg(desktop)]
    if std::env::var_os("LA_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Emitter;
            if let Some(path) = share::opened_file(args) {
                *app.state::<AppState>().opened.lock().unwrap_or_else(|p| p.into_inner()) = Some(path);
                let _ = app.emit("deck-opened", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    // AC-207: Eureka's own title bar: a 32 px strip to drag the window, with the three
    // Windows buttons on top of the app (the Snap Layout menu still opens on ▢).
    #[cfg(windows)]
    {
        builder = builder.plugin(
            tauri_plugin_frame::FramePluginBuilder::new()
                .auto_titlebar(true)
                .titlebar_height(32)
                .button_hover_bg_dark("rgba(255,255,255,0.08)")
                .button_hover_bg_light("rgba(20,22,26,0.07)")
                .build(),
        );
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // On the phone, files are saved where the user picks (a content:// address).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(update::Pending::default())
        .setup(|app| {
            // LA_DATA_DIR relocates all data (used by tests); default: OS app-data dir.
            let dir = match std::env::var_os("LA_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState::new(dir));
            *app.state::<AppState>().opened.lock().unwrap_or_else(|p| p.into_inner()) = share::opened_file(std::env::args());
            // AC-169: the research worker; what a closed app left «en curso» says it was cut.
            research::recover(&app.state::<AppState>());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    handle.state::<AppState>().research.wake.notified().await;
                    for job in handle.state::<AppState>().research.take() {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move { research::run_job(&h.state::<AppState>(), job).await });
                    }
                }
            });
            // AC-108: the memory pass, in the background, every few minutes.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let backoff = memory::Backoff::default();
                // AC-195: the one-time migration to the student's memory (resumable; old files stay).
                match memdb::migrate(&handle.state::<AppState>()) {
                    Ok(c) if c.created + c.merged > 0 => eprintln!("memoria del estudiante: {c:?}"),
                    Ok(_) => {}
                    Err(e) => eprintln!("memoria del estudiante: {e}"),
                }
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                loop {
                    memory::pass(&handle.state::<AppState>(), &backoff).await;
                    tokio::time::sleep(std::time::Duration::from_secs(3 * 60)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::app_version,
            commands::settings::update_check,
            commands::settings::update_install,
            commands::settings::update_whats_new,
            commands::session::fetch_document,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::chatgpt_status,
            commands::settings::chatgpt_connect,
            commands::settings::chatgpt_disconnect,
            commands::settings::chatgpt_models,
            commands::settings::usage_summary,
            commands::session::update_session_meta,
            commands::session::student_model,
            commands::session::student_today,
            commands::session::student_mark_known,
            commands::session::session_memories,
            commands::session::forget_session_memory,
            commands::session::memory_list,
            commands::session::memory_edit,
            commands::session::memory_delete,
            commands::session::memory_forget_all,
            commands::session::memory_export,
            commands::session::remember_session_now,
            commands::academic::companion_state,
            commands::academic::companion_ack_privacy,
            commands::academic::companion_send,
            commands::academic::companion_new_conversation,
            commands::academic::companion_propose_entry,
            commands::academic::companion_save_entry,
            commands::academic::companion_delete_entry,
            commands::academic::companion_checkin,
            commands::academic::companion_unlock,
            commands::academic::companion_set_insight,
            commands::academic::companion_lock,
            commands::academic::companion_set_pin,
            commands::academic::companion_save_resources,
            commands::academic::companion_export,
            commands::academic::companion_erase,
            commands::academic::academic_state,
            commands::academic::academic_save_term,
            commands::academic::academic_add_breaks,
            commands::academic::academic_link_route,
            commands::academic::academic_delete_break,
            commands::academic::academic_delete_term,
            commands::academic::academic_set_active,
            commands::academic::academic_save_course,
            commands::academic::academic_delete_course,
            commands::academic::academic_save_date,
            commands::academic::academic_delete_date,
            commands::academic::academic_import,
            commands::academic::academic_parse,
            commands::academic::career_get,
            commands::academic::career_parse,
            commands::academic::career_save_plan,
            commands::academic::career_save_subject,
            commands::academic::career_delete_subject,
            commands::academic::career_delete,
            commands::settings::get_identity,
            commands::settings::save_identity,
            commands::settings::get_accessibility,
            commands::settings::save_accessibility,
            commands::settings::list_models,
            commands::settings::check_provider,
            commands::settings::quick_setup,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::start_chat,
            commands::session::get_session,
            commands::session::delete_session,
            commands::session::forget_source,
            commands::library::import_book,
            commands::library::add_ocr_pages,
            commands::library::import_document,
            commands::library::ocr_available,
            commands::library::ocr_page,
            commands::library::ocr_cached,
            commands::library::ocr_cache_put,
            commands::library::ocr_cache_clear,
            commands::library::list_books,
            commands::library::get_book,
            commands::library::delete_book,
            commands::library::search_library,
            commands::session::get_learner,
            commands::session::forget_learner,
            commands::session::send_message,
            commands::session::stop_agent,
            commands::settings::list_prompts,
            commands::settings::save_prompt,
            commands::settings::reset_prompt,
            commands::session::get_graph,
            commands::session::extract_session,
            commands::session::import_notes,
            commands::study::list_practice,
            commands::study::get_practice,
            commands::study::create_practice,
            commands::study::reveal_hint,
            commands::study::practice_nudge,
            commands::study::read_own_problems,
            commands::study::create_own_practice,
            commands::study::next_problem,
            commands::study::answer_problem,
            commands::study::delete_practice,
            commands::study::list_exams,
            commands::study::get_exam,
            commands::study::create_exam,
            commands::study::delete_exam,
            commands::study::find_exam_guide,
            commands::study::study_topic,
            commands::library::folders_list,
            commands::library::folder_share,
            commands::library::folder_remove,
            commands::library::folder_set_writable,
            commands::library::folder_plan_apply,
            commands::library::folder_plan_undo,
            commands::study::route_create,
            commands::study::route_list,
            commands::study::route_get,
            commands::study::route_start_class,
            commands::study::route_delete,
            commands::study::create_mock,
            commands::study::submit_mock,
            commands::study::answer_review,
            commands::study::set_exam_goal,
            commands::study::set_exam_schedule,
            commands::study::create_language_path,
            commands::study::record_exercise,
            commands::study::create_cheat_sheet,
            commands::study::explain_question,
            commands::study::report_question,
            commands::study::report_review,
            commands::study::list_decks,
            commands::study::get_deck,
            commands::study::create_deck,
            commands::study::generate_deck,
            commands::study::delete_deck,
            commands::study::save_card,
            commands::study::delete_card,
            commands::study::grade_card,
            commands::study::save_code_card,
            commands::academic::log_study,
            commands::academic::class_list,
            commands::academic::class_get,
            commands::academic::class_start,
            commands::academic::class_append,
            commands::academic::class_rename,
            commands::academic::class_delete,
            commands::academic::class_notes,
            commands::academic::activity_days,
            commands::settings::create_backup,
            commands::code::read_images,
            commands::code::generate_listening,
            commands::code::transcribe_audio,
            commands::code::local_speech_status,
            commands::code::local_speech_download,
            commands::code::local_speech_remove,
            commands::code::speaking_feedback,
            commands::code::list_projects,
            commands::code::get_project,
            commands::code::save_project,
            commands::code::delete_project,
            commands::code::run_project,
            commands::code::generate_project,
            commands::settings::restore_backup,
            commands::study::import_cards,
            commands::study::read_apkg,
            commands::study::export_apkg,
            commands::study::share_deck,
            commands::study::read_shared_deck,
            commands::study::opened_deck,
            commands::code::code_runtimes,
            commands::code::run_code,
            commands::code::explain_code,
            commands::code::review_code,
            commands::code::generate_code_exercise,
            commands::academic::study_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "android")]
            if let tauri::RunEvent::Opened { urls } = _event {
                receive_opened(_app, urls);
            }
        });
}

/// AC-154 on Android: another app hands Eureka a `.eureka` as a content://
/// address that only works while that hand-over lasts, so it is copied in now.
#[cfg(target_os = "android")]
fn receive_opened(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    let Some(url) = urls.into_iter().find(|u| matches!(u.scheme(), "content" | "file")) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        use tauri::Emitter;
        use tauri_plugin_fs::FsExt;
        let mut opts = tauri_plugin_fs::OpenOptions::new();
        opts.read(true);
        let Ok(file) = app.fs().open(tauri_plugin_fs::FilePath::Url(url), opts) else { return };
        // One byte over the limit is enough for `opened_deck` to say it is too big.
        let mut bytes = Vec::new();
        if file.take(share::MAX_SHARED_BYTES as u64 + 1).read_to_end(&mut bytes).is_err() {
            return;
        }
        let state = app.state::<AppState>();
        let path = state.data_dir.join("abierto.eureka");
        if std::fs::write(&path, bytes).is_ok() {
            *state.opened.lock().unwrap_or_else(|p| p.into_inner()) = Some(path);
            let _ = app.emit("deck-opened", ());
        }
    });
}

/// IPC contract: the exact JSON shapes `src/api.ts` / `src/types.ts` use. The
/// e2e mock speaks the same shapes, so these tests tie mock, UI and Rust together.
#[cfg(test)]
mod contract_tests {
    use super::*;
    use agent::AgentEvent;
    use serde_json::json;
    use session::Session;
    use settings::SettingsInput;
    use tools::LearnerInput;

    #[test]
    fn settings_input_from_ui_keeps_key_when_blank() {
        // What Settings.tsx sends: api_key "" for untouched keys, no clear_key.
        let raw = json!({
            "providers": [{ "id": "openrouter", "label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "api_key": "" }],
            "roles": { "teacher": { "provider_id": "openrouter", "model": "x/y" }, "prober": { "provider_id": "", "model": "" } }
        });
        let input: SettingsInput = serde_json::from_value(raw).unwrap();
        assert_eq!(input.providers[0].provider.id, "openrouter");
        assert!(!input.providers[0].clear_key);

        let dir = std::env::temp_dir().join(format!("la-contract-{}", uuid::Uuid::new_v4().simple()));
        let store = SettingsStore::new(&dir);
        store.save(serde_json::from_value(json!({
            "providers": [{ "id": "openrouter", "label": "OpenRouter", "base_url": "u", "api_key": "sk-1" }],
            "roles": { "teacher": { "provider_id": "", "model": "" }, "prober": { "provider_id": "", "model": "" } }
        })).unwrap()).unwrap();
        store.save(input).unwrap();
        assert_eq!(store.keys().get("openrouter").map(String::as_str), Some("sk-1"), "blank key must not erase the stored one");
        let view = serde_json::to_value(store.view()).unwrap();
        assert_eq!(view["providers"][0]["has_key"], true);
        assert!(!view.to_string().contains("sk-1"), "the key never reaches the UI");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn learner_input_from_ui() {
        let full: LearnerInput = serde_json::from_value(json!({ "text": "a", "confidence": 3, "thinking": "t" })).unwrap();
        assert_eq!(full.confidence, Some(3));
        let free: LearnerInput = serde_json::from_value(json!({ "text": "hola" })).unwrap();
        assert!(free.confidence.is_none() && free.thinking.is_empty());
    }

    #[test]
    fn agent_events_match_ts_union() {
        let s = Session::new("g");
        let ev = |e: AgentEvent| serde_json::to_value(e).unwrap();
        assert_eq!(ev(AgentEvent::Text { delta: "x".into() }), json!({ "type": "text", "delta": "x" }));
        assert_eq!(ev(AgentEvent::Activity { label: "x".into() }), json!({ "type": "activity", "label": "x" }));
        assert_eq!(crate::agent::activity_label("library_search"), "Buscando en tu biblioteca…");
        assert_eq!(crate::agent::activity_label(crate::research::TOOL), "Mandando a investigar en la web…");
        assert_eq!(crate::agent::activity_label("herramienta_rara"), "Preparando la respuesta…");
        assert_eq!(ev(AgentEvent::Error { message: "m".into() }), json!({ "type": "error", "message": "m" }));
        assert_eq!(ev(AgentEvent::Done), json!({ "type": "done" }));
        let v = ev(AgentEvent::Session { session: Box::new(s) });
        assert_eq!(v["type"], "session");
        // Fields types.ts relies on.
        for key in ["id", "title", "goal", "phase", "findings", "plan", "pending_question", "messages", "updated_at"] {
            assert!(v["session"].get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["session"]["phase"], "probe");
    }
}
