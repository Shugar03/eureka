import { describe, expect, it } from "vitest";
import { layoutToMarkdown, textToMarkdown, toLines, type PageItems, type RawItem } from "./bookText";

/** A page from lines of [text, size]; y goes down 16 units per line. */
function page(n: number, lines: [string, number][], gapAfter: number[] = []): PageItems {
  let y = 780;
  const items: RawItem[] = [];
  lines.forEach(([str, size], i) => {
    items.push({ str, x: 56, y, w: str.length * size * 0.5, size, eol: true });
    y -= gapAfter.includes(i) ? 40 : 16;
  });
  return { page: n, items };
}

const body = (s: string): [string, number] => [s, 11];

describe("bookText", () => {
  it("joins runs on the same baseline with spaces only where they are apart", () => {
    const lines = toLines({
      page: 1,
      items: [
        { str: "deri", x: 10, y: 100, w: 20, size: 10 },
        { str: "vada", x: 30, y: 100, w: 20, size: 10 },
        { str: "pendiente", x: 56, y: 100, w: 40, size: 10 },
        { str: "otra línea", x: 10, y: 84, w: 40, size: 10 },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual(["derivada pendiente", "otra línea"]);
  });

  it("detects headings by size, drops running headers and page numbers, rejoins hyphens, marks pages", () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page(n, [
        ["Cálculo I — Apuntes", 9],
        ...(n === 1 ? [["Capítulo 1: Derivadas", 18] as [string, number]] : []),
        ...(n === 3 ? [["1.1 La recta tangente", 14] as [string, number]] : []),
        body("La derivada mide cómo cambia una fun-"),
        body("ción cuando cambia su variable."),
        body("Es la pendiente de la recta tangente en un punto"),
        body("del gráfico, y se escribe f'(x)"),
        [String(n), 9],
      ]),
    );
    const { markdown, scanned } = layoutToMarkdown(pages);
    expect(markdown).toContain("<!-- p:1 -->\n\n# Capítulo 1: Derivadas");
    expect(markdown).toContain("<!-- p:3 -->\n\n## 1.1 La recta tangente");
    expect(markdown).toContain("cambia una función cuando");
    expect(markdown).not.toContain("Apuntes");
    expect(markdown).not.toMatch(/^\d$/m);
    expect(scanned).toEqual([]);
  });

  it("uses the PDF bookmarks when there are any, even if the title is not printed", () => {
    const pages = [page(1, [body("Texto de la intro")]), page(2, [["Derivadas", 18], body("Texto del capítulo")])];
    const { markdown } = layoutToMarkdown(pages, [
      { title: "Introducción", page: 1, level: 1 },
      { title: "Derivadas", page: 2, level: 1 },
    ]);
    expect(markdown).toBe("<!-- p:1 -->\n\n# Introducción\n\nTexto de la intro\n\n<!-- p:2 -->\n\n# Derivadas\n\nTexto del capítulo");
  });

  it("separates paragraphs on big gaps, lists bullets and reports scanned pages", () => {
    const { markdown, scanned } = layoutToMarkdown([
      page(1, [body("Primer párrafo."), body("Segundo párrafo."), body("• un punto"), body("• otro punto")], [0]),
      { page: 2, items: [] },
    ]);
    expect(markdown).toBe("<!-- p:1 -->\n\nPrimer párrafo.\n\nSegundo párrafo.\n\n- un punto\n\n- otro punto");
    expect(scanned).toEqual([2]);
  });

  it("plain text: chapter lines become headings and wrapped lines join", () => {
    expect(textToMarkdown("CAPÍTULO 1 Límites\nIntro corta.\n\nUn párrafo\npartido en dos.")).toBe("# CAPÍTULO 1 Límites\n\nIntro corta.\n\nUn párrafo partido en dos.");
  });
});
