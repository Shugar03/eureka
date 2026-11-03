import { useState } from "react";
import type { ClassSlot, Course, CourseInput, DateInput, DateItem, DateKind, SlotKind, Term, TermInput, TermKind } from "../../types";
import { DATE_KIND_LABEL, PALETTE, SLOT_KIND_LABEL, TERM_KIND_LABEL, WEEKDAYS } from "../../lib/academic";

const kinds = <K extends string>(labels: Record<K, string>) => Object.entries(labels) as [K, string][];

function Buttons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="row-end">
      <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
        Cancelar
      </button>
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Guardando…" : label}
      </button>
    </div>
  );
}

/** AC-99: a term (cuatrimestre, trimestre…). */
export function TermForm({ term, suggestion, busy, onSave, onCancel }: { term?: Term; suggestion: { name: string; kind: TermKind }; busy: boolean; onSave: (i: TermInput) => void; onCancel: () => void }) {
  const [name, setName] = useState(term?.name ?? suggestion.name);
  const [kind, setKind] = useState<TermKind>(term?.kind ?? suggestion.kind);
  const [start, setStart] = useState(term?.start ?? "");
  const [end, setEnd] = useState(term?.end ?? "");
  return (
    <form
      className="card draft"
      aria-label={term ? "Editar período" : "Nuevo período"}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ id: term?.id, name, kind, start: start || null, end: end || null });
      }}
    >
      <h2>{term ? "Editar período" : "Nuevo período"}</h2>
      <div className="id-grid">
        <label className="field">
          <span>Nombre</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Nombre del período" required />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TermKind)} aria-label="Tipo de período">
            {kinds(TERM_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Empieza (opcional)</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Inicio del período" />
        </label>
        <label className="field">
          <span>Termina (opcional)</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Fin del período" />
        </label>
      </div>
      <Buttons busy={busy} label="Guardar período" onCancel={onCancel} />
    </form>
  );
}

const blankSlot = (): ClassSlot => ({ weekday: 1, start: "08:00", end: "10:00", room: "", kind: "teoria" });

