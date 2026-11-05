//! The learner's library (AC-69…71): books and readings already converted to
//! Markdown on the frontend (pdf.js, locally), split into sections and
//! searched with BM25. No embeddings and no model: importing and searching
//! cost nothing and work offline.
//!
//! Layout: `library/<id>.json` (sections) and `library/<id>.md` (the whole
//! book with frontmatter, readable as is in Obsidian).

use crate::graph::normalize;
use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

pub const MAX_MARKDOWN_CHARS: usize = 8_000_000;
/// Chunk target size: big enough to answer, small enough to send few tokens.
pub const CHUNK_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: usize,
    pub title: String,
    /// 1–3 (from `#`, `##`, `###`); 0 for text before the first heading.
    pub level: u8,
    /// Page where it starts (PDFs only).
    pub page: Option<u32>,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub created_at: DateTime<Utc>,
    pub pages: u32,
    /// Pages without text (scanned): they're not searchable.
    #[serde(default)]
    pub scanned: Vec<u32>,
    pub sections: Vec<Section>,
    /// AC-187: pages read with OCR on this PC (they may have errors).
    #[serde(default)]
    pub ocr: Option<OcrInfo>,
}

/// AC-187: what OCR read of a book, and what's still to read.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct OcrInfo {
    /// sha256 of the PDF: adding the same file again continues this book.
    pub hash: String,
    pub pages: Vec<u32>,
    /// Scanned pages not read yet (the reading is running, or stopped).
    pub pending: Vec<u32>,
    /// Pages with lines read with little confidence: «revisar».
    pub review: Vec<ReviewNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReviewNote {
    pub page: u32,
    pub lines: Vec<String>,
}

/// One page as OCR read it (the UI already laid it out in paragraphs).
#[derive(Debug, Clone, Deserialize)]
pub struct OcrPage {
    pub page: u32,
    pub markdown: String,
    #[serde(default)]
    pub review: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OcrStatus {
    pub hash: String,
    pub read: usize,
    pub pending: Vec<u32>,
    pub review: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub created_at: DateTime<Utc>,
    pub pages: u32,
    pub sections: usize,
    pub scanned: usize,
    pub chars: usize,
    pub ocr: Option<OcrStatus>,
}

impl Book {
    pub fn summary(&self) -> BookSummary {
        BookSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            file_name: self.file_name.clone(),
            created_at: self.created_at,
            pages: self.pages,
            sections: self.sections.len(),
            scanned: self.scanned.len(),
            chars: self.sections.iter().map(|s| s.markdown.len()).sum(),
            ocr: self.ocr.as_ref().map(|o| OcrStatus { hash: o.hash.clone(), read: o.pages.len(), pending: o.pending.clone(), review: o.review.len() }),
        }
    }

    /// "Capítulo 1 › 1.2 Recta tangente": the section with its parents.
    pub fn path(&self, id: usize) -> String {
        let Some(i) = self.sections.iter().position(|s| s.id == id) else { return String::new() };
        let mut parts = vec![self.sections[i].title.clone()];
        let mut level = self.sections[i].level;
        for s in self.sections[..i].iter().rev() {
            if s.level > 0 && s.level < level {
                parts.push(s.title.clone());
                level = s.level;
            }
        }
        parts.reverse();
        parts.join(" › ")
    }
}

impl Book {
    /// Records OCR'd pages: no longer "scanned" (they're searchable now), with their
    /// «revisar» notes, and what's still pending.
    fn apply_ocr(&mut self, read: &[OcrPage], pending: Vec<u32>) {
        let Some(o) = self.ocr.as_mut() else { return };
        for p in read {
            if !o.pages.contains(&p.page) {
                o.pages.push(p.page);
            }
            o.review.retain(|r| r.page != p.page);
            if !p.review.is_empty() {
                o.review.push(ReviewNote { page: p.page, lines: p.review.iter().take(5).cloned().collect() });
            }
        }
        o.pages.sort_unstable();
        o.review.sort_by_key(|r| r.page);
        o.pending = pending;
        self.scanned.retain(|s| !o.pages.contains(s));
    }
}

/// The Markdown of a readable copy, without its frontmatter.
fn body(md: &str) -> &str {
    md.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---\n\n")).map_or(md, |(_, b)| b)
}

fn page_marker(line: &str) -> Option<u32> {
    line.trim().strip_prefix("<!-- p:")?.strip_suffix("-->")?.trim().parse().ok()
}

