// AC-219..AC-222: working folders.
use super::*;
use std::collections::BTreeMap;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("la-folders-{tag}-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn put(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn folder(root: &Path, writable: bool) -> Folder {
    Folder { id: "f1".into(), path: canonical(root).unwrap().to_string_lossy().to_string(), label: "Apuntes".into(), writable, added_at: Utc::now() }
}

/// Every file (outside Eureka's trash) with its content: the folder's fingerprint.
fn fingerprint(root: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let rel = rel_of(root, &e.path());
            if rel.starts_with(TRASH) {
                continue;
            }
            if e.path().is_dir() {
                out.insert(format!("{rel}/"), String::new());
                stack.push(e.path());
            } else {
                out.insert(rel, String::from_utf8_lossy(&std::fs::read(e.path()).unwrap()).to_string());
            }
        }
    }
    out
}

#[test]
fn nothing_outside_the_folder_is_reachable() {
    let root = tmp("bounds");
    let sibling = PathBuf::from(format!("{}2", root.display()));
    std::fs::create_dir_all(&sibling).unwrap();
    put(&root, "fisica/tp1.txt", "x");
    let r = canonical(&root).unwrap();
    assert!(resolve(&r, "fisica/tp1.txt").is_ok());
    assert!(resolve(&r, "nueva/carpeta/archivo.md").is_ok(), "a new path inside is fine");
    for bad in ["../afuera.txt", "fisica/../../x", "C:/Windows/win.ini", "/etc/passwd", "tp.txt:stream", "CON.txt", "nul", "fisica/.env", "notas. ", "id_rsa", "fisica/auth.json"] {
        assert!(resolve(&r, bad).is_err(), "{bad} must be refused");
    }
    // «C:\Apuntes2» is not inside «C:\Apuntes».
    assert!(!inside(&r, &canonical(&sibling).unwrap()));
    assert!(inside(&r, &r.join("fisica")));
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&sibling);
}

#[cfg(windows)]
#[test]
fn a_junction_that_points_outside_is_not_followed() {
    let root = tmp("junction");
    let outside = tmp("outside");
    put(&outside, "secreto.txt", "no");
    let link = root.join("atajo");
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
    if ok {
        let r = canonical(&root).unwrap();
        assert!(resolve(&r, "atajo/secreto.txt").is_err(), "the junction leads outside");
        // The overview does not list what is behind it either.
        let (entries, _) = walk(&r, &r);
        assert!(entries.iter().all(|e| !e.path.contains("secreto")));
    }
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&outside);
}

#[test]
fn drives_the_system_and_the_whole_profile_are_not_shared() {
    assert!(check_shareable(Path::new(if cfg!(windows) { "C:\\" } else { "/" })).is_err());
    assert!(check_shareable(Path::new("C:\\Windows\\System32")).is_err());
    assert!(check_shareable(Path::new("C:\\Program Files\\App")).is_err());
    assert!(check_shareable(Path::new("C:\\Users\\x\\AppData\\Roaming")).is_err());
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        assert!(check_shareable(Path::new(&home)).is_err());
        assert!(check_shareable(&Path::new(&home).join("Documentos").join("Facultad")).is_ok());
    }
}

