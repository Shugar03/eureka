// AC-122, AC-123: the agent runs the app's controls ("pausá el pomodoro") and
// can see what is on screen. The pure parts: what a command means for the
// stored settings, what the screen tells the agent, and how a command reads in
// the transcript. No DOM, no IPC.
import type { Accessibility, UiCommand } from "../types";
import { mmss, PHASE_LABEL, remaining, type PomoSettings, type PomoState } from "./pomodoro";
import type { ReminderSettings } from "./reminders";
import { validReminders } from "./reminders";
import type { SoundSettings } from "./sounds";
import { PRESETS, type Workspace } from "./workspace";

/** The reminders after `set_reminders`: a number turns that one on with those minutes, 0 turns it off, null leaves it. */
export function applyReminderCommand(cur: ReminderSettings, c: Extract<UiCommand, { command: "set_reminders" }>): ReminderSettings {
  const next = { ...cur, enabled: true };
  if (c.stand_minutes != null) Object.assign(next, c.stand_minutes === 0 ? { stand: false } : { stand: true, standMinutes: c.stand_minutes });
  if (c.water_minutes != null) Object.assign(next, c.water_minutes === 0 ? { water: false } : { water: true, waterMinutes: c.water_minutes });
  return validReminders(next);
}

/** The accessibility settings after `set_accessibility`: only what was asked changes. */
export function applyAccessibilityCommand(cur: Accessibility, c: Extract<UiCommand, { command: "set_accessibility" }>): Accessibility {
  const next = { ...cur };
  if (c.text_size) next.text_size = c.text_size;
  for (const k of ["spacing", "reduce_motion", "read_aloud", "easy_reading", "literal", "short_steps", "dictation"] as const) if (typeof c[k] === "boolean") next[k] = c[k] as boolean;
  return next;
}

/** The sound settings after `set_sound`. */
export function applySoundCommand(cur: SoundSettings, c: Extract<UiCommand, { command: "set_sound" }>): SoundSettings {
  return { enabled: c.enabled ?? cur.enabled, tickTock: c.tick_tock ?? cur.tickTock };
}

export interface UiState {
  pomodoro: PomoState;
  pomodoroSettings: PomoSettings;
  now: number;
  theme: string;
  workspace: Workspace;
  sound: SoundSettings;
  reminders: ReminderSettings;
  accessibility: Accessibility;
}

const THEME_LABEL: Record<string, string> = { dark: "oscuro", light: "claro", system: "según el sistema" };
const SIZE_LABEL: Record<string, string> = { normal: "normal", large: "grande", larger: "muy grande" };

/** A few short lines for the agent: what is running and how the app is set. They go in every prompt, so they stay small. */
export function describeUi(u: UiState): string {
  const p = u.pomodoro;
  const left = mmss(remaining(p, u.now));
  const pomo = p.running ? `corriendo, ${PHASE_LABEL[p.phase].toLowerCase()}, quedan ${left} (bloque ${p.done + 1} de ${u.pomodoroSettings.every})` : p.remainingMs === u.pomodoroSettings[p.phase] * 60_000 && p.done === 0 ? `quieto (${u.pomodoroSettings.focus} min de foco)` : `en pausa, ${PHASE_LABEL[p.phase].toLowerCase()}, quedan ${left}`;
  const wp = u.workspace.wallpaper;
  const wall = wp.kind === "preset" ? (PRESETS.find((x) => x.id === wp.id)?.label ?? wp.id) : wp.kind === "custom" ? "una imagen propia" : wp.kind === "none" ? "sin imagen" : "automático";
  const r = u.reminders;
  const rem = !r.enabled ? "apagados" : [r.stand && `pararse cada ${r.standMinutes} min`, r.water && `agua cada ${r.waterMinutes} min`].filter(Boolean).join(", ") || "sin avisos de pararse ni de agua";
  const a = u.accessibility;
  const acc = [a.text_size !== "normal" && `texto ${SIZE_LABEL[a.text_size]}`, a.spacing && "más espacio", a.reduce_motion && "sin animaciones", a.read_aloud && "lee en voz alta", a.easy_reading && "lectura fácil", a.literal && "lenguaje literal", a.short_steps && "pasos cortos", a.dictation && "dictado"].filter(Boolean).join(", ");
  return [
    `- Pomodoro: ${pomo}`,
    `- Tema: ${THEME_LABEL[u.theme] ?? u.theme}; fondo: ${wall}; acento: ${u.workspace.accent ?? "el del fondo"}`,
    `- Sonido del pomodoro: ${u.sound.enabled ? `activado${u.sound.tickTock ? " (con tic-tac)" : ""}` : "apagado"}`,
    `- Recordatorios: ${rem}`,
    ...(acc ? [`- Accesibilidad: ${acc}`] : []),
  ].join("\n");
}

/** How a command reads in the conversation: "Pausó el pomodoro". */
export function uiCommandLabel(a: Record<string, unknown>): string | null {
  switch (a.command) {
    case "pomodoro_start":
      return `Empezó un pomodoro de ${a.minutes ?? 25} min`;
    case "pomodoro_pause":
      return "Pausó el pomodoro";
    case "pomodoro_resume":
      return "Retomó el pomodoro";
    case "pomodoro_skip":
      return "Saltó a la siguiente etapa del pomodoro";
    case "pomodoro_reset":
      return "Reinició el pomodoro";
    case "set_theme":
      return `Tema ${THEME_LABEL[String(a.theme)] ?? a.theme}`;
    case "set_wallpaper":
      return `Fondo: ${a.wallpaper === "auto" ? "automático" : a.wallpaper === "none" ? "sin imagen" : (PRESETS.find((x) => x.id === a.wallpaper)?.label ?? a.wallpaper)}`;
    case "set_accent":
      return a.accent === "auto" ? "Acento: el color del fondo" : `Acento: ${a.accent}`;
    case "set_sound":
      return a.enabled === false ? "Apagó el sonido del pomodoro" : a.enabled === true ? "Activó el sonido del pomodoro" : a.tick_tock === false ? "Quitó el tic-tac" : "Activó el tic-tac";
    case "set_reminders": {
      const bit = (v: unknown, what: string) => (v === undefined || v === null ? null : v === 0 ? `sin avisos de ${what}` : `${what} cada ${v} min`);
      return `Recordatorios: ${[bit(a.stand_minutes, "pararte"), bit(a.water_minutes, "tomar agua")].filter(Boolean).join(", ")}`;
    }
    case "set_accessibility":
      return "Ajustó la accesibilidad";
    case "set_pomodoro": {
      const bit = (v: unknown, what: string) => (typeof v === "number" ? `${what} ${v} min` : null);
      const parts = [bit(a.focus, "foco"), bit(a.short, "descanso"), bit(a.long, "descanso largo"), typeof a.every === "number" ? `largo cada ${a.every} focos` : null].filter(Boolean);
      return `Pomodoro: ${parts.join(", ")}`;
    }
    case "set_profile":
      return "Actualizó tu perfil";
    default:
      return null;
  }
}
