//! Local library, local OCR and shared working folders.

use super::{err, CmdResult};
use crate::session::Session;
use crate::{agent, folders, library, ocr, office, AppState};
use tauri::{Manager, State};

#[derive(serde::Deserialize)]
pub struct OcrImport {
    pub hash: String,
    pub pages: Vec<library::OcrPage>,
    pub pending: Vec<u32>,
}

/// AC-69/AC-187: a document already converted to Markdown on this PC (pdf.js / text).
#[tauri::command]
pub fn import_book(state: State<'_, AppState>, title: String, file_name: String, markdown: String, pages: u32, scanned: Vec<u32>, ocr: Option<OcrImport>) -> CmdResult<library::BookSummary> {
    let ocr = ocr.map(|o| (o.hash.to_ascii_lowercase(), o.pages, o.pending));
    state.library.import(&title, &file_name, &markdown, pages, scanned, ocr).map(|b| b.summary()).map_err(err)
}

/// AC-191: a Word, PowerPoint, EPUB or ODT file as raw bytes (see `office::parse_upload`),
/// converted to Markdown on this PC and imported like any other document.
#[tauri::command]
pub async fn import_document(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<library::BookSummary> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else { return Err("El archivo no llegó como bytes.".into()) };
    let (title, file_name, bytes) = office::parse_upload(body).map_err(err)?;
    let (name, bytes) = (file_name.clone(), bytes.to_vec());
    let markdown = tokio::task::spawn_blocking(move || office::to_markdown(&name, &bytes)).await.map_err(err)?.map_err(err)?;
    state.library.import(&title, &file_name, &markdown, 0, vec![], None).map(|b| b.summary()).map_err(err)
}

// ── OCR local (AC-187, AC-188) ──

/// AC-187: the next OCR'd pages of a book being read in the background.
#[tauri::command]
pub fn add_ocr_pages(state: State<'_, AppState>, id: String, pages: Vec<library::OcrPage>, pending: Vec<u32>) -> CmdResult<library::BookSummary> {
    state.library.add_ocr_pages(&id, &pages, pending).map(|b| b.summary()).map_err(err)
}

/// Whether this build can read scans (desktop with its models; not the phone).
#[tauri::command]
pub fn ocr_available(app: tauri::AppHandle) -> bool {
    !cfg!(target_os = "android") && ocr::models_dir(app.path().resource_dir().ok()).is_some()
}

/// One page or photo, as raw bytes (no JSON: a page is ~18 MB): width, height and the
/// page number (0 for a photo, only for messages) as little-endian u32, then RGBA. The models load on the first page and stay loaded.
#[tauri::command]
pub async fn ocr_page(app: tauri::AppHandle, state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<ocr::PageText> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else { return Err("La imagen no llegó como bytes.".into()) };
    if body.len() < 12 {
        return Err("La imagen llegó vacía.".into());
    }
    let u32_at = |i: usize| -> Result<u32, String> {
        let bytes: [u8; 4] = body[i..i + 4].try_into().map_err(|_| "Encabezado de imagen incompleto.".to_string())?;
        Ok(u32::from_le_bytes(bytes))
    };
    let (w, h, page) = (u32_at(0)? as usize, u32_at(4)? as usize, u32_at(8)?);
    let img = ocr::Image::from_rgba(w, h, &body[12..]).map_err(err)?;
    let what = if page == 0 { "la imagen".to_string() } else { format!("la página {page}") };
    let dir = ocr::models_dir(app.path().resource_dir().ok()).ok_or("Esta versión de Eureka no trae el lector de escaneos.")?;
    let engine = state.ocr.clone();
    // CPU-heavy: off the async runtime, one page at a time.
    tokio::task::spawn_blocking(move || {
        let mut slot = engine.lock().unwrap_or_else(|p| p.into_inner());
        let eng = match slot.as_mut() {
            Some(e) => e,
            None => slot.insert(ocr::Engine::load(&dir)?),
        };
        Ok::<_, anyhow::Error>(ocr::page_text(eng.read(img)?))
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("No pude leer {what}: {e}"))
}

/// Pages of a PDF already read (by its sha256): a reading continues where it stopped.
#[tauri::command]
pub fn ocr_cached(state: State<'_, AppState>, hash: String) -> CmdResult<std::collections::BTreeMap<u32, ocr::PageText>> {
    ocr::Cache::new(&state.data_dir).get(&hash).map_err(err)
}

#[tauri::command]
pub fn ocr_cache_put(state: State<'_, AppState>, hash: String, page: u32, text: ocr::PageText) -> CmdResult<()> {
    ocr::Cache::new(&state.data_dir).put(&hash, page, text).map_err(err)
}

#[tauri::command]
pub fn ocr_cache_clear(state: State<'_, AppState>, hash: String) -> CmdResult<()> {
    ocr::Cache::new(&state.data_dir).clear(&hash).map_err(err)
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>) -> Vec<library::BookSummary> {
    state.library.list()
}

#[tauri::command]
pub fn get_book(state: State<'_, AppState>, id: String) -> CmdResult<library::Book> {
    state.library.load(&id).map_err(err)
}

#[tauri::command]
pub fn delete_book(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.library.delete(&id).map_err(err)
}

/// AC-70: BM25 over every book, locally.
#[tauri::command]
pub fn search_library(state: State<'_, AppState>, query: String, limit: Option<usize>) -> Vec<library::Hit> {
    state.library.search(&query, limit.unwrap_or(10).min(30))
}

// ── Carpetas de trabajo (AC-219..AC-222) ──

#[tauri::command]
pub fn folders_list(state: State<'_, AppState>) -> Vec<folders::Folder> {
    state.folders.all()
}

/// AC-219: the folder comes from a dialog opened here, never from a path the page sends.
#[tauri::command]
pub async fn folder_share(app: tauri::AppHandle, state: State<'_, AppState>, writable: bool) -> CmdResult<Option<folders::Folder>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tokio::task::spawn_blocking(move || app.dialog().file().set_title("Elegí la carpeta que querés compartir con Eureka").blocking_pick_folder())
        .await
        .map_err(err)?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(err)?;
    state.folders.add(&path, writable).map(Some).map_err(err)
}

#[tauri::command]
pub fn folder_remove(state: State<'_, AppState>, id: String) -> CmdResult<Vec<folders::Folder>> {
    state.folders.remove(&id).map_err(err)
}

#[tauri::command]
pub fn folder_set_writable(state: State<'_, AppState>, id: String, writable: bool) -> CmdResult<Vec<folders::Folder>> {
    state.folders.set_writable(&id, writable).map_err(err)
}

/// AC-220: applies the plan the teacher proposed in a session, once.
#[tauri::command]
pub fn folder_plan_apply(state: State<'_, AppState>, session_id: String, call_id: String) -> CmdResult<Session> {
    agent::folder_plan_apply(&state, &session_id, &call_id).map_err(err)
}

/// AC-220: puts the folder back as it was before the plan.
#[tauri::command]
pub fn folder_plan_undo(state: State<'_, AppState>, session_id: String, call_id: String) -> CmdResult<Session> {
    agent::folder_plan_undo(&state, &session_id, &call_id).map_err(err)
}
