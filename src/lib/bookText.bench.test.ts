/// <reference types="node" />
// @vitest-environment node
// NF-22: the library benchmark, conversion half. Converts the invented
// 28-page book with the real pdf.js (Node build), checks the structure and
// writes the Markdown the Rust half (`library::tests::editorial_benchmark`)
// indexes and queries. Metrics go to tests/fixtures/libro-editorial.convert.json.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPdf } from "./bookText";

const FIX = "tests/fixtures";
/** Same estimate as the backend (`context::estimate_tokens`): ~3.5 characters per token. */
const tokens = (s: string) => Math.ceil(s.length / 3.5);

describe("benchmark: libro editorial", () => {
  it("converts 28 pages locally in well under a second per 10 pages, with chapters and sections", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
    const data = readFileSync(`${FIX}/libro-editorial.pdf`);
    const q = JSON.parse(readFileSync(`${FIX}/libro-editorial.questions.json`, "utf-8"));

    const t0 = performance.now();
    const book = await readPdf(pdfjs as never, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    const ms = performance.now() - t0;

    const headings = book.markdown.split("\n").filter((l) => /^#{1,3} /.test(l));
    expect(headings.filter((h) => h.startsWith("# "))).toEqual(["# Capítulo 1: Fundamentos de la fermentación", "# Capítulo 2: Técnicas tradicionales y su ciencia"]);
    expect(headings.filter((h) => h.startsWith("## "))).toHaveLength(10);
    expect(book.markdown).not.toContain("Editorial Marea\n");
    expect(book.markdown).not.toContain("Fermentación en la cocina andina —");
    expect(book.markdown).toContain("dividiendo la acidez por los grados de azúcar restante; un valor de 0,8");
    expect(book.pages).toBe(q.pages);
    expect(book.scanned).toEqual([]);

    const pdfText = book.markdown.replace(/<!-- p:\d+ -->/g, "");
    const metrics = {
      pages: book.pages,
      convert_ms: Math.round(ms),
      pdf_bytes: data.byteLength,
      markdown_chars: book.markdown.length,
      book_tokens_est: tokens(pdfText),
      model_tokens_used: 0,
      sections: headings.length,
    };
    writeFileSync(`${FIX}/libro-editorial.md`, book.markdown);
    writeFileSync(`${FIX}/libro-editorial.convert.json`, JSON.stringify(metrics, null, 2));
    console.log("conversión", metrics);
    expect(ms).toBeLessThan(5000);
  }, 30_000);
});
