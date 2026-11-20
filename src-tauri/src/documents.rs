//! Clean documents for working folders (AC-221): the model sends the content as
//! data (sheets with columns and rows; blocks of a document) and Eureka lays it
//! out, so every file comes out the same way, without depending on the model
//! getting a format right and without Office installed.
//!
//! - Excel (rust_xlsxwriter): a coloured header row, frozen, with a filter;
//!   numbers as numbers, `=…` as formulas; columns sized to their content.
//! - Word (hand-written OOXML with `zip`): title, headings, paragraphs, bullet
//!   lists and tables in one consistent style (Aptos, the Office default).

use std::io::Write;

use anyhow::{bail, Result};
use rust_xlsxwriter::{Color, Format, FormatBorder, Formula, Workbook};
use serde_json::Value;

use crate::folders::{Block, SheetSpec};

const MAX_SHEETS: usize = 12;
const MAX_ROWS: usize = 20_000;
const MAX_COLS: usize = 60;
const ACCENT: u32 = 0x5B4BA0;

pub fn check_sheets(sheets: &[SheetSpec]) -> Result<()> {
    if sheets.is_empty() || sheets.len() > MAX_SHEETS {
        bail!("un Excel lleva de 1 a {MAX_SHEETS} hojas.");
    }
    for s in sheets {
        if s.name.trim().is_empty() || s.name.chars().count() > 31 || s.name.chars().any(|c| "[]:*?/\\".contains(c)) {
            bail!("la hoja «{}» necesita un nombre de hasta 31 caracteres, sin [ ] : * ? / \\.", s.name);
        }
        if s.columns.is_empty() || s.columns.len() > MAX_COLS {
            bail!("la hoja «{}» necesita de 1 a {MAX_COLS} columnas.", s.name);
        }
        if s.rows.len() > MAX_ROWS {
            bail!("la hoja «{}» tiene más de {MAX_ROWS} filas.", s.name);
        }
    }
    Ok(())
}

pub fn xlsx(sheets: &[SheetSpec]) -> Result<Vec<u8>> {
    check_sheets(sheets)?;
    let mut wb = Workbook::new();
    let header = Format::new().set_bold().set_font_color(Color::White).set_background_color(Color::RGB(ACCENT)).set_border_bottom(FormatBorder::Thin);
    for s in sheets {
        let ws = wb.add_worksheet();
        ws.set_name(s.name.trim())?;
        for (c, name) in s.columns.iter().enumerate() {
            ws.write_string_with_format(0, c as u16, name, &header)?;
        }
        for (r, row) in s.rows.iter().enumerate() {
            let r = (r + 1) as u32;
            for (c, cell) in row.iter().take(s.columns.len()).enumerate() {
                let c = c as u16;
                match cell {
                    Value::Number(n) => {
                        ws.write_number(r, c, n.as_f64().unwrap_or(0.0))?;
                    }
                    Value::Bool(b) => {
                        ws.write_boolean(r, c, *b)?;
                    }
                    Value::Null => {}
                    Value::String(t) if t.trim_start().starts_with('=') && t.trim().len() > 1 => {
                        ws.write_formula(r, c, Formula::new(t.trim()))?;
                    }
                    Value::String(t) => match t.trim().replace(',', ".").parse::<f64>() {
                        // «12», «3,5»: a number typed as text is still a number.
                        Ok(n) if !t.trim().is_empty() && t.trim().chars().all(|ch| ch.is_ascii_digit() || ".,-".contains(ch)) => {
                            ws.write_number(r, c, n)?;
                        }
                        _ => {
                            ws.write_string(r, c, t)?;
                        }
                    },
                    other => {
                        ws.write_string(r, c, other.to_string())?;
                    }
                }
            }
        }
        ws.set_freeze_panes(1, 0)?;
        ws.autofilter(0, 0, s.rows.len() as u32, (s.columns.len() - 1) as u16)?;
        ws.autofit();
    }
    Ok(wb.save_to_buffer()?)
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A run of text; **bold** parts become bold runs.
fn runs(text: &str) -> String {
    let mut out = String::new();
    for (i, part) in text.split("**").enumerate() {
        if part.is_empty() {
            continue;
        }
        let bold = if i % 2 == 1 { "<w:rPr><w:b/></w:rPr>" } else { "" };
        out.push_str(&format!("<w:r>{bold}<w:t xml:space=\"preserve\">{}</w:t></w:r>", esc(part)));
    }
    out
}

fn para(style: &str, text: &str) -> String {
    format!("<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{}</w:p>", runs(text))
}

fn table(columns: &[String], rows: &[Vec<String>]) -> String {
    let cell = |t: &str, head: bool| {
        let shade = if head { format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{ACCENT:06X}\"/>") } else { String::new() };
        let text = if head { format!("<w:r><w:rPr><w:b/><w:color w:val=\"FFFFFF\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>", esc(t)) } else { runs(t) };
        format!("<w:tc><w:tcPr>{shade}</w:tcPr><w:p><w:pPr><w:spacing w:before=\"40\" w:after=\"40\"/></w:pPr>{text}</w:p></w:tc>")
    };
    let mut x = String::from("<w:tbl><w:tblPr><w:tblStyle w:val=\"EurekaTable\"/><w:tblW w:w=\"5000\" w:type=\"pct\"/></w:tblPr>");
    x.push_str(&format!("<w:tr><w:trPr><w:tblHeader/></w:trPr>{}</w:tr>", columns.iter().map(|c| cell(c, true)).collect::<String>()));
    for r in rows {
        x.push_str(&format!("<w:tr>{}</w:tr>", (0..columns.len()).map(|i| cell(r.get(i).map(String::as_str).unwrap_or(""), false)).collect::<String>()));
    }
    x.push_str("</w:tbl><w:p/>");
    x
}

