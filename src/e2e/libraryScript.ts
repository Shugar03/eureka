// The e2e stand-in for `library.rs`: same sections and the same hit shape,
// with a simple word-count ranking instead of BM25.
import type { Book, BookSection, BookSummary, LibraryHit } from "../types";

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
  return { id: b.id, title: b.title, file_name: b.file_name, created_at: b.created_at, pages: b.pages, sections: b.sections.length, scanned: b.scanned.length, chars: b.sections.reduce((n, s) => n + s.markdown.length, 0) };
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
