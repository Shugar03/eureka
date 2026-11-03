import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../../api";
import type { Exam, MockExam } from "../../types";
import { clearDraft, clock, loadDraft, pct, remainingSecs, saveDraft, urgency, weakestDomain } from "../../lib/exam";
import { Markdown } from "../Markdown";
import { ChoiceList, verdictLabel } from "./ChoiceList";
import { QuestionTools } from "./QuestionTools";

interface MockProps {
  exam: Exam;
  mock: MockExam;
  onSubmitted: (e: Exam) => void;
  onStudy: (topicId: string) => void;
}

export function MockRunner({ exam, mock, onSubmitted, onStudy }: MockProps) {
  const result = mock.result;
  const n = mock.questions.length;
  const [answers, setAnswers] = useState<number[][]>(() => result?.answers ?? loadDraft(mock.id, n));
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const body = useRef<HTMLDivElement>(null);
  const latest = useRef(answers);
  const sent = useRef(false);
  latest.current = answers;

  const answered = answers.filter((a) => a.length).length;
  const domainName = useMemo(() => new Map(exam.domains.map((d) => [d.id, d.name])), [exam]);
  const weak = result ? weakestDomain(exam, result) : null;
  const left = result ? null : remainingSecs(mock, now);

  const submit = async (byClock = false) => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    setError(null);
    try {
      const e = await api.submitMock(exam.id, mock.id, latest.current);
      clearDraft(mock.id);
      setAuto(byClock);
      onSubmitted(e);
    } catch (e) {
      sent.current = false;
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // AC-39: the clock ticks every second and hands the exam in at zero.
  useEffect(() => {
    if (result || !mock.time_limit_secs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [result, mock.time_limit_secs]);
  useEffect(() => {
    if (left === 0) submit(true);
  }, [left]);

  const choose = (i: number, choice: number[]) =>
    setAnswers((a) => {
      const next = a.map((x, k) => (k === i ? choice : x));
      saveDraft(mock.id, next);
      return next;
    });

  const toggleFlag = (i: number) =>
    setFlagged((f) => {
      const next = new Set(f);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Scroll only the exam body (scrollIntoView would move the whole shell).
  const jump = (i: number) => {
    const box = body.current;
    const el = box?.querySelector<HTMLElement>(`[data-q="${i}"]`);
    if (!box || !el) return;
    box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 72 });
    el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  const level = left == null ? null : urgency(left);
  return (
    <div className="practice-body" ref={body}>
      {!result && (
        <div className="mock-bar">
          <nav className="q-nav" aria-label="Preguntas">
            {mock.questions.map((q, i) => (
              <button
                key={q.id}
                className={`q-dot ${answers[i].length ? "is-answered" : ""} ${flagged.has(i) ? "is-flagged" : ""}`}
                onClick={() => jump(i)}
                aria-label={`Ir a la pregunta ${i + 1}${answers[i].length ? ", respondida" : ""}${flagged.has(i) ? ", marcada" : ""}`}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          {left != null && (
            <span className={`timer timer-${level}`} role="timer" aria-label="Tiempo restante" data-testid="timer">
              {clock(left)}
            </span>
          )}
        </div>
      )}
      {mock.dropped != null && (
        <p className="muted small" data-testid="checked">
          {mock.dropped
            ? `Un segundo modelo revisó las respuestas: se ${mock.dropped === 1 ? "descartó 1 pregunta dudosa" : `descartaron ${mock.dropped} preguntas dudosas`}.`
            : "Respuestas verificadas por un segundo modelo."}
        </p>
      )}
      {level && level !== "ok" && (
        <p className={`timer-note timer-${level}`} role="status">
          {level === "bad" ? "Queda menos de un minuto: al llegar a cero se entrega solo." : "Quedan 5 minutos o menos."}
        </p>
      )}

      {result && (
        <section className="card" aria-label="Resultado">
          {auto && (
            <p className="timer-note timer-warn" role="status">
              Se terminó el tiempo: el simulacro se entregó solo con lo que habías respondido.
            </p>
          )}
          <div className="row-between">
            <h2>Resultado</h2>
            <span className="readiness-value" data-testid="mock-score">
              {result.correct}/{result.total} · {pct(result.correct / result.total)}
            </span>
          </div>
          <p className="muted small" data-testid="elapsed">
            Tiempo usado: {clock(Math.min(result.elapsed_secs, mock.time_limit_secs ?? Infinity))}
            {mock.time_limit_secs ? ` de ${clock(mock.time_limit_secs)}` : ""}
            {result.total > result.correct && ` · Las que fallaste quedaron en el repaso y en el mazo «Falladas: ${exam.name}».`}
          </p>
          <table className="summary-table">
            <thead>
              <tr>
                <th>Dominio</th>
                <th>Correctas</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {result.by_domain.map((s) => (
                <tr key={s.domain_id}>
                  <td>{domainName.get(s.domain_id)}</td>
                  <td>
                    {s.correct}/{s.total}
                  </td>
                  <td>{pct(s.correct / s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {weak ? (
            <div className="recommend" data-testid="recommend">
              <p>
                Tu dominio más flojo es <strong>{weak.name}</strong>. Conviene repasar:
              </p>
              <ul>
                {weak.topics.map((t) => (
                  <li key={t.id}>
                    <button className="link" onClick={() => onStudy(t.id)}>
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted">¡Todo correcto! Probá con un simulacro más largo.</p>
          )}
        </section>
      )}

      {mock.questions.map((q, i) => {
        const chosen = answers[i];
        return (
          <fieldset key={q.id} data-q={i} className={`card mock-q ${flagged.has(i) ? "is-flagged" : ""} ${q.reported ? "is-reported" : ""}`} aria-label={`Pregunta ${i + 1}`}>
            <legend className="muted small">
              Pregunta {i + 1} de {n} · {domainName.get(q.domain_id)}
            </legend>
            <Markdown text={q.stem} />
            <ChoiceList name={q.id} options={q.options} answer={q.answer} chosen={chosen} reveal={!!result} disabled={busy} onChange={(c) => choose(i, c)} />
            {!result && (
              <div className="row-end">
                <button className="btn ghost small" aria-pressed={flagged.has(i)} onClick={() => toggleFlag(i)}>
                  {flagged.has(i) ? "Marcada para revisar" : "Marcar para revisar"}
                </button>
              </div>
            )}
            {result && (
              <>
                <div className="explanation" data-testid="explanation">
                  {q.reported ? (
                    <strong>Reportada: no cuenta ({q.reported}).</strong>
                  ) : (
                    <strong>{verdictLabel(q.answer, chosen)}</strong>
                  )}{" "}
                  <Markdown text={q.explanation} />
                </div>
                <QuestionTools
                  examId={exam.id}
                  question={q}
                  chosen={chosen}
                  onReport={async (reason) => onSubmitted(await api.reportQuestion(exam.id, mock.id, q.id, reason))}
                />
              </>
            )}
          </fieldset>
        );
      })}

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {!result && (
        <div className="row-end">
          <span className="muted small">
            {answered}/{n} respondidas{flagged.size ? ` · ${flagged.size} marcadas` : ""}
          </span>
          <button className="btn primary" disabled={busy} onClick={() => submit()}>
            {busy ? "Corrigiendo…" : "Entregar"}
          </button>
        </div>
      )}
    </div>
  );
}
