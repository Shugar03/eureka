//! Anki's own package (.apkg), both ways (AC-152, AC-153). An .apkg is a zip
//! with the collection as SQLite: `collection.anki21b` (zstd, Anki 2.1.50+),
//! `collection.anki21` or `collection.anki2` (older). Only the notes' fields
//! are read — never the note types' config, the media or the scheduling.
//! Export writes the classic schema (11), which every Anki version imports.

use anyhow::{anyhow, bail, Context, Result};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::json;
use std::io::{Read, Write};
use std::path::Path;

/// The whole package, media included (only the collection is read).
pub const MAX_APKG_BYTES: usize = 500 * 1024 * 1024;
/// The collection, once decompressed.
const MAX_COLLECTION_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_NOTES: usize = 30_000;
/// What a modern export leaves in `collection.anki2` for old versions.
const UPDATE_NOTICE: &str = "please update to the latest anki version";

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct Imported {
    pub cards: Vec<(String, String)>,
    /// Notes left out: no text on a side (only an image or a sound), or empty.
    pub media_only: usize,
    pub empty: usize,
}

/// An Anki field (HTML) as the text Eureka shows: Markdown-ish, math in `$`.
pub fn field_text(html: &str) -> String {
    let mut s = html.to_string();
    for (from, to) in [("<br>", "\n"), ("<br/>", "\n"), ("<br />", "\n"), ("</div>", "\n"), ("</p>", "\n"), ("</li>", "\n")] {
        s = replace_ci(&s, from, to);
    }
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = strip_sounds(&out);
    let out = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        // MathJax (Anki) to the `$` KaTeX reads.
        .replace("\\[", "$$")
        .replace("\\]", "$$")
        .replace("\\(", "$")
        .replace("\\)", "$");
    let mut lines: Vec<&str> = out.lines().map(str::trim_end).collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let joined = lines.join("\n");
    let mut tidy = String::new();
    for part in joined.split("\n\n\n") {
        if !tidy.is_empty() {
            tidy.push_str("\n\n");
        }
        tidy.push_str(part);
    }
    tidy.trim().to_string()
}

fn replace_ci(s: &str, from: &str, to: &str) -> String {
    let lower = s.to_lowercase();
    if lower.len() != s.len() {
        return s.replace(from, to);
    }
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(pos) = lower[i..].find(from) {
        out.push_str(&s[i..i + pos]);
        out.push_str(to);
        i += pos + from.len();
    }
    out.push_str(&s[i..]);
    out
}

