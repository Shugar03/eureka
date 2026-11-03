import { describe, expect, it } from "vitest";
import { firstOpen, isFinished, lastVerdict, needsNext, toReview, totalOf } from "./practice";
import { expectedOf, scriptedGrade, scriptedProblems } from "../e2e/practiceScript";
import type { PracticeAttempt, PracticeSet, Problem, Verdict } from "../types";

const attempt = (verdict: Verdict): PracticeAttempt => ({ answer: "x", confidence: 3, thinking: "", hints_used: 0, verdict, feedback: "f", at: "" });
const problem = (id: string, targets: string[], verdicts: Verdict[]): Problem => ({
  id,
  statement: id,
  targets,
  hints: [],
  solution: "",
  hints_shown: 0,
  attempts: verdicts.map(attempt),
});
const set = (problems: Problem[]): PracticeSet => ({
  id: "s",
  title: "t",
  created_at: "",
  updated_at: "",
  targets: [
    { id: "a", text: "Idea A" },
    { id: "b", text: "Idea B" },
  ],
  problems,
});

describe("practice helpers", () => {
  it("opens at the first unanswered problem, or the summary", () => {
    expect(firstOpen(set([problem("1", ["a"], ["correct"]), problem("2", ["b"], [])]))).toBe(1);
    expect(firstOpen(set([problem("1", ["a"], ["correct"])]))).toBe(1);
    expect(firstOpen(set([problem("1", ["a"], [])]))).toBe(0);
  });

  it("uses the last attempt", () => {
    expect(lastVerdict(problem("1", ["a"], ["incorrect", "correct"]))).toBe("correct");
    expect(lastVerdict(problem("1", ["a"], []))).toBeNull();
  });

  it("knows when a set is finished", () => {
    expect(isFinished(set([problem("1", ["a"], ["partial"])]))).toBe(true);
    expect(isFinished(set([problem("1", ["a"], ["partial"]), problem("2", ["b"], [])]))).toBe(false);
  });

  it("AC-167: a set written one by one is not finished until all its planned problems exist", () => {
    const one = { ...set([problem("1", ["a"], ["correct"])]), planned: 3 };
    expect(totalOf(one)).toBe(3);
    expect(isFinished(one)).toBe(false);
    expect(needsNext(one)).toBe(true);
    expect(firstOpen(one)).toBe(1);
    expect(needsNext({ ...one, problems: [problem("1", ["a"], [])] })).toBe(false);
    expect(totalOf(set([problem("1", ["a"], [])]))).toBe(1);
    expect(needsNext(set([problem("1", ["a"], ["correct"])]))).toBe(false);
  });

  it("lists ideas to review from problems not ending correct", () => {
    const s = set([problem("1", ["a"], ["incorrect", "correct"]), problem("2", ["b"], ["partial"])]);
    expect(toReview(s)).toEqual([{ id: "b", text: "Idea B" }]);
    expect(toReview(set([problem("1", ["a", "b"], ["correct"])]))).toEqual([]);
  });
});

describe("scripted practice (mock + fake provider)", () => {
  it("generates the requested count, cycling ideas and varying repeats", () => {
    const ps = scriptedProblems(["a", "b"], 5);
    expect(ps).toHaveLength(5);
    expect(ps.map((p) => p.targets[0])).toEqual(["a", "b", "a", "b", "a"]);
    expect(new Set(ps.map((p) => p.statement)).size).toBe(5);
    expect(ps.every((p) => p.hints.length === 3)).toBe(true);
  });

  it("grades by the solution's first word", () => {
    expect(expectedOf("6 m/s: porque…")).toBe("6");
    expect(scriptedGrade("Son 6 m/s", "6 m/s: x").verdict).toBe("correct");
    expect(scriptedGrade("Son 9", "6 m/s: x").verdict).toBe("incorrect");
    expect(scriptedGrade("casi 6", "6 m/s: x").verdict).toBe("partial");
    expect(scriptedGrade("una RECTA", "recta: x").verdict).toBe("correct");
  });
});
