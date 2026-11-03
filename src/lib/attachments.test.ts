import { describe, expect, it } from "vitest";
import { composeMessage, isDocument, isPhoto, titleOf, type Attachment } from "./attachments";

const book = (label: string): Attachment => ({ id: label, kind: "book", label, detail: "en tu biblioteca" });
const image = (label: string, text: string): Attachment => ({ id: label, kind: "image", label, detail: "texto leído", text });

describe("composeMessage (AC-105)", () => {
  it("is just the words when nothing is attached", () => {
    expect(composeMessage("  hola  ", [])).toBe("hola");
    expect(composeMessage("", [])).toBe("");
  });

  it("says what was added to the library, with a question when the person wrote nothing", () => {
    expect(composeMessage("", [book("Cálculo I")])).toBe("Adjunté a mi biblioteca: «Cálculo I». ¿Qué podemos hacer con eso?");
    expect(composeMessage("resumímelo", [book("Cálculo I"), book("Física")])).toBe("resumímelo\n\nAdjunté a mi biblioteca: «Cálculo I», «Física».");
  });

  it("carries the text read from a photo, after the person's words", () => {
    expect(composeMessage("¿está bien?", [image("apunte.jpg", "F = m·a")])).toBe("¿está bien?\n\nImagen adjunta (apunte.jpg):\nF = m·a");
    expect(composeMessage("", [image("apunte.jpg", "F = m·a")])).toBe("Te paso esto:\n\nImagen adjunta (apunte.jpg):\nF = m·a");
    expect(composeMessage("mirá", [image("a.png", "  ")])).toContain("(no se pudo leer texto en la imagen)");
  });

  it("puts a book and a photo together without losing either", () => {
    const m = composeMessage("", [book("Notas"), image("foto.png", "texto")]);
    expect(m).toBe("Adjunté a mi biblioteca: «Notas». ¿Qué podemos hacer con eso?\n\nImagen adjunta (foto.png):\ntexto");
  });
});

describe("what can be attached", () => {
  it("tells documents from photos by type or by extension", () => {
    for (const f of [{ name: "a.pdf", type: "" }, { name: "a.TXT", type: "" }, { name: "x.md", type: "" }, { name: "x.markdown", type: "" }, { name: "sin-extension", type: "application/pdf" }, { name: "n", type: "text/plain" }]) expect(isDocument(f), f.name).toBe(true);
    for (const f of [{ name: "a.png", type: "" }, { name: "b.JPG", type: "" }, { name: "c.jpeg", type: "" }, { name: "d.webp", type: "" }, { name: "x", type: "image/png" }]) expect(isPhoto(f), f.name).toBe(true);
    for (const f of [{ name: "a.docx", type: "" }, { name: "a.zip", type: "application/zip" }, { name: "a.gif", type: "image/gif" }]) expect(isDocument(f) || isPhoto(f), f.name).toBe(false);
  });

  it("names a book after its file", () => {
    expect(titleOf("resumen_historia-2024.pdf")).toBe("resumen historia 2024");
    expect(titleOf("Apuntes.md")).toBe("Apuntes");
    expect(titleOf(".pdf")).toBe(".pdf");
  });
});
