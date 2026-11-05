import { describe, expect, it, vi } from "vitest";
import type { OcrPageText } from "../types";
import { OCR_BATCH, duration, estimateText, isConfident, needsConfirm, ocrJobs, photoText, progressText, runOcr, type OcrRunDeps } from "./ocr";

const text = (markdown: string, confidence = 0.97): OcrPageText => ({ markdown, lines: [], confidence, chars: markdown.replace(/[^\p{L}\p{N}]/gu, "").length, review: confidence < 0.9 ? [markdown] : [] });

/** A fake backend: pages render to nothing, read as "página N", the library is a log. */
function deps(cached: Record<string, OcrPageText> = {}, blank: number[] = []) {
  const log: string[] = [];
  const put = vi.fn(async () => null);
  const d: OcrRunDeps = {
    render: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
    read: async (_img, page) => {
      log.push(`ocr ${page}`);
      return text(blank.includes(page) ? "" : `página ${page}`);
    },
    cached: async () => cached,
    put,
    create: async (pages, pending) => {
      log.push(`create ${pages.map((p) => p.page)} pending ${pending}`);
      return "libro";
    },
    append: async (_id, pages, pending) => {
      log.push(`append ${pages.map((p) => p.page)} pending ${pending}`);
    },
    now: (() => {
      let t = 0;
      return () => (t += 2000);
    })(),
  };
  return { d, log, put };
}

describe("when to read by itself (AC-187)", () => {
  it("up to 10 scanned pages starts, more asks with an estimate", () => {
    expect(needsConfirm(10)).toBe(false);
    expect(needsConfirm(11)).toBe(true);
    expect(estimateText(31, 6)).toBe("Son 31 páginas escaneadas: leerlas lleva unos 3 minutos");
    expect(duration(30)).toBe("menos de un minuto");
    expect(duration(70)).toBe("1 minuto");
    expect(progressText(12, 31, 70)).toBe("Leyendo página 12 de 31 · faltan ~1 min");
    expect(progressText(31, 31, 4)).toBe("Leyendo página 31 de 31 · falta menos de 1 min");
  });
});

describe("runOcr (AC-187)", () => {
  it("creates the book after the first batch and appends the rest, in page order", async () => {
    const { d, log, put } = deps();
    const progress: string[] = [];
    const r = await runOcr([2, 3, 5, 7, 8], d, { onProgress: (p) => progress.push(`${p.index}/${p.total} p${p.page} ${Math.round(p.secondsLeft)}s`) });
    expect(OCR_BATCH).toBe(3);
    expect(log).toEqual(["ocr 2", "ocr 3", "ocr 5", "create 2,3,5 pending 7,8", "ocr 7", "ocr 8", "append 7,8 pending "]);
    expect(r).toEqual({ bookId: "libro", read: [2, 3, 5, 7, 8], canceled: false });
    expect(put).toHaveBeenCalledTimes(5);
    // The estimate starts from the measured default and follows the real pace (2 s here).
    expect(progress[0]).toBe("1/5 p2 20s");
    expect(progress[4]).toBe("5/5 p8 2s");
  });

  it("resumes from the cache: pages already read are not read again", async () => {
    const { d, log, put } = deps({ "2": text("página 2"), "3": text("página 3") });
    const r = await runOcr([2, 3, 5], d, { bookId: "libro" });
    expect(log).toEqual(["ocr 5", "append 2,3,5 pending "]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(r.canceled).toBe(false);
  });

  it("canceling stops after the page in progress and keeps what was read", async () => {
    const { d, log } = deps();
    const ctrl = new AbortController();
    const read = d.read;
    d.read = async (img, page) => {
      const t = await read(img, page);
      if (page === 4) ctrl.abort();
      return t;
    };
    const r = await runOcr([1, 2, 3, 4, 5, 6], d, { signal: ctrl.signal });
    expect(log).toEqual(["ocr 1", "ocr 2", "ocr 3", "create 1,2,3 pending 4,5,6", "ocr 4", "append 4 pending 5,6"]);
    expect(r).toEqual({ bookId: "libro", read: [1, 2, 3, 4], canceled: true });
  });

  it("waits for a page with text before creating the book (a blank cover)", async () => {
    const { d, log } = deps({}, [1, 2, 3]);
    await runOcr([1, 2, 3, 4], d);
    expect(log.filter((l) => !l.startsWith("ocr"))).toEqual(["create 1,2,3,4 pending "]);
    const empty = deps({}, [1]);
    expect((await runOcr([1], empty.d)).bookId).toBeNull();
  });

  it("a job in the background reports the book as soon as it exists", async () => {
    const { d } = deps();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const read = d.read;
    d.read = async (img, page) => {
      if (page === 4) await gate;
      return read(img, page);
    };
    const { ready, done } = ocrJobs.start("h1", "Apunte", [1, 2, 3, 4], d);
    expect(await ready).toBe("libro");
    expect(ocrJobs.isRunning("h1")).toBe(true);
    await vi.waitFor(() => expect(ocrJobs.get("h1")?.progress?.page).toBe(4));
    release();
    expect((await done)?.canceled).toBe(false);
    expect(ocrJobs.get("h1")?.state).toBe("done");
    ocrJobs.dismiss("h1");
    expect(ocrJobs.list()).toEqual([]);
  });
});

describe("photos: local OCR first (AC-188)", () => {
  const run = (available: boolean, page: OcrPageText | Error) => {
    const vision = vi.fn(async () => "leído por el modelo");
    return { vision, out: photoText({ available: async () => available, ocr: async () => (page instanceof Error ? Promise.reject(page) : page), vision }) };
  };

  it("uses the OCR text and never calls the vision model when it is confident", async () => {
    const { vision, out } = run(true, text("Mitocondria: produce la energía de la célula."));
    expect(await out).toEqual({ text: "Mitocondria: produce la energía de la célula.", via: "ocr" });
    expect(vision).not.toHaveBeenCalled();
  });

  it("falls back to the vision model when unsure, with too little text, or without OCR", async () => {
    for (const [available, page] of [
      [true, text("Una foto borrosa de apuntes a mano", 0.7)],
      [true, text("x = 2", 0.99)],
      [true, new Error("sin modelos")],
      [false, text("Mitocondria: produce la energía de la célula.")],
    ] as const) {
      const { vision, out } = run(available, page);
      expect(await out).toEqual({ text: "leído por el modelo", via: "vision" });
      expect(vision).toHaveBeenCalledOnce();
    }
    expect(isConfident({ chars: 20, confidence: 0.9 })).toBe(true);
    expect(isConfident({ chars: 19, confidence: 0.99 })).toBe(false);
  });
});
