import { useState } from "react";
import { api, errorText } from "../../api";
import type { Exam } from "../../types";
import { daysUntil, readyVerdict, scoreHistory } from "../../lib/exam";
import { ScoreTrend } from "./ScoreTrend";

interface Props {
  exam: Exam;
  onSaved: (e: Exam) => void;
}

const VERDICT_TEXT = { ready: "Listo para rendir", close: "Cerca", not: "Todavía no" } as const;

/** AC-42: the goal (passing mark, date, hours) and "¿Estoy listo?". */
export function GoalCard({ exam, onSaved }: Props) {
  const g = exam.goal;
  const [passing, setPassing] = useState(g.passing_pct?.toString() ?? "");
  const [date, setDate] = useState(g.exam_date ?? "");
  const [hours, setHours] = useState(g.hours_per_week?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.setExamGoal(exam.id, { passing_pct: num(passing), exam_date: date || null, hours_per_week: num(hours) }));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const points = scoreHistory(exam);
  const verdict = readyVerdict(exam, g.passing_pct);
  const days = g.exam_date ? daysUntil(g.exam_date, new Date()) : null;

  return (
    <section className="card" aria-label="Meta">
      <div className="row-between">
        <h2>Meta</h2>
        {days != null && (
          <span className="countdown" data-testid="countdown">
            {days > 1 ? `Faltan ${days} días` : days === 1 ? "Es mañana" : days === 0 ? "Es hoy" : "Ya pasó la fecha"}
          </span>
        )}
      </div>
      <div className="goal-form">
        <label>
          Nota para aprobar (%)
          <input inputMode="decimal" value={passing} onChange={(e) => setPassing(e.target.value)} placeholder="70" aria-label="Nota para aprobar" />
        </label>
        <label>
          Fecha del examen
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha del examen" />
        </label>
        <label>
          Horas por semana
          <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6" aria-label="Horas de estudio por semana" />
        </label>
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? "Guardando…" : "Guardar meta"}
        </button>
      </div>
      <p className="muted small">
        Muchos exámenes usan puntaje escalado (AWS pide 700 de 1000): el porcentaje es una aproximación.
        {saved && " Meta guardada."}
      </p>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {verdict.kind !== "unknown" ? (
        <div className={`verdict-box verdict-${verdict.kind}`} data-testid="ready">
          <strong>¿Estoy listo? {VERDICT_TEXT[verdict.kind]}.</strong>{" "}
          {verdict.kind === "ready"
            ? `Promediás ${Math.round(verdict.avg)}% en los últimos simulacros, arriba del ${g.passing_pct}% que pide el examen.`
            : `Promediás ${Math.round(verdict.avg)}% en los últimos simulacros: te faltan ${Math.max(1, Math.round(verdict.gap + 5))} puntos para aprobar con margen (5 puntos arriba de la nota).`}
          {verdict.weak.length > 0 && ` Dominios por debajo de la nota: ${verdict.weak.map((d) => d.name).join(", ")}.`}
        </div>
      ) : (
        <p className="muted small">{points.length ? "Cargá la nota para aprobar para saber si estás listo." : "Hacé un simulacro para ver tu evolución."}</p>
      )}
      {points.length > 0 && <ScoreTrend points={points} passing={g.passing_pct} />}
    </section>
  );
}
