import { useSyncExternalStore } from "react";
import { loadQuotePrefs, saveQuotePrefs, type QuotePrefs } from "../../lib/quotes";

// One copy of the learner's quote preferences, shared by the home card, the
// welcome and Mi espacio, so a favourite marked in one place shows everywhere.
let prefs: QuotePrefs | null = null;
const listeners = new Set<() => void>();

const read = () => (prefs ??= loadQuotePrefs());

export function setQuotePrefs(patch: Partial<QuotePrefs> | ((p: QuotePrefs) => Partial<QuotePrefs>)) {
  const cur = read();
  prefs = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
  saveQuotePrefs(prefs);
  listeners.forEach((l) => l());
}

/** For tests: forget the in-memory copy so the next read comes from storage. */
export function resetQuotePrefsCache() {
  prefs = null;
}

export function useQuotePrefs(): QuotePrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}
