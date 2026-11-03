// Interactive demo in an isolated frame (AC-28, NF-14):
// - sandbox="allow-scripts" WITHOUT allow-same-origin: opaque origin, no access
//   to the app, its storage or Tauri IPC; no top navigation, popups or forms;
// - a CSP injected as the first <meta> blocks every network request.
import { useEffect, useState } from "react";

export const DEMO_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

export function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}">`;
  // Before anything else, so no earlier tag can load before the policy applies.
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`) : `${meta}${html}`;
}

/** AC-175: a bright demo can be shown with inverted colors; the choice is remembered on this device. */
const INVERT_KEY = "la.demoInvert";
function savedInvert(): boolean {
  try {
    return localStorage.getItem(INVERT_KEY) === "1";
  } catch {
    return false;
  }
}

export function DemoFrame({ title, html }: { title: string; html: string }) {
  // The same iframe grows to the whole window, so the demo keeps its state (slider, clicks).
  const [big, setBig] = useState(false);
  // A CSS filter on the frame itself: the demo's content and its sandbox stay untouched.
  const [inverted, setInverted] = useState(savedInvert);
  const toggleInvert = () =>
    setInverted((v) => {
      try {
        localStorage.setItem(INVERT_KEY, v ? "0" : "1");
      } catch {
        /* the choice just isn't remembered */
      }
      return !v;
    });
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  return (
    <figure className={`visual ${big ? "is-expanded" : ""}`} aria-label={`Demo: ${title}`} data-testid="demo">
      <figcaption className="visual-title">
        <span>{title}</span>
        <span className="row">
          <button type="button" className="btn ghost small" aria-pressed={inverted} onClick={toggleInvert} title="Para una demo muy clara con el tema oscuro (o al revés)">
            Invertir colores
          </button>
          <button type="button" className="btn ghost small" aria-pressed={big} onClick={() => setBig((b) => !b)}>
            {big ? "Cerrar (Esc)" : "Ampliar"}
          </button>
        </span>
      </figcaption>
      <iframe className={`demo-frame ${inverted ? "is-inverted" : ""}`} title={title} sandbox="allow-scripts" srcDoc={withCsp(html)} referrerPolicy="no-referrer" />
    </figure>
  );
}
