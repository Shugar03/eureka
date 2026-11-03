import { useEffect, useState } from "react";
import { api, cardsApi, errorText } from "../../api";
import type { Exam, ExamDomain, MockFocus, SessionSummary } from "../../types";
import { byWeight, clock, domainReadiness, examReadiness, failedTopicIds, latestResult, localDate, pct, suggestedMinutes, topicLabel, topicState, weakestDomain } from "../../lib/exam";
import { CheatSheetCard } from "./CheatSheetCard";
import { GoalCard } from "./GoalCard";
import { PlanCard } from "./PlanCard";
import { ScheduleCard } from "./ScheduleCard";
import { useStudyContext } from "../pomodoro/PomodoroContext";
import { MockRunner } from "./MockRunner";
import type { CodeSeed } from "../code/CodeScreen";
import { ReviewRunner } from "./ReviewRunner";

const COUNTS = [10, 20, 30];

export interface ViewProps {
  id: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
  onChanged: () => void;
  onOpenDeck: (id: string) => void;
  onOpenCode: (seed: CodeSeed) => void;
}

export function ExamView({ id, onBack, onOpenSession, onChanged, onOpenDeck, onOpenCode }: ViewProps) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [sessions, setSessions] = useState<Map<string, SessionSummary>>(new Map());
  const [mockId, setMockId] = useState<string | null>(null);
  const [count, setCount] = useState(10);
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState(suggestedMinutes(10));
  const [reviewing, setReviewing] = useState(false);
  const [scope, setScope] = useState<"all" | "weak" | "failed" | "pick">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useStudyContext(exam ? { kind: "exam", id: exam.id, title: exam.name } : null);

  useEffect(() => {
    api.getExam(id).then(setExam).catch((e) => setError(errorText(e)));
    api
      .listSessions()
      .then((l) => setSessions(new Map(l.map((s) => [s.id, s]))))
      .catch(() => {});
  }, [id]);

  if (!exam) return <div className="center muted">{error ?? "Cargando…"}</div>;

  const study = async (topicId: string) => {
    setError(null);
    try {
      const s = await api.studyTopic(exam.id, topicId);
      onChanged();
      onOpenSession(s.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const makeCards = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await cardsApi.generateDeck(exam.name, { kind: "exam", id: exam.id }, 20, localDate(new Date()));
      onOpenDeck(d.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await api.createMock(exam.id, count, timed ? minutes : null, focusFor(scope));
      setExam(e);
      setMockId(e.mocks[e.mocks.length - 1].id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const weak = (() => {
    const r = latestResult(exam);
    return r ? weakestDomain(exam, r) : null;
  })();
  const failedTopics = failedTopicIds(exam);
  const focusFor = (s: typeof scope): MockFocus | null => {
    if (s === "weak" && weak) return { domain_ids: [weak.id], topic_ids: [] };
    if (s === "failed") return { domain_ids: [], topic_ids: failedTopics };
    if (s === "pick") return { domain_ids: [...picked], topic_ids: [] };
    return null;
  };
  const scopes = [
    { id: "all", label: "Todo el examen", enabled: true },
    { id: "weak", label: weak ? `Mi dominio más flojo (${weak.name})` : "Mi dominio más flojo", enabled: !!weak },
    { id: "failed", label: "Temas de lo que fallé", enabled: failedTopics.length > 0 },
    { id: "pick", label: "Elegir dominios", enabled: true },
  ] as const;

  const header = (title?: string) => (
    <header className="chat-head">
      <button className="crumb" onClick={onBack} aria-label="Volver a Exámenes">
        Exámenes
      </button>
      <span className="crumb-sep" aria-hidden>
        /
      </span>
      {title ? (
        <>
          <button
            className="crumb"
            onClick={() => {
              setMockId(null);
              setReviewing(false);
            }}
            aria-label={`Volver a ${exam.name}`}
          >
            {exam.name}
          </button>
          <span className="crumb-sep" aria-hidden>
            /
          </span>
          <h1 className="chat-title">{title}</h1>
        </>
      ) : (
        <h1 className="chat-title">{exam.name}</h1>
      )}
    </header>
  );

  const mock = exam.mocks.find((m) => m.id === mockId);
  if (mock) {
    const n = exam.mocks.indexOf(mock) + 1;
    return (
      <div className="practice-screen">
        {header(`Simulacro ${n}`)}
        <MockRunner key={mock.id} exam={exam} mock={mock} onSubmitted={setExam} onStudy={study} />
      </div>
    );
  }

  if (reviewing) {
    return (
      <div className="practice-screen">
        {header("Repaso de falladas")}
        <ReviewRunner exam={exam} onChanged={setExam} onDone={() => setReviewing(false)} onStudy={study} />
      </div>
    );
  }

  const result = latestResult(exam);
  const readiness = examReadiness(exam, sessions);
  return (
    <div className="practice-screen">
      {header()}
      <div className="practice-body">
        <section className="card readiness" aria-label="Preparación">
          <div className="row-between">
            <div>
              <h2>Preparación estimada</h2>
              <p className="muted small">
                Mitad temas estudiados, mitad resultado del último simulacro, ponderado por el peso de cada dominio.
                {!result && " Hacé un simulacro para medirte."}
              </p>
            </div>
            <span className="readiness-value" data-testid="readiness">
              {pct(readiness)}
            </span>
          </div>
          <div className="bar" aria-hidden>
            <span style={{ width: pct(readiness) }} />
          </div>
        </section>

        <GoalCard key={exam.updated_at} exam={exam} onSaved={setExam} />

        <PlanCard exam={exam} sessions={sessions} onStudy={study} />

        <ScheduleCard exam={exam} onSaved={setExam} />

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <section aria-label="Ruta de estudio" className="exam-path">
          <h2>Ruta de estudio</h2>
          {byWeight(exam.domains).map((d) => (
            <DomainCard
              key={d.id}
              domain={d}
              readiness={domainReadiness(d, result, sessions)}
              sessions={sessions}
              onStudy={study}
              onExercise={
                exam.lang
                  ? (t) =>
                      onOpenCode({
                        lang: exam.lang!,
                        code: "",
                        title: t.title,
                        task: t.objectives.join(" · "),
                        exercise: { topic: `${t.title}: ${t.objectives.join("; ")}`, level: "medio", examId: exam.id, topicId: t.id },
                      })
                  : undefined
              }
            />
          ))}
        </section>

        <section className="card" aria-label="Simulacros">
          <h2>Simulacros</h2>
          <p className="muted small">Preguntas de opción múltiple al estilo del examen, repartidas según el peso de cada dominio. Se corrigen al instante.</p>
          <div className="tabs wrap" role="radiogroup" aria-label="Qué abarca">
            {scopes.map((s) => (
              <button key={s.id} role="radio" aria-checked={scope === s.id} disabled={!s.enabled} className={scope === s.id ? "is-active" : ""} onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {scope === "pick" && (
            <ul className="idea-list" aria-label="Dominios del simulacro">
              {byWeight(exam.domains).map((d) => (
                <li key={d.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(d.id)}
                      onChange={() =>
                        setPicked((p) => {
                          const next = new Set(p);
                          if (next.has(d.id)) next.delete(d.id);
                          else next.add(d.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {d.name} <span className="muted">({d.weight}%)</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {scope !== "all" && <p className="muted small">Los simulacros dirigidos no cuentan para la evolución ni para “¿Estoy listo?”, porque no miden el examen completo.</p>}
          <div className="row-between">
            <div className="tabs" role="radiogroup" aria-label="Cantidad de preguntas">
              {COUNTS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={count === c}
                  className={count === c ? "is-active" : ""}
                  onClick={() => {
                    setCount(c);
                    setMinutes(suggestedMinutes(c));
                  }}
                >
                  {c} preguntas
                </button>
              ))}
            </div>
            <div className="tabs" role="radiogroup" aria-label="Tiempo">
              <button role="radio" aria-checked={!timed} className={!timed ? "is-active" : ""} onClick={() => setTimed(false)}>
                Sin límite
              </button>
              <button role="radio" aria-checked={timed} className={timed ? "is-active" : ""} onClick={() => setTimed(true)}>
                Con tiempo
              </button>
            </div>
          </div>
          {timed && (
            <div className="time-row">
              <label>
                Minutos
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.max(1, Math.min(600, Math.round(Number(e.target.value) || 1))))}
                  aria-label="Minutos del simulacro"
                />
              </label>
              <span className="muted small">Como referencia, ~1,5 min por pregunta. Usá el ritmo de tu examen real. Al terminar el tiempo se entrega solo.</span>
            </div>
          )}
          <div className="row-end">
            <button className="btn primary" disabled={busy || (scope === "pick" && picked.size === 0)} onClick={generate}>
              {busy ? "Generando…" : "Nuevo simulacro"}
            </button>
          </div>
          {exam.mocks.length > 0 && (
            <ul className="mock-list">
              {exam.mocks.map((m, i) => (
                <li key={m.id}>
                  <button className="link" onClick={() => setMockId(m.id)}>
                    Simulacro {i + 1}
                  </button>
                  <span className="muted small">
                    {m.focus ? `Dirigido: ${m.focus} · ` : ""}
                    {m.questions.length} preguntas{m.time_limit_secs ? ` · ${clock(m.time_limit_secs)}` : ""} ·{" "}
                    {m.result ? `${m.result.correct}/${m.result.total} (${pct(m.result.correct / m.result.total)})` : "sin entregar"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <CheatSheetCard exam={exam} onChanged={setExam} />

        <section className="card" aria-label="Tarjetas de memoria">
          <div className="row-between">
            <div>
              <h2>Tarjetas de memoria</h2>
              <p className="muted small">20 tarjetas con lo que hay que memorizar del temario y lo que venís fallando, para repasar unos minutos por día.</p>
            </div>
            <button className="btn" disabled={busy} onClick={makeCards}>
              Crear tarjetas
            </button>
          </div>
        </section>

        <section className="card" aria-label="Repaso de falladas">
          <div className="row-between">
            <div>
              <h2>Repaso de falladas</h2>
              <p className="muted small">
                {exam.review.length
                  ? `${exam.review.length} ${exam.review.length === 1 ? "pregunta" : "preguntas"} de tus simulacros para volver a responder. Cada una sale del repaso cuando la acertás 2 veces seguidas.`
                  : "Las preguntas que falles o dejes en blanco en un simulacro van a aparecer acá."}
              </p>
            </div>
            <button className="btn" disabled={!exam.review.length} onClick={() => setReviewing(true)}>
              Repasar
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

interface DomainProps {
  domain: ExamDomain;
  readiness: ReturnType<typeof domainReadiness>;
  sessions: Map<string, SessionSummary>;
  onStudy: (topicId: string) => void;
  /** Programming paths: practice this topic in the console. */
  onExercise?: (t: ExamDomain["topics"][number]) => void;
}

function DomainCard({ domain, readiness, sessions, onStudy, onExercise }: DomainProps) {
  return (
    <article className="card domain" aria-label={domain.name}>
      <div className="row-between">
        <h3>{domain.name}</h3>
        <span className="weight" title="Peso en el examen">
          {domain.weight}%
        </span>
      </div>
      <p className="muted small">
        Temas: {pct(readiness.coverage)} · Simulacro: {readiness.mock == null ? "—" : pct(readiness.mock)}
      </p>
      <ul className="topic-list">
        {domain.topics.map((t) => {
          const st = topicState(t, sessions);
          return (
            <li key={t.id} className={`topic topic-${st.kind}`}>
              <div className="topic-main">
                <span className="topic-title">{t.title}</span>
                <span className={`topic-state state-${st.kind}`}>{topicLabel(st)}</span>
                {t.exercises_passed > 0 && (
                  <span className="topic-state state-studied">
                    · {t.exercises_passed} {t.exercises_passed === 1 ? "ejercicio aprobado" : "ejercicios aprobados"}
                  </span>
                )}
              </div>
              {t.objectives.length > 0 && (
                <details>
                  <summary>Objetivos ({t.objectives.length})</summary>
                  <ul>
                    {t.objectives.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </details>
              )}
              <span className="row topic-actions">
                {onExercise && (
                  <button className="btn ghost small" onClick={() => onExercise(t)} aria-label={`Ejercicio de ${t.title}`}>
                    Ejercicio
                  </button>
                )}
                <button className="btn small" onClick={() => onStudy(t.id)} aria-label={`${st.kind === "new" ? "Estudiar" : "Continuar"} ${t.title}`}>
                  {st.kind === "new" ? "Estudiar" : "Continuar"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
