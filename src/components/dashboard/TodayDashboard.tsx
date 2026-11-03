import { useEffect, useState } from "react";
import { academicApi, activityApi, api } from "../../api";
import type { AcademicData, ActionScreen, ExamSummary } from "../../types";
import { addDays } from "../../lib/cards";
import { localDate } from "../../lib/exam";
import { dayOff, WEEKDAYS } from "../../lib/academic";
import { classesToday, countdowns, gradeText, gradesByCourse, nextClass, type Countdown } from "../../lib/dashboard";
import { streak, type DotState } from "../../lib/streak";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { Icon } from "../Icon";

interface Props {
  onOpenScreen: (s: ActionScreen) => void;
  onOpenExam?: (id: string) => void;
}

const DOT_LABEL: Record<DotState, string> = { done: "estudiaste", rest: "día libre", gap: "sin estudio", today: "hoy, todavía por hacer", future: "todavía no llegó", idle: "antes de empezar" };
/** Enough history for the best streak without reading years. */
const HISTORY_DAYS = 400;

/** AC-140: the home panel — the streak, today's classes, what's coming and the grades, at a glance. */
export function TodayDashboard({ onOpenScreen, onOpenExam }: Props) {
  const { logVersion } = usePomodoro();
  const now = new Date();
  const today = localDate(now);
  const [days, setDays] = useState<string[] | null>(null);
  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [exams, setExams] = useState<ExamSummary[]>([]);

  useEffect(() => {
    activityApi
      .days(addDays(today, -HISTORY_DAYS))
      .then((d) => setDays(d.map((x) => x.day)))
      .catch(() => setDays([]));
  }, [logVersion, today]);

  useEffect(() => {
    academicApi.state().then(setAcademic).catch(() => setAcademic(null));
    api.listExams().then(setExams).catch(() => setExams([]));
  }, []);

  if (!days) return null;
  const s = streak(days, today);
  const classes = classesToday(academic, today, now.getHours() * 60 + now.getMinutes());
  const upcoming = countdowns(academic, exams, today, now);
  const grades = gradesByCourse(academic);
  const hasTerm = !!academic?.active_term;
  const off = dayOff(academic, today);
  const later = classes.length ? null : nextClass(academic, today);
  const open = (c: Countdown) => (c.source === "exam" && onOpenExam ? onOpenExam(c.id) : onOpenScreen("academic"));

  return (
    <section className="dash" aria-label="Tu día">
      <article className="card dash-card dash-streak" aria-labelledby="dash-streak-h">
        <h2 id="dash-streak-h" className="dash-h">
          <span className={`dash-flame${s.activeToday ? " lit" : ""}`} aria-hidden>
            <Icon name="flame" size={18} />
          </span>
          Racha
        </h2>
        <p className="dash-big" data-testid="streak-current">
          <strong>{s.current}</strong> <span>{s.current === 1 ? "día" : "días"}</span>
        </p>
        <ol className="dash-week" aria-label="Esta semana">
          {s.week.map((d, i) => (
            <li key={d.day} className={`wk wk-${d.state}`} aria-label={`${WEEKDAYS[i]}: ${DOT_LABEL[d.state]}`}>
              <span className="wk-mark" aria-hidden />
              <span className="wk-letter" aria-hidden>
                {d.letter}
              </span>
            </li>
          ))}
        </ol>
        <p className="dash-msg" data-testid="streak-message">
          {s.message}
        </p>
        <p className="muted small">
          Mejor racha: {s.best} {s.best === 1 ? "día" : "días"} · un día libre por semana no la corta.
        </p>
      </article>

      <article className="card dash-card" aria-labelledby="dash-classes-h">
        <h2 id="dash-classes-h" className="dash-h">
          <Icon name="calendar" size={18} />
          Clases de hoy
        </h2>
        {classes.length > 0 ? (
          <ul className="dash-classes">
            {classes.map((c) => (
              <li key={`${c.start}-${c.course}`} className={`cc-${c.color % 8} when-${c.when}`}>
                <span className="dash-time">
                  {c.start}–{c.end}
                </span>
                <span className="dash-what">
                  <strong>{c.course}</strong>
                  <span className="muted small">{[c.kind, c.room].filter(Boolean).join(" · ")}</span>
                </span>
                {c.when === "now" && <span className="dash-badge now">Ahora</span>}
                {c.when === "next" && <span className="dash-badge">Sigue</span>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="dash-empty">
            <p>{off ? `Hoy no hay clases: ${off.name}.` : hasTerm ? "Hoy no tenés clases." : "Cargá tus materias y horarios para verlos acá."}</p>
            {later && <p className="muted small">Próxima: {later}</p>}
            {!hasTerm && (
              <button className="btn small" onClick={() => onOpenScreen("academic")}>
                Ir a Mi cursada
              </button>
            )}
          </div>
        )}
      </article>

      <article className="card dash-card" aria-labelledby="dash-dates-h">
        <h2 id="dash-dates-h" className="dash-h">
          <Icon name="target" size={18} />
          Lo que se viene
        </h2>
        {upcoming.length > 0 ? (
          <ul className="dash-dates">
            {upcoming.map((c) => (
              <li key={`${c.source}-${c.id}`}>
                <button className="dash-date" onClick={() => open(c)}>
                  <span className={`dash-count${c.days <= 3 ? " soon" : ""}`}>
                    {c.days === 0 ? (
                      <strong>Hoy</strong>
                    ) : (
                      <>
                        <strong>{c.days}</strong>
                        <span>{c.days === 1 ? "día" : "días"}</span>
                      </>
                    )}
                  </span>
                  <span className="dash-what">
                    <strong>{c.title}</strong>
                    <span className="muted small">{[c.kind, c.course].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dash-empty">
            <p>No hay fechas por delante.</p>
            <p className="muted small">Anotá parciales, entregas o la fecha de un examen y aparece la cuenta regresiva.</p>
          </div>
        )}
      </article>

      <article className="card dash-card" aria-labelledby="dash-grades-h">
        <h2 id="dash-grades-h" className="dash-h">
          <Icon name="cap" size={18} />
          Notas
        </h2>
        {grades.length > 0 ? (
          <ul className="dash-grades">
            {grades.map((g) => (
              <li key={g.course} className={`cc-${g.color % 8}`}>
                <span className="dash-what">
                  <strong>{g.course}</strong>
                  <span className="muted small">{g.grades.map((x) => `${x.title}: ${gradeText(x.grade)}`).join(" · ")}</span>
                </span>
                <span className="dash-avg" aria-label={`Promedio ${gradeText(g.average)}`}>
                  {gradeText(g.average)}
                </span>
                <span className="dash-bar" aria-hidden>
                  <span style={{ width: `${Math.min(100, g.average * 10)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dash-empty">
            <p>Todavía no hay notas.</p>
            <p className="muted small">Cuando marques un parcial como hecho y le pongas la nota, ves el promedio por materia.</p>
          </div>
        )}
      </article>
    </section>
  );
}
