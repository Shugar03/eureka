import { useEffect, useRef, useState } from "react";
import { quoteOfDay, splashEnabled } from "../../lib/quotes";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ReadAloud } from "../a11y/ReadAloud";
import { QuoteSource } from "./QuoteCard";
import { useQuotePrefs } from "./useQuotePrefs";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Once per launch of the app, not on every screen change nor on a reload
// (sessionStorage outlives a reload and is gone when the app closes).
const SHOWN_KEY = "la.quoteSplashShown";
let shownThisRun = false;
const alreadyShown = () => {
  try {
    return shownThisRun || sessionStorage.getItem(SHOWN_KEY) === "1";
  } catch {
    return shownThisRun;
  }
};
const markShown = () => {
  shownThisRun = true;
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    /* private mode: once per page load is fine */
  }
};

/** AC-133: a calm welcome with today's quote when the app opens. One tap (or Esc) and you're in. */
export function QuoteSplash() {
  const prefs = useQuotePrefs();
  const { identity } = useWorkspace();
  const [open, setOpen] = useState(() => (!alreadyShown() || new URLSearchParams(location.search).has("splash")) && splashEnabled(prefs));
  const enter = useRef<HTMLButtonElement>(null);
  // Never on top of the first-time welcome: wait until the learner is set up.
  const ready = identity !== null && identity.onboarded;

  useEffect(() => {
    if (!open || !ready) return;
    markShown();
    enter.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ready]);

  if (!open || !ready) return null;
  const q = quoteOfDay(new Date(), prefs.hidden);
  return (
    <div className="quote-splash" role="dialog" aria-modal="true" aria-label="Cita del día">
      <figure className="quote-splash-card">
        <span className="quote-splash-date">{capitalize(new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }))}</span>
        <blockquote className="quote-splash-text" data-testid="splash-quote">
          “{q.text}”
        </blockquote>
        <QuoteSource q={q} />
        <ReadAloud markdown={`${q.text} ${q.author}.`} />
        <button ref={enter} className="btn primary quote-splash-enter" onClick={() => setOpen(false)}>
          Entrar
        </button>
      </figure>
    </div>
  );
}
