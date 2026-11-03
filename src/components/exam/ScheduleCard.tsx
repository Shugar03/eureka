import { useState } from "react";
import { api, errorText } from "../../api";
import type { Exam, Slot } from "../../types";
import { WEEKDAYS } from "../../lib/plan";

interface Props {
  exam: Exam;
  onSaved: (e: Exam) => void;
}

const KIND_LABEL = { class: "Clase", study: "Estudio" } as const;

/** AC-51: weekly classes and study blocks of an exam or subject. */
export function ScheduleCard({ exam, onSaved }: Props) {
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [kind, setKind] = useState<Slot["kind"]>(exam.kind === "subject" ? "class" : "study");
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (slots: Slot[]) => {
    setError(null);
    try {
      onSaved(await api.setExamSchedule(exam.id, slots));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  const add = async () => {
    if (await save([...exam.schedule, { weekday, start, end, kind, place }])) setPlace("");
  };

  return (
    <section className="card" aria-label="Horario">
      <h2>Horario</h2>
      <p className="muted small">
        {exam.kind === "subject" ? "Tus clases y los bloques de estudio de la materia." : "Los bloques de la semana que le dedicás a este examen."} Aparecen en la Agenda.
      </p>
      {exam.schedule.length > 0 && (
        <ul className="slot-list" aria-label="Horarios">
          {exam.schedule.map((s, i) => (
            <li key={`${s.weekday}-${s.start}-${i}`}>
              <span className={`slot-kind slot-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span>
                {WEEKDAYS[s.weekday - 1]} {s.start}–{s.end}
              </span>
              <span className="muted">{s.place}</span>
              <button className="btn ghost small" onClick={() => save(exam.schedule.filter((_, j) => j !== i))} aria-label={`Quitar ${WEEKDAYS[s.weekday - 1]} ${s.start}`}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="slot-form">
        <select value={kind} onChange={(e) => setKind(e.target.value as Slot["kind"])} aria-label="Tipo de horario">
          <option value="class">Clase</option>
          <option value="study">Estudio</option>
        </select>
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label="Día">
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Desde" />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Hasta" />
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Lugar (opcional)" aria-label="Lugar" />
        <button className="btn" onClick={add}>
          Agregar
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
