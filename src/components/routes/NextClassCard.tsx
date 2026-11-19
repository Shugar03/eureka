import { useEffect, useState } from "react";
import { errorText, routeApi } from "../../api";
import type { RouteView } from "../../types";
import { currentClass, duration, endDate, shortDate } from "../../lib/routes";

/**
 * AC-217: on the home screen, the next class of the route you were last in,
 * with one button. Nothing when there is no route to follow.
 */
export function NextClassCard({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [r, setR] = useState<RouteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    routeApi
      .list()
      .then((all) => setR(all.find((x) => x.current) ?? null))
      .catch(() => setR(null));
  }, []);
  const cur = r ? currentClass(r) : null;
  if (!r || !cur) return null;
  const pct = r.total ? (100 * r.done) / r.total : 0;
  const go = async () => {
    try {
      onOpenSession((await routeApi.startClass(r.id, cur.cls.id)).id);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="rt-home" aria-label="Tu ruta">
      <span className="rt-home-ring" style={{ "--pct": `${pct}%` } as React.CSSProperties} aria-hidden>
        <span>
          {cur.cls.number}/{r.total}
        </span>
      </span>
      <div className="rt-home-text">
        <span className="rt-kicker">Tu ruta · {r.title}</span>
        <strong>
          Clase {cur.cls.number}: {cur.cls.title}
        </strong>
        <small>
          ~{duration(cur.cls.minutes)} · terminás el {shortDate(endDate(r.minutes_left, r.hours_per_week, new Date()))}
        </small>
        {error && (
          <small className="error-text" role="alert">
            {error}
          </small>
        )}
      </div>
      <button className="btn primary" onClick={go}>
        {cur.cls.session_id ? "Seguir" : "Empezar"}
      </button>
    </section>
  );
}
