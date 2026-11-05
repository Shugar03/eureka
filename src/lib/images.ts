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

/** Pixels for the local OCR (AC-187/188). */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** OCR reads pages at about this width (the scans are rarely sharper). */
export const OCR_WIDTH = 1800;

function canvasRgba(c: HTMLCanvasElement): Rgba {
  return { width: c.width, height: c.height, data: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data };
}

/** A photo as pixels on white, longest side ≤ MAX_SIDE. */
export async function imageRgba(file: File): Promise<Rgba> {
  const bmp = await createImageBitmap(file);
  const [w, h] = fit(bmp.width, bmp.height);
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvasRgba(c);
}

/** A PDF kept open to render its pages one by one for the OCR, ~OCR_WIDTH wide. */
export async function pdfRenderer(data: ArrayBuffer): Promise<{ render: (page: number) => Promise<Rgba>; close: () => Promise<void> }> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  return {
    render: async (n) => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: OCR_WIDTH / base.width });
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(vp.width), height: Math.round(vp.height) });
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      return canvasRgba(c);
    },
    close: () => task.destroy(),
  };
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
