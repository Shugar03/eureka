//! Settings, providers, prompts, subscription accounts, backups, usage and updates.

use super::{err, CmdResult};
use crate::{accounts, agent, backup, llm, oauth, prompts, settings, setup, update, usage, AppState};
use tauri::ipc::Channel;
use tauri::{Manager, State};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> settings::SettingsView {
    state.settings.view()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, input: settings::SettingsInput) -> CmdResult<settings::SettingsView> {
    state.settings.save(input).map_err(err)?;
    Ok(state.settings.view())
}

#[tauri::command]
pub fn get_identity(state: State<'_, AppState>) -> settings::Identity {
    state.settings.load().identity
}

#[tauri::command]
pub fn save_identity(state: State<'_, AppState>, input: settings::Identity) -> CmdResult<settings::Identity> {
    state.settings.save_identity(input).map_err(err)
}

#[tauri::command]
pub fn get_accessibility(state: State<'_, AppState>) -> settings::Accessibility {
    state.settings.load().accessibility
}

#[tauri::command]
pub fn save_accessibility(state: State<'_, AppState>, input: settings::Accessibility) -> CmdResult<settings::Accessibility> {
    state.settings.save_accessibility(input).map_err(err)
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, provider_id: String) -> CmdResult<Vec<String>> {
    let settings = state.settings.load();
    let p = settings.providers.iter().find(|p| p.id == provider_id).ok_or("proveedor desconocido")?;
    let key = state.settings.keys().get(&provider_id).cloned().ok_or("falta la API key")?;
    llm::list_models(&p.base_url, &key).await.map_err(err)
}

#[tauri::command]
pub async fn check_provider(state: State<'_, AppState>, provider_id: String) -> CmdResult<()> {
    let settings = state.settings.load();
    let p = settings.providers.iter().find(|p| p.id == provider_id).ok_or("proveedor desconocido")?;
    let key = state.settings.keys().get(&provider_id).cloned().ok_or("falta la API key")?;
    llm::check_provider(&p.base_url, &key).await.map_err(err)
}

/// AC-158/159: a pasted key becomes a working setup (or a question: which service).
#[tauri::command]
pub async fn quick_setup(state: State<'_, AppState>, key: String, provider: Option<String>) -> CmdResult<setup::Outcome> {
    setup::run(&state, &key, provider.as_deref()).await.map_err(err)
}

#[tauri::command]
pub fn list_prompts(state: State<'_, AppState>) -> Vec<prompts::PromptView> {
    state.prompts.list()
}

#[tauri::command]
pub fn save_prompt(state: State<'_, AppState>, name: String, content: String) -> CmdResult<()> {
    state.prompts.save(&name, &content).map_err(err)
}

#[tauri::command]
pub fn reset_prompt(state: State<'_, AppState>, name: String) -> CmdResult<()> {
    state.prompts.reset(&name).map_err(err)
}

// ── Cuentas con suscripción (ChatGPT Plus/Pro) ──

/// What Ajustes sees of a connected account: never the tokens.
#[derive(serde::Serialize)]
pub struct AccountView {
    pub provider_id: String,
    pub account_id: String,
    pub email: Option<String>,
    pub expires: i64,
}

impl AccountView {
    fn of(account: accounts::Account) -> Self {
        Self { provider_id: oauth::PROVIDER_ID.to_string(), account_id: account.account_id, email: account.email, expires: account.expires }
    }
}

#[tauri::command]
pub fn chatgpt_status(state: State<'_, AppState>) -> Option<AccountView> {
    state.accounts.get(oauth::PROVIDER_ID).map(AccountView::of)
}

/// Opens the browser and waits for the callback. Nothing is saved until the
/// token exchange succeeds, so a cancelled sign-in leaves no half account.
#[tauri::command]
pub async fn chatgpt_connect(state: State<'_, AppState>) -> CmdResult<AccountView> {
    let account = oauth::connect(oauth::ORIGINATOR, |url| {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| anyhow::anyhow!("no se pudo abrir el navegador: {e}"))
    })
    .await
    .map_err(err)?;
    state.accounts.put(oauth::PROVIDER_ID, &account).map_err(err)?;
    Ok(AccountView::of(account))
}

#[tauri::command]
pub fn chatgpt_disconnect(state: State<'_, AppState>) -> CmdResult<()> {
    state.accounts.remove(oauth::PROVIDER_ID).map_err(err)
}

/// The models the connected account may use. A ChatGPT subscription does not
/// serve the provider's `/models`, and the list depends on the plan, so it is
/// read from the account itself instead of from Settings.
#[tauri::command]
pub async fn chatgpt_models(state: State<'_, AppState>) -> CmdResult<Vec<llm::ModelInfo>> {
    let account = state.accounts.get(oauth::PROVIDER_ID).ok_or_else(|| "No hay una cuenta de ChatGPT conectada.".to_string())?;
    let account = agent::valid_account(&state, oauth::PROVIDER_ID, account).await.map_err(err)?;
    let ep = llm::Endpoint {
        base_url: oauth::API_BASE.to_string(),
        api_key: account.access,
        model: String::new(),
        context_tokens: 0,
        session: llm::app_session(),
        subscription: Some(llm::Subscription { account_id: account.account_id, originator: account.originator }),
        usage: Default::default(),
        quick: false,
    };
    llm::list_chatgpt_models(&ep).await.map_err(err)
}

// ── Token usage (AC-186): read here, never sent anywhere ──

#[tauri::command]
pub fn usage_summary(state: State<'_, AppState>) -> usage::Summary {
    let titles = state.sessions.list().into_iter().map(|s| (s.id, s.title)).collect();
    usage::summarize(&state.usage.all(), chrono::Local::now().date_naive(), &titles)
}

// ── Backup (AC-60) ──

/// Writes a .zip of all learning data (never the API keys) to Downloads.
#[tauri::command]
pub fn create_backup(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let dir = app.path().download_dir().map_err(err)?;
    let name = format!("Eureka-respaldo-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M"));
    let path = dir.join(name);
    backup::backup_state(&state, &path).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Restores a backup; the current data is saved first next to the data folder.
#[tauri::command]
pub fn restore_backup(state: State<'_, AppState>, bytes: Vec<u8>) -> CmdResult<usize> {
    let safety = state.data_dir.join(format!("antes-de-restaurar-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    let restored = backup::restore_state(&state, &bytes, &safety).map_err(err)?;
    // AC-190: the library's files changed under the index.
    state.library.invalidate();
    Ok(restored)
}

// ── Version and updates (AC-202) ──

/// The version of this build (Ajustes → Acerca de).
#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Distribution: is there a newer signed installer?
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> CmdResult<update::Check> {
    update::check(&app).await.map_err(err)
}

/// Installs the update found by `update_check` and reopens Eureka (AC-202: no
/// installer window; the progress goes to the bar inside Eureka).
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, state: State<'_, AppState>, on_progress: Channel<update::Progress>) -> CmdResult<()> {
    update::install(&app, &state.data_dir, on_progress).await.map_err(err)
}

/// AC-202: right after updating itself, what the new version brings (once).
#[tauri::command]
pub fn update_whats_new(app: tauri::AppHandle, state: State<'_, AppState>) -> Option<update::WhatsNew> {
    update::take_whats_new(&state.data_dir, &app.package_info().version.to_string())
}
