import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { accessibilityApi, api, localSpeechApi } from "../../api";
import { LOCAL_SPEECH, type Accessibility } from "../../types";
import { applyAccessibility, DEFAULT_ACCESSIBILITY } from "../../lib/accessibility";

interface Ctx {
  a: Accessibility;
  /** Saves at once; display settings apply before the backend answers. */
  update: (patch: Partial<Accessibility>) => Promise<void>;
  /** A speech model is set (Ajustes → Voz), so dictation can work. */
  speechReady: boolean;
  refreshSpeech: () => void;
}

const AccessibilityCtx = createContext<Ctx>({ a: DEFAULT_ACCESSIBILITY, update: async () => {}, speechReady: false, refreshSpeech: () => {} });

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [a, setA] = useState<Accessibility>(DEFAULT_ACCESSIBILITY);
  const [speechReady, setSpeechReady] = useState(false);
  const refreshSpeech = () => {
    api
      .getSettings()
      .then(async (v) => {
        const r = v.roles.speech;
        if (!r?.model) return setSpeechReady(false);
        // AC-106: the local Whisper is only ready once its model is downloaded.
        if (r.provider_id === LOCAL_SPEECH) return setSpeechReady((await localSpeechApi.status()).some((m) => m.id === r.model && m.installed));
        setSpeechReady(true);
      })
      .catch(() => setSpeechReady(false));
  };
  useEffect(() => {
    accessibilityApi.get().then(setA).catch(() => {});
    refreshSpeech();
  }, []);
  useEffect(() => applyAccessibility(a), [a]);

  const update = async (patch: Partial<Accessibility>) => {
    const prev = a;
    const next = { ...a, ...patch };
    setA(next);
    try {
      setA(await accessibilityApi.save(next));
    } catch (e) {
      // Not saved: go back to what is stored, so the screen never shows a setting that isn't kept.
      setA(prev);
      throw e;
    }
  };
  return <AccessibilityCtx.Provider value={{ a, update, speechReady, refreshSpeech }}>{children}</AccessibilityCtx.Provider>;
}

export const useAccessibility = () => useContext(AccessibilityCtx);
