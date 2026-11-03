// Mi cursada (AC-99…): the pure parts — the weekly grid, the dates that matter,
// and reading what the agent proposes. No DOM, no IPC.
import type { AcademicData, ClassSlot, Course, DateItem, DateKind, Proposal, SlotKind, TermKind } from "../types";
import { addDays } from "./cards";
import { daysUntil } from "./exam";

export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const WEEKDAYS_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export const TERM_KIND_LABEL: Record<TermKind, string> = { cuatrimestre: "Cuatrimestre", trimestre: "Trimestre", semestre: "Semestre", anual: "Anual", otro: "Otro" };
export const DATE_KIND_LABEL: Record<DateKind, string> = { parcial: "Parcial", recuperatorio: "Recuperatorio", final: "Final", tp: "TP", entrega: "Entrega", otro: "Otro" };
export const SLOT_KIND_LABEL: Record<SlotKind, string> = { teoria: "Teoría", practica: "Práctica", otro: "Otro" };

/** How many colours the grid cycles through (the backend gives each course an index below this). */
export const PALETTE = 8;

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const termCourses = (d: AcademicData, termId: string | null) => d.courses.filter((c) => c.term_id === termId);
export const termDates = (d: AcademicData, termId: string | null) => d.dates.filter((x) => x.term_id === termId);

/** AC-145: the active term's break that covers `day`, if any. */
export const dayOff = (d: AcademicData | null, day: string) => d?.terms.find((t) => t.id === d.active_term)?.breaks?.find((b) => b.start <= day && day <= b.end) ?? null;

/** A suggestion for the name of a new term, from today's date (Argentine academic calendar). */
export function suggestTerm(now: Date): { name: string; kind: TermKind } {
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  if (m >= 3 && m <= 7) return { name: `1.º cuatrimestre ${y}`, kind: "cuatrimestre" };
  if (m >= 8) return { name: `2.º cuatrimestre ${y}`, kind: "cuatrimestre" };
  return { name: `Verano ${y}`, kind: "otro" };
}

// ── The weekly grid ───────────────────────────────────────────────────────

/** Weekdays to draw: Monday to Friday, plus Saturday and Sunday when a class falls there. */
export function daysShown(courses: Course[]): number[] {
  const last = Math.max(5, ...courses.flatMap((c) => c.slots.map((s) => s.weekday)));
  return Array.from({ length: last }, (_, i) => i + 1);
}

/** The hour range of the grid: whole hours around the classes, at least 8 to 18. */
export function gridRange(courses: Course[]): { from: number; to: number } {
  const slots = courses.flatMap((c) => c.slots);
  if (!slots.length) return { from: 8 * 60, to: 18 * 60 };
  const from = Math.min(8 * 60, ...slots.map((s) => Math.floor(minutesOf(s.start) / 60) * 60));
  const to = Math.max(18 * 60, ...slots.map((s) => Math.ceil(minutesOf(s.end) / 60) * 60));
  return { from, to };
}

export interface Block {
  course: Course;
  slot: ClassSlot;
  /** Position inside the column, in percent of the grid's height. */
  top: number;
  height: number;
}

export function blocksOn(courses: Course[], weekday: number, range: { from: number; to: number }): Block[] {
  const span = range.to - range.from;
  return courses
    .flatMap((course) => course.slots.filter((s) => s.weekday === weekday).map((slot) => ({ course, slot })))
    .sort((a, b) => a.slot.start.localeCompare(b.slot.start))
    .map(({ course, slot }) => {
      const a = minutesOf(slot.start);
      const b = minutesOf(slot.end);
      return { course, slot, top: (100 * (a - range.from)) / span, height: (100 * (b - a)) / span };
    });
}

export function hourMarks(range: { from: number; to: number }): string[] {
  const out: string[] = [];
  for (let m = range.from; m <= range.to; m += 60) out.push(hhmm(m));
  return out;
}

/** Hours of class per week. */
export function weeklyClassHours(courses: Course[]): number {
  return courses.flatMap((c) => c.slots).reduce((n, s) => n + (minutesOf(s.end) - minutesOf(s.start)), 0) / 60;
}

