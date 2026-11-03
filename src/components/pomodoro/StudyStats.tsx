import { useEffect, useState } from "react";
import { studyApi } from "../../api";
import type { StudyEntry } from "../../types";
import { addDays } from "../../lib/cards";
import { localDate } from "../../lib/exam";
import { duration, minutesByContext, minutesByDay, weekday } from "../../lib/study";
import { usePomodoro } from "./PomodoroContext";

/** AC-49: minutes studied today, in the last 7 days and per subject. */
export function StudyStats() {
  const { logVersion } = usePomodoro();
  const [entries, setEntries] = useState<StudyEntry[] | null>(null);
  const today = localDate(new Date());

  useEffect(() => {
    studyApi.since(addDays(today, -6)).then(setEntries).catch(() => setEntries([]));
  }, [logVersion, today]);

  if (!entries) return null;
  const week = minutesByDay(entries, today);
  const max = Math.max(1, ...week.map((d) => d.minutes));
  const total = week.reduce((s, d) => s + d.minutes, 0);
  const top = minutesByContext(entries).slice(0, 4);

  return (
    <section className="card study-stats" aria-label="Tiempo de estudio">
      <div className="row-between">
        <h2>Tiempo de estudio</h2>
        <span className="muted small" data-testid="study-today">
          Hoy: {duration(week[week.length - 1].minutes)} · 7 días: {duration(total)}
        </span>
      </div>
      {total === 0 ? (
        <p className="muted small">Usá el pomodoro de la barra lateral: cada bloque de foco que termines se anota acá.</p>
      ) : (
        <div className="study-week">
          <ul className="week-bars" aria-label="Minutos por día, últimos 7 días">
            {week.map((d) => (
              <li key={d.day} title={`${d.day}: ${duration(d.minutes)}`}>
                <span className="week-bar" aria-hidden>
                  <span style={{ height: `${(100 * d.minutes) / max}%` }} />
                </span>
                <span className="week-day">
                  {weekday(d.day)}
                  <span className="sr-only">: {duration(d.minutes)}</span>
                </span>
              </li>
            ))}
          </ul>
          <ul className="study-top" aria-label="Por tema">
            {top.map((c) => (
              <li key={c.title}>
                <span>{c.title}</span>
                <span className="muted">{duration(c.minutes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
