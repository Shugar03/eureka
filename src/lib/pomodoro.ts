// Pomodoro as a pure state machine over timestamps, so it survives screen
// changes and reloads (the state is stored) and is testable without timers.

export interface PomoSettings {
  /** Minutes. */
  focus: number;
  short: number;
  long: number;
  /** A long break after this many focus blocks. */
  every: number;
}

export const DEFAULT_SETTINGS: PomoSettings = { focus: 25, short: 5, long: 15, every: 4 };

export type PomoPhase = "focus" | "short" | "long";

export interface PomoState {
  phase: PomoPhase;
  running: boolean;
  /** When the running phase ends (ms epoch); null while paused or idle. */
  endsAt: number | null;
  /** Time left while paused or idle. */
  remainingMs: number;
  /** Focus blocks finished in the current cycle. */
  done: number;
}

const length = (phase: PomoPhase, s: PomoSettings, msPerMin: number) => s[phase] * msPerMin;

export const initial = (s: PomoSettings, msPerMin = 60_000): PomoState => ({ phase: "focus", running: false, endsAt: null, remainingMs: length("focus", s, msPerMin), done: 0 });

export const start = (p: PomoState, now: number): PomoState => (p.running ? p : { ...p, running: true, endsAt: now + p.remainingMs });

export const pause = (p: PomoState, now: number): PomoState => (p.running && p.endsAt != null ? { ...p, running: false, endsAt: null, remainingMs: Math.max(0, p.endsAt - now) } : p);

export function remaining(p: PomoState, now: number): number {
  return p.running && p.endsAt != null ? Math.max(0, p.endsAt - now) : p.remainingMs;
}

/** Skips to the next phase without counting the current one. */
export function skip(p: PomoState, s: PomoSettings, msPerMin = 60_000): PomoState {
  const phase: PomoPhase = p.phase === "focus" ? ((p.done + 1) % s.every === 0 ? "long" : "short") : "focus";
  return { phase, running: false, endsAt: null, remainingMs: length(phase, s, msPerMin), done: p.done };
}

/**
 * Advances a running phase that has ended. A finished focus block starts its
 * break right away; a finished break waits for the learner. Returns the phase
 * that just finished (or null).
 */
export function tick(p: PomoState, s: PomoSettings, now: number, msPerMin = 60_000): { state: PomoState; finished: PomoPhase | null } {
  if (!p.running || p.endsAt == null || now < p.endsAt) return { state: p, finished: null };
  if (p.phase === "focus") {
    const done = p.done + 1;
    const phase: PomoPhase = done % s.every === 0 ? "long" : "short";
    const ms = length(phase, s, msPerMin);
    return { state: { phase, running: true, endsAt: p.endsAt + ms, remainingMs: ms, done: done % s.every }, finished: "focus" };
  }
  return { state: { phase: "focus", running: false, endsAt: null, remainingMs: length("focus", s, msPerMin), done: p.done }, finished: p.phase };
}

export function validSettings(s: Partial<PomoSettings>): PomoSettings {
  const clamp = (x: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Math.round(Number(x)))) : d);
  return {
    focus: clamp(s.focus, 1, 120, DEFAULT_SETTINGS.focus),
    short: clamp(s.short, 1, 60, DEFAULT_SETTINGS.short),
    long: clamp(s.long, 1, 90, DEFAULT_SETTINGS.long),
    every: clamp(s.every, 2, 8, DEFAULT_SETTINGS.every),
  };
}

export const PHASE_LABEL: Record<PomoPhase, string> = { focus: "Foco", short: "Descanso", long: "Descanso largo" };

/** 1500000 → "25:00". */
export function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