/// AC-187: the OCR'd pages into the converted Markdown, each at its place among the
/// pages that had text (a scanned page 5 lands between 4 and 6), with its marker.
/// A page read again replaces what was there.
pub fn merge_pages(markdown: &str, pages: &[OcrPage]) -> String {
    // Blocks that start at a page marker; text before the first marker has no page.
    let mut blocks: Vec<(Option<u32>, String)> = Vec::new();
    for para in markdown.split("\n\n") {
        match page_marker(para) {
            Some(p) => blocks.push((Some(p), String::new())),
            None => match blocks.last_mut() {
                Some((_, text)) => {
                    if !text.is_empty() {
                        text.push_str("\n\n");
                    }
                    text.push_str(para);
                }
                None => blocks.push((None, para.to_string())),
            },
        }
    }
    for p in pages {
        let text = p.markdown.trim().to_string();
        if let Some(b) = blocks.iter_mut().find(|b| b.0 == Some(p.page)) {
            b.1 = text;
        } else {
            let at = blocks.iter().position(|b| b.0.is_some_and(|q| q > p.page)).unwrap_or(blocks.len());
            blocks.insert(at, (Some(p.page), text));
        }
    }
    let mut out: Vec<String> = Vec::new();
    for (page, text) in blocks {
        if let Some(p) = page {
            if text.trim().is_empty() {
                continue;
            }
            out.push(format!("<!-- p:{p} -->"));
        }
        if !text.trim().is_empty() {
            out.push(text);
        }
    }
    out.join("\n\n")
}

/// Splits converted Markdown into sections at `#`–`###` headings, keeping the
/// page markers inside each section (a section starting mid-page gets one).
pub fn sections(markdown: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut page: Option<u32> = None;
    let mut cur = Section { id: 0, title: "Inicio".into(), level: 0, page: None, markdown: String::new() };
    for line in markdown.lines() {
        if let Some(p) = page_marker(line) {
            page = Some(p);
        }
        let hashes = line.chars().take_while(|c| *c == '#').count();
        let is_heading = (1..=3).contains(&hashes) && line[hashes..].starts_with(' ') && !line[hashes..].trim().is_empty();
        if is_heading {
            if !cur.markdown.trim().is_empty() || cur.level > 0 {
                out.push(cur);
            }
            cur = Section { id: out.len(), title: line[hashes..].trim().to_string(), level: hashes as u8, page, markdown: String::new() };
            if let Some(p) = page {
                cur.markdown.push_str(&format!("<!-- p:{p} -->\n\n"));
            }
            continue;
        }
        cur.markdown.push_str(line);
        cur.markdown.push('\n');
    }
    if !cur.markdown.trim().is_empty() || cur.level > 0 {
        out.push(cur);
    }
    for (i, s) in out.iter_mut().enumerate() {
        s.id = i;
        s.markdown = s.markdown.trim().to_string();
        if s.page.is_none() {
            s.page = s.markdown.lines().find_map(page_marker);
        }
    }
    // Drop a marker-only intro (the first heading came right after the first marker).
    out.retain(|s| s.level > 0 || s.markdown.lines().any(|l| !l.trim().is_empty() && page_marker(l).is_none()));
    for (i, s) in out.iter_mut().enumerate() {
        s.id = i;
    }
    out
}

/// A searchable piece of one section.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub book: String,
    pub section: usize,
    pub page: Option<u32>,
    pub text: String,
}

/// Section text into ~CHUNK_CHARS pieces at paragraph boundaries, each with its page.
pub fn chunks(book: &Book) -> Vec<Chunk> {
    let mut out = Vec::new();
    for s in &book.sections {
        let mut page = s.page;
        let mut text = String::new();
        let mut start_page = page;
        for para in s.markdown.split("\n\n") {
            if let Some(p) = page_marker(para) {
                page = Some(p);
                if text.is_empty() {
                    start_page = page;
                }
                continue;
            }
            let para = para.trim();
            if para.is_empty() {
                continue;
            }
            if !text.is_empty() && text.len() + para.len() > CHUNK_CHARS {
                out.push(Chunk { book: book.id.clone(), section: s.id, page: start_page, text: std::mem::take(&mut text) });
                start_page = page;
            }
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(para);
        }
        if !text.is_empty() {
            out.push(Chunk { book: book.id.clone(), section: s.id, page: start_page, text });
        }
    }
    out
}

