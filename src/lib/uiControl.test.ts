import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSIBILITY } from "./accessibility";
import { initial, DEFAULT_SETTINGS, pause, start } from "./pomodoro";
import { DEFAULT_REMINDERS } from "./reminders";
import { DEFAULT_SOUND } from "./sounds";
import { applyAccessibilityCommand, applyReminderCommand, applySoundCommand, describeUi, uiCommandLabel, type UiState } from "./uiControl";
import { DEFAULT_WORKSPACE } from "./workspace";

const base = (over: Partial<UiState> = {}): UiState => ({
  pomodoro: initial(DEFAULT_SETTINGS),
  pomodoroSettings: DEFAULT_SETTINGS,
  now: 1_000_000,
  theme: "dark",
  workspace: DEFAULT_WORKSPACE,
  sound: DEFAULT_SOUND,
  reminders: DEFAULT_REMINDERS,
  accessibility: DEFAULT_ACCESSIBILITY,
  ...over,
});

describe("applying a control to the stored settings (AC-122)", () => {
  it("reminders: a number turns one on, 0 turns it off, a missing one is left alone", () => {
    const on = applyReminderCommand(DEFAULT_REMINDERS, { command: "set_reminders", stand_minutes: 25, water_minutes: 45 });
    expect(on).toMatchObject({ enabled: true, stand: true, standMinutes: 25, water: true, waterMinutes: 45 });
    const off = applyReminderCommand(on, { command: "set_reminders", stand_minutes: 0, water_minutes: null });
    expect(off).toMatchObject({ stand: false, standMinutes: 25, water: true, waterMinutes: 45 });
    expect(applyReminderCommand({ ...DEFAULT_REMINDERS, enabled: false }, { command: "set_reminders", stand_minutes: null, water_minutes: 60 }).enabled).toBe(true);
  });

  it("accessibility: only what was asked changes", () => {
    const next = applyAccessibilityCommand(DEFAULT_ACCESSIBILITY, { command: "set_accessibility", text_size: "large", reduce_motion: true });
    expect(next).toEqual({ ...DEFAULT_ACCESSIBILITY, text_size: "large", reduce_motion: true });
    expect(applyAccessibilityCommand(next, { command: "set_accessibility", text_size: null, spacing: true })).toEqual({ ...next, spacing: true });
  });

  it("sound: one switch at a time", () => {
    expect(applySoundCommand(DEFAULT_SOUND, { command: "set_sound", enabled: false, tick_tock: null })).toEqual({ enabled: false, tickTock: true });
    expect(applySoundCommand(DEFAULT_SOUND, { command: "set_sound", enabled: null, tick_tock: false })).toEqual({ enabled: true, tickTock: false });
  });
});

describe("describeUi (AC-123)", () => {
  it("tells the agent what runs and how the app is set, in a few short lines", () => {
    const idle = describeUi(base());
    expect(idle).toContain("- Pomodoro: quieto (25 min de foco)");
    expect(idle).toContain("- Tema: oscuro; fondo: automático; acento: el del fondo");
    expect(idle).toContain("- Sonido del pomodoro: activado (con tic-tac)");
    expect(idle).toContain("- Recordatorios: sin avisos de pararse ni de agua");
    expect(idle).not.toContain("Accesibilidad");
    expect(idle.split("\n").length).toBeLessThanOrEqual(5);

    const t0 = 5_000_000;
    const running = describeUi(base({ pomodoro: start(initial(DEFAULT_SETTINGS), t0), now: t0 + 60_000 }));
    expect(running).toContain("corriendo, foco, quedan 24:00 (bloque 1 de 4)");
    const paused = describeUi(base({ pomodoro: pause(start(initial(DEFAULT_SETTINGS), t0), t0 + 5 * 60_000), now: t0 + 9 * 60_000 }));
    expect(paused).toContain("en pausa, foco, quedan 20:00");
  });

  it("reflects the person's choices", () => {
    const text = describeUi(
      base({
        theme: "light",
        workspace: { ...DEFAULT_WORKSPACE, wallpaper: { kind: "preset", id: "atardecer" }, accent: "#e0675a" },
        sound: { enabled: false, tickTock: true },
        reminders: { ...DEFAULT_REMINDERS, stand: true, standMinutes: 25, water: true, waterMinutes: 60 },
        accessibility: { ...DEFAULT_ACCESSIBILITY, text_size: "larger", easy_reading: true },
      }),
    );
    expect(text).toContain("- Tema: claro; fondo: Atardecer; acento: #e0675a");
    expect(text).toContain("- Sonido del pomodoro: apagado");
    expect(text).toContain("- Recordatorios: pararse cada 25 min, agua cada 60 min");
    expect(text).toContain("- Accesibilidad: texto muy grande, lectura fácil");
  });
});

describe("uiCommandLabel", () => {
  it("reads each command as a short line, and says nothing about an unknown one", () => {
    const l = (a: Record<string, unknown>) => uiCommandLabel(a);
    expect(l({ command: "pomodoro_start", minutes: 40 })).toBe("Empezó un pomodoro de 40 min");
    expect(l({ command: "pomodoro_pause" })).toBe("Pausó el pomodoro");
    expect(l({ command: "set_theme", theme: "light" })).toBe("Tema claro");
    expect(l({ command: "set_wallpaper", wallpaper: "bosque" })).toBe("Fondo: Bosque entre la niebla");
    expect(l({ command: "set_sound", enabled: false })).toBe("Apagó el sonido del pomodoro");
    expect(l({ command: "set_reminders", stand_minutes: 25, water_minutes: 0 })).toBe("Recordatorios: pararte cada 25 min, sin avisos de tomar agua");
    expect(l({ command: "format_disk" })).toBeNull();
  });
});
