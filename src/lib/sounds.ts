// AC-97: the pomodoro's sounds, synthesised (no files, no permissions): a
// kitchen-timer tick-tock in the last seconds and a bell at the end. They can
// be turned off, and nothing plays by itself unless the learner left them on.

export interface SoundSettings {
  /** Master switch: the bell and every other sound. */
  enabled: boolean;
  /** The tick-tock during the last seconds of a block. */
  tickTock: boolean;
}

export const DEFAULT_SOUND: SoundSettings = { enabled: true, tickTock: true };

/** The tick-tock runs for this many seconds before a block ends. */
export const TICK_WINDOW = 10;

const KEY = "la.sound";

export function loadSound(): SoundSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_SOUND.enabled, tickTock: typeof v.tickTock === "boolean" ? v.tickTock : DEFAULT_SOUND.tickTock };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function saveSound(s: SoundSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: it still applies for this visit */
  }
}

/** The whole second to tick for in the last `window` seconds (10…1), else null. */
export function tickSecond(remainingMs: number, window = TICK_WINDOW): number | null {
  if (!(remainingMs > 0)) return null;
  const sec = Math.ceil(remainingMs / 1000);
  return sec <= window ? sec : null;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One short note: `freq` Hz, `type` wave, from `at` seconds after now, fading out over `len`. */
function note(c: AudioContext, freq: number, at: number, len: number, peak: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** "Chiqui": a dry little click, alternating high and low like a clock. */
export function tick(high: boolean) {
  const c = audio();
  if (!c) return;
  note(c, high ? 2300 : 1700, 0, 0.045, 0.1, "square");
}

/** "Ting": a bell with a bright overtone that rings out. */
export function ding() {
  const c = audio();
  if (!c) return;
  note(c, 1568, 0, 1.6, 0.22);
  note(c, 2349, 0, 0.9, 0.08);
  note(c, 3136, 0, 0.35, 0.04);
}

/** A gentle two-note ping, for reminders. */
export function soft() {
  const c = audio();
  if (!c) return;
  note(c, 660, 0, 0.35, 0.12);
  note(c, 880, 0.18, 0.5, 0.12);
}
