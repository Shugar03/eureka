// AC-187/188: reading scans and photos of printed text on this PC (PaddleOCR, in
// the Rust side). This module is the logic around it, with no Tauri or pdf.js in
// it: when to start by itself and when to ask, the background reading page by page
// (cancelable, resumable from the per-page cache), and when a photo's OCR is good
// enough to skip the vision model.
import type { OcrPageInput, OcrPageText } from "../types";
import type { Rgba } from "./images";

/** Up to this many scanned pages the reading starts by itself; more, it asks first. */
export const OCR_AUTO_PAGES = 10;
/** Seconds per page measured on a Ryzen 5 4500 (release build, 1800 px pages); the
 * running estimate replaces it with the real pace after the first page. */
export const SECONDS_PER_PAGE = 4;
/** Pages per write to the library: the book is usable after the first batch. */
export const OCR_BATCH = 3;

export const needsConfirm = (pages: number) => pages > OCR_AUTO_PAGES;

/** "menos de un minuto", "1 minuto", "unos 3 minutos". */
export function duration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (seconds < 50) return "menos de un minuto";
  if (min <= 1) return "1 minuto";
  return `unos ${min} minutos`;
}

/** «Son 31 páginas escaneadas: leerlas lleva unos 3 minutos» */
export function estimateText(pages: number, perPage = SECONDS_PER_PAGE): string {
  return `Son ${pages} páginas escaneadas: leerlas lleva ${duration(pages * perPage)}`;
}

/** «Leyendo página 12 de 31 · faltan ~1 min» */
export function progressText(index: number, total: number, secondsLeft: number): string {
  const left = secondsLeft < 50 ? "falta menos de 1 min" : `faltan ~${Math.round(secondsLeft / 60)} min`;
  return `Leyendo página ${index} de ${total} · ${left}`;
}

/** AC-188: a photo's OCR is used instead of the vision model only when it read enough
 * text (20+ letters or digits) with a mean confidence of 0.9 or more. Handwriting,
 * diagrams and blurry photos read low and go to the vision model as before. */
export const MIN_PHOTO_CHARS = 20;
export const MIN_PHOTO_CONFIDENCE = 0.9;
export const isConfident = (p: Pick<OcrPageText, "chars" | "confidence">) => p.chars >= MIN_PHOTO_CHARS && p.confidence >= MIN_PHOTO_CONFIDENCE;

export interface PhotoDeps {
  available: () => Promise<boolean>;
  ocr: () => Promise<OcrPageText>;
  vision: () => Promise<string>;
}

/** AC-188: local OCR first; the vision model only when it isn't confident (or OCR is
 * not available here, like on the phone, or it failed). */
export async function photoText(deps: PhotoDeps): Promise<{ text: string; via: "ocr" | "vision" }> {
  try {
    if (await deps.available()) {
      const page = await deps.ocr();
      if (isConfident(page)) return { text: page.markdown, via: "ocr" };
    }
  } catch {
    /* the vision model reads it instead */
  }
  return { text: await deps.vision(), via: "vision" };
}

export interface OcrProgress {
  /** 1-based position among the pages to read. */
  index: number;
  total: number;
  page: number;
  secondsLeft: number;
}

export interface OcrRunDeps {
  render: (page: number) => Promise<Rgba>;
  read: (img: Rgba, page: number) => Promise<OcrPageText>;
  /** Pages already read (a previous run that stopped). */
  cached: () => Promise<Record<string, OcrPageText>>;
  put: (page: number, text: OcrPageText) => Promise<unknown>;
  /** Creates the book with its first pages; returns its id. */
  create: (pages: OcrPageInput[], pending: number[]) => Promise<string>;
  append: (id: string, pages: OcrPageInput[], pending: number[]) => Promise<unknown>;
  now?: () => number;
}

export interface OcrRun {
  bookId: string | null;
  read: number[];
  canceled: boolean;
}

/** Reads `pages` in order, writing to the library every OCR_BATCH pages: the book is
 * created as soon as some page has text, then grows. Canceling stops after the page
 * in progress and keeps what was read; the pages left stay `pending`. */
