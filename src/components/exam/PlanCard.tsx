import { useEffect, useState } from "react";
import { studyApi } from "../../api";
import type { Exam, SessionSummary, StudyEntry } from "../../types";
import { localDate } from "../../lib/exam";
import { monday, studyPlan } from "../../lib/plan";
import { duration } from "../../lib/study";
import { usePomodoro } from "../pomodoro/PomodoroContext";

interface Props {
  exam: Exam;
  sessions: Map<string, SessionSummary>;
  onStudy: (topicId: string) => void;
}

const fmt = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** AC-52: the weeks until the exam date, what to study today and this week's time. */
export function PlanCard({ exam, sessions, onStudy }: Props) {
  const { logVersion } = usePomodoro();
  const [entries, setEntries] = useState<StudyEntry[]>([]);
  const today = localDate(new Date());

  useEffect(() => {
    studyApi.since(monday(today)).then(setEntries).catch(() => {});
  }, [logVersion, today]);

  const plan = studyPlan(exam, sessions, today, entries, new Date());
  if (!plan) {
    return (
      <section className="card" aria-label="Plan de estudio">
        <h2>Plan de estudio</h2>
        <p className="muted small">Cargá la fecha del {exam.kind === "subject" ? "parcial o final" : "examen"} en la Meta y armo un plan semana por semana hasta ese día.</p>
      </section>
    );
  }

  const week = plan.weeks[0];
  return (
    <section className="card" aria-label="Plan de estudio">
      <div className="row-between">
        <h2>Plan de estudio</h2>
        <span className="muted small">{plan.weeks.length === 1 ? "Última semana" : `${plan.weeks.length} semanas`}</span>
      </div>

      <div className="plan-today" data-testid="plan-today">
        <strong>Hoy:</strong>{" "}
        {plan.today ? (
          <>
            {plan.today.review ? "repasá" : plan.today.started ? "seguí con" : "estudiá"} <em>{plan.today.title}</em> <span className="muted">({plan.today.review ? `${plan.today.domain}: ${plan.today.review}` : plan.today.domain})</span>{" "}
            <button className="btn small" onClick={() => onStudy(plan.today!.topicId)}>
              {plan.today.review ? "Repasar" : plan.today.started ? "Continuar" : "Estudiar"}
            </button>
          </>
        ) : week.final ? (
          "semana final: simulacro completo con tiempo, repaso de falladas y la hoja de repaso."
        ) : (
          "no quedan temas pendientes esta semana: hacé un simulacro o repasá tus falladas."
        )}
      </div>

      {plan.replannedWith && (
        <p className="muted small" role="status" data-testid="plan-replanned">
          Reajustado con tu simulacro del {fmt(plan.replannedWith)}: los temas de los dominios que salieron flojos vuelven para repasar.
        </p>
      )}

      {plan.weekGoal != null && (
        <div className="plan-hours" data-testid="plan-hours">
          <span>
            Esta semana: {duration(plan.weekMinutes)} de {duration(plan.weekGoal)}
          </span>
          <span className="bar" aria-hidden>
            <span style={{ width: `${Math.min(100, (100 * plan.weekMinutes) / plan.weekGoal)}%` }} />
          </span>
        </div>
      )}

      <ol className="plan-weeks">
        {plan.weeks.map((w, i) => (
          <li key={w.from} className={i === 0 ? "is-current" : ""}>
            <span className="plan-dates">
              {i === 0 ? "Esta semana" : `${fmt(w.from)} – ${fmt(w.to)}`}
            </span>
            <span>
              {w.topics.map((t) => (t.review ? `${t.title} (repaso)` : t.title)).join(" · ")}
              {w.final && `${w.topics.length ? " · " : ""}Simulacros con tiempo, repaso y hoja de repaso`}
              {!w.topics.length && !w.final && <span className="muted">Repaso</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
