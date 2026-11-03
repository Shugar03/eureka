// Flashcards: today's queue and the SM-2 schedule (mirror of cards.rs, to
// label the grade buttons with when the card comes back).
import type { Card, Deck, Grade } from "../types";

export const NEW_PER_DAY = 20;
const MIN_EASE = 1.3;

/** Mirror of cards::next_interval (Rust). */
export function nextInterval(c: Card, grade: Grade): number {
  const grow = (factor: number, min: number) => Math.max(Math.round(c.interval * factor), c.interval + min);
  switch (grade) {
    case "again":
      return 0;
    case "hard":
      return c.reps === 0 ? 1 : grow(1.2, 1);
    case "good":
      return c.reps === 0 ? 1 : c.reps === 1 ? 3 : grow(c.ease, 1);
    case "easy":
      return c.reps === 0 ? 4 : grow(c.ease * 1.3, 2);
  }
}

/** Mirror of cards::review (Rust), for the browser mock. */
export function review(c: Card, grade: Grade, today: string): Card {
  const interval = nextInterval(c, grade);
  const [ease, reps, lapses] =
    grade === "again"
      ? [c.ease - 0.2, 0, c.lapses + (c.reps > 0 ? 1 : 0)]
      : grade === "hard"
        ? [c.ease - 0.15, c.reps + 1, c.lapses]
        : grade === "good"
          ? [c.ease, c.reps + 1, c.lapses]
          : [c.ease + 0.15, c.reps + 1, c.lapses];
  return { ...c, ease: Math.max(MIN_EASE, ease), interval, reps, lapses, due: addDays(today, interval), reviewed: today };
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10); // a UTC date built from calendar parts: no shift
}

/** Due reviews first (most overdue first), then up to `newLimit` new cards. */
export function dueQueue(deck: Deck, today: string, newLimit = NEW_PER_DAY): Card[] {
  const due = deck.cards.filter((c) => c.reviewed && c.due <= today).sort((a, b) => a.due.localeCompare(b.due));
  const fresh = deck.cards.filter((c) => !c.reviewed).slice(0, newLimit);
  return [...due, ...fresh];
}

/** 0 → "hoy", 1 → "1 día", 45 → "1,5 meses", 400 → "1,1 años". */
export function intervalLabel(days: number): string {
  if (days <= 0) return "hoy";
  if (days === 1) return "1 día";
  if (days < 30) return `${days} días`;
  const fmt = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");
  if (days < 365) return `${fmt(days / 30)} ${days < 45 ? "mes" : "meses"}`;
  return `${fmt(days / 365)} ${days < 548 ? "año" : "años"}`;
}

export const GRADES: { id: Grade; label: string; key: string }[] = [
  { id: "again", label: "Otra vez", key: "1" },
  { id: "hard", label: "Difícil", key: "2" },
  { id: "good", label: "Bien", key: "3" },
  { id: "easy", label: "Fácil", key: "4" },
];
