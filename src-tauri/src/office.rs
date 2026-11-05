//! AC-191: Word, PowerPoint, EPUB and OpenDocument text into the library, converted
//! to Markdown on this PC with anydoc (Firecrawl, MIT, pure Rust). Headings become
//! `#`–`###`, which `library::sections` splits on; a slide's title is a `##`.
//! anydoc carries its own decompression and nesting limits (zip bombs fail with
//! `ResourceLimit`); this adds a cap on the file itself.

use anyhow::{bail, Result};

/// Bigger than any reading a student is handed; the Markdown has its own cap.
pub const MAX_BYTES: usize = 50 * 1024 * 1024;

/// The formats this converts, by extension (the picker only offers these).
pub fn format_of(file_name: &str) -> Option<anydoc::Format> {
    let ext = file_name.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "docx" => anydoc::Format::Docx,
        "pptx" => anydoc::Format::Pptx,
        "epub" => anydoc::Format::Epub,
        "odt" => anydoc::Format::Odt,
        _ => return None,
    })
}

pub fn to_markdown(file_name: &str, bytes: &[u8]) -> Result<String> {
    let Some(format) = format_of(file_name) else { bail!("Por ahora la biblioteca lee Word (.docx), PowerPoint (.pptx), EPUB y OpenDocument (.odt).") };
    if bytes.len() > MAX_BYTES {
        bail!("El archivo es demasiado grande (más de 50 MB).");
    }
    let md = anydoc::to_markdown_bytes(bytes, format).map_err(|e| match e {
        anydoc::ConvertError::Encrypted => anyhow::anyhow!("El archivo tiene contraseña: abrilo, guardalo sin contraseña y probá de nuevo."),
        anydoc::ConvertError::ResourceLimit { .. } => anyhow::anyhow!("El archivo es demasiado grande para leerlo."),
        _ => anyhow::anyhow!("No pude leer {file_name}: parece dañado o no es lo que dice su extensión."),
    })?;
    Ok(drop_empty_headings(&md))
}

/// The upload as `libraryApi.importDocument` frames it: a u32 (LE) length, then
/// `{title, fileName}` as JSON, then the file. Raw bytes: a JSON array of numbers
/// would be ~4 times the file.
pub fn parse_upload(body: &[u8]) -> Result<(String, String, &[u8])> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Head {
        title: String,
        file_name: String,
    }
    let n = body.get(..4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize).unwrap_or(usize::MAX);
    let Some(head) = body.get(4..4usize.saturating_add(n)) else { bail!("El archivo llegó incompleto.") };
    let head: Head = serde_json::from_slice(head).map_err(|_| anyhow::anyhow!("El archivo llegó incompleto."))?;
    Ok((head.title, head.file_name, &body[4 + n..]))
}

fn heading_level(line: &str) -> Option<usize> {
    let n = line.chars().take_while(|c| *c == '#').count();
    ((1..=6).contains(&n) && line[n..].starts_with(' ')).then_some(n)
}

/// An EPUB's title page or a Word title right before the first chapter is a heading
/// with nothing under it: it would be an empty section. A heading followed by a
/// deeper one is a parent and stays.
fn drop_empty_headings(md: &str) -> String {
    let lines: Vec<&str> = md.lines().collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    for (i, line) in lines.iter().enumerate() {
        if let Some(level) = heading_level(line) {
            let next = lines[i + 1..].iter().find(|l| !l.trim().is_empty());
            if next.is_none_or(|n| heading_level(n).is_some_and(|l| l <= level)) {
                continue;
            }
        }
        out.push(line);
    }
    let mut s = out.join("\n");
    while s.contains("\n\n\n") {
        s = s.replace("\n\n\n", "\n\n");
    }
    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::sections;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures").join(name)).unwrap()
    }

    fn titles(name: &str) -> Vec<(u8, String)> {
        sections(&to_markdown(name, &fixture(name)).unwrap()).into_iter().map(|s| (s.level, s.title)).collect()
    }

    #[test]
    fn word_odt_powerpoint_and_epub_become_sections() {
        let notes = vec![(1, "Volcanes de la Puna".to_string()), (2, "El cono de Tamberías".into()), (2, "Fumarolas y azufre".into())];
        assert_eq!(titles("apuntes-volcanes.docx"), notes);
        assert_eq!(titles("apuntes-volcanes.odt"), notes);
        assert_eq!(titles("clase-volcanes.pptx"), [(2, "Clase 3: volcanes".to_string()), (2, "Tipos de erupción".into()), (2, "La regla del semáforo".into())]);
        // The book's title page has nothing under it: no empty section.
        assert_eq!(titles("libro-volcanes.epub"), [(1, "Capítulo 1: El fuego de abajo".to_string()), (2, "1.1 La cámara".into()), (1, "Capítulo 2: Vivir cerca".into())]);
        let md = to_markdown("clase-volcanes.pptx", &fixture("clase-volcanes.pptx")).unwrap();
        assert!(md.contains("Rojo: evacuar"), "{md}");
    }

    #[test]
    fn what_it_cannot_read_says_so() {
        assert!(format_of("a.DOCX").is_some() && format_of("a.doc").is_none() && format_of("sin-extension").is_none());
        assert!(to_markdown("a.docx", b"esto no es un zip").unwrap_err().to_string().contains("parece dañado"));
        assert!(to_markdown("a.xlsx", &fixture("apuntes-volcanes.docx")).unwrap_err().to_string().contains("Por ahora"));
        assert!(to_markdown("a.docx", &vec![0; MAX_BYTES + 1]).unwrap_err().to_string().contains("50 MB"));
    }

    #[test]
    fn the_upload_carries_title_name_and_bytes() {
        let head = br#"{"title":"Clase 3","fileName":"clase.pptx"}"#;
        let mut body = (head.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(head);
        body.extend_from_slice(b"PK..");
        let (title, name, bytes) = parse_upload(&body).unwrap();
        assert_eq!((title.as_str(), name.as_str(), bytes), ("Clase 3", "clase.pptx", &b"PK.."[..]));
        assert!(parse_upload(&body[..10]).is_err() && parse_upload(b"").is_err());
    }

    #[test]
    fn empty_headings_go_parents_stay() {
        assert_eq!(drop_empty_headings("# Título\n\n# Cap 1\n\n## 1.1\n\nTexto.\n\n# Vacío"), "# Cap 1\n\n## 1.1\n\nTexto.");
    }
}