export async function runOcr(pages: number[], deps: OcrRunDeps, opts: { bookId?: string | null; signal?: AbortSignal; onProgress?: (p: OcrProgress) => void; onBook?: (id: string) => void } = {}): Promise<OcrRun> {
  const now = deps.now ?? (() => performance.now());
  const cache = await deps.cached();
  let bookId = opts.bookId ?? null;
  const read: number[] = [];
  let buffer: OcrPageInput[] = [];
  const pending = () => pages.filter((p) => !read.includes(p));
  const flush = async () => {
    if (!buffer.length) return;
    if (!bookId) {
      if (!buffer.some((b) => b.markdown.trim())) return; // blank pages so far: wait for text
      bookId = await deps.create(buffer, pending());
      opts.onBook?.(bookId);
    } else await deps.append(bookId, buffer, pending());
    buffer = [];
  };
  let spent = 0;
  let measured = 0;
  const uncached = pages.filter((p) => !cache[p]).length;
  for (const [i, page] of pages.entries()) {
    if (opts.signal?.aborted) break;
    const perPage = measured ? spent / measured / 1000 : SECONDS_PER_PAGE;
    opts.onProgress?.({ index: i + 1, total: pages.length, page, secondsLeft: Math.max(0, uncached - measured) * perPage });
    let text = cache[page];
    if (!text) {
      const t0 = now();
      text = await deps.read(await deps.render(page), page);
      spent += now() - t0;
      measured++;
      await deps.put(page, text);
    }
    read.push(page);
    buffer.push({ page, markdown: text.markdown, review: text.review });
    if (buffer.length >= OCR_BATCH) await flush();
  }
  await flush();
  return { bookId, read, canceled: read.length < pages.length };
}

// ── Readings in the background: they live here, not in a screen, so they go on
// while the person moves around the app. ──

export interface OcrJob {
  /** The PDF's sha256. */
  key: string;
  title: string;
  progress: OcrProgress | null;
  state: "running" | "done" | "canceled" | "error";
  bookId: string | null;
  error?: string;
}

const jobs = new Map<string, OcrJob>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let snapshot: OcrJob[] = [];

function emit() {
  snapshot = [...jobs.values()];
  for (const l of listeners) l();
}

function update(key: string, patch: Partial<OcrJob>) {
  const j = jobs.get(key);
  if (!j) return;
  jobs.set(key, { ...j, ...patch });
  emit();
}

export const ocrJobs = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  list: () => snapshot,
  get: (key: string) => jobs.get(key),
  cancel: (key: string) => controllers.get(key)?.abort(),
  dismiss: (key: string) => {
    if (jobs.get(key)?.state !== "running") jobs.delete(key);
    emit();
  },
  /** Starts a reading unless one with that key is running; `ready` resolves with the
   * book id once the book exists (or null if nothing was read), `done` at the end. */
  start(key: string, title: string, pages: number[], deps: OcrRunDeps & { finish?: (r: OcrRun) => Promise<unknown> }, bookId: string | null = null): { ready: Promise<string | null>; done: Promise<OcrRun | null> } {
    const ctrl = new AbortController();
    controllers.set(key, ctrl);
    jobs.set(key, { key, title, progress: null, state: "running", bookId });
    emit();
    let resolveReady: (id: string | null) => void = () => {};
    const ready = new Promise<string | null>((r) => (resolveReady = r));
    if (bookId) resolveReady(bookId);
    const done = runOcr(pages, deps, {
      bookId,
      signal: ctrl.signal,
      onProgress: (progress) => update(key, { progress }),
      onBook: (id) => {
        update(key, { bookId: id });
        resolveReady(id);
      },
    })
      .then(async (r) => {
        await deps.finish?.(r);
        update(key, { state: r.canceled ? "canceled" : "done", bookId: r.bookId });
        resolveReady(r.bookId);
        return r;
      })
      .catch((e) => {
        update(key, { state: "error", error: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) });
        resolveReady(jobs.get(key)?.bookId ?? null);
        return null;
      })
      .finally(() => controllers.delete(key));
    return { ready, done };
  },
  isRunning: (key: string) => jobs.get(key)?.state === "running",
};

/** sha256 of a file, hex: the key of its OCR cache and of its book. */
export async function fileHash(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
