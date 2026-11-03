// Books and long readings to Markdown, fully local (AC-69): pdf.js reads the
// text with its font sizes and positions; the rest is plain heuristics, so a
// 500-page PDF takes seconds and nothing leaves the machine.

export const MAX_BOOK_PAGES = 2000;

/** One pdf.js text run, reduced to what the layout needs. */
export interface RawItem {
  str: string;
  x: number;
  y: number;
  /** Run width in PDF units (to tell "same word" from "next word"). */
  w: number;
  /** Font size. */
  size: number;
  eol?: boolean;
}

export interface PageItems {
  page: number;
  items: RawItem[];
}

export interface OutlineEntry {
  title: string;
  page: number;
  level: number;
}

export interface Line {
  page: number;
  text: string;
  size: number;
  y: number;
}

export interface BookText {
  markdown: string;
  pages: number;
  /** Pages with no text at all (scanned images). */
  scanned: number[];
}

const BULLET = /^([•·▪◦‣∙●○■□–—-]|\d{1,3}[.)]|[a-z][.)])\s/;
const PAGE_NUMBER = /^(p[aá]g(ina)?\.?\s*)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(de|\/)\s*\d{1,4})?$/i;

/** Groups runs into lines (same baseline), inserting spaces where runs are apart. */
export function toLines({ page, items }: PageItems): Line[] {
  const lines: Line[] = [];
  let cur: { text: string; y: number; size: number; chars: Map<number, number>; end: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.text.replace(/\s+/g, " ").trim();
    if (text) {
      // The line's size is the one most of its characters use.
      const size = [...cur.chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? cur.size;
      lines.push({ page, text, size, y: cur.y });
    }
    cur = null;
  };
  for (const it of items) {
    if (!it.str) {
      if (it.eol) flush();
      continue;
    }
    const size = Math.round(it.size * 10) / 10;
    if (cur && Math.abs(it.y - cur.y) > Math.max(size, cur.size) * 0.5) flush();
    if (!cur) cur = { text: "", y: it.y, size, chars: new Map(), end: it.x };
    const gap = it.x - cur.end;
    if (cur.text && gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += " ";
    cur.text += it.str;
    cur.end = it.x + it.w;
    cur.chars.set(size, (cur.chars.get(size) ?? 0) + it.str.length);
    if (it.eol) flush();
  }
  flush();
  return lines;
}

const runKey = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Drops running headers/footers (repeated at the top or bottom of many pages) and bare page numbers. */
export function stripRunning(pages: Line[][]): Line[][] {
  const edge = (ls: Line[]) => [...ls.slice(0, 2), ...ls.slice(-2)];
  const counts = new Map<string, number>();
  for (const ls of pages) for (const k of new Set(edge(ls).map((l) => runKey(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const withText = pages.filter((p) => p.length).length;
  const min = Math.max(3, Math.ceil(withText * 0.4));
  return pages.map((ls) => {
    const edges = new Set(edge(ls));
    return ls.filter((l) => !PAGE_NUMBER.test(l.text) && !(edges.has(l) && (counts.get(runKey(l.text)) ?? 0) >= min));
  });
}

/** The body font size: the one used by most characters. */
export function bodySize(lines: Line[]): number {
  const chars = new Map<number, number>();
  for (const l of lines) chars.set(l.size, (chars.get(l.size) ?? 0) + l.text.length);
  return [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

const isHeadingText = (t: string) => t.length <= 120 && /\p{L}/u.test(t) && !/[.,;]$/.test(t);

/** Heading level by font size (1–3), or 0 for body text. */
export function headingLevels(lines: Line[], body: number): Map<number, number> {
  const sizes = [...new Set(lines.filter((l) => l.size >= body * 1.15 && isHeadingText(l.text)).map((l) => l.size))].sort((a, b) => b - a);
  return new Map(sizes.map((s, i) => [s, Math.min(i + 1, 3)]));
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Lines of one page to Markdown blocks: paragraphs, bullets, headings; hyphenated words rejoined. */
function pageBlocks(lines: Line[], levels: Map<number, number>, outline: OutlineEntry[]): string[] {
  const blocks: string[] = [];
  const titles = new Map(outline.map((o) => [norm(o.title), o.level]));
  const pending = [...outline];
  let para = "";
  let lastY: number | null = null;
  let lastSize = 0;
  const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).filter((g) => g > 0).sort((a, b) => a - b);
  const lineGap = gaps[Math.floor(gaps.length / 2)] ?? 14;
  const flush = () => {
    if (para.trim()) blocks.push(para.trim());
    para = "";
  };
  const heading = (level: number, text: string) => {
    flush();
    blocks.push(`${"#".repeat(level)} ${text}`);
  };
  for (const l of lines) {
    const n = norm(l.text);
    const fromOutline = titles.get(n);
    if (fromOutline !== undefined) {
      const i = pending.findIndex((o) => norm(o.title) === n);
      if (i >= 0) pending.splice(i, 1);
      heading(fromOutline, l.text);
    } else if (outline.length === 0 && levels.has(l.size)) {
      heading(levels.get(l.size)!, l.text);
    } else if (BULLET.test(l.text)) {
      flush();
      para = `- ${l.text.replace(BULLET, "")}`;
    } else {
      const gap = lastY === null ? 0 : Math.abs(lastY - l.y);
      if (gap > lineGap * 1.6 || (lastSize && Math.abs(l.size - lastSize) > 0.5)) flush();
      if (para.endsWith("-") && /^\p{Ll}/u.test(l.text)) para = para.slice(0, -1) + l.text;
      else para = para ? `${para} ${l.text}` : l.text;
    }
    lastY = l.y;
    lastSize = l.size;
  }
  flush();
  // Bookmarks whose title isn't printed on the page still open a section there.
  return [...pending.map((o) => `${"#".repeat(o.level)} ${o.title}`), ...blocks];
}

/** The whole document to Markdown with `<!-- p:N -->` page markers (citations use them). */
export function layoutToMarkdown(pages: PageItems[], outline: OutlineEntry[] = []): BookText {
  const raw = pages.map(toLines);
  const clean = stripRunning(raw);
  const all = clean.flat();
  const levels = outline.length ? new Map<number, number>() : headingLevels(all, bodySize(all));
  const top = Math.min(...outline.map((o) => o.level), 1);
  const ol = outline.map((o) => ({ ...o, level: Math.min(o.level - top + 1, 3) }));
  const out: string[] = [];
  const scanned: number[] = [];
  pages.forEach((p, i) => {
    if (!raw[i].length) scanned.push(p.page);
    const blocks = pageBlocks(clean[i], levels, ol.filter((o) => o.page === p.page));
    if (blocks.length) out.push(`<!-- p:${p.page} -->`, ...blocks);
  });
  return { markdown: out.join("\n\n"), pages: pages.length, scanned };
}

/** Plain text: chapter-like lines become headings, the rest paragraphs. */
export function textToMarkdown(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t) continue;
    const first = t.split("\n")[0].trim();
    if (/^(cap[ií]tulo|parte|unidad|tema|secci[oó]n|chapter|part)\b/i.test(first) && first.length <= 120) {
      out.push(`# ${first}`);
      const rest = t.split("\n").slice(1).join(" ").trim();
      if (rest) out.push(rest);
    } else {
      out.push(t.replace(/-\n(\p{Ll})/gu, "$1").replace(/\s*\n\s*/g, " "));
    }
  }
  return out.join("\n\n");
}

/** Reads a PDF with pdf.js, reporting progress per page. */
export async function pdfBook(data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<BookText> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return readPdf(pdfjs, data, onProgress);
}

type PdfJs = typeof import("pdfjs-dist");

/** The pdf.js part, with the module passed in (the benchmark runs it in Node). */
export async function readPdf(pdfjs: PdfJs, data: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<BookText> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const total = Math.min(doc.numPages, MAX_BOOK_PAGES);
    const outline: OutlineEntry[] = [];
    try {
      const walk = async (items: Awaited<ReturnType<typeof doc.getOutline>>, level: number) => {
        for (const it of items ?? []) {
          try {
            const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
            if (dest?.[0]) outline.push({ title: it.title.trim(), page: (await doc.getPageIndex(dest[0])) + 1, level });
          } catch {
            /* a broken bookmark: skip it */
          }
          if (level < 3) await walk(it.items, level + 1);
        }
      };
      await walk(await doc.getOutline(), 1);
    } catch {
      /* no bookmarks: headings come from font sizes */
    }
    const pages: PageItems[] = [];
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }[]) {
        if (typeof it.str !== "string" || !it.transform) continue;
        const [, , c, d, e, f] = it.transform;
        items.push({ str: it.str, x: e, y: f, w: it.width ?? 0, size: it.height || Math.hypot(c, d), eol: it.hasEOL });
      }
      pages.push({ page: i, items });
      page.cleanup();
      onProgress?.(i, total);
    }
    return layoutToMarkdown(pages, outline.filter((o) => o.title && o.page <= total));
  } finally {
    await task.destroy();
  }
}
