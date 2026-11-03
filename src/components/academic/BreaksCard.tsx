import { useState } from "react";
import type { BreakInput, Term, TermBreak } from "../../types";
import { dateLabel } from "../../lib/academic";
import { addDays } from "../../lib/cards";
import { holidaysBetween } from "../../lib/holidays";

interface Props {
  term: Term;
  today: string;
  busy: boolean;
  onAdd: (items: BreakInput[]) => Promise<boolean>;
  onDelete: (id: string) => void;
}

const span = (b: TermBreak) => (b.start === b.end ? dateLabel(b.start) : `del ${dateLabel(b.start)} al ${dateLabel(b.end)}`);

/** AC-145: holidays and weeks without classes, so the panel, the agenda and the calendar skip them. */
export function BreaksCard({ term, today, busy, onAdd, onDelete }: Props) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const breaks = term.breaks ?? [];
  const coming = breaks.filter((b) => b.end >= today);
  const past = breaks.filter((b) => b.end < today);

  const add = async () => {
    setNote(null);
    if (await onAdd([{ start, end: end || null, name }])) [setStart, setEnd, setName].forEach((f) => f(""));
  };
  const national = async () => {
    const from = term.start && term.start > today ? term.start : today;
    const to = term.end && term.end >= from ? term.end : addDays(from, 365);
    const found = holidaysBetween(from, to).filter((h) => !breaks.some((b) => b.start === h.date && b.end === h.date));
    if (!found.length) return setNote("Ya están todos los feriados nacionales de este período.");
    if (await onAdd(found.map((h) => ({ start: h.date, end: null, name: h.name })))) setNote(`Sumé ${found.length} ${found.length === 1 ? "feriado nacional" : "feriados nacionales"}.`);
  };

  const row = (b: TermBreak) => (
    <li key={b.id} className="break-row">
      <span className="date-main">
        <strong>{b.name}</strong>
        <span className="muted small">{span(b)}</span>
      </span>
      <button className="btn ghost small" onClick={() => onDelete(b.id)} aria-label={`Borrar ${b.name}`} disabled={busy}>
        Borrar
      </button>
    </li>
  );

  return (
    <section className="card" aria-label="Feriados y días sin clases">
      <div className="row-between">
        <h2>Feriados y días sin clases</h2>
        <button className="btn small" onClick={national} disabled={busy}>
          Sumar feriados nacionales
        </button>
      </div>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
      {coming.length ? <ul className="date-list">{coming.map(row)}</ul> : <p className="muted small">Ninguno por delante. Esos días no aparecen clases en el inicio, la agenda ni el calendario que exportás.</p>}
      {past.length > 0 && (
        <details className="date-done">
          <summary>Pasados ({past.length})</summary>
          <ul className="date-list">{past.map(row)}</ul>
        </details>
      )}
      <div className="break-form" role="group" aria-label="Agregar días sin clases">
        <label className="field">
          <span>Desde</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Sin clases desde" />
        </label>
        <label className="field">
          <span>Hasta (opcional)</span>
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} aria-label="Sin clases hasta" />
        </label>
        <label className="field">
          <span>Motivo</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Motivo" placeholder="Semana de parciales, receso…" />
        </label>
        <button className="btn small" onClick={add} disabled={busy || !start}>
          Agregar
        </button>
      </div>
      <p className="muted small">Los feriados nacionales se calculan con la Ley 27.399, para cualquier año. Los días puente los fija el Gobierno cada año: si tu facultad no tiene clases, sumalos a mano.</p>
    </section>
  );
}
