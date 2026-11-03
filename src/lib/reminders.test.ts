import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDERS, dueReminders, healthDue, notificationId, upcomingReminders, validReminders } from "./reminders";
import type { AcademicData, ExamSummary, Slot } from "../types";

const slot = (weekday: number, start: string, end: string, kind: Slot["kind"] = "class", place = ""): Slot => ({ weekday, start, end, kind, place });
const exam = (id: string, schedule: Slot[], exam_date: string | null = null): ExamSummary => ({
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
// Tuesday 27 Oct 2026, local time.
const at = (h: number, m: number) => new Date(2026, 9, 27, h, m);

describe("reminders (AC-62)", () => {
  const exams = [exam("Física", [slot(2, "18:00", "20:00", "class", "Aula 5"), slot(3, "18:00", "20:00")], "2026-10-30"), exam("AWS", [slot(2, "08:00", "09:00", "study")], "2026-11-03")];

  it("warns before today's classes and study blocks, once", () => {
    expect(dueReminders(at(17, 30), exams, 0, DEFAULT_REMINDERS, new Set()).filter((r) => r.id.includes("slot"))).toEqual([]);
    const r = dueReminders(at(17, 50), exams, 0, DEFAULT_REMINDERS, new Set());
    const cls = r.find((x) => x.id.includes("slot"))!;
    expect(cls).toEqual({ id: "2026-10-27:slot:Física:18:00", title: "Clase de Física", body: "En 10 min (18:00–20:00) · Aula 5" });
    expect(dueReminders(at(17, 55), exams, 0, DEFAULT_REMINDERS, new Set([cls.id])).some((x) => x.id === cls.id)).toBe(false);
    expect(dueReminders(at(8, 0), exams, 0, DEFAULT_REMINDERS, new Set())[0].body).toBe("Empieza ahora (08:00–09:00)");
    expect(dueReminders(at(18, 1), exams, 0, DEFAULT_REMINDERS, new Set()).some((x) => x.id.includes("slot"))).toBe(false);
  });

  it("counts down exams at 7, 3, 1 and 0 days, from 9:00", () => {
    expect(dueReminders(at(8, 30), exams, 0, DEFAULT_REMINDERS, new Set()).some((x) => x.id.includes("exam"))).toBe(false);
    const r = dueReminders(at(9, 0), exams, 0, DEFAULT_REMINDERS, new Set()).filter((x) => x.id.includes("exam"));
    expect(r).toEqual([
      { id: "2026-10-27:exam:Física", title: "Física", body: "Faltan 3 días: hacé un simulacro con tiempo y repasá tus falladas." },
      { id: "2026-10-27:exam:AWS", title: "AWS", body: "Faltan 7 días: seguí el plan de estudio." },
    ]);
    expect(dueReminders(at(9, 0), [exam("X", [], "2026-10-27")], 0, DEFAULT_REMINDERS, new Set())[0].body).toContain("¡Hoy es el examen!");
    expect(dueReminders(at(9, 0), exams, 0, { ...DEFAULT_REMINDERS, exams: false }, new Set())).toEqual([]);
  });

  it("reminds of today's cards from the chosen time; can be turned off", () => {
    expect(dueReminders(at(18, 59), [], 12, DEFAULT_REMINDERS, new Set())).toEqual([]);
    expect(dueReminders(at(19, 0), [], 12, DEFAULT_REMINDERS, new Set())).toEqual([{ id: "2026-10-27:cards", title: "Tarjetas para hoy", body: "Tenés 12 tarjetas para repasar: son pocos minutos." }]);
    expect(dueReminders(at(20, 0), [], 0, DEFAULT_REMINDERS, new Set())).toEqual([]);
    expect(dueReminders(at(20, 0), [], 3, { ...DEFAULT_REMINDERS, cardsAt: "" }, new Set())).toEqual([]);
    expect(dueReminders(at(20, 0), exams, 3, { ...DEFAULT_REMINDERS, enabled: false }, new Set())).toEqual([]);
  });

  it("validates settings", () => {
    expect(validReminders({ slotMinutes: 999, cardsAt: "25:00" })).toEqual({ ...DEFAULT_REMINDERS, slotMinutes: 120 });
    expect(validReminders({ enabled: false, cardsAt: "" })).toEqual({ ...DEFAULT_REMINDERS, enabled: false, cardsAt: "" });
  });
});

describe("healthDue (AC-98)", () => {
  const on = { ...DEFAULT_REMINDERS, stand: true, water: true, standMinutes: 25, waterMinutes: 60 };
  const MIN = 60_000;

  it("is off by default and counts each reminder from its own clock", () => {
    expect(healthDue(100 * MIN, { standAt: 0, waterAt: 0 }, DEFAULT_REMINDERS).due).toEqual([]);
    const t0 = { standAt: 0, waterAt: 0 };
    expect(healthDue(24 * MIN, t0, on).due).toEqual([]);
    const a = healthDue(25 * MIN, t0, on);
    expect(a.due.map((r) => r.title)).toEqual(["Hora de pararte"]);
    expect(a.due[0].body).toContain("25 min");
    expect(a.clock).toEqual({ standAt: 25 * MIN, waterAt: 0 });
    expect(healthDue(49 * MIN, a.clock, on).due).toEqual([]);
    const b = healthDue(60 * MIN, a.clock, on);
    expect(b.due.map((r) => r.title)).toEqual(["Hora de pararte", "Hora de tomar agua"]); // stand is due again 35 min after its last one
  });

  it("fires both when both are due, once, and never in a burst after a long gap", () => {
    const both = healthDue(120 * MIN, { standAt: 0, waterAt: 0 }, on);
    expect(both.due.map((r) => r.title)).toEqual(["Hora de pararte", "Hora de tomar agua"]);
    expect(both.clock).toEqual({ standAt: 120 * MIN, waterAt: 120 * MIN });
    expect(healthDue(121 * MIN, both.clock, on).due).toEqual([]);
  });

  it("a disabled reminder keeps restarting its clock, so enabling it later waits the full time", () => {
    const standOnly = { ...on, water: false };
    const r = healthDue(200 * MIN, { standAt: 200 * MIN, waterAt: 0 }, standOnly);
    expect(r.due).toEqual([]);
    expect(r.clock.waterAt).toBe(200 * MIN);
    expect(healthDue(300 * MIN, { standAt: 0, waterAt: 0 }, { ...on, enabled: false }).due).toEqual([]);
  });

  it("works with a faster clock (the e2e build) and validates the minutes", () => {
    expect(healthDue(25_000, { standAt: 0, waterAt: 0 }, on, 1000).due.map((r) => r.title)).toEqual(["Hora de pararte"]);
    expect(validReminders({ stand: true, standMinutes: 3, waterMinutes: 9999 })).toEqual({ ...DEFAULT_REMINDERS, stand: true, standMinutes: 10, waterMinutes: 240 });
    expect(validReminders({ standMinutes: Number.NaN, waterMinutes: "" as unknown as number })).toEqual(DEFAULT_REMINDERS);
  });
});

describe("Mi cursada in the reminders (AC-103)", () => {
  // Tuesday 27 Oct 2026 (weekday 2).
  const academic: AcademicData = {
    active_term: "t",
    terms: [
      { id: "t", name: "2.º cuatrimestre", kind: "cuatrimestre", start: null, end: null },
      { id: "old", name: "1.º cuatrimestre", kind: "cuatrimestre", start: null, end: null },
    ],
    courses: [
      { id: "c1", term_id: "t", name: "Análisis I", code: "", professor: "", room: "Aula 3", notes: "", color: 0, slots: [{ weekday: 2, start: "10:00", end: "12:00", room: "", kind: "teoria" }] },
      { id: "c2", term_id: "old", name: "Química", code: "", professor: "", room: "", notes: "", color: 1, slots: [{ weekday: 2, start: "10:00", end: "12:00", room: "", kind: "teoria" }] },
    ],
    dates: [
      { id: "d1", term_id: "t", course_id: "c1", kind: "parcial", title: "Primer parcial", date: "2026-10-30", time: "10:00", notes: "", done: false, grade: null },
      { id: "d2", term_id: "t", course_id: null, kind: "tp", title: "TP hecho", date: "2026-10-30", time: null, notes: "", done: true, grade: null },
      { id: "d3", term_id: "old", course_id: "c2", kind: "final", title: "Final viejo", date: "2026-10-30", time: null, notes: "", done: false, grade: null },
    ],
  };
  const due = (now: Date, a: AcademicData | null | undefined = academic, sent = new Set<string>()) => dueReminders(now, [], 0, DEFAULT_REMINDERS, sent, a);

  it("warns before a class of the active term, with its room, once", () => {
    expect(due(at(9, 30)).filter((r) => r.id.includes(":ac:"))).toEqual([]);
    const r = due(at(9, 50)).find((x) => x.id.includes(":ac:"))!;
    expect(r).toEqual({ id: "2026-10-27:ac:c1:10:00", title: "Clase de Análisis I", body: "En 10 min (10:00–12:00) · Aula 3" });
    expect(due(at(9, 55), academic, new Set([r.id])).some((x) => x.id === r.id)).toBe(false);
    expect(due(at(10, 0)).find((x) => x.id.includes(":ac:"))!.body).toBe("Empieza ahora (10:00–12:00) · Aula 3");
  });

  it("ignores other terms and counts down only the dates still pending", () => {
    const titles = due(at(9, 0)).map((r) => r.title);
    expect(titles).toContain("Parcial: Primer parcial");
    expect(titles).not.toContain("Clase de Química");
    expect(titles.some((t) => t.includes("Final viejo") || t.includes("TP hecho"))).toBe(false);
    const parcial = due(at(9, 0)).find((r) => r.title === "Parcial: Primer parcial")!;
    expect(parcial.id).toBe("2026-10-27:acdate:d1");
    expect(parcial.body).toBe("Análisis I: faltan 3 días a las 10:00. Repasá lo que te falta y dormí bien.");
    expect(due(at(8, 59)).some((r) => r.id.includes("acdate"))).toBe(false);
  });

  it("says today and tomorrow, and does nothing without Mi cursada or with reminders off", () => {
    const d = (date: string) => ({ ...academic, dates: [{ ...academic.dates[0], date }] });
    expect(due(at(9, 0), d("2026-10-27")).find((r) => r.id.includes("acdate"))!.body).toContain("es hoy");
    expect(due(at(9, 0), d("2026-10-28")).find((r) => r.id.includes("acdate"))!.body).toContain("es mañana");
    expect(due(at(9, 0), d("2026-11-10")).some((r) => r.id.includes("acdate"))).toBe(false);
    expect(due(at(9, 50), null)).toEqual([]);
    expect(dueReminders(at(9, 50), [], 0, DEFAULT_REMINDERS, new Set())).toEqual([]); // older callers, no argument
    expect(dueReminders(at(9, 50), [], 0, { ...DEFAULT_REMINDERS, enabled: false }, new Set(), academic)).toEqual([]);
    expect(due(at(9, 50), { ...academic, active_term: null })).toEqual([]);
  });
});

describe("reminders the phone schedules ahead", () => {
  const exams = [exam("Física", [slot(2, "18:00", "20:00", "class", "Aula 5"), slot(3, "18:00", "20:00")], "2026-10-30")];
  const plan = (now: Date, sent = new Set<string>(), cards = { today: 4, any: true }) =>
    upcomingReminders(now, 2, exams, cards, DEFAULT_REMINDERS, sent).map((x) => [x.at.toTimeString().slice(0, 5), x.at.getDate(), x.reminder.id, x.reminder.body]);

  it("puts each reminder at the moment it becomes due, from now on", () => {
    expect(plan(at(12, 0))).toEqual([
      ["17:45", 27, "2026-10-27:slot:Física:18:00", "En 15 min (18:00–20:00) · Aula 5"],
      ["19:00", 27, "2026-10-27:cards", "Tenés 4 tarjetas para repasar: son pocos minutos."],
      ["17:45", 28, "2026-10-28:slot:Física:18:00", "En 15 min (18:00–20:00)"],
      ["19:00", 28, "2026-10-28:cards", "Repasá las tarjetas de hoy: son pocos minutos."],
    ]);
  });

  it("skips what already went out or is already past, and what has nothing to say", () => {
    const tomorrow = plan(at(8, 0), new Set(["2026-10-27:slot:Física:18:00"]), { today: 0, any: false });
    expect(tomorrow.map((x) => x[2])).toEqual(["2026-10-27:exam:Física", "2026-10-28:slot:Física:18:00"]);
    // The exam countdown is due at 9:00: opened at 12:00 it is not scheduled for later that day.
    expect(plan(at(12, 0)).some((x) => x[2] === "2026-10-27:exam:Física")).toBe(false);
    expect(upcomingReminders(at(8, 0), 2, exams, { today: 1, any: true }, { ...DEFAULT_REMINDERS, enabled: false }, new Set())).toEqual([]);
  });

  it("gives each reminder a stable notification number", () => {
    expect(notificationId("2026-10-27:cards")).toBe(notificationId("2026-10-27:cards"));
    expect(notificationId("2026-10-27:cards")).not.toBe(notificationId("2026-10-28:cards"));
    expect(notificationId("x")).toBeGreaterThan(0);
  });
});
