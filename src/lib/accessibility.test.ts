import { describe, expect, it } from "vitest";
import { applyAccessibility, DEFAULT_ACCESSIBILITY, speechText, splitAtWord } from "./accessibility";

describe("speechText (AC-74)", () => {
  it("reads markup, citations and code as a person would say them", () => {
    const md = "## La derivada\n\nEs la **pendiente** de la [recta tangente](https://x.y) [L1] [Cálculo I, «Derivadas», p. 2].\n\n- uno\n- dos\n\n```py\nprint(1)\n```";
    const t = speechText(md);
    expect(t).toBe("La derivada\nEs la pendiente de la recta tangente .\nuno\ndos\n(hay un bloque de código en pantalla)");
  });

  it("turns simple LaTeX into words instead of reading symbols", () => {
    const t = speechText("Si $f(x) = x^2$, entonces $$\\frac{a}{b} \\cdot c$$");
    expect(t).toMatch(/f\(x\)\s+igual a\s+x\s+al cuadrado/);
    expect(t).toMatch(/a\s+sobre\s+b\s+por\s+c/);
    expect(t).not.toMatch(/[$\\^{}]/);
  });

  it("reads table cells separated, not the pipes", () => {
    expect(speechText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a, b\n1, 2");
  });
});

describe("splitAtWord", () => {
  it("marks the word a boundary event points at, and nothing when there is none", () => {
    expect(splitAtWord("hola linda gente", 5)).toEqual(["hola ", "linda", " gente"]);
    expect(splitAtWord("hola", -1)).toEqual(["hola", "", ""]);
    expect(splitAtWord("hola", 99)).toEqual(["hola", "", ""]);
  });
});

describe("applyAccessibility (AC-73)", () => {
  it("sets the attributes the CSS reads, and clears them", () => {
    applyAccessibility({ ...DEFAULT_ACCESSIBILITY, spacing: true, text_size: "larger", reduce_motion: true });
    const d = document.documentElement.dataset;
    expect([d.spacing, d.textSize, d.motion]).toEqual(["on", "larger", "reduce"]);
    applyAccessibility(DEFAULT_ACCESSIBILITY);
    expect([d.spacing, d.textSize, d.motion]).toEqual([undefined, "normal", undefined]);
  });
});
