import { describe, expect, it } from "vitest";
import { fileStem, leftOutText } from "./deckImport";

describe("deckImport", () => {
  it("AC-152: says what was left out and why, in one sentence", () => {
    expect(leftOutText({})).toBeNull();
    expect(leftOutText({ media: 1 })).toBe("Quedaron afuera: 1 nota tenía solo imagen o sonido (no se importan).");
    expect(leftOutText({ media: 3, empty: 2 })).toBe("Quedaron afuera: 3 notas tenían solo imagen o sonido (no se importan); 2 estaban vacías o sin dorso.");
    expect(leftOutText({ skipped: 1 })).toContain("1 tarjeta no se pudo usar");
  });

  it("names the deck after the file", () => {
    expect(fileStem("Inglés B2.apkg")).toBe("Inglés B2");
    expect(fileStem("sin-extension")).toBe("sin-extension");
  });
});
