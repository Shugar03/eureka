import { describe, expect, it } from "vitest";
import { expected, grade, gradable, normalize } from "./grade";
import type { QuestionArgs } from "../types";

const q = (a: Partial<QuestionArgs>): QuestionArgs => ({ question: "q", purpose: "check", ...a });

describe("instant correction (AC-208)", () => {
  it("choice and multi", () => {
    const c = q({ options: ["a", "b", "c"], answer: 2 });
    expect(grade(c, { choice: "b" })).toEqual({ correct: true, right: 1, total: 1 });
    expect(grade(c, { choice: "a" })?.correct).toBe(false);
    expect(expected(c)).toBe("b");
    const m = q({ format: "multi", options: ["a", "b", "c"], answer: [1, 3] });
    // Each option is a decision: b left out is right too.
    expect(grade(m, { picked: ["a", "c"] })).toEqual({ correct: true, right: 3, total: 3 });
    expect(grade(m, { picked: ["a", "b"] })).toEqual({ correct: false, right: 1, total: 3 });
    expect(expected(m)).toBe("a · c");
  });

  it("true_false, order and match count each part", () => {
    const tf = q({ format: "true_false", statements: ["x", "y", "z"], answer: [true, false, true] });
    expect(grade(tf, { verdicts: { 0: true, 1: true, 2: true } })).toEqual({ correct: false, right: 2, total: 3 });
    expect(expected(tf)).toBe("1. Verdadero  2. Falso  3. Verdadero");
    const o = q({ format: "order", items: ["a", "b", "c"] });
    expect(grade(o, { order: ["a", "c", "b"] })).toEqual({ correct: false, right: 1, total: 3 });
    const mt = q({ format: "match", pairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }] });
    expect(grade(mt, { matches: { 0: "1", 1: "2" } })?.correct).toBe(true);
  });

  it("cloze forgives case, accents, spaces and accepts alternatives", () => {
    const c = q({ question: "La ___ entra cuando se ___.", format: "cloze", answer: ["cuestión social", "problematiza|visibiliza"] });
    expect(grade(c, { gaps: ["Cuestion  Social.", "visibiliza"] })).toEqual({ correct: true, right: 2, total: 2 });
    expect(grade(c, { gaps: ["agenda", "problematiza"] })?.right).toBe(1);
    expect(expected(c)).toBe("La cuestión social entra cuando se problematiza.");
    expect(normalize("  ¿Público?  ")).toBe("publico");
  });

  it("reads the key the way models send it", () => {
    expect(grade(q({ options: ["a", "b", "c"], answer: "2" as never }), { choice: "b" })?.correct).toBe(true);
    expect(grade(q({ options: ["a", "Capital humano"], answer: "capital humano" as never }), { choice: "Capital humano" })?.correct).toBe(true);
    const tf = q({ format: "true_false", statements: ["x", "y"], answer: "[false, true]" as never });
    expect(grade(tf, { verdicts: { 0: false, 1: true } })?.correct).toBe(true);
    expect(grade(q({ format: "true_false", statements: ["x", "y"], answer: ["false", "true"] as never }), { verdicts: { 0: false, 1: true } })?.correct).toBe(true);
    expect(grade(q({ question: "En ___", format: "cloze", answer: [1948] as never }), { gaps: ["1948"] })?.correct).toBe(true);
  });

  it("without a key there is nothing to correct", () => {
    expect(gradable(q({ options: ["a", "b"] }))).toBe(false);
    expect(grade(q({}), {})).toBeNull();
  });
});