/** AC-99: a course, with its weekly slots (day, time, room). */
export function CourseForm({ course, termId, busy, onSave, onCancel }: { course?: Course; termId: string; busy: boolean; onSave: (i: CourseInput) => void; onCancel: () => void }) {
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [professor, setProfessor] = useState(course?.professor ?? "");
  const [room, setRoom] = useState(course?.room ?? "");
  const [notes, setNotes] = useState(course?.notes ?? "");
  const [color, setColor] = useState<number | null>(course?.color ?? null);
  const [slots, setSlots] = useState<ClassSlot[]>(course?.slots ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const patch = (i: number, p: Partial<ClassSlot>) => setSlots((cur) => cur.map((s, j) => (j === i ? { ...s, ...p } : s)));

  return (
    <form
      className="card draft"
      aria-label={course ? "Editar materia" : "Agregar materia"}
      onSubmit={(e) => {
        e.preventDefault();
        // Said here, next to the field, instead of waiting for the backend to refuse it.
        const bad = slots.findIndex((s) => !s.start || !s.end || s.end <= s.start);
        if (bad >= 0) return setProblem(!slots[bad].start || !slots[bad].end ? `Completá la hora del horario ${bad + 1}.` : `El horario ${bad + 1} tiene que terminar después de empezar.`);
        setProblem(null);
        onSave({ id: course?.id, term_id: termId, name, code, professor, room, notes, color, slots });
      }}
    >
      <h2>{course ? "Editar materia" : "Agregar materia"}</h2>
      <div className="id-grid">
        <label className="field">
          <span>Materia</span>
          <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label="Nombre de la materia" required />
        </label>
        <label className="field">
          <span>Código (opcional)</span>
          <input value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} aria-label="Código de la materia" />
        </label>
        <label className="field">
          <span>Profesor/a (opcional)</span>
          <input value={professor} maxLength={100} onChange={(e) => setProfessor(e.target.value)} aria-label="Profesor o profesora" />
        </label>
        <label className="field">
          <span>Aula habitual (opcional)</span>
          <input value={room} maxLength={60} onChange={(e) => setRoom(e.target.value)} aria-label="Aula habitual" />
        </label>
      </div>

      <fieldset className="slots">
        <legend>Días y horarios</legend>
        {slots.length === 0 && <p className="muted small">Todavía no cargaste ningún horario.</p>}
        {slots.map((s, i) => (
          <div key={i} className="slot-row" role="group" aria-label={`Horario ${i + 1}`}>
            <select value={s.weekday} onChange={(e) => patch(i, { weekday: Number(e.target.value) })} aria-label={`Día ${i + 1}`}>
              {WEEKDAYS.map((d, k) => (
                <option key={d} value={k + 1}>
                  {d}
                </option>
              ))}
            </select>
            <input type="time" value={s.start} onChange={(e) => patch(i, { start: e.target.value })} aria-label={`Desde ${i + 1}`} />
            <input type="time" value={s.end} onChange={(e) => patch(i, { end: e.target.value })} aria-label={`Hasta ${i + 1}`} />
            <input value={s.room} placeholder="Aula" maxLength={60} onChange={(e) => patch(i, { room: e.target.value })} aria-label={`Aula ${i + 1}`} />
            <select value={s.kind} onChange={(e) => patch(i, { kind: e.target.value as SlotKind })} aria-label={`Tipo ${i + 1}`}>
              {kinds(SLOT_KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <button type="button" className="btn ghost small" onClick={() => setSlots((cur) => cur.filter((_, j) => j !== i))} aria-label={`Quitar horario ${i + 1}`}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => setSlots((cur) => [...cur, blankSlot()])}>
          + Agregar horario
        </button>
        {problem && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}
      </fieldset>

      <label className="field">
        <span>Notas (opcional)</span>
        <textarea value={notes} rows={2} maxLength={500} onChange={(e) => setNotes(e.target.value)} aria-label="Notas de la materia" placeholder="Bibliografía, cómo se aprueba, lo que quieras recordar" />
      </label>
      <div className="field">
        <span>Color en la grilla</span>
        <div className="swatches" role="radiogroup" aria-label="Color de la materia">
          {Array.from({ length: PALETTE }, (_, i) => (
            <button key={i} type="button" role="radio" aria-checked={color === i} aria-label={`Color ${i + 1}`} className={`swatch cc-${i} ${color === i ? "is-selected" : ""}`} onClick={() => setColor(i)} />
          ))}
        </div>
      </div>
      <Buttons busy={busy} label="Guardar materia" onCancel={onCancel} />
    </form>
  );
}

/** AC-100: a date that matters — a parcial, a TP, a final. */
export function DateForm({ item, termId, courses, busy, onSave, onCancel }: { item?: DateItem; termId: string; courses: Course[]; busy: boolean; onSave: (i: DateInput) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<DateKind>(item?.kind ?? "parcial");
  const [title, setTitle] = useState(item?.title ?? "");
  const [courseId, setCourseId] = useState(item?.course_id ?? "");
  const [date, setDate] = useState(item?.date ?? "");
  const [time, setTime] = useState(item?.time ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [done, setDone] = useState(item?.done ?? false);
  const [grade, setGrade] = useState(item?.grade != null ? String(item.grade) : "");
  return (
    <form
      className="card draft"
      aria-label={item ? "Editar fecha" : "Agregar fecha"}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ id: item?.id, term_id: termId, course_id: courseId || null, kind, title, date, time: time || null, notes, done, grade: grade.trim() === "" ? null : Number(grade) });
      }}
    >
      <h2>{item ? "Editar fecha" : "Agregar fecha"}</h2>
      <div className="id-grid">
        <label className="field">
          <span>Qué es</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as DateKind)} aria-label="Tipo de fecha">
            {kinds(DATE_KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Título</span>
          <input value={title} maxLength={120} placeholder="Primer parcial" onChange={(e) => setTitle(e.target.value)} aria-label="Título de la fecha" required />
        </label>
        <label className="field">
          <span>Materia</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Materia de la fecha">
            <option value="">Sin materia</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fecha</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" required />
        </label>
        <label className="field">
          <span>Hora (opcional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Hora de la fecha" />
        </label>
        {item && (
          <label className="field">
            <span>Nota obtenida (opcional)</span>
            <input type="number" min={0} max={100} step="0.01" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Nota obtenida" />
          </label>
        )}
      </div>
      <label className="field">
        <span>Notas (opcional)</span>
        <textarea value={notes} rows={2} maxLength={500} onChange={(e) => setNotes(e.target.value)} aria-label="Notas de la fecha" placeholder="Temas, aula, qué llevar…" />
      </label>
      {item && (
        <label className="check">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} aria-label="Ya está hecho" /> Ya está hecho
        </label>
      )}
      <Buttons busy={busy} label="Guardar fecha" onCancel={onCancel} />
    </form>
  );
}
