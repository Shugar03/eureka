import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { studyApi } from "../../api";
import type { StudyContext } from "../../types";
import { localDate } from "../../lib/exam";
import * as P from "../../lib/pomodoro";
import { ding, loadSound, saveSound, soft, tick, tickSecond, type SoundSettings } from "../../lib/sounds";

interface Value {
  state: P.PomoState;
  settings: P.PomoSettings;
  now: number;
  msPerMin: number;
  /** What the learner is studying (the screen they're on). */
  context: StudyContext | null;
  /** Bumped every time a focus block is logged (to refresh the totals). */
  logVersion: number;
  notice: string | null;
  /** AC-97: bell and tick-tock; the learner can turn them off. */
  sound: SoundSettings;
  setSound: (s: SoundSettings) => void;
  start: () => void;
  /** Starts a focus block of `minutes` right away (the agent's pomodoro button). */
  startFocus: (minutes: number) => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  setSettings: (s: P.PomoSettings) => void;
  setContext: (c: StudyContext | null) => void;
}

const noop = () => {};
const Ctx = createContext<Value>({
  state: P.initial(P.DEFAULT_SETTINGS),
  settings: P.DEFAULT_SETTINGS,
  now: 0,
  msPerMin: 60_000,
  context: null,
  logVersion: 0,
  notice: null,
  sound: { enabled: false, tickTock: false },
  setSound: noop,
  start: noop,
  startFocus: noop,
  pause: noop,
  reset: noop,
  skip: noop,
  setSettings: noop,
  setContext: noop,
});

export const usePomodoro = () => useContext(Ctx);

/** Screens call this so a finished focus block is logged with what they show. */
export function useStudyContext(c: StudyContext | null) {
  const { setContext } = usePomodoro();
  useEffect(() => {
    setContext(c);
    return () => setContext(null);
  }, [c?.kind, c?.id, c?.title]);
}

const STATE_KEY = "la.pomodoro";
const SETTINGS_KEY = "la.pomodoro.settings";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: the timer still works for this visit */
  }
}

// `?fastPomodoro` in the e2e build: 1 minute lasts 1 second.
const FAST = import.meta.env.MODE === "e2e" && new URLSearchParams(location.search).has("fastPomodoro");

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const msPerMin = FAST ? 1000 : 60_000;
  const [settings, setSettingsState] = useState<P.PomoSettings>(() => P.validSettings(load(SETTINGS_KEY, P.DEFAULT_SETTINGS)));
  const [state, setState] = useState<P.PomoState>(() => load(STATE_KEY, P.initial(settings, msPerMin)));
  const [now, setNow] = useState(() => Date.now());
  const [context, setContext] = useState<StudyContext | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [sound, setSoundState] = useState<SoundSettings>(loadSound);
  const lastTick = useRef<number | null>(null);
  // The block is logged with what was on screen when it ENDED.
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => save(STATE_KEY, state), [state]);
  useEffect(() => save(SETTINGS_KEY, settings), [settings]);

  // The tick-tock of the last seconds, once per second.
  useEffect(() => {
    const sec = state.running && sound.enabled && sound.tickTock ? tickSecond(P.remaining(state, now)) : null;
    if (sec === null) {
      lastTick.current = null;
      return;
    }
    if (sec !== lastTick.current) {
      lastTick.current = sec;
      tick(sec % 2 === 0);
    }
  }, [now, state, sound]);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [state.running]);

  useEffect(() => {
    const { state: next, finished } = P.tick(state, settings, now, msPerMin);
    if (!finished) return;
    setState(next);
    if (sound.enabled) (finished === "focus" ? ding : soft)();
    if (finished === "focus") {
      const minutes = settings.focus;
      studyApi
        .log(localDate(new Date()), minutes, contextRef.current)
        .then(() => setLogVersion((v) => v + 1))
        .catch(() => {});
      setNotice(`¡Bloque de foco terminado! Anoté ${minutes} min. ${next.phase === "long" ? "Descanso largo" : "Descanso"} de ${settings[next.phase]} min.`);
    } else setNotice("Terminó el descanso. ¿Otro pomodoro?");
  }, [now]);

  // The tab/window title shows the clock while it runs.
  useEffect(() => {
    const base = "Eureka";
    document.title = state.running ? `${P.mmss(P.remaining(state, now))} · ${P.PHASE_LABEL[state.phase]} — ${base}` : base;
  }, [state, now]);

  const value: Value = {
    state,
    settings,
    now,
    msPerMin,
    context,
    logVersion,
    notice,
    sound,
    setSound: (v) => {
      setSoundState(v);
      saveSound(v);
    },
    startFocus: (minutes) => {
      const v = P.validSettings({ ...settings, focus: minutes });
      const t = Date.now();
      setSettingsState(v);
      setNotice(null);
      setNow(t);
      setState(P.start(P.initial(v, msPerMin), t));
    },
    start: useCallback(() => {
      setNotice(null);
      setNow(Date.now());
      setState((s) => P.start(s, Date.now()));
    }, []),
    pause: useCallback(() => setState((s) => P.pause(s, Date.now())), []),
    reset: () => {
      setNotice(null);
      setState(P.initial(settings, msPerMin));
    },
    skip: () => {
      setNotice(null);
      setState((s) => P.skip(s, settings, msPerMin));
    },
    setSettings: (s) => {
      const v = P.validSettings(s);
      setSettingsState(v);
      setState((cur) => (cur.running ? cur : { ...cur, remainingMs: v[cur.phase] * msPerMin }));
    },
    setContext,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
