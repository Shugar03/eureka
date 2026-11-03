import { describe, expect, it } from "vitest";
import type { AcademicData, ExamSummary } from "../types";
import { classesToday, countdowns, gradeText, gradesByCourse, nextClass } from "./dashboard";

// 2026-10-29 is a Thursday (weekday 4).
const TODAY = "2026-10-29";
const NOW = new Date(2026, 9, 29, 10, 30);
const slot = (weekday: number, start: string, end: string) => ({ weekday, start, end, room: "", kind: "teoria" as const });

const data: AcademicData = {
  active_term: "t1",
  terms: [
    { id: "t1", name: "2º cuatrimestre", kind: "cuatrimestre", start: null, end: null },
    { id: "t0", name: "1º cuatrimestre", kind: "cuatrimestre", start: null, end: null },
  ] as AcademicData["terms"],
  courses: [
    { id: "a", term_id: "t1", name: "Análisis II", code: "", professor: "", room: "Aula 3", notes: "", color: 2, slots: [slot(4, "08:00", "10:00"), slot(4, "14:00", "16:00")] },
    { id: "f", term_id: "t1", name: "Física I", code: "", professor: "", room: "", notes: "", color: 5, slots: [slot(4, "10:00", "12:00"), slot(2, "09:00", "11:00")] },
    { id: "old", term_id: "t0", name: "Álgebra", code: "", professor: "", room: "", notes: "", color: 1, slots: [slot(4, "18:00", "20:00")] },
  ],
  dates: [
    { id: "d1", term_id: "t1", course_id: "f", kind: "parcial", title: "Primer parcial", date: "2026-11-03", time: null, notes: "", done: false, grade: null },
    { id: "d2", term_id: "t1", course_id: "a", kind: "entrega", title: "TP 2", date: "2026-10-30", time: null, notes: "", done: false, grade: null },
    { id: "d3", term_id: "t1", course_id: "a", kind: "parcial", title: "Parcial 1", date: "2026-10-01", time: null, notes: "", done: true, grade: 7 },
    { id: "d4", term_id: "t1", course_id: "a", kind: "entrega", title: "TP 1", date: "2026-09-20", time: null, notes: "", done: true, grade: 8 },
    { id: "d5", term_id: "t1", course_id: "f", kind: "entrega", title: "Ya pasó", date: "2026-10-20", time: null, notes: "", done: false, grade: null },
    { id: "d6", term_id: "t0", course_id: "old", kind: "final", title: "Final viejo", date: "2026-07-01", time: null, notes: "", done: true, grade: 4 },
  ] as AcademicData["dates"],
};

describe("today's classes (AC-142)", () => {
  it("lists the active term's classes in order and marks the one now and the next", () => {
    const c = classesToday(data, TODAY, 10 * 60 + 30);
    expect(c.map((x) => `${x.start} ${x.course} ${x.when}`)).toEqual(["08:00 Análisis II done", "10:00 Física I now", "14:00 Análisis II next"]);
    expect(c[0].room).toBe("Aula 3");
  });

  it("with no term or no classes today there is nothing, and the next class is named", () => {
    expect(classesToday(null, TODAY, 0)).toEqual([]);
    expect(classesToday(data, "2026-10-30", 0)).toEqual([]);
    expect(nextClass(data, "2026-10-30")).toBe("Martes 09:00 · Física I");
    expect(nextClass(data, "2026-10-28")).toBe("Mañana 08:00 · Análisis II");
  });
});

describe("days without classes (AC-145)", () => {
  const off = (breaks: { start: string; end: string; name: string }[]): AcademicData => ({ ...data, terms: data.terms.map((t) => (t.id === "t1" ? { ...t, breaks: breaks.map((b, i) => ({ id: `b${i}`, ...b })) } : t)) });

  it("a holiday has no classes, and the next class skips the days off", () => {
    const d = off([{ start: TODAY, end: TODAY, name: "Feriado" }, { start: "2026-11-02", end: "2026-11-06", name: "Semana de parciales" }]);
    expect(classesToday(d, TODAY, 600)).toEqual([]);
    // Friday 30 has no classes, Mon 2 to Fri 6 are off: Tuesday 10/11 is next.
    expect(nextClass(d, TODAY)).toBe("Martes 10/11 09:00 · Física I");
    expect(nextClass(off([{ start: "2026-10-30", end: "2026-11-30", name: "Receso" }]), "2026-10-29")).toBe("Martes 1/12 09:00 · Física I");
  });
});

describe("countdowns (AC-142)", () => {
  it("joins Mi cursada and the exams, soonest first, leaving out what passed or is done", () => {
    const exams = [{ id: "e1", name: "Inglés B2", exam_date: "2026-11-01" }, { id: "e2", name: "Sin fecha", exam_date: null }] as ExamSummary[];
    const c = countdowns(data, exams, TODAY, NOW);
    expect(c.map((x) => `${x.days} ${x.kind} ${x.title} ${x.course}`.trim())).toEqual(["1 Entrega TP 2 Análisis II", "3 Examen Inglés B2", "5 Parcial Primer parcial Física I"]);
    expect(c[1].source).toBe("exam");
  });
});

describe("grades (AC-143)", () => {
  it("groups the active term's grades by course with the average", () => {
    expect(gradesByCourse(data)).toEqual([{ course: "Análisis II", color: 2, grades: [{ title: "TP 1", grade: 8 }, { title: "Parcial 1", grade: 7 }], average: 7.5 }]);
    expect(gradeText(7.5)).toBe("7,5");
    expect(gradeText(8)).toBe("8");
  });
});
