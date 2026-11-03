//! Backup and restore (AC-60): every learning data file in one .zip.
//! API keys (`auth.json`) and the code console's temporary folders are never
//! included. Restoring first saves a copy of the current data.

use anyhow::{anyhow, Context, Result};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;

/// What a backup contains: these files and folders of the data dir.
pub const FILES: [&str; 3] = ["settings.json", "study_log.jsonl", "activity.json"];
pub const DIRS: [&str; 11] = ["sessions", "graph", "practice", "exams", "decks", "prompts", "profile", "projects", "library", "academic", "classes"];
pub const MAX_RESTORE_BYTES: usize = 200 * 1024 * 1024;

/// Relative paths (with `/`) of every file to back up.
pub fn entries(data_dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = FILES.iter().filter(|f| data_dir.join(f).is_file()).map(|f| f.to_string()).collect();
    for d in DIRS {
        let Ok(rd) = std::fs::read_dir(data_dir.join(d)) else { continue };
        let mut files: Vec<String> = rd.flatten().filter(|e| e.path().is_file()).filter_map(|e| e.file_name().to_str().map(|n| format!("{d}/{n}"))).filter(|n| !n.ends_with(".tmp")).collect();
        files.sort();
        out.extend(files);
    }
    out
}

/// Only paths a backup can contain: a known file, or one level inside a
/// known folder, with no `..`, drive letters or absolute paths.
pub fn allowed(name: &str) -> bool {
    let p = Path::new(name);
    if !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return false;
    }
    let parts: Vec<&str> = name.split('/').collect();
    match parts.as_slice() {
        [f] => FILES.contains(f),
        [d, f] => DIRS.contains(d) && !f.is_empty() && !f.contains('\\'),
        _ => false,
    }
}

pub fn write_zip(data_dir: &Path, out: &Path) -> Result<usize> {
    let names = entries(data_dir);
    let mut zip = zip::ZipWriter::new(std::fs::File::create(out).context("no se pudo crear el archivo de respaldo")?);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for n in &names {
        zip.start_file(n.as_str(), opts)?;
        zip.write_all(&std::fs::read(data_dir.join(n))?)?;
    }
    zip.finish()?;
    Ok(names.len())
}

/// Restores a backup: validates every entry first (nothing is written if any
/// is unexpected), saves the current data to `safety`, then extracts.
pub fn restore(data_dir: &Path, bytes: &[u8], safety: &Path) -> Result<usize> {
    if bytes.len() > MAX_RESTORE_BYTES {
        return Err(anyhow!("El respaldo es demasiado grande."));
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| anyhow!("Ese archivo no es un respaldo de Eureka (.zip)."))?;
    let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).and_then(|f| f.name().map(|n| n.to_string()))).collect::<std::result::Result<_, _>>()?;
    let files: Vec<&String> = names.iter().filter(|n| !n.ends_with('/')).collect();
    if files.is_empty() || files.iter().any(|n| !allowed(n)) {
        return Err(anyhow!("Ese archivo no es un respaldo de Eureka: tiene contenido inesperado."));
    }
    write_zip(data_dir, safety)?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        if f.is_dir() {
            continue;
        }
        let target: PathBuf = data_dir.join(f.name()?.as_ref());
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        std::fs::write(target, buf)?;
    }
    Ok(files.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("la-backup-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_known_paths_are_allowed() {
        for ok in ["settings.json", "study_log.jsonl", "sessions/a.json", "decks/x.json", "profile/learner.json"] {
            assert!(allowed(ok), "{ok}");
        }
        for bad in ["auth.json", "../x", "sessions/../auth.json", "sessions/a/b.json", "C:/Windows/x", "/etc/passwd", "runs/x/main.py", "evil.exe", "sessions/"] {
            assert!(!allowed(bad), "{bad}");
        }
    }

    #[test]
    fn backup_skips_keys_and_restores_with_a_safety_copy() {
        let src = tmp("src");
        std::fs::write(src.join("settings.json"), "{}").unwrap();
        std::fs::write(src.join("auth.json"), "{\"k\":\"sk-secreta\"}").unwrap();
        std::fs::create_dir_all(src.join("sessions")).unwrap();
        std::fs::write(src.join("sessions/s1.json"), "{\"id\":\"s1\"}").unwrap();
        std::fs::write(src.join("sessions/s1.json.tmp"), "x").unwrap();
        std::fs::create_dir_all(src.join("runs/abc")).unwrap();
        std::fs::write(src.join("runs/abc/main.py"), "print(1)").unwrap();
        assert_eq!(entries(&src), ["settings.json", "sessions/s1.json"]);

        let zip_path = src.join("backup.zip");
        assert_eq!(write_zip(&src, &zip_path).unwrap(), 2);
        let bytes = std::fs::read(&zip_path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("sk-secreta"), "keys never go in a backup");

        let dst = tmp("dst");
        std::fs::write(dst.join("settings.json"), "{\"viejo\":true}").unwrap();
        let safety = dst.join("antes.zip");
        assert_eq!(restore(&dst, &bytes, &safety).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(dst.join("sessions/s1.json")).unwrap(), "{\"id\":\"s1\"}");
        assert_eq!(std::fs::read_to_string(dst.join("settings.json")).unwrap(), "{}");
        assert!(safety.is_file(), "the previous data was saved first");

        assert!(restore(&dst, b"no es un zip", &safety).is_err());
        let evil = dst.join("evil.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
        z.start_file("auth.json", SimpleFileOptions::default()).unwrap();
        z.write_all(b"{}").unwrap();
        z.finish().unwrap();
        assert!(restore(&dst, &std::fs::read(&evil).unwrap(), &safety).unwrap_err().to_string().contains("contenido inesperado"));
        std::fs::remove_dir_all(src).ok();
        std::fs::remove_dir_all(dst).ok();
    }
}
