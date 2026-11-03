import { useState } from "react";
import { errorText } from "../../api";
import type { DateKind, ImportReport, Proposal } from "../../types";
import { DATE_KIND_LABEL, dateLabel, proposalCounts, reportText, slotText } from "../../lib/academic";

/**
 * AC-101: what the agent (or the importer) wants to save, shown in full, with
 * nothing saved until the person says so.
 */
export function ProposalPreview({ proposal, onSave, onDiscard, onOpen }: { proposal: Proposal; onSave: (p: Proposal) => Promise<ImportReport>; onDiscard?: () => void; onOpen?: () => void }) {
  // AC-165: courses and dates can be renamed, moved or taken out before saving.
  const [p, setP] = useState<Proposal>(proposal);
  const [editing, setEditing] = useState(false);
  const renameCourse = (i: number, name: string) => {
    const old = (p.courses ?? [])[i].name;
    setP({ ...p, courses: (p.courses ?? []).map((c, j) => (j === i ? { ...c, name } : c)), dates: (p.dates ?? []).map((d) => (d.course === old ? { ...d, course: name } : d)) });
  };
  const setDate = (i: number, patch: Partial<NonNullable<Proposal["dates"]>[number]>) => setP({ ...p, dates: (p.dates ?? []).map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  // Its dates go with it: they would bring the course back when saved.
  const removeCourse = (i: number) => {
    const name = (p.courses ?? [])[i].name;
    setP({ ...p, courses: (p.courses ?? []).filter((_, j) => j !== i), dates: (p.dates ?? []).filter((d) => d.course !== name) });
  };
  const removeDate = (i: number) => setP({ ...p, dates: (p.dates ?? []).filter((_, j) => j !== i) });
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved"; report: ImportReport } | { kind: "error"; message: string }>({ kind: "idle" });
  const courses = p.courses ?? [];
  const dates = p.dates ?? [];

  const save = async () => {
    setState({ kind: "saving" });
    try {
      setState({ kind: "saved", report: await onSave(p) });
    } catch (e) {
      setState({ kind: "error", message: errorText(e) });
    }
  };

  return (
    <section className="proposal" aria-label="Propuesta para Mi cursada">
      <p className="proposal-head">
        <strong>{proposalCounts(p)}</strong>
        {p.term?.name && <span className="muted"> · {p.term.name}</span>}
      </p>
      {courses.length > 0 && (
        <ul className="proposal-list" aria-label="Materias">
          {courses.map((c, i) => (
            <li key={i}>
              {editing ? <input value={c.name} onChange={(e) => renameCourse(i, e.target.value)} aria-label={`Nombre de la materia ${i + 1}`} /> : <strong>{c.name}</strong>}
              {c.professor && <span className="muted"> · prof. {c.professor}</span>}
              {(c.slots ?? []).length > 0 && <span className="proposal-slots">{(c.slots ?? []).map((s) => slotText({ weekday: s.weekday ?? 1, start: s.start ?? "", end: s.end ?? "", room: s.room ?? "", kind: s.kind ?? "teoria" }, c.room)).join("  ·  ")}</span>}
              {editing && (
                <button className="btn ghost small" onClick={() => removeCourse(i)} aria-label={`Sacar ${c.name}`}>
                  Sacar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {dates.length > 0 && (
        <ul className="proposal-list" aria-label="Fechas">
          {dates.map((d, i) => (
            <li key={i}>
              <span className="date-kind">{DATE_KIND_LABEL[d.kind as DateKind] ?? d.kind}</span>{" "}
              {editing ? <input value={d.title} onChange={(e) => setDate(i, { title: e.target.value })} aria-label={`Título de la fecha ${i + 1}`} /> : <strong>{d.title}</strong>}
              {d.course && <span className="muted"> · {d.course}</span>}
              {editing ? (
                <input type="date" value={d.date} onChange={(e) => setDate(i, { date: e.target.value })} aria-label={`Día de la fecha ${i + 1}`} />
              ) : (
                <span className="proposal-slots">
                  {dateLabel(d.date)}
                  {d.time ? ` · ${d.time}` : ""}
                </span>
              )}
              {editing && (
                <button className="btn ghost small" onClick={() => removeDate(i)} aria-label={`Sacar ${d.title}`}>
                  Sacar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.kind === "saved" ? (
        <div className="row">
          <span className="muted" role="status">
            Guardado en «{state.report.term}»: {reportText(state.report)}.
          </span>
          {onOpen && (
            <button className="btn small" onClick={onOpen}>
              Abrir Mi cursada
            </button>
          )}
        </div>
      ) : (
        <div className="row">
          <button className="btn ghost small" onClick={() => setEditing((e) => !e)} disabled={state.kind === "saving"} aria-pressed={editing}>
            {editing ? "Listo" : "Corregir"}
          </button>
          <button className="btn primary small" onClick={save} disabled={state.kind === "saving" || (!courses.length && !dates.length)}>
            {state.kind === "saving" ? "Guardando…" : "Guardar en Mi cursada"}
          </button>
          {onDiscard && (
            <button className="btn ghost small" onClick={onDiscard} disabled={state.kind === "saving"}>
              Descartar
            </button>
          )}
          <span className="muted small">Se guarda recién cuando lo confirmás.</span>
        </div>
      )}
      {state.kind === "error" && (
        <p className="error-text" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}
