import { describe, expect, it } from "vitest";
import { longDate, parseExamProposal, sameName } from "./examChat";

const parse = (a: unknown) => parseExamProposal(JSON.stringify(a));

describe("parseExamProposal (AC-120)", () => {
  it("reads what the agent proposed, with everything optional but the name", () => {
    expect(parse({ name: " AWS Certified AI Practitioner " })).toEqual({ name: "AWS Certified AI Practitioner", kind: "certification", exam_date: null, hours_per_week: null, passing_pct: null, guide: null });
    expect(parse({ name: "Álgebra I", kind: "subject", exam_date: "2026-12-15", hours_per_week: 6.5, passing_pct: 60, guide: "  Unidad 1  " })).toEqual({
      name: "Álgebra I",
      kind: "subject",
      exam_date: "2026-12-15",
      hours_per_week: 6.5,
      passing_pct: 60,
      guide: "Unidad 1",
    });
    expect(parse({ name: "X", exam_date: "", guide: "   " })).toMatchObject({ exam_date: null, guide: null });
  });

  it("only turns into a card what the backend would also accept", () => {
    for (const bad of [
      { name: "  " },
      { name: "x".repeat(121) },
      { name: "X", kind: "language" },
      { name: "X", exam_date: "15/12/2026" },
      { name: "X", exam_date: "2026-02-30" },
      { name: "X", hours_per_week: 100 },
      { name: "X", hours_per_week: "mucho" },
      { name: "X", passing_pct: 0 },
      { kind: "certification" },
    ]) {
      expect(parse(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseExamProposal("no json")).toBeNull();
  });
});

describe("helpers", () => {
  it("says the date in words and compares names ignoring case and accents", () => {
    expect(longDate("2026-12-15")).toBe("15 de diciembre de 2026");
    expect(sameName("  AWS  Certified AI practitioner", "aws certified ai Practitioner")).toBe(true);
    expect(sameName("Álgebra I", "algebra i")).toBe(true);
    expect(sameName("Álgebra I", "Álgebra II")).toBe(false);
  });
});