/// `[sound:x.mp3]` references say nothing without the file.
fn strip_sounds(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find("[sound:") {
        out.push_str(&rest[..i]);
        rest = match rest[i..].find(']') {
            Some(j) => &rest[i + j + 1..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// True when the field shows something other than text (image, sound, video).
fn has_media(html: &str) -> bool {
    let l = html.to_lowercase();
    l.contains("<img") || l.contains("[sound:") || l.contains("<audio") || l.contains("<video")
}

/// `{{c1::respuesta::pista}}` → the front hides it (`[pista]` or `[…]`), the back shows it.
pub fn cloze(text: &str) -> Option<(String, String)> {
    if !text.contains("{{c") {
        return None;
    }
    let (mut front, mut back, mut rest, mut found) = (String::new(), String::new(), text, false);
    while let Some(i) = rest.find("{{c") {
        let after = &rest[i + 3..];
        let digits = after.chars().take_while(char::is_ascii_digit).count();
        let (Some(body), true) = (after[digits..].strip_prefix("::"), digits > 0) else {
            front.push_str(&rest[..i + 3]);
            back.push_str(&rest[..i + 3]);
            rest = after;
            continue;
        };
        let Some(end) = body.find("}}") else { break };
        let inner = &body[..end];
        let (answer, hint) = inner.split_once("::").map(|(a, h)| (a, Some(h))).unwrap_or((inner, None));
        front.push_str(&rest[..i]);
        back.push_str(&rest[..i]);
        front.push_str(&format!("[{}]", hint.unwrap_or("…")));
        back.push_str(answer);
        rest = &body[end + 2..];
        found = true;
    }
    front.push_str(rest);
    back.push_str(rest);
    found.then_some((front, back))
}

/// One note's fields (already split) as a card: front is the first field,
/// the back the rest with text; a cloze note shows its own text on both sides.
pub fn note_card(fields: &[&str]) -> std::result::Result<(String, String), bool> {
    let texts: Vec<String> = fields.iter().map(|f| field_text(f)).collect();
    let media = fields.iter().any(|f| has_media(f));
    let first = texts.first().cloned().unwrap_or_default();
    if let Some((front, back)) = cloze(&first) {
        let extra: Vec<&str> = texts[1..].iter().map(String::as_str).filter(|t| !t.is_empty()).collect();
        let back = if extra.is_empty() { back } else { format!("{back}\n\n{}", extra.join("\n\n")) };
        return Ok((front.trim().to_string(), back.trim().to_string()));
    }
    let back: Vec<&str> = texts.iter().skip(1).map(String::as_str).filter(|t| !t.is_empty()).collect();
    if first.is_empty() || back.is_empty() {
        return Err(media);
    }
    Ok((first, back.join("\n\n")))
}

/// The collection inside the package, decompressed when it is the modern one.
fn collection(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| anyhow!("Ese archivo no es un paquete de Anki (.apkg)."))?;
    for name in ["collection.anki21b", "collection.anki21", "collection.anki2"] {
        let Ok(f) = zip.by_name(name) else { continue };
        let mut out = Vec::new();
        if name.ends_with('b') {
            let mut dec = ruzstd::decoding::StreamingDecoder::new(f).map_err(|e| anyhow!("No pude abrir el paquete de Anki: {e}"))?;
            (&mut dec).take(MAX_COLLECTION_BYTES + 1).read_to_end(&mut out).context("No pude abrir el paquete de Anki")?;
        } else {
            f.take(MAX_COLLECTION_BYTES + 1).read_to_end(&mut out).context("No pude abrir el paquete de Anki")?;
        }
        if out.len() as u64 > MAX_COLLECTION_BYTES {
            bail!("El mazo de Anki es demasiado grande.");
        }
        return Ok(out);
    }
    bail!("Ese archivo no tiene un mazo de Anki adentro. En Anki: Archivo → Exportar → «Paquete de mazos de Anki (.apkg)».")
}

/// Reads the cards of an .apkg. `scratch` is a folder for the SQLite file
/// (SQLite reads files, not memory); it is removed before returning.
pub fn read_apkg(bytes: &[u8], scratch: &Path) -> Result<Imported> {
    if bytes.len() > MAX_APKG_BYTES {
        bail!("El paquete de Anki es demasiado grande (máximo 500 MB).");
    }
    let db = collection(bytes)?;
    std::fs::create_dir_all(scratch)?;
    let path = scratch.join(format!("anki-{}.sqlite", uuid::Uuid::new_v4().simple()));
    std::fs::write(&path, &db)?;
    let result = read_notes(&path);
    let _ = std::fs::remove_file(&path);
    result
}

fn read_notes(path: &Path) -> Result<Imported> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| anyhow!("El paquete de Anki está dañado."))?;
    let count: i64 = conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0)).map_err(|_| anyhow!("El paquete de Anki está dañado."))?;
    if count as usize > MAX_NOTES {
        bail!("El mazo tiene {count} notas: el máximo es {MAX_NOTES}. Exportá un submazo desde Anki.");
    }
    let mut stmt = conn.prepare("SELECT flds FROM notes ORDER BY id")?;
    let mut rows = stmt.query([])?;
    let mut out = Imported::default();
    while let Some(row) = rows.next()? {
        let flds: String = row.get(0)?;
        let fields: Vec<&str> = flds.split('\u{1f}').collect();
        match note_card(&fields) {
            Ok((front, _)) if front.to_lowercase().starts_with(UPDATE_NOTICE) => {}
            Ok(card) => out.cards.push(card),
            Err(true) => out.media_only += 1,
            Err(false) => out.empty += 1,
        }
    }
    Ok(out)
}

// ── Export ──

/// Eureka's text as an Anki field: HTML-escaped, line breaks, math for MathJax.
pub fn to_field(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text.trim();
    // `$$…$$` → `\[…\]` and `$…$` → `\(…\)`, outside of math nothing changes.
    while let Some(i) = rest.find('$') {
        out.push_str(&escape(&rest[..i]));
        let display = rest[i..].starts_with("$$");
        let open = if display { 2 } else { 1 };
        let body = &rest[i + open..];
        let close = if display { body.find("$$") } else { body.find('$') };
        match close {
            Some(j) if j > 0 => {
                let (l, r) = if display { ("\\[", "\\]") } else { ("\\(", "\\)") };
                out.push_str(l);
                out.push_str(&escape(&body[..j]));
                out.push_str(r);
                rest = &body[j + open..];
            }
            _ => {
                out.push_str(&rest[i..i + open]);
                rest = body;
            }
        }
    }
    out.push_str(&escape(rest));
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace("\r\n", "\n").replace('\n', "<br>")
}

