// AC-142, AC-143: what the home panel shows from Mi cursada and the exams —
// today's classes, the dates coming up, and the grades so far.
import type { AcademicData, DateKind, ExamSummary, SlotKind } from "../types";
import { DATE_KIND_LABEL, dayOff, minutesOf, SLOT_KIND_LABEL, termCourses, termDates, WEEKDAYS } from "./academic";
import { addDays } from "./cards";
import { daysUntil } from "./exam";
import { isoWeekday } from "./plan";

export interface ClassToday {
  course: string;
  color: number;
  start: string;
  end: string;
  room: string;
  kind: string;
  /** Against the current time. */
  when: "done" | "now" | "next" | "later";
}

/** Today's classes of the active term, in order, and which one is now or next. */
export function classesToday(data: AcademicData | null, today: string, nowMinutes: number): ClassToday[] {
  if (!data?.active_term || dayOff(data, today)) return [];
  const wd = isoWeekday(today);
  const list = termCourses(data, data.active_term)
    .flatMap((c) => c.slots.filter((s) => s.weekday === wd).map((s) => ({ course: c.name, color: c.color, start: s.start, end: s.end, room: s.room || c.room, kind: SLOT_KIND_LABEL[s.kind as SlotKind] ?? "" })))
    .sort((a, b) => a.start.localeCompare(b.start));
  let nextGiven = false;
  return list.map((c) => {
    const [from, to] = [minutesOf(c.start), minutesOf(c.end)];
    let when: ClassToday["when"] = "later";
    if (to <= nowMinutes) when = "done";
    else if (from <= nowMinutes) when = "now";
    else if (!nextGiven) {
      when = "next";
      nextGiven = true;
    }
    return { ...c, when };
  });
}

/** Days ahead `nextClass` looks, past holidays and breaks. */
const LOOKAHEAD = 70;

/** When there are no classes today: the next day with classes ("Martes 14:00 · Análisis"), skipping days off (AC-145). */
export function nextClass(data: AcademicData | null, today: string): string | null {
  if (!data?.active_term) return null;
  const courses = termCourses(data, data.active_term);
  if (!courses.some((c) => c.slots.length)) return null;
  for (let i = 1; i <= LOOKAHEAD; i++) {
    const date = addDays(today, i);
    if (dayOff(data, date)) continue;
    const wd = isoWeekday(date);
    const slots = courses.flatMap((c) => c.slots.filter((s) => s.weekday === wd).map((s) => ({ s, c }))).sort((a, b) => a.s.start.localeCompare(b.s.start));
    if (!slots.length) continue;
    const when = i === 1 ? "Mañana" : i < 7 ? WEEKDAYS[wd - 1] : `${WEEKDAYS[wd - 1]} ${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
    return `${when} ${slots[0].s.start} · ${slots[0].c.name}`;
  }
  return null;
}

export interface Countdown {
  id: string;
  title: string;
  /** "Parcial", "Final", "Entrega", "Examen"… */
  kind: string;
  course: string;
  date: string;
  days: number;
  /** Where to open it. */
  source: "academic" | "exam";
}

/** Dates still to come, from Mi cursada and from the exams being prepared, soonest first. */
export function countdowns(data: AcademicData | null, exams: ExamSummary[], today: string, now: Date, limit = 5): Countdown[] {
  const names = new Map((data?.courses ?? []).map((c) => [c.id, c.name]));
  const fromAcademic: Countdown[] = (data?.dates ?? [])
    .filter((d) => !d.done && d.date >= today)
    .map((d) => ({ id: d.id, title: d.title, kind: DATE_KIND_LABEL[d.kind as DateKind] ?? "Fecha", course: d.course_id ? names.get(d.course_id) ?? "" : "", date: d.date, days: daysUntil(d.date, now), source: "academic" as const }));
  const fromExams: Countdown[] = exams
    .filter((e) => e.exam_date && e.exam_date >= today)
    .map((e) => ({ id: e.id, title: e.name, kind: "Examen", course: "", date: e.exam_date!, days: daysUntil(e.exam_date!, now), source: "exam" as const }));
  return [...fromAcademic, ...fromExams].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).slice(0, limit);
}

export interface CourseGrades {
  course: string;
  color: number;
  grades: { title: string; grade: number }[];
  average: number;
}

/** The grades of the active term, by course, with each course's average. */
export function gradesByCourse(data: AcademicData | null): CourseGrades[] {
  if (!data?.active_term) return [];
  const courses = termCourses(data, data.active_term);
  return courses
    .map((c) => {
      const grades = termDates(data, data.active_term)
        .filter((d) => d.course_id === c.id && d.grade !== null && Number.isFinite(d.grade))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ title: d.title, grade: d.grade as number }));
      const average = grades.length ? Math.round((10 * grades.reduce((s, g) => s + g.grade, 0)) / grades.length) / 10 : 0;
      return { course: c.name, color: c.color, grades, average };
    })
    .filter((c) => c.grades.length > 0);
}

/** "7,5" — Argentine decimal comma. */
export const gradeText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
