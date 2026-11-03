// Pure helpers for the practice screens.
import type { PracticeSet, Problem, Verdict } from "../types";

export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: "Correcto",
  partial: "Parcial",
  incorrect: "Incorrecto",
};

export const lastVerdict = (p: Problem): Verdict | null => (p.attempts.length ? p.attempts[p.attempts.length - 1].verdict : null);

/** AC-167: how many problems the set will have (some may not be written yet). */
export const totalOf = (s: PracticeSet) => Math.max(s.planned ?? 0, s.problems.length);

/** AC-167: every written problem was answered and more are planned: the next one is due. */
export const needsNext = (s: PracticeSet) => s.problems.length < totalOf(s) && s.problems.every((p) => p.attempts.length > 0);

export const LEVEL_LABEL: Record<number, string> = {
  1: "Una idea · contexto conocido",
  2: "Una idea · contexto nuevo",
  3: "Dos ideas combinadas",
  4: "Varias ideas · contexto nuevo",
};

/** The problem to show when opening a set: the first one never answered. */
export function firstOpen(s: PracticeSet): number {
  const i = s.problems.findIndex((p) => p.attempts.length === 0);
  return i === -1 ? s.problems.length : i;
}

export const isFinished = (s: PracticeSet) => s.problems.length >= totalOf(s) && s.problems.every((p) => p.attempts.length > 0);

/** Ideas whose problems did not end correct: worth reviewing. */
export function toReview(s: PracticeSet): { id: string; text: string }[] {
  const weak = new Set(s.problems.filter((p) => lastVerdict(p) !== "correct").flatMap((p) => p.targets));
  return s.targets.filter((t) => weak.has(t.id));
}
