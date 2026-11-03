import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { identityApi } from "../../api";
import type { Identity } from "../../types";
import { applyTheme, loadTheme, type Theme } from "../../lib/theme";
import { applyWorkspace, DEFAULT_WORKSPACE, loadWorkspace, resolveTheme, saveWorkspace, type Tone, type Workspace } from "../../lib/workspace";

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** The theme in force ("system" resolved). */
  tone: Tone;
  ws: Workspace;
  /** False when the browser refused to keep it (it still applies for this run). */
  saved: boolean;
  update: (patch: Partial<Workspace>) => void;
  /** AC-92: what the learner told the app about themself; null until it is read. */
  identity: Identity | null;
  /** Applies at once and saves in the background. */
  setIdentity: (patch: Partial<Identity>) => void;
  /** What to call them: their first name, or the one an older version kept. */
  name: string;
}

export const EMPTY_IDENTITY: Identity = { first_name: "", last_name: "", school: "", career: "", age: null, treatment: "", treatment_other: "", onboarded: true };

const WorkspaceCtx = createContext<Ctx>({ theme: "dark", setTheme: () => {}, tone: "dark", ws: DEFAULT_WORKSPACE, saved: true, update: () => {}, identity: EMPTY_IDENTITY, setIdentity: () => {}, name: "" });

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [ws, setWs] = useState<Workspace>(loadWorkspace);
  const [saved, setSaved] = useState(true);
  const [system, setSystem] = useState(() => resolveTheme("system"));
  const [identity, setIdentityState] = useState<Identity | null>(null);
  // If the backend can't be read, never block the app behind a welcome that can't be saved.
  useEffect(() => {
    identityApi.get().then(setIdentityState).catch(() => setIdentityState(EMPTY_IDENTITY));
  }, []);

  useEffect(() => applyTheme(theme), [theme]);
  // "Según el sistema" follows the OS while the app is open.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => setSystem(m.matches ? "light" : "dark");
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [theme]);

  const tone: Tone = theme === "system" ? system : theme;
  useEffect(() => applyWorkspace(ws, tone), [ws, tone]);

  const value = useMemo<Ctx>(
    () => ({
      theme,
      setTheme,
      tone,
      ws,
      saved,
      identity,
      name: identity?.first_name.trim() || ws.name,
      setIdentity: (patch) =>
        setIdentityState((cur) => {
          const next = { ...(cur ?? EMPTY_IDENTITY), ...patch };
          // The server trims and clamps; the box keeps what was typed (a trailing space is part of typing).
          identityApi.save(next).catch(() => {});
          return next;
        }),
      update: (patch) =>
        setWs((cur) => {
          const next = { ...cur, ...patch };
          setSaved(saveWorkspace(next));
          return next;
        }),
    }),
    [theme, tone, ws, saved, identity],
  );
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceCtx);
