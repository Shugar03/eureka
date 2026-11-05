// The e2e stand-in for `library.rs`: same sections and the same hit shape,
// with a simple word-count ranking instead of BM25.
import type { Book, BookSection, BookSummary, LibraryHit, OcrPageInput } from "../types";

const marker = (l: string) => /^<!-- p:(\d+) -->$/.exec(l.trim())?.[1];

export function sections(markdown: string): BookSection[] {
  const out: BookSection[] = [];
  let page: number | null = null;
  let cur: BookSection = { id: 0, title: "Inicio", level: 0, page: null, markdown: "" };
  const push = () => {
    const hasText = cur.markdown.split("\n").some((l) => l.trim() && !marker(l));
    if (cur.level > 0 || hasText) out.push({ ...cur, id: out.length, markdown: cur.markdown.trim() });
  };
  for (const line of markdown.split("\n")) {
    const p = marker(line);
    if (p) page = Number(p);
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) {
      push();
      cur = { id: 0, title: h[2].trim(), level: h[1].length, page, markdown: page ? `<!-- p:${page} -->\n\n` : "" };
      continue;
    }
    cur.markdown += `${line}\n`;
  }
  push();
  return out;
}

export function summary(b: Book): BookSummary {
  const ocr = b.ocr ? { hash: b.ocr.hash, read: b.ocr.pages.length, pending: b.ocr.pending, review: b.ocr.review.length } : null;
  return { id: b.id, title: b.title, file_name: b.file_name, created_at: b.created_at, pages: b.pages, sections: b.sections.length, scanned: b.scanned.length, chars: b.sections.reduce((n, s) => n + s.markdown.length, 0), ocr };
}

/** AC-187: like `library::merge_pages`, each OCR'd page at its place among the text pages. */
export function mergePages(markdown: string, pages: OcrPageInput[]): string {
  const blocks: [number | null, string][] = [];
  for (const para of markdown.split("\n\n")) {
    const p = marker(para);
    const last = blocks[blocks.length - 1];
    if (p) blocks.push([Number(p), ""]);
    else if (last) last[1] = last[1] ? `${last[1]}\n\n${para}` : para;
    else blocks.push([null, para]);
  }
  for (const p of pages) {
    const same = blocks.find((b) => b[0] === p.page);
    if (same) same[1] = p.markdown.trim();
    else {
      const at = blocks.findIndex((b) => b[0] !== null && b[0] > p.page);
      blocks.splice(at < 0 ? blocks.length : at, 0, [p.page, p.markdown.trim()]);
    }
  }
  return blocks
    .filter(([page, text]) => page === null || text.trim())
    .flatMap(([page, text]) => (page === null ? [text] : [`<!-- p:${page} -->`, text]))
    .filter((t) => t.trim())
    .join("\n\n");
}

/** Like `Book::apply_ocr`. */
export function applyOcr(b: Book, read: OcrPageInput[], pending: number[]) {
  const o = b.ocr!;
  for (const p of read) {
    if (!o.pages.includes(p.page)) o.pages.push(p.page);
    o.review = o.review.filter((r) => r.page !== p.page);
    if (p.review.length) o.review.push({ page: p.page, lines: p.review.slice(0, 5) });
  }
  o.pages.sort((x, y) => x - y);
  o.review.sort((x, y) => x.page - y.page);
  o.pending = pending;
  b.scanned = b.scanned.filter((s) => !o.pages.includes(s));
}

const words = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3)
    .map((w) => w.replace(/e?s$/, ""));

export function search(books: Book[], query: string, limit: number): LibraryHit[] {
  const q = new Set(words(query));
  const hits: LibraryHit[] = [];
  for (const b of books)
    for (const s of b.sections) {
      let page = s.page;
      for (const para of s.markdown.split("\n\n")) {
        const p = marker(para);
        if (p) {
          page = Number(p);
          continue;
        }
        const score = words(para).filter((w) => q.has(w)).length;
        if (score) hits.push({ book_id: b.id, book_title: b.title, section_id: s.id, section: s.title, page, snippet: para.slice(0, 240), text: para, score });
      }
    }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
