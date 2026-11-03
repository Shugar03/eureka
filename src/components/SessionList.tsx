import { useState } from "react";
import { api, errorText } from "../api";
import type { SessionSummary } from "../types";
import { PHASES } from "../lib/transcript";

/**
 * AC-107: the sessions on Home, managed. Pin, rename, archive (hidden, still
 * remembered), delete. Deleting keeps what was learned unless the person asks
 * to forget it too.
 */
export function SessionList({ sessions, onOpen, onChanged }: { sessions: SessionSummary[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string; forget: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archived = sessions.filter((s) => s.archived);
  const shown = showArchived ? archived : sessions.filter((s) => !s.archived);

  const act = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const meta = (id: string, m: { title?: string; pinned?: boolean; archived?: boolean }) => act(() => api.updateSessionMeta(id, m));
  const rename = () => {
    if (!renaming) return;
    const { id, title } = renaming;
    setRenaming(null);
    if (title.trim()) void meta(id, { title });
  };
  const remove = () => {
    if (!deleting) return;
    const { id, forget } = deleting;
    setDeleting(null);
    void act(() => api.deleteSession(id, forget));
  };

  if (!sessions.length) return null;
  return (
    <section className="sessions" aria-label="Sesiones">
      <div className="row-between">
        <h2>{showArchived ? "Archivadas" : "Sesiones"}</h2>
        {(archived.length > 0 || showArchived) && (
          <button className="btn ghost small" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
            {showArchived ? "Volver a sesiones" : `Archivadas (${archived.length})`}
          </button>
        )}
      </div>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="muted small">{showArchived ? "No hay sesiones archivadas." : "Todas tus sesiones están archivadas."}</p>
      ) : (
        <ul>
          {shown.map((s) => (
            <li key={s.id} className="session-row">
              {renaming?.id === s.id ? (
                <form
                  className="session-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <input
                    aria-label={`Nuevo nombre de ${s.title}`}
                    value={renaming.title}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                  />
                  <button className="btn small primary" type="submit" disabled={!renaming.title.trim()}>
                    Guardar
                  </button>
                  <button className="btn small ghost" type="button" onClick={() => setRenaming(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <button className="session-open" onClick={() => onOpen(s.id)}>
                  <span className="session-title">
                    {s.pinned && (
                      <span className="pin-mark" aria-label="Fijada" title="Fijada">
                        ●{" "}
                      </span>
                    )}
                    {s.title}
                  </span>
                  <span className="session-meta">
                    <span className={`pill phase-${s.phase}`}>{PHASES.find((p) => p.id === s.phase)?.label}</span>
                    {s.plan_total > 0 && (
                      <span className="progress" aria-hidden>
                        <span style={{ width: `${(100 * s.plan_done) / s.plan_total}%` }} />
                      </span>
                    )}
                    {s.plan_total > 0 && ` ${s.plan_done}/${s.plan_total} pasos`}
                    <span className="dim"> · {new Date(s.updated_at).toLocaleDateString()}</span>
                  </span>
                </button>
              )}
              {renaming?.id !== s.id && (
                <span className="session-actions">
                  {!s.archived && (
                    <button className="btn ghost small" onClick={() => meta(s.id, { pinned: !s.pinned })} aria-label={`${s.pinned ? "Desfijar" : "Fijar"} ${s.title}`}>
                      {s.pinned ? "Desfijar" : "Fijar"}
                    </button>
                  )}
                  <button className="btn ghost small" onClick={() => setRenaming({ id: s.id, title: s.title })} aria-label={`Renombrar ${s.title}`}>
                    Renombrar
                  </button>
                  <button className="btn ghost small" onClick={() => meta(s.id, { archived: !s.archived })} aria-label={`${s.archived ? "Desarchivar" : "Archivar"} ${s.title}`}>
                    {s.archived ? "Desarchivar" : "Archivar"}
                  </button>
                  <button className="btn ghost small" onClick={() => setDeleting({ id: s.id, title: s.title, forget: false })} aria-label={`Borrar ${s.title}`}>
                    Borrar
                  </button>
                </span>
              )}
              {deleting?.id === s.id && (
                <div className="session-delete" role="group" aria-label={`Confirmar borrar ${s.title}`}>
                  <p className="small">Se borra la conversación. Lo que aprendiste en ella sigue en tu memoria y en el grafo.</p>
                  <label className="check small">
                    <input type="checkbox" checked={deleting.forget} onChange={(e) => setDeleting({ ...deleting, forget: e.target.checked })} />
                    <span>Olvidar también lo que aprendí en esta sesión</span>
                  </label>
                  <span className="row">
                    <button className="btn small danger" onClick={remove}>
                      Borrar
                    </button>
                    <button className="btn small ghost" onClick={() => setDeleting(null)}>
                      Cancelar
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
