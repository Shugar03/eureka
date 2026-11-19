import { useEffect, useState } from "react";
import { errorText, routeApi } from "../../api";
import type { RouteLink, RouteView } from "../../types";
import { classOf, endDate, nextAfter, shortDate } from "../../lib/routes";

/** The route a session belongs to, reloaded when the session's phase changes. */
export function useRouteOf(link: RouteLink | null | undefined, phase: string) {
  const [r, setR] = useState<RouteView | null>(null);
  useEffect(() => {
    if (!link) return setR(null);
    routeApi
      .get(link.route_id)
      .then(setR)
      .catch(() => setR(null));
  }, [link?.route_id, link?.class_id, phase]);
  return r;
}

/** AC-216: under the header of a class, where it stands in its route. */
export function RouteStrip({ r, classId, onOpenRoute }: { r: RouteView; classId: string; onOpenRoute: (id: string) => void }) {
  const at = classOf(r, classId);
  if (!at) return null;
  const all = r.units.flatMap((u) => u.classes).filter((c) => c.state !== "known");
  return (
    <div className="rt-strip" role="group" aria-label="Tu ruta">
      <button type="button" className="rt-strip-title" onClick={() => onOpenRoute(r.id)}>
        {r.title} · Unidad {at.unitIndex + 1}: {at.unit}
      </button>
      <span className="rt-dots" aria-hidden>
        {all.map((c) => (
          <i key={c.id} className={c.id === classId ? "is-this" : c.state === "done" ? "is-done" : ""} />
        ))}
      </span>
      <span className="rt-strip-n">
        Clase {at.cls.number} de {r.total}
      </span>
    </div>
  );
}

/** AC-216: when a class closes, what it was worth and the door to the next one. */
export function ClassDoneCard({ r, classId, learned, onOpenSession, onOpenRoute }: { r: RouteView; classId: string; learned: string[]; onOpenSession: (id: string) => void; onOpenRoute: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const at = classOf(r, classId);
  if (!at) return null;
  const next = nextAfter(r, classId);
  const go = async () => {
    if (!next) return;
    try {
      onOpenSession((await routeApi.startClass(r.id, next.id)).id);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const left = r.total - r.done;
  return (
    <section className="rt-done" aria-label={`Clase ${at.cls.number} terminada`}>
      <span className="rt-medal" aria-hidden>
        ✓
      </span>
      <div>
        <span className="rt-kicker is-ok">Clase {at.cls.number} terminada</span>
        <h3>{next ? at.cls.title : `¡Terminaste «${r.title}»!`}</h3>
        <p>{next ? `Te ${left === 1 ? "queda 1 clase" : `quedan ${left} clases`}: a tu ritmo, terminás el ${shortDate(endDate(r.minutes_left, r.hours_per_week, new Date()))}.` : "Completaste todas las clases de la ruta."}</p>
        {learned.length > 0 && (
          <div className="rt-learned" aria-label="Lo que entendiste">
            {learned.map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        )}
        {error && (
          <p className="error-text small" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          {next && (
            <button className="btn primary" onClick={go}>
              Siguiente: {next.title} →
            </button>
          )}
          <button className="btn ghost" onClick={() => onOpenRoute(r.id)}>
            Ver mi ruta
          </button>
        </div>
      </div>
    </section>
  );
}