/// Anki's duplicate check: the first 8 hex digits of the SHA-1 of the sort field.
fn checksum(text: &str) -> i64 {
    let hex = sha1_smol::Sha1::from(text).digest().to_string();
    i64::from_str_radix(&hex[..8], 16).unwrap_or(0)
}

const SCHEMA: &str = "
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
";

/// The `col` row's JSON: one Basic note type ("Eureka") and the deck.
fn col_json(deck_id: i64, model_id: i64, deck: &str, now: i64) -> (String, String, String, String) {
    let conf = json!({ "activeDecks": [1], "curDeck": 1, "newSpread": 0, "collapseTime": 1200, "timeLim": 0, "estTimes": true, "dueCounts": true, "curModel": model_id.to_string(), "nextPos": 1, "sortType": "noteFld", "sortBackwards": false, "addToCur": true });
    let field = |name: &str, ord: u32| json!({ "name": name, "ord": ord, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "media": [] });
    let models = json!({ model_id.to_string(): {
        "id": model_id, "name": "Eureka (básico)", "type": 0, "mod": now, "usn": -1, "sortf": 0, "did": deck_id,
        "tmpls": [{ "name": "Tarjeta 1", "ord": 0, "qfmt": "{{Frente}}", "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n{{Dorso}}", "did": null, "bqfmt": "", "bafmt": "" }],
        "flds": [field("Frente", 0), field("Dorso", 1)],
        "css": ".card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n",
        "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}", "tags": [], "vers": [], "req": [[0, "all", [0]]]
    }});
    let deck_entry = |id: i64, name: &str| json!({ "id": id, "name": name, "desc": "", "mod": now, "usn": -1, "collapsed": false, "newToday": [0, 0], "revToday": [0, 0], "lrnToday": [0, 0], "timeToday": [0, 0], "dyn": 0, "conf": 1, "extendNew": 10, "extendRev": 50 });
    let decks = json!({ "1": deck_entry(1, "Default"), deck_id.to_string(): deck_entry(deck_id, deck) });
    let dconf = json!({ "1": {
        "id": 1, "name": "Default", "mod": 0, "usn": 0, "maxTaken": 60, "autoplay": true, "timer": 0, "replayq": true, "dyn": false,
        "new": { "perDay": 20, "delays": [1, 10], "separate": true, "ints": [1, 4, 7], "initialFactor": 2500, "bury": true, "order": 1 },
        "lapse": { "leechFails": 8, "minInt": 1, "delays": [10], "leechAction": 0, "mult": 0 },
        "rev": { "perDay": 200, "fuzz": 0.05, "ivlFct": 1, "maxIvl": 36500, "ease4": 1.3, "bury": true, "minSpace": 1 }
    }});
    (conf.to_string(), models.to_string(), decks.to_string(), dconf.to_string())
}

/// Writes an .apkg with every card as new (the review history stays in Eureka).
pub fn write_apkg(deck: &str, cards: &[(String, String)], scratch: &Path) -> Result<Vec<u8>> {
    if cards.is_empty() {
        bail!("El mazo no tiene tarjetas para exportar.");
    }
    std::fs::create_dir_all(scratch)?;
    let path = scratch.join(format!("anki-{}.anki2", uuid::Uuid::new_v4().simple()));
    let result = write_collection(&path, deck, cards).and_then(|_| std::fs::read(&path).map_err(Into::into));
    let _ = std::fs::remove_file(&path);
    let db = result?;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("collection.anki2", opts)?;
    zip.write_all(&db)?;
    zip.start_file("media", opts)?;
    zip.write_all(b"{}")?;
    Ok(zip.finish()?.into_inner())
}

