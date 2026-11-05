// AC-105: what the "+" of the chat attaches, and how it becomes part of the message.
// A document goes into the library (0 tokens, searchable by the agent); a photo is
// read with the vision model and its text travels in the message.

export interface Attachment {
  id: string;
  kind: "book" | "image";
  /** A book's title, or an image's file name. */
  label: string;
  /** What the chip says under the name. */
  detail: string;
  /** For an image: the text read from it. */
  text?: string;
}

/** AC-191: Word, PowerPoint, EPUB and OpenDocument text, converted to Markdown on this PC (Rust). */
export const isOfficeDocument = (f: { name: string }) => /\.(docx|pptx|epub|odt)$/i.test(f.name);

/** What the library's file pickers accept. */
export const LIBRARY_FILES = ".pdf,.txt,.md,.markdown,.docx,.pptx,.epub,.odt,application/pdf,text/plain,text/markdown";

/** Documents the library reads: PDF, plain text, Markdown, Word, PowerPoint, EPUB and ODT. */
export const isDocument = (f: { name: string; type: string }) => f.type === "application/pdf" || /\.(pdf|txt|md|markdown)$/i.test(f.name) || f.type === "text/plain" || f.type === "text/markdown" || isOfficeDocument(f);

export const isPhoto = (f: { name: string; type: string }) => /^image\/(png|jpe?g|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

/** "resumen_historia-2024.pdf" → "resumen historia 2024". */
export function titleOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
}

/** The message that goes to the agent: the person's words first, then what they attached. */
export function composeMessage(text: string, items: Attachment[]): string {
  const body = text.trim();
  const books = items.filter((i) => i.kind === "book");
  const images = items.filter((i) => i.kind === "image");
  const parts: string[] = [];
  if (body) parts.push(body);
  else if (!books.length && images.length) parts.push("Te paso esto:");
  if (books.length) parts.push(`Adjunté a mi biblioteca: ${books.map((b) => `«${b.label}»`).join(", ")}.${body ? "" : " ¿Qué podemos hacer con eso?"}`);
  for (const img of images) parts.push(`Imagen adjunta (${img.label}):\n${img.text?.trim() || "(no se pudo leer texto en la imagen)"}`);
  return parts.join("\n\n");
}
