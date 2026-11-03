import { describe, expect, it } from "vitest";
import { BREATH_CYCLE, breathAt, dayLabel, GROUNDING, splitList } from "./companion";

describe("breathAt (AC-87)", () => {
  it("walks inhale 4, hold 4, exhale 6, then starts again", () => {
    const at = (t: number) => {
      const b = breathAt(t);
      return [b.step.label, b.left, b.cycle];
    };
    expect(BREATH_CYCLE).toBe(14);
    expect(at(0)).toEqual(["Inhalá", 4, 1]);
    expect(at(3)).toEqual(["Inhalá", 1, 1]);
    expect(at(4)).toEqual(["Sostené", 4, 1]);
    expect(at(8)).toEqual(["Exhalá", 6, 1]);
    expect(at(13)).toEqual(["Exhalá", 1, 1]);
    expect(at(14)).toEqual(["Inhalá", 4, 2]);
    expect(at(-5)).toEqual(["Inhalá", 4, 1]);
  });
});

describe("grounding", () => {
  it("counts down 5 to 1", () => {
    expect(GROUNDING.map((g) => g.n)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("splitList", () => {
  it("trims, lowercases and drops empties and repeats", () => {
    expect(splitList(" Cansancio, alivio ,, cansancio ")).toEqual(["cansancio", "alivio"]);
    expect(splitList("")).toEqual([]);
  });
});

describe("dayLabel", () => {
  it("says today and yesterday, and the date otherwise", () => {
    const now = new Date(2026, 9, 28, 15);
    expect(dayLabel(new Date(2026, 9, 28, 1).toISOString(), now)).toBe("Hoy");
    expect(dayLabel(new Date(2026, 9, 27, 23).toISOString(), now)).toBe("Ayer");
    expect(dayLabel(new Date(2026, 9, 20, 12).toISOString(), now)).toMatch(/20/);
  });
});