#[test]
fn the_overview_shows_the_tree_and_first_lines_but_never_private_files() {
    let root = tmp("overview");
    put(&root, "fisica/tp1.txt", "Trabajo práctico 1: cinemática y movimiento rectilíneo");
    put(&root, "notas.md", "# Análisis\nLímites y derivadas");
    put(&root, ".env", "API_KEY=secreto");
    put(&root, "claves.pem", "-----BEGIN");
    let f = folder(&root, false);
    let (text, meta) = overview(&f, "").unwrap();
    assert!(text.contains("fisica/tp1.txt") && text.contains("cinemática"), "{text}");
    assert!(text.contains("notas.md") && text.contains("Límites y derivadas"));
    assert!(!text.contains(".env") && !text.contains("secreto") && !text.contains("claves.pem"));
    assert!(text.starts_with("<datos_de_archivos>"), "file content is marked as data");
    assert_eq!((meta["files"].as_u64(), meta["dirs"].as_u64()), (Some(2), Some(1)));
    let (page, _) = read(&f, "notas.md", 0).unwrap();
    assert!(page.contains("Límites y derivadas"));
    assert!(read(&f, ".env", 0).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_plan_is_checked_as_if_it_ran_and_never_overwrites() {
    let root = tmp("validate");
    put(&root, "tp1.txt", "a");
    put(&root, "tp2.txt", "b");
    let f = folder(&root, true);
    let ok = validate(&f, vec![Op::Mkdir { path: "Física".into() }, Op::Move { from: "tp1.txt".into(), to: "Física/TP 1.txt".into() }, Op::Move { from: "Física/TP 1.txt".into(), to: "Física/TP 1 - cinemática.txt".into() }]);
    assert!(ok.is_ok(), "{ok:?}");
    let err = |ops: Vec<Op>| validate(&f, ops).unwrap_err().to_string();
    assert!(err(vec![Op::Move { from: "tp1.txt".into(), to: "tp2.txt".into() }]).contains("no piso"));
    assert!(err(vec![Op::Move { from: "tp1.txt".into(), to: "a.txt".into() }, Op::Move { from: "tp1.txt".into(), to: "b.txt".into() }]).contains("ya lo movió"));
    assert!(err(vec![Op::Write { path: "x.exe".into(), content: "".into() }]).contains(".md"));
    assert!(err(vec![Op::Move { from: "tp1.txt".into(), to: "../afuera.txt".into() }]).contains(".."));
    assert!(err(vec![]).contains("no tiene cambios"));
    assert!(validate(&folder(&root, false), vec![Op::Mkdir { path: "x".into() }]).unwrap_err().to_string().contains("solo leer"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn applying_and_undoing_leaves_the_folder_exactly_as_it_was() {
    let root = tmp("roundtrip");
    let data = tmp("data");
    put(&root, "tp1.txt", "cinemática");
    put(&root, "tp2.txt", "dinámica");
    put(&root, "viejo/borrador.txt", "duplicado");
    let f = folder(&root, true);
    let before = fingerprint(&root);
    let ops = vec![
        Op::Mkdir { path: "Física".into() },
        Op::Move { from: "tp1.txt".into(), to: "Física/TP 1 - cinemática.txt".into() },
        Op::Move { from: "tp2.txt".into(), to: "Física/Parciales/TP 2.txt".into() },
        Op::Trash { path: "viejo".into() },
        Op::Write { path: "Índice.md".into(), content: "# Índice".into() },
        Op::Xlsx { path: "Física/Notas.xlsx".into(), sheets: vec![SheetSpec { name: "Notas".into(), columns: vec!["TP".into(), "Nota".into()], rows: vec![vec![json!("1"), json!(8)]] }] },
        Op::Docx { path: "Resumen.docx".into(), title: "Resumen".into(), blocks: vec![Block::Paragraph { text: "Hola".into() }] },
    ];
    let j = apply(&data, &f, "p1", ops.clone()).unwrap();
    assert!(j.error.is_none(), "{:?}", j.error);
    let after = fingerprint(&root);
    assert!(after.contains_key("Física/TP 1 - cinemática.txt") && after.contains_key("Física/Parciales/TP 2.txt"));
    assert!(after.contains_key("Índice.md") && after.contains_key("Física/Notas.xlsx") && after.contains_key("Resumen.docx"));
    assert!(!after.contains_key("viejo/borrador.txt"), "put aside, not here");
    assert!(root.join(TRASH).join("p1").join("viejo").join("borrador.txt").exists(), "never deleted: in the trash");
    // The same plan applies once.
    assert!(apply(&data, &f, "p1", ops).is_err());
    let report = undo(&data, &f, "p1").unwrap();
    assert!(report.kept.is_empty(), "{report:?}");
    assert_eq!(fingerprint(&root), before, "exactly as it was");
    assert!(!root.join(TRASH).exists(), "an empty trash goes too");
    assert!(undo(&data, &f, "p1").is_err(), "undone once");
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&data);
}

#[test]
fn undo_keeps_a_document_the_person_edited_afterwards() {
    let root = tmp("edited");
    let data = tmp("data2");
    let f = folder(&root, true);
    apply(&data, &f, "p2", vec![Op::Write { path: "notas.md".into(), content: "uno".into() }]).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    std::fs::write(root.join("notas.md"), "uno, y lo que agregué").unwrap();
    let report = undo(&data, &f, "p2").unwrap();
    assert_eq!(report.kept, vec!["notas.md".to_string()]);
    assert!(root.join("notas.md").exists());
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&data);
}

#[test]
fn a_step_that_fails_stops_the_plan_and_what_was_done_can_be_undone() {
    let root = tmp("fails");
    let data = tmp("data3");
    put(&root, "a.txt", "a");
    let f = folder(&root, true);
    let before = fingerprint(&root);
    // Valid when proposed; the file vanishes before the second step runs.
    let ops = vec![Op::Mkdir { path: "Nueva".into() }, Op::Move { from: "a.txt".into(), to: "Nueva/a.txt".into() }];
    let validated = validate(&f, ops).unwrap();
    std::fs::remove_file(root.join("a.txt")).unwrap();
    let j = apply(&data, &f, "p3", validated);
    // Re-validation catches it before anything moves.
    assert!(j.is_err());
    std::fs::write(root.join("a.txt"), "a").unwrap();
    assert_eq!(fingerprint(&root), before);
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&data);
}

#[test]
fn the_planner_answer_is_validated_like_any_plan() {
    let root = tmp("planner");
    put(&root, "tp1.txt", "a");
    let f = folder(&root, true);
    let good = json!({ "summary": "Por materia", "ops": [{ "op": "mkdir", "path": "Física" }, { "op": "move", "from": "tp1.txt", "to": "Física/tp1.txt" }] }).to_string();
    let (summary, ops) = parse_plan(&good, &f).unwrap();
    assert_eq!(summary, "Por materia");
    assert_eq!(counts(&ops), "1 carpetas nuevas, 1 movidos o renombrados");
    let bad = json!({ "summary": "x", "ops": [{ "op": "move", "from": "no-existe.txt", "to": "b.txt" }] }).to_string();
    assert!(parse_plan(&bad, &f).unwrap_err().to_string().contains("no existe"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn shared_folders_persist_once_each_with_their_permission() {
    let data = tmp("store");
    let a = tmp("share");
    let store = FolderStore::new(&data);
    let f = store.add(&a, false).unwrap();
    assert_eq!(store.add(&a, true).unwrap().id, f.id, "the same folder twice keeps the first");
    assert!(!store.get(&f.id).unwrap().writable);
    store.set_writable(&f.id, true).unwrap();
    assert!(store.find(&f.label).unwrap().writable);
    assert!(store.find("otra").unwrap_err().to_string().contains(&f.label));
    assert!(store.remove(&f.id).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&data);
    let _ = std::fs::remove_dir_all(&a);
}
