import { useMemo, useState } from "react";
import { yourDevice } from "../../lib/platform";
import { companionApi, errorText } from "../../api";
import type { CompanionView } from "../../types";
import { computeInsights, missingForInsights, type Insight } from "../../lib/insights";

/**
 * AC-95: "Lo que noté". Patterns in what the person wrote, computed here, on
 * this machine. Each is a guess: the person says "me suena" or "no es así",
 * and what they confirmed stays as what they know about themself.
 */
export function InsightsPanel({ view, onView }: { view: CompanionView; onView: (v: CompanionView) => void }) {
  const found = useMemo(() => computeInsights(view.entries), [view.entries]);
  const [showRejected, setShowRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verdict = (i: Insight) => view.insights[i.key];
  const confirmed = found.filter((i) => verdict(i) === "confirmed");
  const rejected = found.filter((i) => verdict(i) === "rejected");
  const open = found.filter((i) => !verdict(i));
  const missing = missingForInsights(view.entries);

  const answer = async (i: Insight, v: "confirmed" | "rejected" | null) => {
    setError(null);
    try {
      onView(await companionApi.setInsight(i.key, v));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="card" aria-label="Lo que noté">
      <h2>Lo que noté</h2>
      <p className="muted small">Son solo patrones de lo que anotaste: no son un diagnóstico ni explican por qué. Vos sabés si te suenan. Se calculan en {yourDevice()} y no se envían a ningún lado.</p>

      {found.length === 0 && (
        <p className="muted" data-testid="insights-empty">
          {missing > 0 ? `Con ${missing} ${missing === 1 ? "anotación" : "anotaciones"} más con tu ánimo, empiezo a ver cosas.` : "Por ahora no noto nada que se destaque. Seguí anotando cuando quieras."}
        </p>
      )}

      {confirmed.length > 0 && (
        <div className="insight-group" aria-label="Lo que ya confirmé">
          <h3>Lo que ya confirmé</h3>
          <ul className="insight-list">
            {confirmed.map((i) => (
              <li key={i.key} className="insight is-confirmed" data-testid="insight">
                <strong>{i.title}</strong>
                <span>{i.detail}</span>
                <button className="btn ghost small" onClick={() => answer(i, null)} aria-label={`Quitar de lo confirmado: ${i.title}`}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open.length > 0 && (
        <ul className="insight-list">
          {open.map((i) => (
            <li key={i.key} className="insight" data-testid="insight">
              <strong>{i.title}</strong>
              <span>{i.detail}</span>
              <div className="row">
                <button className="btn small" onClick={() => answer(i, "confirmed")} aria-label={`Me suena: ${i.title}`}>
                  Me suena
                </button>
                <button className="btn ghost small" onClick={() => answer(i, "rejected")} aria-label={`No es así: ${i.title}`}>
                  No es así
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <div>
          <button className="link small" onClick={() => setShowRejected((s) => !s)} aria-expanded={showRejected}>
            {showRejected ? "Ocultar las que descarté" : `Ver las que descarté (${rejected.length})`}
          </button>
          {showRejected && (
            <ul className="insight-list">
              {rejected.map((i) => (
                <li key={i.key} className="insight is-rejected">
                  <strong>{i.title}</strong>
                  <button className="btn ghost small" onClick={() => answer(i, null)} aria-label={`Volver a mostrar: ${i.title}`}>
                    Volver a mostrar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
