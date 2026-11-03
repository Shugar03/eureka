// AC-151/AC-155: the text of a file the person picked — a text PDF directly,
// a photo or a scanned PDF through the vision model (same key, same model).
import { visionApi } from "../api";
import { imageToDataUrl, isImage, pdfPageImages } from "./images";
import { pdfText } from "./pdfText";

export type ReadPurpose = "timetable" | "curriculum" | "problems";

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** `viaVision` tells the UI to ask for a careful review of the transcription. */
export async function fileText(file: File, purpose: ReadPurpose, onVision?: () => void): Promise<{ text: string; viaVision: boolean }> {
  const pdf = isPdf(file);
  let text = isImage(file) ? "" : pdf ? await pdfText(await file.arrayBuffer()) : await file.text();
  if (text.trim() || !(isImage(file) || pdf)) return { text: text.trim(), viaVision: false };
  onVision?.();
  const images = isImage(file) ? [await imageToDataUrl(file)] : await pdfPageImages(await file.arrayBuffer());
  text = await visionApi.read(images, purpose);
  return { text: text.trim(), viaVision: true };
}
