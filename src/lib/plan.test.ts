import { describe, expect, it } from "vitest";
import { examMinutes, isoWeekday, monday, pendingTopics, slotsOn, studyPlan, upcoming, weeklyHours } from "./plan";
import type { Exam, ExamSummary, SessionSummary, Slot, StudyEntry } from "../types";

const topic = (id: string, session_id: string | null = null) => ({ id, title: id.toUpperCase(), objectives: [], session_id, exercises_passed: 0 });

function exam(date: string | null, hours: number | null = null): Exam {
  return {
    id: "e",
    name: "AWS",
    created_at: "",
    updated_at: "",
    domains: [
      { id: "d1", name: "Liviano", weight: 20, topics: [topic("a"), topic("b", "s-done")] },
      { id: "d2", name: "Pesado", weight: 80, topics: [topic("c", "s-mid"), topic("d"), topic("e")] },
    ],
    mocks: [],
    review: [],
    goal: { passing_pct: null, exam_date: date, hours_per_week: hours },
    cheat_sheet: null,
    kind: "certification",
    schedule: [],
    lang: null,
  };
}

const summary = (id: string, phase: SessionSummary["phase"]): SessionSummary => ({ id, title: id, goal: id, phase, updated_at: "", plan_total: 0, plan_done: 0 });
const sessions = new Map([
  ["s-done", summary("s-done", "done")],
  ["s-mid", summary("s-mid", "teach")],
]);
const tuesday = new Date(2026, 9, 27, 10, 0); // Tue 27 Oct 2026

describe("study plan to the exam date (AC-52)", () => {
  it("weeks start on Monday, local days", () => {
    expect([monday("2026-10-27"), monday("2026-10-26"), monday("2026-11-01")]).toEqual(["2026-10-26", "2026-10-26", "2026-10-26"]);
    expect([isoWeekday("2026-10-26"), isoWeekday("2026-11-01")]).toEqual([1, 7]);
  });

  it("AC-149: a weak domain in the last mock brings its studied topics back to review", () => {
    const mocked = (correct: number, passing: number | null = null): Exam => ({
      ...exam("2026-11-20"),
      goal: { passing_pct: passing, exam_date: "2026-11-20", hours_per_week: null },
      mocks: [{ id: "m", questions: [], focus: null, timed: false, started_at: "", result: { answers: [], correct, total: 10, by_domain: [{ domain_id: "d1", correct, total: 10 }], at: new Date(2026, 9, 26, 15).toISOString(), elapsed_secs: 0 } }] as unknown as Exam["mocks"],
    });
    const back = pendingTopics(mocked(5), sessions).find((t) => t.topicId === "b");
    expect(back).toMatchObject({ domain: "Liviano", started: false, review: "50% en el último simulacro" });
    const d1 = pendingTopics(mocked(5), sessions).filter((t) => t.domain === "Liviano").map((t) => t.topicId);
    expect(d1).toEqual(["a", "b"]);
    expect(pendingTopics(mocked(8), sessions).some((t) => t.topicId === "b")).toBe(false);
    expect(pendingTopics(mocked(8, 85), sessions).some((t) => t.topicId === "b")).toBe(true);
    expect(studyPlan(mocked(5), sessions, "2026-10-27", [], tuesday)!.replannedWith).toBe("2026-10-26");
    expect(studyPlan(mocked(9), sessions, "2026-10-27", [], tuesday)!.replannedWith).toBeNull();
  });

  it("orders pending topics: heavier/weaker domains first, studied ones out", () => {
    expect(pendingTopics(exam(null), sessions).map((t) => [t.topicId, t.started])).toEqual([
      ["c", true],
      ["d", false],
      ["e", false],
      ["a", false],
    ]);
  });

  it("spreads topics over the weeks and keeps the last one for mocks and review", () => {
    const p = studyPlan(exam("2026-11-20", 6), sessions, "2026-10-27", [], tuesday)!;
    expect(p.daysLeft).toBe(24);
    expect(p.weeks.map((w) => [w.from, w.to, w.topics.map((t) => t.topicId).join(""), w.final])).toEqual([
      ["2026-10-27", "2026-11-01", "cd", false],
      ["2026-11-02", "2026-11-08", "e", false],
      ["2026-11-09", "2026-11-15", "a", false],
      ["2026-11-16", "2026-11-20", "", true],
    ]);
    expect(p.today?.topicId).toBe("c");
    expect(p.weekGoal).toBe(360);
  });

  it("a single week does everything; no date or a past one gives no plan", () => {
    const p = studyPlan(exam("2026-10-30"), sessions, "2026-10-27", [], tuesday)!;
    expect(p.weeks).toHaveLength(1);
    expect([p.weeks[0].final, p.weeks[0].topics.length]).toEqual([true, 4]);
    expect(p.weekGoal).toBeNull();
    expect(studyPlan(exam(null), sessions, "2026-10-27", [], tuesday)).toBeNull();
    expect(studyPlan(exam("2026-10-20"), sessions, "2026-10-27", [], tuesday)).toBeNull();
  });

  it("counts this week's minutes for the exam and its topic sessions", () => {
    const e = (day: string, minutes: number, kind: string, id: string): StudyEntry => ({ at: "", day, minutes, context: { kind, id, title: "" } });
    const log = [e("2026-10-26", 25, "exam", "e"), e("2026-10-27", 25, "session", "s-mid"), e("2026-10-25", 50, "exam", "e"), e("2026-10-27", 25, "exam", "otro")];
    expect(examMinutes(exam(null), log, "2026-10-26")).toBe(50);
    expect(studyPlan(exam("2026-11-20", 6), sessions, "2026-10-27", log, tuesday)!.weekMinutes).toBe(50);
  });
});

describe("weekly agenda (AC-51)", () => {
  const slot = (weekday: number, start: string, end: string, kind: Slot["kind"] = "class"): Slot => ({ weekday, start, end, kind, place: "" });
  const s = (id: string, schedule: Slot[], exam_date: string | null = null): ExamSummary => ({
    id,
    name: id,
    updated_at: "",
    domains: 0,
    topics: 0,
    started: 0,
    last_score: null,
    to_review: 0,
    kind: "subject",
    exam_date,
    schedule,
  });
  const all = [s("Física", [slot(2, "18:00", "20:00"), slot(4, "18:00", "20:00")], "2026-12-01"), s("Álgebra", [slot(2, "08:30", "10:00"), slot(6, "10:00", "11:30", "study")], "2026-11-10"), s("AWS", [], "2026-10-01")];

  it("lists a day's slots by time, across subjects", () => {
    expect(slotsOn(all, 2).map((x) => `${x.name} ${x.start}`)).toEqual(["Álgebra 08:30", "Física 18:00"]);
    expect(slotsOn(all, 7)).toEqual([]);
  });

  it("lists upcoming dates and weekly hours", () => {
    expect(upcoming(all, "2026-10-27").map((x) => x.id)).toEqual(["Álgebra", "Física"]);
    expect(weeklyHours(all)).toEqual({ classes: 5.5, study: 1.5 });
  });
});