const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Aptos"/><w:sz w:val="22"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="2B2550"/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="5B4BA0"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2B2550"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="EurekaTable"><w:name w:val="Eureka Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D5D1E6"/><w:bottom w:val="single" w:sz="4" w:color="D5D1E6"/><w:insideH w:val="single" w:sz="4" w:color="D5D1E6"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>"#;

const NUMBERING: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"#;

pub fn docx(title: &str, blocks: &[Block]) -> Result<Vec<u8>> {
    if blocks.is_empty() {
        bail!("el documento no tiene contenido.");
    }
    let mut body = String::new();
    if !title.trim().is_empty() {
        body.push_str(&para("Title", title.trim()));
    }
    for b in blocks {
        match b {
            Block::Heading { text, level } => body.push_str(&para(&format!("Heading{}", (*level).clamp(1, 3)), text)),
            Block::Paragraph { text } => {
                for line in text.split("\n\n") {
                    body.push_str(&para("Normal", line.trim()));
                }
            }
            Block::Bullets { items } => {
                for it in items {
                    body.push_str(&para("ListBullet", it));
                }
            }
            Block::Table { columns, rows } if !columns.is_empty() => body.push_str(&table(columns, rows)),
            Block::Table { .. } => {}
        }
    }
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    let files: [(&str, &str); 6] = [
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#),
        ("word/_rels/document.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#),
        ("word/document.xml", &document),
        ("word/styles.xml", STYLES),
        ("word/numbering.xml", NUMBERING),
    ];
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in files {
            z.start_file(name, opts)?;
            z.write_all(content.as_bytes())?;
        }
        z.finish()?;
    }
    Ok(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_excel_reads_back_with_its_header_numbers_and_formulas() {
        let sheets = vec![SheetSpec { name: "Notas".into(), columns: vec!["Materia".into(), "Nota".into(), "Doble".into()], rows: vec![vec![json!("Análisis"), json!(8), json!("=B2*2")], vec![json!("Física"), json!("7,5"), json!(null)]] }];
        let bytes = xlsx(&sheets).unwrap();
        let md = anydoc::to_markdown_bytes(&bytes, anydoc::Format::Excel).unwrap();
        assert!(md.contains("Materia") && md.contains("Análisis") && md.contains("Física"), "{md}");
        assert!(md.contains('8') && md.contains("7.5"), "numbers stay numbers: {md}");
        assert!(check_sheets(&[SheetSpec { name: "a/b".into(), columns: vec!["x".into()], rows: vec![] }]).is_err());
        assert!(check_sheets(&[]).is_err());
    }

    #[test]
    fn a_word_document_reads_back_with_its_title_headings_lists_and_tables() {
        let blocks = vec![
            Block::Heading { text: "Unidad 1".into(), level: 1 },
            Block::Paragraph { text: "La **derivada** mide el cambio & la pendiente.".into() },
            Block::Bullets { items: vec!["Límite".into(), "Tangente".into()] },
            Block::Table { columns: vec!["Concepto".into(), "Idea".into()], rows: vec![vec!["Derivada".into(), "Pendiente <local>".into()]] },
        ];
        let bytes = docx("Resumen de Análisis", &blocks).unwrap();
        let md = anydoc::to_markdown_bytes(&bytes, anydoc::Format::Docx).unwrap();
        for want in ["Resumen de Análisis", "Unidad 1", "derivada", "& la pendiente", "Límite", "Tangente", "Concepto", "local>"] {
            assert!(md.contains(want), "{want} missing in {md}");
        }
        assert!(docx("x", &[]).is_err());
    }
}
