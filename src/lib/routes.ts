// AC-214..AC-217: learning routes — what the card and the screens compute.
import type { ClassView, RouteProposal, RouteView } from "../types";

/** Classes to take and minutes they add up to (known ones are skipped). */
export function proposalSize(p: RouteProposal): { classes: number; minutes: number; known: number } {
  const all = p.units.flatMap((u) => u.classes);
  const take = all.filter((c) => !c.known);
  return { classes: take.length, minutes: take.reduce((n, c) => n + c.minutes, 0), known: all.length - take.length };
}

/** When it ends at this pace: whole weeks of study from `from` (a local date). */
export function endDate(minutes: number, hoursPerWeek: number, from: Date): Date {
  const weeks = Math.max(1, Math.ceil(minutes / 60 / Math.max(0.5, hoursPerWeek)));
  const d = new Date(from);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export const weeksFor = (minutes: number, hoursPerWeek: number) => Math.max(1, Math.ceil(minutes / 60 / Math.max(0.5, hoursPerWeek)));

/** «~19 h», «45 min», «1 h 20». */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (minutes >= 600) return `~${Math.round(minutes / 60)} h`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export const shortDate = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", "");

/** The class to take next, with its unit. */
export function currentClass(r: RouteView): { unit: string; unitIndex: number; cls: ClassView } | null {
  for (const [i, u] of r.units.entries()) {
    const c = u.classes.find((x) => x.id === r.current);
    if (c) return { unit: u.title, unitIndex: i, cls: c };
  }
  return null;
}

/** The class after `classId` that is still to take. */
export function nextAfter(r: RouteView, classId: string): ClassView | null {
  const all = r.units.flatMap((u) => u.classes);
  const i = all.findIndex((c) => c.id === classId);
  return all.slice(i + 1).find((c) => c.state !== "known" && c.state !== "done") ?? null;
}

/** Where a class sits: its unit and its number. */
export function classOf(r: RouteView, classId: string): { unit: string; unitIndex: number; cls: ClassView } | null {
  for (const [i, u] of r.units.entries()) {
    const c = u.classes.find((x) => x.id === classId);
    if (c) return { unit: u.title, unitIndex: i, cls: c };
  }
  return null;
}

/** A route with the same title already exists (a reloaded chat must not offer it twice). */
export const sameRoute = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
