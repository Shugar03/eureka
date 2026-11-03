// AC-62: which reminders are due now. Pure: the app calls it every minute
// with the clock, the agenda and what was already sent today.
import type { AcademicData, ExamSummary } from "../types";
import { DATE_KIND_LABEL } from "./academic";
import { daysUntil, localDate } from "./exam";
import { isoWeekday, slotsOn } from "./plan";

export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before a class or study block. */
  slotMinutes: number;
  exams: boolean;
  /** "HH:MM" for the daily flashcards reminder; "" = off. */
  cardsAt: string;
  /** AC-98: "stand up" after this many minutes without moving (the length of a pomodoro, by default). */
  stand: boolean;
  standMinutes: number;
  /** AC-98: "drink some water" every this many minutes. */
  water: boolean;
  waterMinutes: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, slotMinutes: 15, exams: true, cardsAt: "19:00", stand: false, standMinutes: 25, water: false, waterMinutes: 60 };

export interface Reminder {
  /** Unique per day, so each one is sent once. */
  id: string;
  title: string;
  body: string;
}

const EXAM_DAYS = [7, 3, 1, 0];
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function dueReminders(now: Date, exams: ExamSummary[], cardsDue: number, s: ReminderSettings, sent: Set<string>, academic?: AcademicData | null): Reminder[] {
  if (!s.enabled) return [];
  const today = localDate(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const out: Reminder[] = [];

  for (const slot of slotsOn(exams, isoWeekday(today))) {
    const left = minutesOf(slot.start) - minute;
    if (left >= 0 && left <= s.slotMinutes) {
      const what = slot.kind === "class" ? "Clase" : "Bloque de estudio";
      out.push({ id: `${today}:slot:${slot.examId}:${slot.start}`, title: `${what} de ${slot.name}`, body: `${left === 0 ? "Empieza ahora" : `En ${left} min`} (${slot.start}–${slot.end})${slot.place ? ` · ${slot.place}` : ""}` });
    }
  }

  // Exam countdowns from 9:00 on (or at once if the app opens later).
  if (s.exams && minute >= 9 * 60) {
    for (const e of exams) {
      if (!e.exam_date) continue;
      const d = daysUntil(e.exam_date, now);
      if (!EXAM_DAYS.includes(d)) continue;
      const when = d === 0 ? "es hoy" : d === 1 ? "es mañana" : `faltan ${d} días`;
      out.push({ id: `${today}:exam:${e.id}`, title: e.name, body: d === 0 ? "¡Hoy es el examen! Repasá tu hoja de repaso y respirá." : `${when[0].toUpperCase()}${when.slice(1)}: ${d <= 3 ? "hacé un simulacro con tiempo y repasá tus falladas." : "seguí el plan de estudio."}` });
    }
  }

  // AC-103: the classes and the dates of Mi cursada (active term), like materias and exams.
  if (academic?.active_term) {
    const term = academic.active_term;
    const courses = academic.courses.filter((c) => c.term_id === term);
    for (const c of courses) {
      for (const slot of c.slots.filter((x) => x.weekday === isoWeekday(today))) {
        const left = minutesOf(slot.start) - minute;
        if (left < 0 || left > s.slotMinutes) continue;
        const room = slot.room || c.room;
        out.push({ id: `${today}:ac:${c.id}:${slot.start}`, title: `Clase de ${c.name}`, body: `${left === 0 ? "Empieza ahora" : `En ${left} min`} (${slot.start}–${slot.end})${room ? ` · ${room}` : ""}` });
      }
    }
    if (s.exams && minute >= 9 * 60) {
      for (const d of academic.dates.filter((x) => x.term_id === term && !x.done)) {
        const left = daysUntil(d.date, now);
        if (!EXAM_DAYS.includes(left)) continue;
        const course = courses.find((c) => c.id === d.course_id)?.name;
        const when = left === 0 ? "es hoy" : left === 1 ? "es mañana" : `faltan ${left} días`;
        out.push({ id: `${today}:acdate:${d.id}`, title: `${DATE_KIND_LABEL[d.kind]}: ${d.title}`, body: `${course ? `${course}: ` : ""}${when}${d.time ? ` a las ${d.time}` : ""}. ${left <= 3 ? "Repasá lo que te falta y dormí bien." : "Hay tiempo para ir armando el plan."}` });
      }
    }
  }

  if (s.cardsAt && cardsDue > 0 && minute >= minutesOf(s.cardsAt)) {
    out.push({ id: `${today}:cards`, title: "Tarjetas para hoy", body: `Tenés ${cardsDue} ${cardsDue === 1 ? "tarjeta" : "tarjetas"} para repasar: son pocos minutos.` });
  }
  return out.filter((r) => !sent.has(r.id));
}

/** A reminder and the moment it is due. */
export interface Scheduled {
  at: Date;
  reminder: Reminder;
}

/**
 * The reminders of the next `days` days, each at the moment it becomes due, so
 * the phone can hand them to the system: Android freezes a closed app and the
 * minute check never runs. It asks `dueReminders` at each candidate moment, so
 * the rules and texts are the same. Later days don't know their card count yet.
 */
export function upcomingReminders(now: Date, days: number, exams: ExamSummary[], cards: { today: number; any: boolean }, s: ReminderSettings, sent: Set<string>, academic?: AcademicData | null): Scheduled[] {
  if (!s.enabled) return [];
  const moments: Date[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const weekday = isoWeekday(localDate(day));
    const term = academic?.active_term;
    const starts = [
      ...slotsOn(exams, weekday).map((x) => x.start),
      ...(term && academic ? academic.courses.filter((c) => c.term_id === term).flatMap((c) => c.slots.filter((x) => x.weekday === weekday).map((x) => x.start)) : []),
    ];
    const minutes = [...starts.map((t) => Math.max(0, minutesOf(t) - s.slotMinutes)), 9 * 60, ...(s.cardsAt ? [minutesOf(s.cardsAt)] : [])];
    for (const m of minutes) moments.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60));
  }
  moments.sort((a, b) => a.getTime() - b.getTime());
  // Each reminder goes at its first moment, even one already past (then it isn't scheduled again later).
  const seen = new Set(sent);
  const out: Scheduled[] = [];
  for (const at of moments) {
    const later = localDate(at) !== localDate(now);
    for (const r of dueReminders(at, exams, later ? Number(cards.any) : cards.today, s, seen, academic)) {
      seen.add(r.id);
      if (at.getTime() <= now.getTime()) continue;
      out.push({ at, reminder: later && r.id.endsWith(":cards") ? { ...r, body: "Repasá las tarjetas de hoy: son pocos minutos." } : r });
    }
  }
  return out;
}