export function slotText(s: ClassSlot, courseRoom = ""): string {
  const room = s.room || courseRoom;
  return `${WEEKDAYS_SHORT[s.weekday - 1]} ${s.start}–${s.end}${room ? ` · ${room}` : ""}`;
}

// ── Dates ─────────────────────────────────────────────────────────────────

/** Pending dates from today on, soonest first. */
export function upcomingDates(dates: DateItem[], today: string): DateItem[] {
  return dates.filter((d) => !d.done && d.date >= today).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
}

/** Pending dates that already passed (still not marked as done). */
export function overdueDates(dates: DateItem[], today: string): DateItem[] {
  return dates.filter((d) => !d.done && d.date < today).sort((a, b) => a.date.localeCompare(b.date));
}

export function doneDates(dates: DateItem[]): DateItem[] {
  return dates.filter((d) => d.done).sort((a, b) => b.date.localeCompare(a.date));
}

export function daysLabel(date: string, now: Date = new Date()): string {
  const d = daysUntil(date, now);
  if (d === 0) return "Hoy";
  if (d === 1) return "Mañana";
  if (d === -1) return "Ayer";
  return d > 0 ? `En ${d} días` : `Hace ${-d} días`;
}

/** "12 de noviembre" (with the weekday), from a YYYY-MM-DD. */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

/** The courses' dates that fall in the week of `today` (Monday to Sunday), by day. */
export function weekDates(dates: DateItem[], today: string): Map<number, DateItem[]> {
  const [y, m, d] = today.split("-").map(Number);
  const wd = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const monday = addDays(today, -wd);
  const out = new Map<number, DateItem[]>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const list = dates.filter((x) => x.date === day && !x.done);
    if (list.length) out.set(i + 1, list);
  }
  return out;
}

// ── Reading a proposal ────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (s: unknown): s is string => typeof s === "string" && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`)) && new Date(`${s}T00:00:00`).toISOString().slice(0, 10) === s;

/**
 * What a `propose_timetable` call may show as a card: the same checks the
 * backend makes, so something it would refuse never becomes a "Guardar".
 */
export function parseProposal(raw: string): Proposal | null {
  let p: Proposal;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  const courses = p.courses ?? [];
  const dates = p.dates ?? [];
  if (!courses.length && !dates.length) return null;
  if (p.term && (typeof p.term.name !== "string" || !p.term.name.trim())) return null;
  for (const c of courses) {
    if (typeof c.name !== "string" || !c.name.trim()) return null;
    for (const s of c.slots ?? []) {
      if (!Number.isInteger(s.weekday) || (s.weekday as number) < 1 || (s.weekday as number) > 7) return null;
      if (!HHMM.test(String(s.start)) || !HHMM.test(String(s.end)) || String(s.end) <= String(s.start)) return null;
    }
  }
  for (const d of dates) {
    if (typeof d.title !== "string" || !d.title.trim() || !validYmd(d.date)) return null;
    if (d.time && !HHMM.test(d.time)) return null;
  }
  return p;
}

/** What the card says it will save, in words. */
export function proposalCounts(p: Proposal): string {
  const c = p.courses?.length ?? 0;
  const d = p.dates?.length ?? 0;
  const parts = [c && `${c} ${c === 1 ? "materia" : "materias"}`, d && `${d} ${d === 1 ? "fecha" : "fechas"}`].filter(Boolean);
  return parts.join(" y ");
}

/** "2 materias nuevas, 1 fecha nueva, 1 ya estaba" — what an import did, in words. */
export function reportText(r: { courses_added: number; courses_updated: number; dates_added: number; dates_skipped: number }): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    r.courses_added && n(r.courses_added, "materia nueva", "materias nuevas"),
    r.courses_updated && n(r.courses_updated, "materia actualizada", "materias actualizadas"),
    r.dates_added && n(r.dates_added, "fecha nueva", "fechas nuevas"),
    r.dates_skipped && `${n(r.dates_skipped, "fecha", "fechas")} que ya ${r.dates_skipped === 1 ? "estaba" : "estaban"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no había nada nuevo";
}
