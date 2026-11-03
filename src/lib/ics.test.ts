import { describe, expect, it } from "vitest";
import { buildIcs, fold, icsText, nextWeekday } from "./ics";
import type { AcademicData, ExamSummary } from "../types";

const exam = (over: Partial<ExamSummary>): ExamSummary => ({
  id: "e1",
  name: "Física, I",
  updated_at: "",
  domains: 0,
  topics: 0,
  started: 0,
  last_score: null,
  to_review: 0,
  kind: "subject",
  exam_date: null,
  schedule: [],
  ...over,
});

describe("calendar export (AC-59)", () => {
  it("escapes text and folds long lines", () => {
    expect(icsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const long = "SUMMARY:" + "x".repeat(150);
    const folded = fold(long);
    expect(folded.split("\r\n").map((l) => l.length)).toEqual([75, 75, 10]);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(fold("short")).toBe("short");
  });

  it("finds the next class day from today", () => {
    expect(nextWeekday("2026-10-27", 2)).toBe("2026-10-27"); // Tuesday itself
    expect(nextWeekday("2026-10-27", 1)).toBe("2026-11-02");
    expect(nextWeekday("2026-10-27", 7)).toBe("2026-11-01");
  });

  it("repeats weekly slots until the exam date and adds the exam as an all-day event", () => {
    const ics = buildIcs(
      [exam({ exam_date: "2026-12-01", schedule: [{ weekday: 4, start: "18:00", end: "20:30", kind: "class", place: "Aula 5" }] })],
      "2026-10-27",
      new Date(Date.UTC(2026, 9, 27, 12, 0, 0)),
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const l of [
      "DTSTART:20261029T180000",
      "DTEND:20261029T203000",
      "RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261201T235959",
      "SUMMARY:Clase: Física\\, I",
      "LOCATION:Aula 5",
      "DTSTART;VALUE=DATE:20261201",
      "DTEND;VALUE=DATE:20261202",
      "SUMMARY:Parcial/final: Física\\, I",
      "TRIGGER:-P1D",
      "DTSTAMP:20261027T120000Z",
    ])
      expect(ics).toContain(l);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("adds Mi cursada: classes until the term ends without the days off, and the dates to come (AC-144, AC-145)", () => {
    const data: AcademicData = {
      active_term: "t",
      terms: [{ id: "t", name: "2.º cuatrimestre", kind: "cuatrimestre", start: "2026-08-03", end: "2026-11-28", breaks: [{ id: "b", start: "2026-11-23", end: "2026-11-23", name: "Soberanía" }, { id: "b2", start: "2026-11-09", end: "2026-11-13", name: "Parciales" }] }],
      courses: [{ id: "c", term_id: "t", name: "Análisis II", code: "", professor: "", room: "Aula 3", notes: "", color: 0, slots: [{ weekday: 1, start: "08:00", end: "10:00", room: "", kind: "teoria" }] }],
      dates: [
        { id: "d1", term_id: "t", course_id: "c", kind: "parcial", title: "Primer parcial", date: "2026-11-16", time: "18:00", notes: "", done: false, grade: null },
        { id: "d2", term_id: "t", course_id: null, kind: "otro", title: "Inscripción", date: "2026-11-02", time: null, notes: "", done: false, grade: null },
        { id: "d3", term_id: "t", course_id: "c", kind: "tp", title: "TP hecho", date: "2026-11-05", time: null, notes: "", done: true, grade: 9 },
      ],
    };
    const ics = buildIcs([], "2026-10-27", new Date(Date.UTC(2026, 9, 27, 12)), data);
    for (const l of [
      "DTSTART:20261102T080000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261128T235959",
      "EXDATE:20261109T080000,20261123T080000",
      "SUMMARY:Análisis II",
      "LOCATION:Aula 3",
      "DTSTART:20261116T180000",
      "SUMMARY:Parcial: Primer parcial · Análisis II",
      "DESCRIPTION:Mañana: Parcial: Primer parcial · Análisis II",
      "DTSTART;VALUE=DATE:20261102",
      "SUMMARY:Otro: Inscripción",
    ])
      expect(ics).toContain(l);
    expect(ics).not.toContain("TP hecho");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it("without a date, slots repeat 20 weeks; past dates are left out", () => {
    const ics = buildIcs([exam({ exam_date: "2026-10-01", schedule: [{ weekday: 2, start: "08:00", end: "09:00", kind: "study", place: "" }] })], "2026-10-27");
    expect(ics).toContain("UNTIL=20270316T235959");
    expect(ics).toContain("SUMMARY:Estudio: Física\\, I");
    expect(ics).not.toContain("LOCATION");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});