const STOPWORDS: &[&str] = &[
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "y", "o", "u", "e", "a", "en", "por", "para", "con", "sin", "que", "se", "su", "sus", "es", "son", "como", "mas", "pero", "lo", "le",
    "les", "esta", "este", "esto", "estos", "estas", "ese", "esa", "eso", "cual", "cuales", "muy", "ya", "si", "no", "ni", "hay", "fue", "ser", "sobre", "entre", "cuando", "donde", "porque", "tambien", "the", "of", "and",
    "to", "in", "is", "for", "on", "with", "as", "by", "an", "be", "this", "that", "are", "it", "or", "from", "at", "which", "qué", "que", "cómo",
];

/// Light Spanish/English stemming: enough to match plurals ("tangentes" and
/// "tangente", "funciones" and "función") and -mente adverbs.
pub fn stem(w: &str) -> String {
    let long = |s: &str| s.chars().count() >= 4;
    let mut s = w;
    if let Some(base) = s.strip_suffix("mente").filter(|b| long(b)) {
        s = base;
    }
    if let Some(base) = s.strip_suffix('s').filter(|b| long(b)) {
        s = base;
    }
    if let Some(base) = s.strip_suffix('e').filter(|b| long(b)) {
        s = base;
    }
    s.to_string()
}

/// Characters kept for the root term: "mandioca"/"mandioquera" or "amargo"/"amarga" share "~mand"/"~amar".
pub const ROOT_CHARS: usize = 4;

/// Each meaningful word, stemmed, plus its root (prefixed `~`). An exact match
/// scores twice (word and root); a related word, once. Measured in NF-22:
/// paraphrased questions go from 50 % to 83 % right section in the top 4.
pub fn terms(text: &str) -> Vec<String> {
    concepts(text).into_iter().flat_map(|c| std::iter::once(c.stem).chain(c.root)).collect()
}

