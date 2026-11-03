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
use std::sync::Mutex;
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
pub async fn install(_app: &AppHandle) -> Result<()> {
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

/// Downloads, verifies the signature and installs; on Windows the installer
/// closes the app and opens the new version.
#[cfg(desktop)]
pub async fn install(app: &AppHandle) -> Result<()> {
    let update = app.state::<Pending>().0.lock().unwrap().take().ok_or_else(|| anyhow!("Primero buscá la actualización."))?;
    update.download_and_install(|_, _| {}, || {}).await.context("no se pudo instalar la actualización")?;
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
    fn checks_report_their_status_for_the_screen() {
        assert_eq!(serde_json::to_value(Check::Off).unwrap(), serde_json::json!({ "status": "off" }));
        let a = Check::Available { version: "0.2.0".into(), current: "0.1.0".into(), notes: "x".into() };
        assert_eq!(serde_json::to_value(a).unwrap()["status"], "available");
    }
}
