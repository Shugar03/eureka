// AC-141: a kind streak. One rest day per week (Monday to Sunday) never breaks
// it, today not done yet never breaks it, and no message ever blames.
import { addDays } from "./cards";
import { monday } from "./plan";

/** "idle": before the first day ever studied, so there is nothing to keep or rest from. */
export type DotState = "done" | "rest" | "gap" | "today" | "future" | "idle";

export interface WeekDot {
  day: string;
  /** "L", "M", "M", "J", "V", "S", "D". */
  letter: string;
  state: DotState;
}

export interface Streak {
  /** Days studied in the current streak (rest days don't add, but don't break it). */
  current: number;
  best: number;
  activeToday: boolean;
  /** This week's rest day is already taken. */
  restUsed: boolean;
  week: WeekDot[];
  message: string;
}

const LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

/** The current streak, walking back from today (or yesterday, if today is still to come). */
function currentStreak(active: Set<string>, today: string, first: string | null): number {
  if (!first) return 0;
  let d = active.has(today) ? today : addDays(today, -1);
  const rest = new Set<string>();
  let n = 0;
  while (d >= first) {
    if (active.has(d)) n++;
    else {
      const w = monday(d);
      if (rest.has(w)) break;
      rest.add(w);
    }
    d = addDays(d, -1);
  }
  return n;
}

/** The longest streak ever, walking forward with the same rule. */
function bestStreak(active: Set<string>, today: string, first: string | null): number {
  if (!first) return 0;
  let best = 0;
  let run = 0;
  const rest = new Set<string>();
  for (let d = first; d <= today; d = addDays(d, 1)) {
    if (active.has(d)) {
      run++;
      best = Math.max(best, run);
    } else if (d === today) {
      // Today is not over: it can't break anything yet.
    } else if (!rest.has(monday(d))) rest.add(monday(d));
    else run = 0;
  }
  return best;
}

export function streak(days: string[], today: string): Streak {
  const active = new Set(days);
  const first = [...active].sort()[0] ?? null;
  const current = currentStreak(active, today, first);
  const best = Math.max(current, bestStreak(active, today, first));
  const activeToday = active.has(today);

  const mon = monday(today);
  let restTaken = false;
  const week: WeekDot[] = LETTERS.map((letter, i) => {
    const day = addDays(mon, i);
    let state: DotState;
    if (active.has(day)) state = "done";
    else if (day > today) state = "future";
    else if (day === today) state = "today";
    else if (!first || day < first) state = "idle";
    else if (!restTaken) {
      state = "rest";
      restTaken = true;
    } else state = "gap";
    return { day, letter, state };
  });

  return { current, best, activeToday, restUsed: restTaken, week, message: message(current, best, activeToday, restTaken) };
}

/** Never "perdiste": either encouragement or a fresh start. */
function message(current: number, best: number, activeToday: boolean, restUsed: boolean): string {
  if (current === 0) return best > 0 ? "Arrancás de nuevo cuando quieras: lo que aprendiste no se pierde." : "Hoy puede ser el día uno.";
  if (activeToday && current === 1) return best > 1 ? "Volviste. Lo que aprendiste sigue ahí." : "Primer día. Buen comienzo.";
  if (activeToday) return `${current} días con estudio. Hoy ya sumaste.`;
  return restUsed ? `Vas ${current} días. Cualquier cosa que hagas hoy suma uno más.` : `Vas ${current} días. Hoy podés sumar uno, o usar tu día libre de la semana.`;
}
