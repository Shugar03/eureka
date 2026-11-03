import { useEffect, useState } from "react";
import { api, cardsApi } from "../api";
import { localDate } from "../lib/exam";
import { sameName } from "../lib/examChat";
import type { ActionScreen, ProposedAction } from "../types";
import { loadReminderSettings, saveReminderSettings } from "./Reminders";
import { validReminders } from "../lib/reminders";
import { usePomodoro } from "./pomodoro/PomodoroContext";

export const SCREEN_LABEL: Record<ActionScreen, string> = {
  library: "la biblioteca",
  practice: "Práctica",
  exams: "Exámenes",
  cards: "Tarjetas",
  agenda: "la agenda",
  code: "la consola de código",
  language: "Idiomas",
  graph: "el grafo",
  companion: "Acompañamiento",
  academic: "Mi cursada",
  classes: "Clases",
  progress: "Mi progreso",
  settings: "Ajustes",
};

/**
 * AC-90: a button the agent offered. Nothing happens until it is tapped: the
 * person decides, and the card says plainly what the tap will do.
 */
const ACTIVITY: Record<string, string> = { simulacro: "para hacer un simulacro", hoja: "para la hoja de repaso", repaso: "para repasar las que fallaste" };

export function ActionCard({ action, onOpenScreen, onOpenExam, onOpenDeck }: { action: ProposedAction; onOpenScreen: (s: ActionScreen) => void; onOpenExam?: (id: string) => void; onOpenDeck?: (id: string) => void }) {
  const pomo = usePomodoro();
  const [done, setDone] = useState(false);
  // AC-164: an exam or a deck by its name; it may have been renamed or deleted since.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const name = action.kind === "open_exam" ? action.exam : action.kind === "open_deck" ? action.deck : null;
    if (!name) return;
    const find = <T extends { id: string; name: string }>(xs: T[]) => xs.find((x) => sameName(x.name, name))?.id ?? null;
    (action.kind === "open_exam" ? api.listExams().then(find) : cardsApi.listDecks(localDate(new Date())).then(find)).then(setTarget).catch(() => setTarget(null));
  }, [action]);

  const minutes = action.minutes ?? 25;
  const running = pomo.state.running;

  let hint = "";
  let run: () => void = () => {};
  let disabled = false;
  if (action.kind === "open_screen" && action.screen) {
    const screen = action.screen;
    hint = `Te lleva a ${SCREEN_LABEL[screen]}`;
    run = () => onOpenScreen(screen);
  } else if (action.kind === "start_pomodoro") {
    hint = running ? "Ya hay un pomodoro en curso" : `${minutes} min de foco; el reloj arranca ahora`;
    disabled = running;
    run = () => {
      pomo.startFocus(minutes);
      setDone(true);
    };
  } else if (action.kind === "open_exam" || action.kind === "open_deck") {
    const isExam = action.kind === "open_exam";
    const name = isExam ? action.exam : action.deck;
    hint = target === null ? `No encontré ${isExam ? "la preparación" : "el mazo"} «${name}»` : isExam ? `Abre «${name}» ${ACTIVITY[action.activity ?? ""] ?? ""}`.trim() : `Abre el mazo «${name}» para estudiarlo`;
    disabled = !target;
    run = () => target && (isExam ? onOpenExam?.(target) : onOpenDeck?.(target));
  } else if (action.kind === "set_reminders") {
    const parts = [action.stand_minutes && `que te pares cada ${action.stand_minutes} min`, action.water_minutes && `que tomes agua cada ${action.water_minutes} min`].filter(Boolean);
    hint = `Te avisa ${parts.join(" y ")}`;
    run = () => {
      const cur = loadReminderSettings();
      saveReminderSettings(
        validReminders({
          ...cur,
          enabled: true,
          ...(action.stand_minutes ? { stand: true, standMinutes: action.stand_minutes } : {}),
          ...(action.water_minutes ? { water: true, waterMinutes: action.water_minutes } : {}),
        }),
      );
      setDone(true);
    };
  }

  return (
    <div className="action-card" role="group" aria-label={action.label}>
      <span className="action-hint">{hint}</span>
      <div className="row">
        <button className="btn primary small" onClick={run} disabled={disabled || done}>
          {action.label}
        </button>
        {done && (
          <span className="muted small" role="status">
            {action.kind === "start_pomodoro" ? "Pomodoro en marcha" : "Listo, quedó activado"}
          </span>
        )}
      </div>
    </div>
  );
}
