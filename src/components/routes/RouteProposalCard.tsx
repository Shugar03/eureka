import { useEffect, useState } from "react";
import { errorText, routeApi } from "../../api";
import type { RouteProposal, RouteView } from "../../types";
import { duration, endDate, proposalSize, sameRoute, shortDate, weeksFor } from "../../lib/routes";

const PACES = [2, 4, 6, 8];

/**
 * AC-214: the route the teacher proposed, researched and planned by the app.
 * Nothing is created until «Crear la ruta»: classes and whole units can be
 * taken out, a class marked as already known (or not), and the pace changed.
 */
export function RouteProposalCard({ proposal, onOpenRoute, onOpenSession }: { proposal: RouteProposal; onOpenRoute: (id: string) => void; onOpenSession: (id: string) => void }) {
  const [p, setP] = useState<RouteProposal>(proposal);
  const [created, setCreated] = useState<RouteView | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // A reloaded conversation must not offer to create the same route twice.
  useEffect(() => {
    routeApi
      .list()
      .then((all) => setExisting(all.find((r) => sameRoute(r.title, proposal.title))?.id ?? null))
      .catch(() => {});
  }, [proposal.title]);

  const size = proposalSize(p);
  const ends = endDate(size.minutes, p.hours_per_week, new Date());
  const units = p.units.filter((u) => u.classes.length > 0);

  const removeClass = (unitId: string, classId: string) =>
    setP({ ...p, units: p.units.map((u) => (u.id === unitId ? { ...u, classes: u.classes.filter((c) => c.id !== classId) } : u)).filter((u) => u.classes.length > 0) });
  const removeUnit = (unitId: string) => setP({ ...p, units: p.units.filter((u) => u.id !== unitId) });
  const toggleKnown = (unitId: string, classId: string) =>
    setP({ ...p, units: p.units.map((u) => (u.id === unitId ? { ...u, classes: u.classes.map((c) => (c.id === classId ? { ...c, known: !c.known } : c)) } : u)) });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await routeApi.create(p));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (created || existing) {
    const id = created?.id ?? existing!;
    return (
      <section className="rt-offer is-made" aria-label={`Ruta ${p.title}`}>
        {error && (
          <p className="error-text small" role="alert">
            {error}
          </p>
        )}
        <div className="rt-made">
          <span className="rt-made-mark" aria-hidden>
            ✓
          </span>
          <div>
            <strong>{created ? "Tu ruta está lista" : "Esta ruta ya la creaste"}</strong>
            <span className="muted small">{p.title}</span>
          </div>
          {created?.current ? (
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  onOpenSession((await routeApi.startClass(created.id, created.current!)).id);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Empezar la clase 1
            </button>
          ) : null}
          <button className={`btn ${created?.current ? "ghost" : "primary"}`} onClick={() => onOpenRoute(id)}>
            {created ? "Ver mi ruta" : "Abrir la ruta"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rt-offer" aria-label={`Ruta propuesta: ${p.title}`}>
      <header className="rt-head">
        <span className="rt-kicker">Ruta propuesta</span>
        <h3>{p.title}</h3>
        <p>{p.goal}</p>
        <div className="rt-facts">
          <span>
            <strong>{size.classes}</strong> clases
          </span>
          <span>
            <strong>{duration(size.minutes)}</strong> en total
          </span>
          <span>
            <strong>{weeksFor(size.minutes, p.hours_per_week)}</strong> {weeksFor(size.minutes, p.hours_per_week) === 1 ? "semana" : "semanas"} <small>a {p.hours_per_week} h por semana</small>
          </span>
          <span>
            <strong>{shortDate(ends)}</strong> terminás
          </span>
        </div>
      </header>
      <div className="rt-sources">
        {p.researched && p.sources.length > 0 ? (
          <>
            <span>Basada en:</span>
            {p.sources.map((s) => (
              <a key={s.url} className="rt-src" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                {s.title}
              </a>
            ))}
          </>
        ) : (
          <span>Armada con lo que sabe el profesor: no hubo búsqueda web{p.researched ? " útil" : " (configurala en Ajustes → Búsqueda web)"}.</span>
        )}
        {p.note && <p className="rt-note">{p.note}</p>}
      </div>
      <ol className="rt-units">
        {units.map((u, i) => {
          const known = u.classes.filter((c) => c.known).length;
          const mins = u.classes.filter((c) => !c.known).reduce((n, c) => n + c.minutes, 0);
          const isOpen = open === u.id;
          return (
            <li key={u.id} className="rt-unit">
              <div className="rt-unit-row">
                <span className="rt-unum" aria-hidden>
                  {i + 1}
                </span>
                <button type="button" className="rt-unit-main" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : u.id)}>
                  <strong>{u.title}</strong>
                  <span className="rt-cls">{u.classes.map((c) => c.title).join(" · ")}</span>
                </button>
                {known > 0 && <span className="rt-known">{known === 1 ? "1 ya la sabés" : `${known} ya las sabés`}</span>}
                <span className="rt-hrs">
                  {u.classes.length - known} {u.classes.length - known === 1 ? "clase" : "clases"} · {duration(mins)}
                </span>
                <button type="button" className="rt-x" aria-label={`Sacar la unidad ${u.title}`} onClick={() => removeUnit(u.id)}>
                  ×
                </button>
              </div>
              {isOpen && (
                <ul className="rt-classes">
                  {u.classes.map((c) => (
                    <li key={c.id} className={c.known ? "is-known" : ""}>
                      <span className="rt-class-main">
                        <strong>{c.title}</strong>
                        {c.topics.length > 0 && <small>{c.topics.join(" · ")}</small>}
                      </span>
                      <span className="rt-min">{duration(c.minutes)}</span>
                      <button type="button" className="btn ghost small" onClick={() => toggleKnown(u.id, c.id)} aria-pressed={c.known}>
                        {c.known ? "La quiero ver" : "Ya la sé"}
                      </button>
                      <button type="button" className="rt-x" aria-label={`Sacar la clase ${c.title}`} onClick={() => removeClass(u.id, c.id)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="rt-foot">
        <div className="rt-pace" role="radiogroup" aria-label="Horas por semana">
          <span>Ritmo:</span>
          {PACES.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={p.hours_per_week === h} className={`rt-pace-btn ${p.hours_per_week === h ? "is-on" : ""}`} onClick={() => setP({ ...p, hours_per_week: h })}>
              {h} h
            </button>
          ))}
          <span className="muted small">por semana</span>
        </div>
        <button className="btn primary" onClick={create} disabled={busy || size.classes === 0}>
          {busy ? "Creando…" : "Crear la ruta"}
        </button>
      </footer>
    </section>
  );
}
