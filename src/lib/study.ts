// Totals of the study log: minutes per local day and per context.
import type { StudyEntry } from "../types";
import { addDays } from "./cards";

export interface DayTotal {
  day: string;
  minutes: number;
}

/** The last `n` local days ending today, oldest first, zeros included. */
export function minutesByDay(entries: StudyEntry[], today: string, n = 7): DayTotal[] {
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  return days.map((day) => ({ day, minutes: entries.filter((e) => e.day === day).reduce((s, e) => s + e.minutes, 0) }));
}

/** Minutes per context (most studied first); entries without one go to "Sin tema". */
export function minutesByContext(entries: StudyEntry[]): { title: string; minutes: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = e.context?.title ?? "Sin tema";
    m.set(k, (m.get(k) ?? 0) + e.minutes);
  }
  return [...m].map(([title, minutes]) => ({ title, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** 0 → "0 min", 45 → "45 min", 90 → "1 h 30 min", 120 → "2 h". */
export function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function weekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}