/** The number the system's notifications need, the same for the same reminder. */
export function notificationId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) || 1;
}

/** When the last "stand up" and "water" reminders were due (ms epoch); the next ones count from here. */
export interface HealthClock {
  standAt: number;
  waterAt: number;
}

/**
 * AC-98: which health reminders are due. Each one counts from its own clock,
 * so changing the minutes or snoozing never fires a burst. Returns the
 * reminders and the clock to keep.
 */
export function healthDue(nowMs: number, clock: HealthClock, s: ReminderSettings, msPerMin = 60_000): { due: Reminder[]; clock: HealthClock } {
  if (!s.enabled) return { due: [], clock: { standAt: nowMs, waterAt: nowMs } };
  const due: Reminder[] = [];
  let { standAt, waterAt } = clock;
  if (!s.stand) standAt = nowMs;
  else if (nowMs - standAt >= s.standMinutes * msPerMin) {
    const mins = Math.round((nowMs - standAt) / msPerMin);
    due.push({ id: `health:stand:${nowMs}`, title: "Hora de pararte", body: `Llevás ${mins} min sin moverte: pará, estirá las piernas y caminá un minuto.` });
    standAt = nowMs;
  }
  if (!s.water) waterAt = nowMs;
  else if (nowMs - waterAt >= s.waterMinutes * msPerMin) {
    due.push({ id: `health:water:${nowMs}`, title: "Hora de tomar agua", body: "Un vaso de agua te ayuda a concentrarte." });
    waterAt = nowMs;
  }
  return { due, clock: { standAt, waterAt } };
}

export function validReminders(s: Partial<ReminderSettings>): ReminderSettings {
  const slot = Number(s.slotMinutes);
  const mins = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(240, Math.max(10, Math.round(Number(v)))) : d);
  return {
    stand: s.stand ?? DEFAULT_REMINDERS.stand,
    standMinutes: mins(s.standMinutes, DEFAULT_REMINDERS.standMinutes),
    water: s.water ?? DEFAULT_REMINDERS.water,
    waterMinutes: mins(s.waterMinutes, DEFAULT_REMINDERS.waterMinutes),
    enabled: s.enabled ?? DEFAULT_REMINDERS.enabled,
    slotMinutes: Number.isFinite(slot) ? Math.min(120, Math.max(0, Math.round(slot))) : DEFAULT_REMINDERS.slotMinutes,
    exams: s.exams ?? DEFAULT_REMINDERS.exams,
    cardsAt: typeof s.cardsAt === "string" && (s.cardsAt === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(s.cardsAt)) ? s.cardsAt : DEFAULT_REMINDERS.cardsAt,
  };
}
