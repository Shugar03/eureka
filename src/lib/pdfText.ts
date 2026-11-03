// Text of a PDF (an exam guide), read locally with pdf.js: the file never
// leaves the machine. pdf.js is big, so it loads only when a PDF is picked.

export const MAX_PDF_PAGES = 80;

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

/** Joins pdf.js text items into lines and tidies the whitespace. */
export function itemsToText(items: TextItem[]): string {
  let out = "";
  for (const it of items) {
    if (typeof it.str === "string") out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return tidy(out);
}

export function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
      const page = await doc.getPage(i);
      pages.push(itemsToText((await page.getTextContent()).items as TextItem[]));
    }
    return tidy(pages.join("\n\n"));
  } finally {
    await task.destroy();
  }
}
