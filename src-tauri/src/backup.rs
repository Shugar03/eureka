//! Backup and restore (AC-60): every learning data file in one .zip.
//! API keys (`auth.json`) and the code console's temporary folders are never
//! included. Restoring first saves a copy of the current data. The student's
//! memory (AC-195) goes as one consistent SQLite file: the store is closed
//! (WAL checkpointed) while the zip is written or restored, never its -wal/-shm.

use anyhow::{anyhow, Context, Result};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;

/// What a backup contains: these files and folders of the data dir.
pub const FILES: [&str; 3] = ["settings.json", "study_log.jsonl", "activity.json"];
pub const DIRS: [&str; 11] = ["sessions", "graph", "practice", "exams", "decks", "prompts", "profile", "projects", "library", "academic", "classes"];
pub const MAX_RESTORE_BYTES: usize = 200 * 1024 * 1024;
/// The student's memory: only the database file itself, never its WAL sidecars.
pub const MEMORY: &str = "memory/memoria.sqlite";

/// Relative paths (with `/`) of every file to back up.
pub fn entries(data_dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = FILES.iter().filter(|f| data_dir.join(f).is_file()).map(|f| f.to_string()).collect();
    for d in DIRS {
        let Ok(rd) = std::fs::read_dir(data_dir.join(d)) else { continue };
        let mut files: Vec<String> = rd.flatten().filter(|e| e.path().is_file()).filter_map(|e| e.file_name().to_str().map(|n| format!("{d}/{n}"))).filter(|n| !n.ends_with(".tmp")).collect();
        files.sort();
        out.extend(files);
    }
    if data_dir.join(MEMORY).is_file() {
        out.push(MEMORY.to_string());
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
    if name == MEMORY {
        return true;
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
    // The memory's sidecars belong to the file being replaced; without a memory
    // in the backup, the current one doesn't match the restored files either:
    // it goes, and the migration rebuilds it from them.
    let memory = data_dir.join(MEMORY);
    let has_memory = files.iter().any(|n| n.as_str() == MEMORY);
    for side in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{side}", memory.display()));
    }
    if !has_memory {
        let _ = std::fs::remove_file(&memory);
    }
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

/// The app's backup: the memory store stays closed while the zip is written.
pub fn backup_state(state: &crate::AppState, out: &Path) -> Result<usize> {
    state.memdb.closed(|| write_zip(&state.data_dir, out))
}

/// The app's restore: the store is closed while files are replaced, so the
/// restored database is the one reopened; then the migration fills it from the
/// restored files only if they were never loaded (student edits are never overwritten).
pub fn restore_state(state: &crate::AppState, bytes: &[u8], safety: &Path) -> Result<usize> {
    let n = state.memdb.closed(|| restore(&state.data_dir, bytes, safety))?;
    crate::memdb::migrate(state)?;
    Ok(n)
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
        for ok in ["settings.json", "study_log.jsonl", "sessions/a.json", "decks/x.json", "profile/learner.json", MEMORY] {
            assert!(allowed(ok), "{ok}");
        }
        for bad in ["memory/memoria.sqlite-wal", "memory/memoria.sqlite-shm", "memory/otra.sqlite", "auth.json", "../x", "sessions/../auth.json", "sessions/a/b.json", "C:/Windows/x", "/etc/passwd", "runs/x/main.py", "evil.exe", "sessions/"] {
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

#[cfg(test)]
mod memory_tests {
    use super::*;
    use crate::memdb::{Kind, Note};

    fn state(tag: &str) -> (crate::AppState, PathBuf) {
        let d = std::env::temp_dir().join(format!("la-backup-mem-{tag}-{}", uuid::Uuid::new_v4().simple()));
        (crate::AppState::new(d.clone()), d)
    }

    fn names(bytes: &[u8]) -> Vec<String> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().to_string()).collect()
    }

    #[test]
    fn the_memory_goes_in_the_backup_and_the_restored_one_is_used() {
        // A: a confusion the student corrected into «domina».
        let (a, da) = state("a");
        a.learner.update(|p| crate::learner::add_misconception(p, "La derivada", "es el área", false, "Sesión: x")).unwrap();
        crate::memdb::migrate(&a).unwrap();
        let id = a.memdb.list().unwrap()[0].id;
        a.memdb.edit(id, "La derivada", "ya la entiendo", Kind::Domina).unwrap();
        let zip_path = da.join("respaldo.zip");
        backup_state(&a, &zip_path).unwrap();
        let bytes = std::fs::read(&zip_path).unwrap();
        let n = names(&bytes);
        assert!(n.iter().any(|x| x == MEMORY), "{n:?}");
        assert!(!n.iter().any(|x| x.ends_with("-wal") || x.ends_with("-shm")), "never the sidecars: {n:?}");
        assert_eq!(a.memdb.list().unwrap().len(), 1, "A keeps working after the backup (the store reopens)");

        // B: its own memory, open, with something else in it.
        let (b, db) = state("b");
        b.memdb.note(Note::new(Kind::LeCuesta, "fracciones", "x", "memory:z", "Sesión: z", chrono::Utc::now())).unwrap();
        assert_eq!(b.memdb.list().unwrap()[0].title, "fracciones");
        restore_state(&b, &bytes, &db.join("antes.zip")).unwrap();
        let after = b.memdb.list().unwrap();
        assert_eq!(after.len(), 1, "the restored database, not the old open one: {after:?}");
        assert!(after[0].by_student && after[0].kind == Kind::Domina && after[0].content == "ya la entiendo");
        // The restored profile still has the old confusion: the migration doesn't bring it back over the edit.
        assert!(!after.iter().any(|o| o.kind == Kind::Confusion));
        // The safety copy of B has B's memory, consistent.
        assert!(names(&std::fs::read(db.join("antes.zip")).unwrap()).iter().any(|x| x == MEMORY));
        std::fs::remove_dir_all(da).ok();
        std::fs::remove_dir_all(db).ok();
    }

    #[test]
    fn a_backup_from_before_the_memory_rebuilds_it_from_the_restored_files() {
        let src = std::env::temp_dir().join(format!("la-backup-old-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(src.join("profile")).unwrap();
        let mut p = crate::learner::Profile::default();
        crate::learner::add_misconception(&mut p, "Integrales", "son derivadas", false, "Sesión: vieja");
        std::fs::write(src.join("profile/learner.json"), serde_json::to_string(&p).unwrap()).unwrap();
        let zip_path = src.join("viejo.zip");
        write_zip(&src, &zip_path).unwrap();
        let bytes = std::fs::read(&zip_path).unwrap();
        assert!(!names(&bytes).iter().any(|x| x == MEMORY));

        let (b, db) = state("old");
        b.memdb.note(Note::new(Kind::LeCuesta, "fracciones", "x", "memory:z", "Sesión: z", chrono::Utc::now())).unwrap();
        restore_state(&b, &bytes, &db.join("antes.zip")).unwrap();
        let after = b.memdb.list().unwrap();
        assert_eq!(after.iter().map(|o| o.title.as_str()).collect::<Vec<_>>(), vec!["Integrales"], "what the backup knew, nothing of the replaced data");
        std::fs::remove_dir_all(src).ok();
        std::fs::remove_dir_all(db).ok();
    }
}
