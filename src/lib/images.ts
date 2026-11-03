// AC-63: images for the vision model, made small enough to send (JPEG,
// longest side ≤ 2000 px). Scanned PDFs: their first pages, rendered.

export const MAX_SIDE = 2000;
export const MAX_PDF_IMAGE_PAGES = 6;

export const isImage = (f: File) => /^image\/(png|jpe?g|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

/** Width and height that fit in `max` keeping the ratio (never upscaled). */
export function fit(w: number, h: number, max = MAX_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

function canvasToJpeg(c: HTMLCanvasElement): string {
  return c.toDataURL("image/jpeg", 0.85);
}

export async function imageToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const [w, h] = fit(bmp.width, bmp.height);
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs read better on white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvasToJpeg(c);
}

export async function pdfPageImages(data: ArrayBuffer, maxPages = MAX_PDF_IMAGE_PAGES): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_SIDE / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(vp.width), height: Math.round(vp.height) });
      await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
      out.push(canvasToJpeg(c));
    }
    return out;
  } finally {
    await task.destroy();
  }
}
