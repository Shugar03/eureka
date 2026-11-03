import { useCallback, useRef } from "react";
import type { UiCommand } from "../types";
import { applyAccessibilityCommand, applyReminderCommand, applySoundCommand, describeUi } from "../lib/uiControl";
import { validSettings } from "../lib/pomodoro";
import { identityApi } from "../api";
import { loadReminderSettings, saveReminderSettings } from "./Reminders";
import { usePomodoro } from "./pomodoro/PomodoroContext";
import { useAccessibility } from "./a11y/AccessibilityContext";
import { useWorkspace } from "./workspace/WorkspaceContext";

/**
 * AC-122, AC-123: the agent's hands and eyes on the app. `run` does what the
 * person asked for in the chat ("pausá el pomodoro"); `snapshot` is what the
 * agent is told about the screen. Both read the latest state through a ref, so
 * they keep one identity and never act on a stale render.
 */
export function useUiControl() {
  const pomo = usePomodoro();
  const ws = useWorkspace();
  const acc = useAccessibility();
  const latest = useRef({ pomo, ws, acc });
  latest.current = { pomo, ws, acc };

  const run = useCallback((c: UiCommand) => {
    const { pomo, ws, acc } = latest.current;
    switch (c.command) {
      case "pomodoro_start":
        return pomo.startFocus(c.minutes);
      case "pomodoro_pause":
        return pomo.pause();
      case "pomodoro_resume":
        return pomo.start();
      case "pomodoro_skip":
        return pomo.skip();
      case "pomodoro_reset":
        return pomo.reset();
      case "set_theme":
        return ws.setTheme(c.theme);
      case "set_wallpaper":
        return ws.update({ wallpaper: c.wallpaper === "auto" ? { kind: "auto" } : c.wallpaper === "none" ? { kind: "none" } : { kind: "preset", id: c.wallpaper }, palette: [] });
      case "set_accent":
        return ws.update({ accent: c.accent === "auto" ? null : c.accent });
      case "set_sound":
        return pomo.setSound(applySoundCommand(pomo.sound, c));
      case "set_reminders":
        return saveReminderSettings(applyReminderCommand(loadReminderSettings(), c));
      case "set_accessibility":
        return void acc.update(applyAccessibilityCommand(acc.a, c));
      // AC-160: durations and the profile, as the person asked in the chat.
      case "set_pomodoro":
        return pomo.setSettings(validSettings({ ...pomo.settings, ...(c.focus != null && { focus: c.focus }), ...(c.short != null && { short: c.short }), ...(c.long != null && { long: c.long }), ...(c.every != null && { every: c.every }) }));
      case "set_profile":
        return void identityApi
          .get()
          .then((i) =>
            identityApi.save({
              ...i,
              ...(c.first_name != null && { first_name: c.first_name }),
              ...(c.school != null && { school: c.school }),
              ...(c.career != null && { career: c.career }),
              ...(c.treatment != null && { treatment: c.treatment === "ninguno" ? "" : c.treatment }),
            }),
          )
          .catch(() => {});
    }
  }, []);

  const snapshot = useCallback(() => {
    const { pomo, ws, acc } = latest.current;
    return describeUi({ pomodoro: pomo.state, pomodoroSettings: pomo.settings, now: Date.now(), theme: ws.theme, workspace: ws.ws, sound: pomo.sound, reminders: loadReminderSettings(), accessibility: acc.a });
  }, []);

  return { run, snapshot };
}
