import { useEffect, useState } from "react";
import { errorText, routeApi } from "../../api";
import type { ClassView, RouteView } from "../../types";
import { currentClass, duration, endDate, shortDate, weeksFor } from "../../lib/routes";
import { Icon } from "../Icon";

const MARK: Record<ClassView["state"], string> = { done: "✓", known: "✓", current: "", started: "", todo: "○" };

/**
 * AC-217: «Mis rutas». The list of routes and, inside one, where it stands, what
 * it changed by itself, and each unit as a path of classes.
 */
export function RoutesScreen({ initial, onOpenSession, onStudy }: { initial?: string | null; onOpenSession: (id: string) => void; onStudy: (message: string) => void }) {
  const [routes, setRoutes] = useState<RouteView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    routeApi
      .list()
      .then(setRoutes)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  const r = routes?.find((x) => x.id === selected) ?? null;
  const start = async (route: RouteView, classId: string) => {
    try {
      const s = await routeApi.startClass(route.id, classId);
      onOpenSession(s.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="practice-screen routes-screen">
      <header className="chat-head">
        {r ? (
          <>
            <button className="crumb" onClick={() => setSelected(null)}>
              Mis rutas
            </button>
            <span className="crumb-sep">/</span>
            <h1 className="chat-title">{r.title}</h1>
          </>
        ) : (
          <h1 className="chat-title">Mis rutas</h1>
        )}
      </header>
      <div className="practice-body rt">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!routes ? (
          !error && <p className="muted">Cargando…</p>
        ) : r ? (
          <RouteDetail r={r} onStart={(id) => start(r, id)} onDeleted={() => (setSelected(null), load())} />
        ) : routes.length === 0 ? (
          <section className="card rt-empty">
            <span className="rt-empty-icon" aria-hidden>
              <Icon name="route" size={22} />
            </span>
            <div>
              <h2>Todavía no tenés rutas</h2>
              <p className="muted">Una ruta es un curso de varias clases hacia algo que querés aprender, armado con cómo lo enseñan las universidades y los cursos conocidos. Pedísela al profesor: «quiero aprender Machine Learning, armame una ruta».</p>
              <button className="btn primary" onClick={() => onStudy("Quiero que me armes una ruta de aprendizaje.")}>
                Pedir una ruta
              </button>
            </div>
          </section>
        ) : (
          <ul className="rt-list" aria-label="Tus rutas">
            {routes.map((x) => {
              const cur = currentClass(x);
              const pct = x.total ? Math.round((100 * x.done) / x.total) : 0;
              return (
                <li key={x.id}>
                  <button className="card rt-list-item" onClick={() => setSelected(x.id)}>
                    <span className="rt-list-title">
                      <strong>{x.title}</strong>
                      <small>{x.done === x.total ? "Ruta completa" : cur ? `Clase ${cur.cls.number} de ${x.total}: ${cur.cls.title}` : ""}</small>
                    </span>
                    <span className="rt-bar" aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <small className="muted">
                      {x.done} de {x.total} clases{x.done < x.total ? ` · terminás el ${shortDate(endDate(x.minutes_left, x.hours_per_week, new Date()))}` : ""}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RouteDetail({ r, onStart, onDeleted }: { r: RouteView; onStart: (classId: string) => void; onDeleted: () => void }) {
  const cur = currentClass(r);
  const [open, setOpen] = useState<string | null>(cur ? r.units[cur.unitIndex].id : null);
  const [armed, setArmed] = useState(false);
  const pct = r.total ? (100 * r.done) / r.total : 0;
  const finished = r.done === r.total;
  const ends = endDate(r.minutes_left, r.hours_per_week, new Date());

  return (
    <>
      <section className="card rt-hero" aria-label="Dónde estás">
        <div>
          <span className="rt-kicker">{finished ? "Ruta completa" : cur ? `Vas por la clase ${cur.cls.number} de ${r.total}` : ""}</span>
          <h2>{finished ? r.title : cur?.cls.title}</h2>
          <p>{finished ? "Terminaste todas las clases. Lo que aprendiste quedó en tu grafo y en tus tarjetas." : `${r.goal} A ${r.hours_per_week} h por semana, terminás el ${shortDate(ends)}.`}</p>
          <div className="rt-bigbar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="rt-barlbl">
            <span>{r.done} hechas</span>
            {cur && <span>Unidad {cur.unitIndex + 1} de {r.units.length}</span>}
            <span>{r.total - r.done} por delante</span>
          </div>
        </div>
        {cur && (
          <div className="rt-next">
            <span className="rt-kicker">{cur.cls.session_id ? "Seguís con" : "Próxima clase"}</span>
            <h3>{cur.cls.title}</h3>
            <small>
              ~{duration(cur.cls.minutes)} · {cur.unit}
            </small>
            <button className="btn primary" onClick={() => onStart(cur.cls.id)}>
              {cur.cls.session_id ? "Seguir la clase" : "Empezar la clase"}
            </button>
          </div>
        )}
      </section>

      <div className="rt-stats">
        <div className="card">
          <strong>{r.done}</strong>
          <small>de {r.total} clases hechas</small>
        </div>
        <div className="card">
          <strong>{duration(r.minutes_left)}</strong>
          <small>por delante</small>
        </div>
        <div className="card">
          <strong>{finished ? "—" : weeksFor(r.minutes_left, r.hours_per_week)}</strong>
          <small>{weeksFor(r.minutes_left, r.hours_per_week) === 1 ? "semana" : "semanas"} a tu ritmo</small>
        </div>
      </div>

      {r.adjustments.length > 0 && (
        <section className="card rt-adapt" aria-label="La ruta se acomodó a vos">
          <span className="rt-kicker">La ruta se acomodó a vos</span>
          {r.adjustments.map((a, i) => (
            <p key={i}>
              <span className={`rt-tag is-${a.kind}`}>{a.kind === "refuerzo" ? "Refuerzo" : a.kind === "skip" ? "Salteada" : "Cambio"}</span>
              {a.text}
            </p>
          ))}
        </section>
      )}

      <section className="rt-units-detail" aria-label="Unidades">
        {r.units.map((u, i) => {
          const take = u.classes.filter((c) => c.state !== "known");
          const done = take.filter((c) => c.state === "done").length;
          const isOpen = open === u.id;
          const status = done === take.length ? "is-done" : u.classes.some((c) => c.state === "current") ? "is-now" : "is-later";
          return (
            <article key={u.id} className={`card rt-ublock ${status} ${isOpen ? "is-open" : ""}`} aria-label={u.title}>
              <button type="button" className="rt-uhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : u.id)}>
                <span className="rt-ring" style={{ "--pct": `${take.length ? (100 * done) / take.length : 100}%` } as React.CSSProperties} aria-hidden>
                  <span>{done === take.length ? "✓" : `${done}/${take.length}`}</span>
                </span>
                <span className="rt-utitle">
                  <strong>
                    Unidad {i + 1} · {u.title}
                  </strong>
                  <small>{u.classes.map((c) => c.title).join(" · ")}</small>
                </span>
                <span className="rt-ustate">{done === take.length ? "Completa" : status === "is-now" ? "En curso" : "Después"}</span>
              </button>
              {isOpen && (
                <ol className="rt-path" aria-label={`Clases de ${u.title}`}>
                  {u.classes.map((c, j) => (
                    <li key={c.id} className={`rt-step ${j % 4 === 1 ? "is-left" : j % 4 === 3 ? "is-right" : ""} is-${c.state}`}>
                      <span className={`rt-node is-${c.state} ${c.kind === "refuerzo" ? "is-ref" : ""}`} aria-hidden>
                        {c.state === "current" || c.state === "started" ? c.number : MARK[c.state]}
                      </span>
                      <span className="rt-step-text">
                        <strong>
                          {c.title}
                          {c.kind === "refuerzo" && <span className="rt-tag is-refuerzo">refuerzo</span>}
                        </strong>
                        <small>
                          {c.state === "known"
                            ? "Ya la sabías: la ruta la saltea"
                            : c.state === "done"
                              ? `Clase ${c.number} · hecha${c.done_at ? ` el ${new Date(c.done_at).toLocaleDateString("es-AR", { day: "numeric", month: "numeric" })}` : ""}`
                              : `Clase ${c.number} · ~${duration(c.minutes)}${c.topics.length ? ` · ${c.topics.slice(0, 3).join(", ")}` : ""}`}
                        </small>
                        {(c.state === "current" || c.state === "started") && (
                          <button className="btn small primary" onClick={() => onStart(c.id)} aria-label={`${c.session_id ? "Seguir" : "Empezar"}: ${c.title}`}>
                            {c.session_id ? "Seguir" : "Empezar"}
                          </button>
                        )}
                        {c.state === "done" && c.session_id && (
                          <button className="btn small ghost" onClick={() => onStart(c.id)} aria-label={`Volver a la clase: ${c.title}`}>
                            Volver a verla
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </section>

      {r.sources.length > 0 && (
        <section className="rt-sources-detail" aria-label="En qué se basa">
          <span className="rt-kicker">En qué se basa</span>
          <div>
            {r.sources.map((s) => (
              <a key={s.url} className="rt-src" href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ))}
          </div>
        </section>
      )}
      <div className="rt-danger">
        <button
          className={`btn small ${armed ? "danger" : "ghost"}`}
          onBlur={() => setArmed(false)}
          onClick={async () => {
            if (!armed) return setArmed(true);
            await routeApi.remove(r.id);
            onDeleted();
          }}
        >
          {armed ? "¿Seguro? Borrar la ruta (las clases quedan como sesiones)" : "Borrar la ruta"}
        </button>
      </div>
    </>
  );
}
