import { describe, expect, it } from "vitest";
import { byYear, gradeText, nextStep, parseGrades, progressPct, yearLabel } from "./career";
import type { CareerSubjectView } from "../types";

const s = (over: Partial<CareerSubjectView>): CareerSubjectView => ({
  id: "x",
  name: "Física I",
  code: "",
  year: 1,
  term: null,
  para_cursar: [],
  para_rendir: [],
  status: "pendiente",
  grade: null,
  failed: [],
  can_take: false,
  can_sit_final: false,
  missing: [],
  in_cursada: false,
  ...over,
});

describe("career", () => {
  it("AC-156: grades read with a comma and are checked", () => {
    expect(gradeText(8)).toBe("8");
    expect(gradeText(7.5)).toBe("7,5");
    expect(parseGrades("2, 3,5 4")).toEqual([2, 3.5, 4]);
    expect(parseGrades("")).toEqual([]);
    expect(() => parseGrades("12")).toThrow();
    expect(() => parseGrades("dos")).toThrow();
  });

  it("AC-156: the row says the next step or what blocks it", () => {
    expect(nextStep(s({ status: "aprobada" }))).toBeNull();
    expect(nextStep(s({ can_take: true }))).toBe("Podés cursarla");
    expect(nextStep(s({ can_take: true, in_cursada: true }))).toContain("está en tu cursada");
    expect(nextStep(s({ status: "regular", can_sit_final: true }))).toBe("Podés rendir el final");
    expect(nextStep(s({ missing: ["Análisis I", "Álgebra"] }))).toBe("Para cursarla te falta regularizar: Análisis I, Álgebra");
    expect(nextStep(s({ status: "regular", missing: ["Análisis I"] }))).toBe("Para rendir te falta aprobar: Análisis I");
  });

  it("groups by year and cuatrimestre", () => {
    const got = byYear([s({ id: "b", year: 2, term: 2 }), s({ id: "a", year: 1 }), s({ id: "c", year: 2, term: 1 })]);
    expect(got.map(([y, xs]) => [y, xs.map((x) => x.id)])).toEqual([
      [1, ["a"]],
      [2, ["c", "b"]],
    ]);
    expect(yearLabel(1)).toBe("Primer año");
    expect(yearLabel(3)).toBe("Tercer año");
    expect(progressPct(10, 40)).toBe(25);
    expect(progressPct(0, 0)).toBe(0);
  });
});