/// How many different meaningful words a query has (AC-189: a top passage
/// matching fewer than half of them is a partial match).
pub fn query_words(query: &str) -> usize {
    let mut stems: Vec<String> = concepts(query).into_iter().map(|c| c.stem).collect();
    stems.sort();
    stems.dedup();
    stems.len()
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Concept {
    stem: String,
    /// `~` + the first ROOT_CHARS characters, when shorter than the stem.
    root: Option<String>,
    /// The word as written (accents folded), for showing what matched.
    word: String,
}

fn concepts(text: &str) -> Vec<Concept> {
    normalize(text)
        .split_whitespace()
        .filter(|w| w.chars().count() > 1 && !STOPWORDS.contains(w))
        .map(|w| {
            let s = stem(w);
            let root: String = s.chars().take(ROOT_CHARS).collect();
            let root = (root.len() < s.len()).then(|| format!("~{root}"));
            Concept { stem: s, root, word: w.to_string() }
        })
        .collect()
}

/// One book's part of the index (AC-190): adding, growing or removing a book
/// touches only this and the global counts.
#[derive(Clone)]
struct BookIndex {
    id: String,
    created_at: DateTime<Utc>,
    title: String,
    /// "Capítulo 1 › 1.2 …" per section id.
    paths: Vec<String>,
    chunks: Vec<Chunk>,
    /// Per chunk: term → frequency (section title words count double).
    tf: Vec<HashMap<String, f64>>,
    len: Vec<f64>,
}

impl BookIndex {
    fn new(b: &Book) -> Self {
        let paths: Vec<String> = b.sections.iter().map(|s| b.path(s.id)).collect();
        let chunks = chunks(b);
        let mut tf = Vec::with_capacity(chunks.len());
        let mut len = Vec::with_capacity(chunks.len());
        for c in &chunks {
            let mut m: HashMap<String, f64> = HashMap::new();
            for t in terms(&c.text) {
                *m.entry(t).or_default() += 1.0;
            }
            for t in terms(paths.get(c.section).map_or("", String::as_str)) {
                *m.entry(t).or_default() += 2.0;
            }
            len.push(m.values().sum());
            tf.push(m);
        }
        Self { id: b.id.clone(), created_at: b.created_at, title: b.title.clone(), paths, chunks, tf, len }
    }
}

/// BM25 over every chunk of every book. Document frequencies, the number of
/// chunks and their total length are running sums, so IDF and the average
/// length stay exact when one book changes.
#[derive(Clone, Default)]
pub struct Index {
    /// Newest first, like `LibraryStore::all` (same order as a full build, so ties rank the same).
    books: Vec<BookIndex>,
    df: HashMap<String, usize>,
    chunks: usize,
    total_len: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub book_id: String,
    pub book_title: String,
    pub section_id: usize,
    /// "Capítulo 1 › 1.2 …"
    pub section: String,
    pub page: Option<u32>,
    pub snippet: String,
    /// The whole chunk (what the teacher reads).
    pub text: String,
    pub score: f64,
    /// Query words (stemmed) this passage contains.
    pub matched: Vec<String>,
    /// Shares only one word with a longer query: probably not the answer.
    pub weak: bool,
}

impl Index {
    pub fn build(books: &[Book]) -> Self {
        let mut index = Self::default();
        for b in books {
            index.upsert(b);
        }
        index
    }

    /// AC-190: (re)indexes one book, replacing its previous version.
    pub fn upsert(&mut self, book: &Book) {
        self.remove(&book.id);
        let bi = BookIndex::new(book);
        for m in &bi.tf {
            for t in m.keys() {
                *self.df.entry(t.clone()).or_default() += 1;
            }
        }
        self.chunks += bi.chunks.len();
        self.total_len += bi.len.iter().sum::<f64>();
        let at = self.books.iter().position(|o| o.created_at < bi.created_at).unwrap_or(self.books.len());
        self.books.insert(at, bi);
    }

    /// AC-190: forgets one book.
    pub fn remove(&mut self, id: &str) {
        let Some(i) = self.books.iter().position(|b| b.id == id) else { return };
        let bi = self.books.remove(i);
        for m in &bi.tf {
            for t in m.keys() {
                if let Some(n) = self.df.get_mut(t) {
                    *n -= 1;
                    if *n == 0 {
                        self.df.remove(t);
                    }
                }
            }
        }
        self.chunks -= bi.chunks.len();
        self.total_len -= bi.len.iter().sum::<f64>();
    }

    /// Titles of the indexed books (for the teacher's state block).
    pub fn titles(&self) -> Vec<String> {
        let mut t: Vec<String> = self.books.iter().map(|b| b.title.clone()).collect();
        t.sort();
        t
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let q: HashSet<String> = terms(query).into_iter().collect();
        if q.is_empty() || self.chunks == 0 {
            return vec![];
        }
        let mut cs = concepts(query);
        cs.sort();
        cs.dedup_by(|a, b| a.stem == b.stem);
        // Which query words a chunk matches (exactly or by root): shown to the
        // teacher, so a passage that only shares one word reads as weak (NF-22).
        let matched = |tf: &HashMap<String, f64>| -> Vec<String> { cs.iter().filter(|c| tf.contains_key(&c.stem) || c.root.as_ref().is_some_and(|r| tf.contains_key(r))).map(|c| c.word.clone()).collect() };
        let n = self.chunks as f64;
        let avg = (self.total_len / n).max(1.0);
        let idf: HashMap<&String, f64> = q.iter().filter_map(|t| self.df.get(t).map(|&df| (t, ((n - df as f64 + 0.5) / (df as f64 + 0.5) + 1.0).ln()))).collect();
        let (k1, b) = (1.2, 0.75);
        let mut scored: Vec<(f64, usize, usize)> = Vec::new();
        for (bi, book) in self.books.iter().enumerate() {
            for (i, tf) in book.tf.iter().enumerate() {
                let s: f64 = idf
                    .iter()
                    .filter_map(|(t, idf)| {
                        let f = *tf.get(*t)?;
                        Some(idf * f * (k1 + 1.0) / (f + k1 * (1.0 - b + b * book.len[i] / avg)))
                    })
                    .sum();
                if s > 0.0 {
                    scored.push((s, bi, i));
                }
            }
        }
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        scored
            .into_iter()
            .take(limit)
            .map(|(score, bi, i)| {
                let book = &self.books[bi];
                let c = &book.chunks[i];
                let words = matched(&book.tf[i]);
                let weak = cs.len() >= 3 && words.len() < 2;
                Hit {
                    book_id: c.book.clone(),
                    book_title: book.title.clone(),
                    section_id: c.section,
                    section: book.paths.get(c.section).cloned().unwrap_or_default(),
                    page: c.page,
                    snippet: snippet(&c.text, &q),
                    text: c.text.clone(),
                    score,
                    matched: words,
                    weak,
                }
            })
            .collect()
    }
}

/// ~240 characters around the first matching word.
fn snippet(text: &str, q: &HashSet<String>) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let at = words.iter().position(|w| terms(w).iter().any(|t| q.contains(t))).unwrap_or(0);
    let from = at.saturating_sub(12);
    let mut out = String::new();
    for w in &words[from..] {
        if out.len() > 240 {
            out.push('…');
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    if from > 0 {
        format!("…{out}")
    } else {
        out
    }
}

pub struct LibraryStore {
    dir: PathBuf,
    index: Mutex<Option<Arc<Index>>>,
    /// Full index builds so far (AC-190: changing one book never adds one).
    builds: AtomicUsize,
}

impl LibraryStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("library"), index: Mutex::new(None), builds: AtomicUsize::new(0) }
    }

    fn json(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            bail!("libro inválido");
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    /// `ocr`: the scanned pages already read (AC-187), the PDF's hash and the pages
    /// still to read; they're merged into the text pages before anything else.
    pub fn import(&self, title: &str, file_name: &str, markdown: &str, pages: u32, scanned: Vec<u32>, ocr: Option<(String, Vec<OcrPage>, Vec<u32>)>) -> Result<Book> {
        let title = title.trim();
        if title.is_empty() {
            bail!("Poné un título.");
        }
        let mut book = Book {
            id: uuid::Uuid::new_v4().simple().to_string(),
            title: title.to_string(),
            file_name: file_name.trim().to_string(),
            created_at: Utc::now(),
            pages,
            scanned,
            sections: vec![],
            ocr: None,
        };
        let markdown = match ocr {
            Some((hash, read, pending)) => {
                book.ocr = Some(OcrInfo { hash, ..Default::default() });
                book.apply_ocr(&read, pending);
                merge_pages(markdown, &read)
            }
            None => markdown.to_string(),
        };
        if markdown.len() > MAX_MARKDOWN_CHARS {
            bail!("El documento es demasiado grande (más de 8 millones de caracteres).");
        }
        book.sections = sections(&markdown);
        if book.sections.iter().all(|s| s.markdown.lines().all(|l| l.trim().is_empty() || page_marker(l).is_some())) {
            bail!(if book.scanned.is_empty() && book.ocr.is_none() { "El documento no tiene texto." } else { "El PDF no tiene texto seleccionable (parece escaneado)." });
        }
        self.save(&book, &markdown)?;
        Ok(book)
    }

    /// AC-187: more OCR'd pages for a book (the reading goes on in the background):
    /// merged at their place, its sections and its part of the index redone (AC-190).
    pub fn add_ocr_pages(&self, id: &str, read: &[OcrPage], pending: Vec<u32>) -> Result<Book> {
        let mut book = self.load(id)?;
        if book.ocr.is_none() {
            bail!("Ese libro no se está leyendo con OCR.");
        }
        let current = std::fs::read_to_string(self.dir.join(format!("{id}.md"))).ok().map(|md| body(&md).to_string()).unwrap_or_else(|| {
            // No readable copy (deleted by hand): rebuild it from the sections.
            book.sections.iter().map(|s| if s.level > 0 { format!("{} {}\n\n{}", "#".repeat(s.level as usize), s.title, s.markdown) } else { s.markdown.clone() }).collect::<Vec<_>>().join("\n\n")
        });
        let markdown = merge_pages(&current, read);
        if markdown.len() > MAX_MARKDOWN_CHARS {
            bail!("El documento es demasiado grande (más de 8 millones de caracteres).");
        }
        book.apply_ocr(read, pending);
        book.sections = sections(&markdown);
        self.save(&book, &markdown)?;
        Ok(book)
    }

    fn save(&self, book: &Book, markdown: &str) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let path = self.json(&book.id)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(book)?)?;
        std::fs::rename(tmp, &path)?;
        // The readable copy: one note per book, headings as its outline.
        let front = format!("---\ntitle: \"{}\"\nsource: \"{}\"\npages: {}\nimported: {}\n---\n\n", book.title.replace('"', "'"), book.file_name.replace('"', "'"), book.pages, book.created_at.format("%Y-%m-%d"));
        std::fs::write(self.dir.join(format!("{}.md", book.id)), front + markdown)?;
        // AC-190: only this book's part of the index; not built yet, it stays lazy.
        // `make_mut` clones only while a search still holds the previous index.
        if let Some(index) = self.index.lock().unwrap().as_mut() {
            Arc::make_mut(index).upsert(book);
        }
        Ok(())
    }

    pub fn load(&self, id: &str) -> Result<Book> {
        let raw = std::fs::read_to_string(self.json(id)?).map_err(|_| anyhow!("Ese libro ya no está en la biblioteca."))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn all(&self) -> Vec<Book> {
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut books: Vec<Book> = rd
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str(&raw).ok())
            .collect();
        books.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        books
    }

    pub fn list(&self) -> Vec<BookSummary> {
        self.all().iter().map(Book::summary).collect()
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let path = self.json(id)?;
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("md"));
        if let Some(index) = self.index.lock().unwrap().as_mut() {
            Arc::make_mut(index).remove(id);
        }
        Ok(())
    }

    /// The files changed behind the store's back (a backup was restored): rebuilt on next use.
    pub fn invalidate(&self) {
        *self.index.lock().unwrap() = None;
    }

    #[cfg(test)]
    fn builds(&self) -> usize {
        self.builds.load(Ordering::Relaxed)
    }

    /// Built whole on first use; after that each change updates one book (AC-190).
    pub fn index(&self) -> Arc<Index> {
        let mut g = self.index.lock().unwrap();
        g.get_or_insert_with(|| {
            self.builds.fetch_add(1, Ordering::Relaxed);
            Arc::new(Index::build(&self.all()))
        })
        .clone()
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        self.index().search(query, limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MD: &str = "<!-- p:1 -->\n\n# Capítulo 1: Derivadas\n\nLa derivada mide cómo cambia una función.\n\n<!-- p:2 -->\n\n## 1.1 La recta tangente\n\nLa pendiente de la recta tangente en un punto es la derivada.\n\n<!-- p:3 -->\n\nSigue la explicación de la tangente.\n\n# Capítulo 2: Integrales\n\nLa integral acumula áreas bajo la curva.";

    fn store() -> (LibraryStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("la-lib-{}", uuid::Uuid::new_v4().simple()));
        (LibraryStore::new(&dir), dir)
    }

    #[test]
    fn markdown_splits_into_sections_with_pages_and_paths() {
        let s = sections(MD);
        let titles: Vec<&str> = s.iter().map(|x| x.title.as_str()).collect();
        assert_eq!(titles, ["Capítulo 1: Derivadas", "1.1 La recta tangente", "Capítulo 2: Integrales"]);
        assert_eq!(s.iter().map(|x| x.page).collect::<Vec<_>>(), [Some(1), Some(2), Some(3)]);
        assert!(s[1].markdown.starts_with("<!-- p:2 -->"), "a section keeps the page it starts on");
        let book = Book { id: "b".into(), title: "Cálculo".into(), file_name: "c.pdf".into(), created_at: Utc::now(), pages: 3, scanned: vec![], sections: s, ocr: None };
        assert_eq!(book.path(1), "Capítulo 1: Derivadas › 1.1 La recta tangente");
        let c = chunks(&book);
        assert_eq!(c[1].page, Some(2));
        assert!(c[1].text.contains("Sigue la explicación"), "small paragraphs share a chunk");
    }

    #[test]
    fn stems_and_stopwords() {
        assert_eq!(terms("Las derivadas de las funciones"), ["derivada", "~deri", "funcion", "~func"]);
        assert_eq!(stem("integrales"), "integral");
        assert_eq!(stem("gas"), "gas");
        assert_eq!(stem("tangentes"), stem("tangente"));
    }

    #[test]
    fn import_search_and_delete() {
        let (st, dir) = store();
        assert!(st.import("  ", "x.pdf", MD, 3, vec![], None).is_err());
        assert!(st.import("Escaneado", "x.pdf", "<!-- p:1 -->", 1, vec![1], None).unwrap_err().to_string().contains("escaneado"));
        let b = st.import("Cálculo I", "calculo.pdf", MD, 3, vec![], None).unwrap();
        st.import("Historia", "h.txt", "# Revolución\n\nLa revolución de mayo de 1810.", 0, vec![], None).unwrap();
        assert_eq!(st.list().len(), 2);
        assert!(dir.join("library").join(format!("{}.md", b.id)).is_file(), "readable copy for Obsidian");

        let hits = st.search("¿qué es la pendiente de las tangentes?", 5);
        assert_eq!(hits[0].book_title, "Cálculo I");
        assert_eq!(hits[0].section, "Capítulo 1: Derivadas › 1.1 La recta tangente");
        assert_eq!(hits[0].page, Some(2));
        assert!(hits[0].snippet.contains("pendiente"));
        assert!(st.search("fotosíntesis", 5).is_empty());

        st.delete(&b.id).unwrap();
        assert!(st.search("tangente", 5).is_empty(), "the index forgets deleted books");
        assert!(st.load("../x").is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    fn ocr_page(page: u32, text: &str, review: &[&str]) -> OcrPage {
        OcrPage { page, markdown: text.into(), review: review.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn ocr_pages_land_in_place_and_are_searchable() {
        // A mixed PDF: pages 4 and 6 had text, 5 and 7 were scans.
        let md = "<!-- p:4 -->\n\n# Fotosíntesis\n\nLa luz llega a la hoja.\n\n<!-- p:6 -->\n\nEl oxígeno sale por los estomas.";
        let merged = merge_pages(md, &[ocr_page(5, "La clorofila absorbe la luz roja y azul.", &[])]);
        assert_eq!(merged, "<!-- p:4 -->\n\n# Fotosíntesis\n\nLa luz llega a la hoja.\n\n<!-- p:5 -->\n\nLa clorofila absorbe la luz roja y azul.\n\n<!-- p:6 -->\n\nEl oxígeno sale por los estomas.");
        assert_eq!(merge_pages(&merged, &[ocr_page(5, "Corregido.", &[])]).matches("<!-- p:5 -->").count(), 1, "a page read again replaces itself");

        // Pages long enough to be chunks of their own (a chunk cites the page it starts on).
        let long = |s: &str| format!("{s} ").repeat(30).trim().to_string();
        let md = format!("<!-- p:4 -->\n\n# Fotosíntesis\n\n{}\n\n<!-- p:6 -->\n\n{}", long("La luz llega a la hoja."), long("El oxígeno sale por los estomas."));
        let (st, dir) = store();
        let b = st.import("Biología", "bio.pdf", &md, 7, vec![5, 7], Some(("ab".repeat(32), vec![ocr_page(5, &long("La clorofila absorbe la luz roja y azul."), &["l4 c1orofi1a"])], vec![7]))).unwrap();
        let o = b.ocr.clone().unwrap();
        assert_eq!((o.pages.clone(), o.pending.clone(), b.scanned.clone()), (vec![5], vec![7], vec![7]));
        assert_eq!(o.review, [ReviewNote { page: 5, lines: vec!["l4 c1orofi1a".into()] }]);
        let hits = st.search("clorofila", 3);
        assert_eq!((hits[0].page, hits[0].book_title.as_str()), (Some(5), "Biología"), "cites the scanned page");

        let b = st.add_ocr_pages(&b.id, &[ocr_page(7, &long("Los cloroplastos guardan almidón."), &[])], vec![]).unwrap();
        assert_eq!(b.ocr.as_ref().unwrap().pages, [5, 7]);
        assert!(b.ocr.as_ref().unwrap().pending.is_empty() && b.scanned.is_empty());
        assert_eq!(st.search("almidón", 3)[0].page, Some(7), "the index sees the new page");
        assert_eq!(st.search("estomas", 3)[0].page, Some(6), "and keeps the old ones");
        let s = b.summary().ocr.unwrap();
        assert_eq!((s.read, s.review, s.pending.len()), (2, 1, 0));
        let md = std::fs::read_to_string(dir.join("library").join(format!("{}.md", b.id))).unwrap();
        assert!(md.starts_with("---\ntitle: \"Biología\"") && md.matches("title:").count() == 1, "one frontmatter");

        // Only scans, first pages read: the book exists already.
        let only = st.import("Escaneado", "s.pdf", "", 3, vec![1, 2, 3], Some(("cd".repeat(32), vec![ocr_page(1, "Primera página leída.", &[])], vec![2, 3]))).unwrap();
        assert_eq!(only.sections[0].page, Some(1));
        assert!(st.add_ocr_pages(&st.import("Texto", "t.txt", "Hola.", 0, vec![], None).unwrap().id, &[], vec![]).is_err(), "only OCR books grow");
        std::fs::remove_dir_all(dir).ok();
    }

    /// A book of `pages` pages about `topic`, with a word only it has.
    fn book_md(topic: &str, pages: u32) -> String {
        let mut md = String::new();
        for p in 1..=pages {
            if p % 10 == 1 {
                md.push_str(&format!("# {topic}: capítulo {}\n\n", p / 10 + 1));
            }
            md.push_str(&format!("<!-- p:{p} -->\n\n"));
            for k in 0..4 {
                md.push_str(&format!("Párrafo {k} de la página {p} sobre {topic}: la energía, el calor y el trabajo en sistemas {topic}{p}{k}.\n\n"));
            }
        }
        md
    }

    /// Search results as comparable tuples (score rounded: float sums may differ in the last bit).
    fn ranked(hits: &[Hit]) -> Vec<(i64, String, usize, Option<u32>, bool)> {
        hits.iter().map(|h| ((h.score * 1e9).round() as i64, h.book_id.clone(), h.section_id, h.page, h.weak)).collect()
    }

    #[test]
    fn the_index_changes_one_book_at_a_time_and_matches_a_full_rebuild() {
        // AC-190
        let (st, dir) = store();
        let long = |s: &str| format!("{s} ").repeat(30).trim().to_string();
        let a = st.import("Física", "f.pdf", &book_md("física", 20), 20, vec![], None).unwrap();
        let ocr = st.import("Biología", "b.pdf", "<!-- p:1 -->\n\n# Células\n\nLa célula es la unidad de la vida.", 2, vec![2], Some(("ef".repeat(32), vec![], vec![2]))).unwrap();
        assert_eq!(st.search("energía", 3).len(), 3);
        assert_eq!(st.builds(), 1);
        let same = |q: &str| {
            let fresh = Index::build(&st.all());
            assert_eq!(ranked(&st.search(q, 10)), ranked(&fresh.search(q, 10)), "{q}");
            assert_eq!(st.index().titles(), fresh.titles());
        };
        // Add, grow with OCR, remove: each one updates that book, and ranks like a rebuild.
        let c = st.import("Química", "q.txt", &book_md("química", 5), 0, vec![], None).unwrap();
        same("energía calor química");
        st.add_ocr_pages(&ocr.id, &[ocr_page(2, &long("Las mitocondrias producen energía."), &[])], vec![]).unwrap();
        assert_eq!(st.search("mitocondrias", 3)[0].page, Some(2), "the grown page is searchable");
        same("energía mitocondrias célula");
        st.delete(&a.id).unwrap();
        assert!(st.search("física1", 3).is_empty(), "the removed book is gone");
        same("energía calor trabajo");
        st.delete(&c.id).unwrap();
        st.delete(&ocr.id).unwrap();
        assert!(st.search("energía", 3).is_empty() && st.index().titles().is_empty());
        assert_eq!(st.builds(), 1, "never rebuilt whole");
        // A restored backup changes the files underneath: the next search rebuilds.
        st.invalidate();
        st.search("energía", 3);
        assert_eq!(st.builds(), 2);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn adding_a_book_to_a_library_of_50_does_not_rebuild_it() {
        // AC-190: timing in the report (debug build, this PC).
        let (st, dir) = store();
        for i in 0..50 {
            st.import(&format!("Libro {i}"), "x.pdf", &book_md(&format!("tema{i}"), 40), 40, vec![], None).unwrap();
        }
        let t = std::time::Instant::now();
        st.search("energía", 5);
        let full = t.elapsed();
        let t = std::time::Instant::now();
        let b = st.import("Libro nuevo", "n.pdf", &book_md("nuevo", 40), 40, vec![], None).unwrap();
        let add = t.elapsed();
        let hits = st.search("nuevo1", 1);
        assert_eq!(hits[0].book_id, b.id);
        let t = std::time::Instant::now();
        st.delete(&b.id).unwrap();
        let del = t.elapsed();
        eprintln!("50 libros de 40 páginas: índice entero {full:?} · agregar uno (guardar + indexarlo) {add:?} · quitarlo {del:?}");
        assert_eq!(st.builds(), 1);
        assert!(add < full, "adding one book ({add:?}) costs less than rebuilding ({full:?})");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_500_page_book_imports_and_searches_fast() {
        let (st, dir) = store();
        let mut md = String::new();
        for p in 1..=500 {
            if p % 25 == 1 {
                md.push_str(&format!("# Capítulo {}

", p / 25 + 1));
            }
            md.push_str(&format!("<!-- p:{p} -->

"));
            for k in 0..6 {
                md.push_str(&format!("Párrafo {k} de la página {p}: la termodinámica estudia la energía, el calor y el trabajo en sistemas físicos y químicos con ejemplos {p}{k}.

"));
            }
        }
        let t = std::time::Instant::now();
        st.import("Física", "f.pdf", &md, 500, vec![], None).unwrap();
        let hits = st.search("calor y trabajo", 5);
        let took = t.elapsed();
        assert_eq!(hits.len(), 5);
        eprintln!("500 páginas ({} KB): importar + indexar + buscar en {took:?}", md.len() / 1024);
        assert!(took.as_secs_f64() < 5.0, "{took:?}");
        let t = std::time::Instant::now();
        st.search("energía", 5);
        assert!(t.elapsed().as_millis() < 200, "searching again reuses the index");
        std::fs::remove_dir_all(dir).ok();
    }
}
