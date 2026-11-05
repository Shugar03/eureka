// AC-187: a PDF into the library, reading its scanned pages with the local OCR.
// Shared by Biblioteca and the chat's «+». Up to OCR_AUTO_PAGES scanned pages the
// reading starts by itself; more, `confirm` asks with an estimate first. The book
// exists after the first pages and keeps growing in the background (ocrJobs).
import { libraryApi, ocrApi } from "../api";
import type { BookSummary } from "../types";
import { pdfBook } from "./bookText";
import { pdfRenderer } from "./images";
import { estimateText, fileHash, needsConfirm, ocrJobs } from "./ocr";

export interface AddedPdf {
  book: BookSummary;
  /** Scanned pages without text left in the book (OCR declined or not available). */
  unread: number;
  /** "started": the rest is being read in the background. */
  ocr: "none" | "started" | "declined";
}

export async function addPdf(file: File, title: string, opts: { onStatus?: (text: string) => void; confirm: (pages: number, estimate: string) => Promise<boolean> }): Promise<AddedPdf> {
  const data = await file.arrayBuffer();
  const doc = await pdfBook(data.slice(0), (done, total) => opts.onStatus?.(`Leyendo ${file.name}: página ${done} de ${total}`));
  const plain = async (ocr: AddedPdf["ocr"]) => ({ book: await libraryApi.import(title, file.name, doc.markdown, doc.pages, doc.scanned), unread: doc.scanned.length, ocr });
  if (!doc.scanned.length || !(await ocrApi.available().catch(() => false))) return plain("none");

  const hash = await fileHash(data.slice(0));
  // The same file again: it continues its book (and its cache), it doesn't duplicate it.
  const existing = (await libraryApi.list()).find((b) => b.ocr?.hash === hash);
  if (existing && (!existing.ocr!.pending.length || ocrJobs.isRunning(hash))) return { book: existing, unread: 0, ocr: ocrJobs.isRunning(hash) ? "started" : "none" };
  const todo = existing ? existing.ocr!.pending : doc.scanned;
  const cached = await ocrApi.cached(hash);
  const left = todo.filter((p) => !cached[p]).length;
  if (needsConfirm(left) && !(await opts.confirm(left, estimateText(left)))) {
    return existing ? { book: existing, unread: existing.ocr!.pending.length, ocr: "declined" } : plain("declined");
  }

  opts.onStatus?.(`Leyendo ${file.name} con OCR…`);
  const pdf = await pdfRenderer(data);
  const { ready } = ocrJobs.start(
    hash,
    title,
    todo,
    {
      render: (page) => pdf.render(page),
      read: (img, page) => ocrApi.page(img.width, img.height, img.data, page),
      cached: async () => cached,
      put: (page, text) => ocrApi.put(hash, page, text),
      create: async (pages, pending) => (await libraryApi.import(title, file.name, doc.markdown, doc.pages, doc.scanned, { hash, pages, pending })).id,
      append: (id, pages, pending) => libraryApi.addOcrPages(id, pages, pending),
      finish: async (r) => {
        await pdf.close();
        // Everything is in the book now; a canceled reading keeps its cache to resume.
        if (!r.canceled) await ocrApi.clear(hash);
      },
    },
    existing?.id ?? null,
  );
  const id = await ready;
  const book = id ? (await libraryApi.list()).find((b) => b.id === id) : undefined;
  if (!book) {
    const job = ocrJobs.get(hash);
    throw job?.error ?? "No encontré texto en las páginas escaneadas.";
  }
  return { book, unread: 0, ocr: "started" };
}
