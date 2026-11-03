import { describe, expect, it } from "vitest";
import { blocksOn, daysLabel, daysShown, doneDates, gridRange, hourMarks, overdueDates, parseProposal, proposalCounts, reportText, slotText, suggestTerm, upcomingDates, weekDates, weeklyClassHours } from "./academic";
import type { ClassSlot, Course, DateItem } from "../types";

const slot = (weekday: number, start: string, end: string, room = ""): ClassSlot => ({ weekday, start, end, room, kind: "teoria" });
const course = (name: string, slots: ClassSlot[], extra: Partial<Course> = {}): Course => ({ id: name, term_id: "t", name, code: "", professor: "", room: "", notes: "", color: 0, slots, ...extra });
const date = (title: string, d: string, extra: Partial<DateItem> = {}): DateItem => ({ id: title, term_id: "t", course_id: null, kind: "parcial", title, date: d, time: null, notes: "", done: false, grade: null, ...extra });

describe("the weekly grid (AC-99)", () => {
  it("draws Monday to Friday, and the weekend only when a class falls there", () => {
    expect(daysShown([])).toEqual([1, 2, 3, 4, 5]);
    expect(daysShown([course("A", [slot(2, "10:00", "11:00")])])).toEqual([1, 2, 3, 4, 5]);
    expect(daysShown([course("A", [slot(6, "10:00", "11:00")])])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(daysShown([course("A", [slot(7, "10:00", "11:00")])])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("covers the classes in whole hours, 8 to 18 at least", () => {
    expect(gridRange([])).toEqual({ from: 480, to: 1080 });
    expect(gridRange([course("A", [slot(1, "10:00", "12:00")])])).toEqual({ from: 480, to: 1080 });
    expect(gridRange([course("A", [slot(1, "06:30", "08:00"), slot(2, "19:00", "22:15")])])).toEqual({ from: 360, to: 1380 });
    expect(hourMarks({ from: 480, to: 720 })).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00"]);
  });

  it("places each class by its time inside its day, in order", () => {
    const range = { from: 480, to: 1080 }; // 10 hours
    const blocks = blocksOn([course("B", [slot(1, "14:00", "16:00")]), course("A", [slot(1, "08:00", "09:00"), slot(2, "08:00", "09:00")])], 1, range);
    expect(blocks.map((b) => b.course.name)).toEqual(["A", "B"]);
    expect(blocks[0]).toMatchObject({ top: 0, height: 10 });
    expect(blocks[1].top).toBeCloseTo(60);
    expect(blocks[1].height).toBeCloseTo(20);
  });

  it("adds up the weekly hours and says a slot in a line", () => {
    expect(weeklyClassHours([course("A", [slot(1, "10:00", "12:00"), slot(3, "10:00", "11:30")])])).toBe(3.5);
    expect(slotText(slot(3, "10:00", "12:00", "Aula 5"), "Aula 3")).toBe("mié 10:00–12:00 · Aula 5");
    expect(slotText(slot(1, "08:00", "10:00"), "Aula 3")).toBe("lun 08:00–10:00 · Aula 3");
    expect(slotText(slot(1, "08:00", "10:00"))).toBe("lun 08:00–10:00");
  });
});

describe("the dates that matter (AC-100)", () => {
  const dates = [date("Final", "2026-12-10"), date("Parcial 1", "2026-10-30", { time: "10:00" }), date("Parcial 0", "2026-10-30", { time: "08:00" }), date("Viejo", "2026-10-01"), date("Hecho", "2026-10-05", { done: true, grade: 8 })];

  it("lists what is coming by day and time, what slipped, and what is done", () => {
    expect(upcomingDates(dates, "2026-10-28").map((d) => d.title)).toEqual(["Parcial 0", "Parcial 1", "Final"]);
    expect(overdueDates(dates, "2026-10-28").map((d) => d.title)).toEqual(["Viejo"]);
    expect(doneDates(dates).map((d) => d.title)).toEqual(["Hecho"]);
  });

  it("says how far away a date is", () => {
    const now = new Date(2026, 9, 28, 15);
    expect(["2026-10-28", "2026-10-29", "2026-10-27", "2026-11-04", "2026-10-20"].map((d) => daysLabel(d, now))).toEqual(["Hoy", "Mañana", "Ayer", "En 7 días", "Hace 8 días"]);
  });

  it("finds the dates of this week (Monday to Sunday), by day", () => {
    const w = weekDates([date("Lunes", "2026-10-26"), date("Jueves", "2026-10-29"), date("Domingo", "2026-11-01"), date("Lunes que viene", "2026-11-02"), date("Hecho", "2026-10-27", { done: true })], "2026-10-28");
    expect([...w.keys()]).toEqual([1, 4, 7]);
  });

  it("suggests the name of a new term from the date", () => {
    expect(suggestTerm(new Date(2026, 3, 10))).toEqual({ name: "1.º cuatrimestre 2026", kind: "cuatrimestre" });
    expect(suggestTerm(new Date(2026, 9, 28))).toEqual({ name: "2.º cuatrimestre 2026", kind: "cuatrimestre" });
    expect(suggestTerm(new Date(2026, 0, 15)).name).toBe("Verano 2026");
  });
});

describe("reading a proposal (AC-101)", () => {
  const ok = { term: { name: "2.º cuatrimestre 2026" }, courses: [{ name: "Análisis I", slots: [{ weekday: 1, start: "10:00", end: "12:00" }] }], dates: [{ kind: "parcial", title: "Primer parcial", date: "2026-11-12" }] };

  it("accepts what the backend would accept", () => {
    expect(parseProposal(JSON.stringify(ok))).not.toBeNull();
    expect(parseProposal(JSON.stringify({ dates: ok.dates }))).not.toBeNull();
    expect(parseProposal(JSON.stringify({ courses: [{ name: "Solo el nombre" }] }))).not.toBeNull();
  });

  it("refuses what it would refuse, so a bad one never becomes a Guardar", () => {
    const bad = (p: unknown) => parseProposal(JSON.stringify(p));
    expect(bad({})).toBeNull();
    expect(bad({ courses: [], dates: [] })).toBeNull();
    expect(bad({ ...ok, term: { name: " " } })).toBeNull();
    expect(bad({ courses: [{ name: "" }] })).toBeNull();
    expect(bad({ courses: [{ name: "A", slots: [{ weekday: 8, start: "10:00", end: "11:00" }] }] })).toBeNull();
    expect(bad({ courses: [{ name: "A", slots: [{ weekday: 1, start: "12:00", end: "10:00" }] }] })).toBeNull();
    expect(bad({ courses: [{ name: "A", slots: [{ weekday: 1, start: "9:00", end: "10:00" }] }] })).toBeNull();
    expect(bad({ dates: [{ kind: "parcial", title: "x", date: "12/11/2026" }] })).toBeNull();
    expect(bad({ dates: [{ kind: "parcial", title: "x", date: "2026-02-30" }] })).toBeNull();
    expect(bad({ dates: [{ kind: "parcial", title: "", date: "2026-11-12" }] })).toBeNull();
    expect(bad({ dates: [{ kind: "parcial", title: "x", date: "2026-11-12", time: "10hs" }] })).toBeNull();
    expect(parseProposal("no json")).toBeNull();
  });

  it("says what it will save", () => {
    expect(proposalCounts(ok)).toBe("1 materia y 1 fecha");
    expect(proposalCounts({ courses: [{ name: "a" }, { name: "b" }] })).toBe("2 materias");
    expect(proposalCounts({ dates: [ok.dates[0], ok.dates[0]] })).toBe("2 fechas");
  });
});

describe("what an import did", () => {
  it("says it in words", () => {
    expect(reportText({ courses_added: 2, courses_updated: 0, dates_added: 1, dates_skipped: 0 })).toBe("2 materias nuevas, 1 fecha nueva");
    expect(reportText({ courses_added: 0, courses_updated: 1, dates_added: 0, dates_skipped: 3 })).toBe("1 materia actualizada, 3 fechas que ya estaban");
    expect(reportText({ courses_added: 1, courses_updated: 0, dates_added: 0, dates_skipped: 1 })).toBe("1 materia nueva, 1 fecha que ya estaba");
    expect(reportText({ courses_added: 0, courses_updated: 0, dates_added: 0, dates_skipped: 0 })).toBe("no había nada nuevo");
  });
});
