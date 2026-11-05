import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorText, memoryApi } from "../api";
import { onPhone, thisDevice } from "../lib/platform";
import type { MemoryKind, MemoryObservation } from "../types";

export const MEMORY_GROUPS: { kind: MemoryKind; title: string; one: string }[] = [
  { kind: "le_cuesta", title: "Le cuesta", one: "Le cuesta" },
  { kind: "confusion", title: "Confusiones", one: "Confusión" },
  { kind: "pendiente", title: "Pendiente", one: "Pendiente" },
  { kind: "domina", title: "Ya lo domina", one: "Ya lo domina" },
  { kind: "preferencia", title: "Cómo aprendés mejor", one: "Cómo aprendo mejor" },
  { kind: "idea", title: "Ideas que entendiste", one: "Idea entendida" },
];

/** Long groups (ideas) show this many until «Ver todas». */
const FIRST = 8;

const day = (iso: string) => new Date(iso).toLocaleDateString();
const today = () => new Date().toISOString().slice(0, 10);

/**
 * AC-199/AC-200: «Lo que Eureka sabe de vos»: the student's memory by type,
 * with its evidence; every observation can be corrected (it becomes verified
 * and the background never overwrites it) or deleted, and the whole memory
 * exported as linked Markdown pages for Obsidian.
 */
export function MemorySection() {
  const [list, setList] = useState<MemoryObservation[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [exported, setExported] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    memoryApi.list().then(setList).catch(() => setList([]));
  }, []);
  if (!list) return null;

  const run = async (f: () => Promise<MemoryObservation[]>) => {
    setError(null);
    try {
      setList(await f());
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const exportOkf = async () => {
    setError(null);
    try {
      setExported(await memoryApi.exportOkf());
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="card memory-view" aria-label="Lo que Eureka sabe de vos">
      <div className="row-between">
        <h2>Lo que Eureka sabe de vos</h2>
        {list.length > 0 && (
          <span className="row">
            {!onPhone() && (
              <button className="btn ghost small" onClick={exportOkf} title="Páginas Markdown enlazadas, para abrir como bóveda en Obsidian">
                Exportar para Obsidian
              </button>
            )}
            <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={() => (armed ? (setArmed(false), run(memoryApi.forgetAll)) : setArmed(true))} onBlur={() => setArmed(false)}>
              {armed ? "¿Seguro? Olvidar todo" : "Olvidar todo"}
            </button>
          </span>
        )}
      </div>
      <p className="muted small">
        Lo que Eureka anotó de tus sesiones, prácticas y simulacros: qué te cuesta, qué ya dominás, tus confusiones y cómo aprendés mejor. El profesor lo usa para elegir por dónde empezar. Si algo no es así, corregilo: lo que corregís vos queda así y no se pisa. Queda solo en {thisDevice()}.
      </p>
      {exported && (
        <p className="muted small" role="status">
          Listo: <span className="path">{exported}</span>. Abrí esa carpeta en Obsidian como bóveda.{" "}
          <button className="link" onClick={() => revealItemInDir(exported).catch(() => {})}>
            Mostrar en la carpeta
          </button>
        </p>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="muted small">Todavía nada: se completa cuando terminás sesiones o practicás.</p>
      ) : (
        MEMORY_GROUPS.map((g) => {
          const items = list.filter((o) => o.kind === g.kind);
          if (items.length === 0) return null;
          const shown = open[g.kind] ? items : items.slice(0, FIRST);
          return (
            <div key={g.kind} className="memory-group">
              <h3>
                {g.title} <span className="muted small">({items.length})</span>
              </h3>
              <ul className="memory-list" aria-label={g.title}>
                {shown.map((o) =>
                  editing === o.id ? (
                    <li key={o.id}>
                      <MemoryEdit
                        o={o}
                        onCancel={() => setEditing(null)}
                        onSave={async (title, content, kind) => {
                          if (await run(() => memoryApi.edit(o.id, title, content, kind))) setEditing(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={o.id}>
                      <span>
                        <strong>{o.title}</strong>
                        {o.state === "reparada" && <span className="tag tag-check">reparada</span>}
                        {o.by_student ? <span className="tag tag-check">lo corregiste vos</span> : o.verified && <span className="tag tag-check">verificada</span>}
                        {o.conflict && <span className="tag tag-probe">se contradice con otra</span>}
                        {o.due && o.due <= today() && o.state === "activa" && <span className="tag tag-probe">para repasar</span>}
                        {o.content && o.content !== o.title && <p className="small">{o.content}</p>}
                        {o.evidence.length > 0 && (
                          <p className="small muted">
                            {o.evidence
                              .slice(0, 2)
                              .map((e) => `${e.label} · ${day(e.at)}`)
                              .join(" — ")}
                          </p>
                        )}
                      </span>
                      <span className="row memory-actions">
                        <button className="btn ghost small" onClick={() => setEditing(o.id)} aria-label={`Corregir: ${o.title}`}>
                          Corregir
                        </button>
                        <button className="btn ghost small" onClick={() => run(() => memoryApi.remove(o.id))} aria-label={`Borrar: ${o.title}`}>
                          Borrar
                        </button>
                      </span>
                    </li>
                  ),
                )}
              </ul>
              {items.length > FIRST && (
                <button className="link small" onClick={() => setOpen({ ...open, [g.kind]: !open[g.kind] })} aria-expanded={!!open[g.kind]}>
                  {open[g.kind] ? "Ver menos" : `Ver todas (${items.length})`}
                </button>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

function MemoryEdit({ o, onSave, onCancel }: { o: MemoryObservation; onSave: (title: string, content: string, kind: MemoryKind) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(o.title);
  const [content, setContent] = useState(o.content === o.title ? "" : o.content);
  const [kind, setKind] = useState<MemoryKind>(o.kind);
  const id = `mem-${o.id}`;
  return (
    <form
      className="memory-edit stack"
      aria-label={`Corregir: ${o.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(title, content, kind);
      }}
    >
      <label className="field" htmlFor={`${id}-kind`}>
        Qué es
        <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {MEMORY_GROUPS.map((g) => (
            <option key={g.kind} value={g.kind}>
              {g.one}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-title`}>
        Título
        <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
      </label>
      <label className="field" htmlFor={`${id}-content`}>
        Detalle
        <textarea id={`${id}-content`} value={content} onChange={(e) => setContent(e.target.value)} maxLength={600} rows={2} />
      </label>
      <span className="row">
        <button type="submit" className="btn small" disabled={!title.trim()}>
          Guardar
        </button>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Cancelar
        </button>
      </span>
    </form>
  );
}