fn write_collection(path: &Path, deck: &str, cards: &[(String, String)]) -> Result<()> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let now = now_ms / 1000;
    let (deck_id, model_id) = (now_ms, now_ms + 1);
    let (conf, models, decks, dconf) = col_json(deck_id, model_id, deck, now);
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO col VALUES (1, ?1, ?2, ?2, 11, 0, 0, 0, ?3, ?4, ?5, ?6, '{}')", rusqlite::params![now - now % 86_400, now_ms, conf, models, decks, dconf])?;
    for (i, (front, back)) in cards.iter().enumerate() {
        let (f, b) = (to_field(front), to_field(back));
        let id = now_ms + 10 + i as i64;
        let guid = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let sort = field_text(&f);
        tx.execute(
            "INSERT INTO notes VALUES (?1, ?2, ?3, ?4, -1, '', ?5, ?6, ?7, 0, '')",
            rusqlite::params![id, guid, model_id, now, format!("{f}\u{1f}{b}"), sort, checksum(&sort)],
        )?;
        tx.execute("INSERT INTO cards VALUES (?1, ?1, ?2, 0, ?3, -1, 0, 0, ?4, 0, 0, 0, 0, 0, 0, 0, 0, '')", rusqlite::params![id, deck_id, now, i as i64 + 1])?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("eureka-anki-{}", uuid::Uuid::new_v4().simple()))
    }

    /// A package as Anki writes it: the collection under `name`, zstd for anki21b.
    fn package(name: &str, notes: &[&str]) -> Vec<u8> {
        let dir = scratch();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("c.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE notes (id integer primary key, flds text not null);").unwrap();
        for (i, n) in notes.iter().enumerate() {
            conn.execute("INSERT INTO notes VALUES (?1, ?2)", rusqlite::params![i as i64 + 1, n]).unwrap();
        }
        drop(conn);
        let db = std::fs::read(&path).unwrap();
        std::fs::remove_dir_all(dir).ok();
        let body = if name.ends_with('b') { ruzstd::encoding::compress_to_vec(&db[..], ruzstd::encoding::CompressionLevel::Fastest) } else { db };
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file(name, opts).unwrap();
        zip.write_all(&body).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn fields_become_text_with_math_and_without_media() {
        assert_eq!(field_text("Capital de <b>Francia</b>?<br>Pista: &quot;P&quot;&nbsp;"), "Capital de Francia?\nPista: \"P\"");
        assert_eq!(field_text("<div>Uno</div><div>Dos</div>"), "Uno\nDos");
        assert_eq!(field_text("La derivada \\(x^2\\) es \\[2x\\]"), "La derivada $x^2$ es $$2x$$");
        assert_eq!(field_text("Hola [sound:hola.mp3]<img src=\"a.png\">"), "Hola");
        assert_eq!(field_text("A &amp;lt; B"), "A &lt; B", "decoded once, not twice");
    }

    #[test]
    fn a_cloze_hides_each_gap_on_the_front_and_shows_it_on_the_back() {
        assert_eq!(cloze("La {{c1::mitocondria}} produce {{c2::ATP::una molécula}}."), Some(("La […] produce [una molécula].".into(), "La mitocondria produce ATP.".into())));
        assert_eq!(cloze("sin huecos"), None);
        assert_eq!(cloze("{{cosa}}"), None, "not a cloze");
    }

    #[test]
    fn a_note_is_a_card_unless_a_side_is_only_media() {
        assert_eq!(note_card(&["Hola", "Hello"]), Ok(("Hola".into(), "Hello".into())));
        assert_eq!(note_card(&["perro", "dog", "", "Ejemplo: el perro ladra"]), Ok(("perro".into(), "dog\n\nEjemplo: el perro ladra".into())), "the rest of the fields go to the back");
        assert_eq!(note_card(&["{{c1::París}} es la capital", "Extra"]), Ok(("[…] es la capital".into(), "París es la capital\n\nExtra".into())));
        assert_eq!(note_card(&["<img src=\"x.png\">", "Un gato"]), Err(true));
        assert_eq!(note_card(&["Sin dorso", ""]), Err(false));
    }

    #[test]
    fn a_modern_package_is_read_from_anki21b_and_never_its_update_notice() {
        let notes = ["Hola\u{1f}Hello", "<img src=\"a.png\">\u{1f}gato", "{{c1::Agua}} es H2O\u{1f}"];
        let bytes = package("collection.anki21b", &notes);
        let got = read_apkg(&bytes, &scratch()).unwrap();
        assert_eq!(got.cards, vec![("Hola".to_string(), "Hello".to_string()), ("[…] es H2O".to_string(), "Agua es H2O".to_string())]);
        assert_eq!((got.media_only, got.empty), (1, 0));

        // A modern export also carries a legacy collection with one notice note.
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let legacy = package("collection.anki2", &["Please update to the latest Anki version, then import the .colpkg/.apkg file again.\u{1f}"]);
        let mut legacy_zip = zip::ZipArchive::new(std::io::Cursor::new(legacy)).unwrap();
        let mut legacy_db = Vec::new();
        legacy_zip.by_name("collection.anki2").unwrap().read_to_end(&mut legacy_db).unwrap();
        let mut modern_zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut modern_db = Vec::new();
        modern_zip.by_name("collection.anki21b").unwrap().read_to_end(&mut modern_db).unwrap();
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("collection.anki2", opts).unwrap();
        zip.write_all(&legacy_db).unwrap();
        zip.start_file("collection.anki21b", opts).unwrap();
        zip.write_all(&modern_db).unwrap();
        let both = zip.finish().unwrap().into_inner();
        assert_eq!(read_apkg(&both, &scratch()).unwrap().cards.len(), 2, "anki21b wins over the legacy notice");

        let only_notice = package("collection.anki2", &["Please update to the latest Anki version, then import the .colpkg/.apkg file again.\u{1f}"]);
        assert!(read_apkg(&only_notice, &scratch()).unwrap().cards.is_empty());
    }

    #[test]
    fn the_fixture_package_written_by_another_sqlite_reads_whole() {
        let bytes = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/mazo-anki.apkg")).unwrap();
        let got = read_apkg(&bytes, &scratch()).unwrap();
        assert_eq!(
            got.cards,
            vec![
                ("Hola".to_string(), "Hello".to_string()),
                ("La […] produce ATP.".to_string(), "La mitocondria produce ATP.".to_string()),
                ("La derivada de $x^2$".to_string(), "$2x$".to_string()),
            ]
        );
        assert_eq!(got.media_only, 1);
    }

    #[test]
    fn a_wrong_file_says_what_to_export_from_anki() {
        assert!(read_apkg(b"not a zip", &scratch()).unwrap_err().to_string().contains(".apkg"));
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("otra.txt", zip::write::SimpleFileOptions::default()).unwrap();
        let empty = zip.finish().unwrap().into_inner();
        assert!(read_apkg(&empty, &scratch()).unwrap_err().to_string().contains("Paquete de mazos de Anki"));
    }

    #[test]
    fn math_and_markup_travel_to_anki_escaped() {
        assert_eq!(to_field("a < b & c\nlínea"), "a &lt; b &amp; c<br>línea");
        assert_eq!(to_field("Si $x^2$ entonces $$\\int f$$"), "Si \\(x^2\\) entonces \\[\\int f\\]");
        assert_eq!(to_field("cuesta $5"), "cuesta $5", "a lone dollar is not math");
        assert_eq!(field_text(&to_field("Si $x<1$\nfin")), "Si $x<1$\nfin", "and back");
    }

    #[test]
    fn an_exported_package_is_a_classic_collection_that_reads_back() {
        let cards = vec![("¿Capital de Francia?".to_string(), "París".to_string()), ("$2+2$".to_string(), "4\ncuatro".to_string())];
        let bytes = write_apkg("Geografía", &cards, &scratch()).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
        let mut media = String::new();
        zip.by_name("media").unwrap().read_to_string(&mut media).unwrap();
        assert_eq!(media, "{}");
        assert_eq!(read_apkg(&bytes, &scratch()).unwrap().cards, cards);

        let dir = scratch();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("c.anki2");
        let mut db = Vec::new();
        zip.by_name("collection.anki2").unwrap().read_to_end(&mut db).unwrap();
        std::fs::write(&path, db).unwrap();
        let conn = Connection::open(&path).unwrap();
        let (ver, decks, models): (i64, String, String) = conn.query_row("SELECT ver, decks, models FROM col", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(ver, 11);
        assert!(decks.contains("\"Geografía\""));
        let models: serde_json::Value = serde_json::from_str(&models).unwrap();
        let model = models.as_object().unwrap().values().next().unwrap();
        assert_eq!(model["flds"].as_array().unwrap().len(), 2);
        let (cards_n, new_n, sort, csum): (i64, i64, String, i64) = conn
            .query_row("SELECT (SELECT count(*) FROM cards), (SELECT count(*) FROM cards WHERE type = 0 AND queue = 0), (SELECT sfld FROM notes ORDER BY id LIMIT 1), (SELECT csum FROM notes ORDER BY id LIMIT 1)", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        assert_eq!((cards_n, new_n), (2, 2), "every card goes as new");
        assert_eq!(sort, "¿Capital de Francia?");
        assert_eq!(csum, i64::from_str_radix(&sha1_smol::Sha1::from("¿Capital de Francia?").digest().to_string()[..8], 16).unwrap());
        drop(conn);
        std::fs::remove_dir_all(dir).ok();
        assert!(write_apkg("Vacío", &[], &scratch()).is_err());
    }
}
