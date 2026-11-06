//! Updates (distribution): like any desktop app, Eureka asks for a newer
//! signed installer and installs it. Releases are public on GitHub (the repo
//! is built in by the release script as EUREKA_UPDATE_REPO); no credential
//! travels in the app. A build without it (development, e2e) never checks.
//!
//! The installer must be signed with the key whose public half is in
//! tauri.conf.json: the plugin refuses anything else.
#![cfg_attr(mobile, allow(dead_code))]

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_updater::{Update, UpdaterExt};

const REPO: Option<&str> = option_env!("EUREKA_UPDATE_REPO");
/// The release asset the updater reads (written by scripts/release.cjs).
pub const MANIFEST: &str = "latest.json";

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Check {
    /// This build has no update source (development).
    Off,
    Current { version: String },
    Available { version: String, current: String, notes: String },
}

/// AC-202: how the installation goes, for the bar inside Eureka (the installer runs
/// without a window: `installMode: "quiet"` in tauri.conf.json).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "stage", rename_all = "lowercase")]
pub enum Progress {
    Downloading { done: u64, total: Option<u64> },
    /// Downloaded and verified: Eureka closes and the new version opens by itself.
    Installing,
}

/// AC-202: what the new version shows once, when it opens after updating itself.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct WhatsNew {
    pub version: String,
    pub from: String,
    pub notes: String,
}

/// Written right before the installer runs, read (and deleted) by the next start.
const MARKER: &str = "update-just-installed.json";

pub fn remember_whats_new(dir: &Path, w: &WhatsNew) -> Result<()> {
    std::fs::write(dir.join(MARKER), serde_json::to_vec(w)?)?;
    Ok(())
}

/// The news of the version that is running now, once. A marker left by an
/// installation that did not finish (another version) is dropped silently.
pub fn take_whats_new(dir: &Path, current: &str) -> Option<WhatsNew> {
    let path = dir.join(MARKER);
    let raw = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    serde_json::from_str::<WhatsNew>(&raw).ok().filter(|w| w.version == current)
}

