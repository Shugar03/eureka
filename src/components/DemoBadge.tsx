/**
 * Shown only in the browser demo (`npm run dev:e2e`): its teacher is a script,
 * so it must never be mistaken for the real app. Hidden under automation so
 * the tests and their screenshots are unchanged.
 */
export function DemoBadge() {
  if (typeof navigator !== "undefined" && navigator.webdriver) return null;
  return (
    <div className="demo-badge" role="note">
      <strong>Demo en el navegador</strong>
      <span>Las respuestas son de ejemplo, no de un modelo real. Para usar tu modelo: <code>npm run app</code>.</span>
    </div>
  );
}