/// The update found by the last check, kept until it is installed.
#[cfg(desktop)]
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);
/// Phones update through their store: there is never anything pending.
#[cfg(mobile)]
#[derive(Default)]
pub struct Pending(#[allow(dead_code)] Mutex<()>);

#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// Where the manifest of the latest release can be downloaded.
fn manifest_url(release_json: &str) -> Result<String> {
    let r: Release = serde_json::from_str(release_json).context("GitHub devolvió un release ilegible")?;
    r.assets.into_iter().find(|a| a.name == MANIFEST).map(|a| a.browser_download_url).ok_or_else(|| anyhow!("el último release no tiene {MANIFEST}"))
}

#[cfg(mobile)]
pub async fn check(_app: &AppHandle) -> Result<Check> {
    Ok(Check::Off)
}

#[cfg(mobile)]
pub async fn install(_app: &AppHandle, _data_dir: &Path, _progress: Channel<Progress>) -> Result<()> {
    Err(anyhow!("En el celular Eureka se actualiza desde la tienda."))
}

#[cfg(desktop)]
pub async fn check(app: &AppHandle) -> Result<Check> {
    let Some(repo) = REPO.filter(|r| !r.is_empty()) else { return Ok(Check::Off) };
    let current = app.package_info().version.to_string();
    let res = crate::llm::client()?
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Eureka")
        .send()
        .await
        .context("no pude conectarme para buscar actualizaciones")?;
    match res.status().as_u16() {
        200 => {}
        // No release yet: nothing newer than this one.
        404 => return Ok(Check::Current { version: current }),
        403 | 429 => return Err(anyhow!("GitHub pidió esperar un rato antes de volver a buscar actualizaciones")),
        s => return Err(anyhow!("GitHub respondió {s} al buscar actualizaciones")),
    }
    let url = manifest_url(&res.text().await?)?;
    let found = app.updater_builder().endpoints(vec![url.parse()?])?.build()?.check().await?;
    let out = match &found {
        Some(u) => Check::Available { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone().unwrap_or_default() },
        None => Check::Current { version: current },
    };
    *app.state::<Pending>().0.lock().unwrap() = found;
    Ok(out)
}

/// Downloads, verifies the signature and installs; on Windows the installer runs
/// without a window, closes the app and opens the new version.
#[cfg(desktop)]
pub async fn install(app: &AppHandle, data_dir: &Path, progress: Channel<Progress>) -> Result<()> {
    let update = app.state::<Pending>().0.lock().unwrap().take().ok_or_else(|| anyhow!("Primero buscá la actualización."))?;
    remember_whats_new(data_dir, &WhatsNew { version: update.version.clone(), from: update.current_version.clone(), notes: update.body.clone().unwrap_or_default() })?;
    let mut done = 0u64;
    let mut last = 0u64;
    let result = update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                // About every 512 KB: a smooth bar without flooding the IPC.
                if done - last >= 512 * 1024 || Some(done) == total {
                    last = done;
                    let _ = progress.send(Progress::Downloading { done, total });
                }
            },
            || {
                let _ = progress.send(Progress::Installing);
            },
        )
        .await;
    if let Err(e) = result {
        let _ = std::fs::remove_file(data_dir.join(MARKER));
        return Err(anyhow::Error::new(e).context("no se pudo instalar la actualización"));
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manifest_is_found_among_the_release_assets() {
        let raw = r#"{"tag_name":"v0.2.0","assets":[
            {"name":"Eureka_0.2.0_x64-setup.exe","browser_download_url":"https://github.com/o/r/releases/download/v0.2.0/Eureka_0.2.0_x64-setup.exe"},
            {"name":"latest.json","browser_download_url":"https://github.com/o/r/releases/download/v0.2.0/latest.json"}]}"#;
        assert_eq!(manifest_url(raw).unwrap(), "https://github.com/o/r/releases/download/v0.2.0/latest.json");
        assert!(manifest_url(r#"{"assets":[]}"#).unwrap_err().to_string().contains("latest.json"));
        assert!(manifest_url("{roto").is_err());
    }

    #[test]
    fn the_news_show_once_and_only_on_the_new_version() {
        let dir = std::env::temp_dir().join(format!("la-update-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.as_path();
        let w = WhatsNew { version: "0.7.0".into(), from: "0.6.0".into(), notes: "### Nuevo
- algo".into() };
        assert_eq!(take_whats_new(dir, "0.7.0"), None, "nothing installed yet");
        remember_whats_new(dir, &w).unwrap();
        assert_eq!(take_whats_new(dir, "0.7.0"), Some(w));
        assert_eq!(take_whats_new(dir, "0.7.0"), None, "only once");
        // An installation that did not finish: the old version opens, no news, marker gone.
        remember_whats_new(dir, &WhatsNew { version: "0.8.0".into(), from: "0.7.0".into(), notes: String::new() }).unwrap();
        assert_eq!(take_whats_new(dir, "0.7.0"), None);
        assert!(!dir.join(MARKER).exists());
    }

    #[test]
    fn progress_reaches_the_screen_by_stage() {
        assert_eq!(serde_json::to_value(Progress::Downloading { done: 5, total: Some(10) }).unwrap(), serde_json::json!({ "stage": "downloading", "done": 5, "total": 10 }));
        assert_eq!(serde_json::to_value(Progress::Installing).unwrap(), serde_json::json!({ "stage": "installing" }));
    }

    #[test]
    fn checks_report_their_status_for_the_screen() {
        assert_eq!(serde_json::to_value(Check::Off).unwrap(), serde_json::json!({ "status": "off" }));
        let a = Check::Available { version: "0.2.0".into(), current: "0.1.0".into(), notes: "x".into() };
        assert_eq!(serde_json::to_value(a).unwrap()["status"], "available");
    }
}
