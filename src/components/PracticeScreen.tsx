import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api";
import type { GraphView, LearnerInput, PracticeSet, PracticeSummary } from "../types";

import { filterGraph } from "../lib/graphView";
import { firstOpen, isFinished, lastVerdict, LEVEL_LABEL, needsNext, toReview, totalOf, VERDICT_LABEL } from "../lib/practice";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { OwnProblems } from "./OwnProblems";

interface Props {
  /** Open this set directly (e.g. created from the graph). */
  initialId: string | null;
  onOpenGraph: () => void;
}

const COUNTS = [3, 5, 8];
/** AC-168: same cap as the backend. */
const MAX_NUDGES = 3;

export function PracticeScreen({ initialId, onOpenGraph }: Props) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  useEffect(() => setOpenId(initialId), [initialId]);
  return openId ? <PracticeRunner id={openId} onBack={() => setOpenId(null)} /> : <PracticeHome onOpen={setOpenId} onOpenGraph={onOpenGraph} />;
}

function PracticeHome({ onOpen, onOpenGraph }: { onOpen: (id: string) => void; onOpenGraph: () => void }) {
  const [sets, setSets] = useState<PracticeSummary[]>([]);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const refresh = () => api.listPractice().then(setSets).catch((e) => setError(errorText(e)));
  useEffect(() => {
    refresh();
    api.getGraph().then(setGraph).catch((e) => setError(errorText(e)));
  }, []);

  const shown = useMemo(() => (graph ? filterGraph(graph, query).nodes : []), [graph, query]);

  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.createPractice([...chosen], count);
      onOpen(s.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    await api.deletePractice(id).catch((e) => setError(errorText(e)));
    refresh();
  };

  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Práctica</h1>
      </header>
      <div className="practice-body">
        <OwnProblems onOpen={onOpen} />
        {graph && graph.nodes.length === 0 ? (
          <div className="graph-empty">
            <h2>Para problemas nuevos, primero necesitás ideas en el grafo</h2>
            <p className="muted">Terminá una sesión o importá notas: esa práctica se arma con lo que ya entendiste. Tus propios problemas los podés traer igual.</p>
            <button className="btn" onClick={onOpenGraph}>
              Ir al grafo
            </button>
          </div>
        ) : (
          <section className="card" aria-label="Nueva práctica">
            <h2>Nueva práctica</h2>
            <p className="muted small">Elegí las ideas que querés fortalecer. Los problemas las van a necesitar sin nombrarlas.</p>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar ideas…" aria-label="Filtrar ideas para practicar" />
            <ul className="idea-list" aria-label="Ideas">
              {shown.map((n) => (
                <li key={n.id}>
                  <label>
                    <input type="checkbox" checked={chosen.has(n.id)} onChange={() => toggle(n.id)} />
                    <span>{n.text}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row-between">
              <div className="tabs" role="radiogroup" aria-label="Cantidad de problemas">
                {COUNTS.map((c) => (
                  <button key={c} role="radio" aria-checked={count === c} className={count === c ? "is-active" : ""} onClick={() => setCount(c)}>
                    {c} problemas
                  </button>
                ))}
              </div>
              <button className="btn primary" disabled={busy || chosen.size === 0} onClick={create}>
                {busy ? "Generando…" : `Generar (${chosen.size} ${chosen.size === 1 ? "idea" : "ideas"})`}
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {sets.length > 0 && (
          <section className="sessions" aria-label="Prácticas">
            <h2>Prácticas</h2>
            <ul>
              {sets.map((s) => (
                <li key={s.id} className="session-row">
                  <button className="session-open" onClick={() => onOpen(s.id)}>
                    <span className="session-title">{s.title}</span>
                    <span className="session-meta">
                      <span className="progress" aria-hidden>
                        <span style={{ width: `${(100 * s.done) / Math.max(1, s.total)}%` }} />
                      </span>
                      {s.done}/{s.total} · {s.correct} correctos
                    </span>
                  </button>
                  <button
                    className={`btn small ${armed === s.id ? "danger" : "ghost"}`}
                    onClick={() => remove(s.id)}
                    onBlur={() => setArmed((a) => (a === s.id ? null : a))}
                    aria-label={armed === s.id ? `Confirmar borrar ${s.title}` : `Borrar ${s.title}`}
                  >
                    {armed === s.id ? "¿Seguro? Borrar" : "Borrar"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function PracticeRunner({ id, onBack }: { id: string; onBack: () => void }) {
  const [set, setSet] = useState<PracticeSet | null>(null);
  const [index, setIndex] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<LearnerInput | null>(null);
  // AC-168: what they have written so far, for a hint made for that point.
  const [draft, setDraft] = useState("");
  const onDraft = useCallback((d: string) => setDraft(d), []);
  const [nudging, setNudging] = useState(false);
  const [solvedNote, setSolvedNote] = useState<string | null>(null);
  // AC-167: the next problem is written after each answer, while the correction is read.
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const writeNext = useCallback(async (s: PracticeSet) => {
    setWriting(true);
    setWriteError(null);
    try {
      setSet(await api.nextProblem(s.id, s.problems.length));
    } catch (e) {
      setWriteError(errorText(e));
    } finally {
      setWriting(false);
    }
  }, []);
  const due = !!set && !writing && !writeError && (needsNext(set) || (index >= set.problems.length && set.problems.length < totalOf(set)));
  useEffect(() => {
    if (due && set) writeNext(set);
  }, [due, set, writeNext]);

  useEffect(() => {
    api
      .getPractice(id)
      .then((s) => {
        setSet(s);
        setIndex(firstOpen(s));
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (!set) return <div className="center muted">{error ?? "Cargando…"}</div>;

  const go = (i: number) => {
    setIndex(i);
    setRetrying(false);
    setShowSolution(false);
    setError(null);
    setSolvedNote(null);
  };

  const submit = async (input: LearnerInput) => {
    const p = set.problems[index];
    setBusy(true);
    setError(null);
    setLastInput(input);
    try {
      setSet(await api.answerProblem(set.id, p.id, input));
      setRetrying(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const nudge = async () => {
    setNudging(true);
    setError(null);
    setSolvedNote(null);
    try {
      const r = await api.practiceNudge(set.id, set.problems[index].id, draft);
      setSet(r.set);
      if (r.solved) setSolvedNote(r.hint);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setNudging(false);
    }
  };

  const hint = async () => {
    try {
      setSet(await api.revealHint(set.id, set.problems[index].id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const header = (
    <header className="chat-head">
      <button className="crumb" onClick={onBack} aria-label="Volver a Práctica">
        Práctica
      </button>
      <span className="crumb-sep" aria-hidden>
        /
      </span>
      <h1 className="chat-title">{set.title}</h1>
    </header>
  );

  const total = totalOf(set);
  if (index >= set.problems.length && set.problems.length < total) {
    return (
      <div className="practice-screen">
        {header}
        <div className="practice-body">
          <span className="muted" data-testid="problem-progress">
            Problema {index + 1} de {total}
          </span>
          {writeError ? (
            <div className="error" role="alert">
              <p>No se pudo escribir el próximo problema: {writeError}</p>
              <div className="row">
                <button className="btn" onClick={() => writeNext(set)}>
                  Reintentar
                </button>
              </div>
            </div>
          ) : (
            <p className="muted" role="status">
              Escribiendo el próximo problema según cómo te fue…
            </p>
          )}
        </div>
      </div>
    );
  }

  if (index >= set.problems.length) {
    const review = toReview(set);
    return (
      <div className="practice-screen">
        {header}
        <div className="practice-body">
          <section className="card" aria-label="Resumen">
            <h2>Resumen</h2>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Problema</th>
                  <th>Resultado</th>
                  <th>Pistas</th>
                  <th>Intentos</th>
                </tr>
              </thead>
              <tbody>
                {set.problems.map((p, i) => {
                  const v = lastVerdict(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <button className="link" onClick={() => go(i)}>
                          Problema {i + 1}
                        </button>
                      </td>
                      <td>{v ? <span className={`verdict verdict-${v}`}>{VERDICT_LABEL[v]}</span> : <span className="muted">sin responder</span>}</td>
                      <td>{p.attempts.length ? p.attempts[p.attempts.length - 1].hints_used : p.hints_shown + (p.nudges?.length ?? 0)}</td>
                      <td>{p.attempts.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {review.length > 0 ? (
              <>
                <h3>Para repasar</h3>
                <ul className="graph-list">
                  {review.map((t) => (
                    <li key={t.id}>{t.text}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>¡Todo correcto! Estas ideas están firmes.</p>
            )}
            <div className="row-end">
              <button className="btn" onClick={onBack}>
                Volver a Práctica
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const p = set.problems[index];
  const last = p.attempts[p.attempts.length - 1];
  const answering = !last || retrying;
  const nudges = p.nudges ?? [];

  return (
    <div className="practice-screen">
      {header}
      <div className="practice-body">
        <div className="row-between">
          <span className="muted" data-testid="problem-progress">
            Problema {index + 1} de {total}
          </span>
          {!!p.level && (
            <span className="tag tag-predict practice-level" data-testid="problem-level">
              {LEVEL_LABEL[p.level]}
            </span>
          )}
          <span className="row">
            <button className="btn ghost small" disabled={index === 0} onClick={() => go(index - 1)}>
              ← Anterior
            </button>
            <button className="btn ghost small" onClick={() => go(index + 1)}>
              {index >= total - 1 ? "Resumen" : "Siguiente →"}
            </button>
          </span>
        </div>

        {answering ? (
          <QuestionCard key={`${p.id}-${p.attempts.length}`} args={{ question: p.statement, purpose: "check" }} tag="Problema" answer={null} pending busy={busy} onSubmit={submit} onDraft={onDraft} />
        ) : (
          <section className="card" aria-label="Problema">
            <Markdown text={p.statement} />
          </section>
        )}

        <section className="hints" aria-label="Pistas">
          {p.hints.slice(0, p.hints_shown).map((h, i) => (
            <div key={i} className="hint">
              <span className="tag tag-predict">Pista {i + 1}</span> <Markdown text={h} />
            </div>
          ))}
          {nudges.map((h, i) => (
            <div key={`n${i}`} className="hint" data-testid="nudge">
              <span className="tag tag-check">Empujón {i + 1}</span> <Markdown text={h} />
            </div>
          ))}
          {solvedNote && (
            <p className="hint hint-solved" role="status">
              {solvedNote}
            </p>
          )}
          {answering && (
            <div className="row">
              {p.hints.length > 0 && (
                <button className="btn small" disabled={p.hints_shown >= p.hints.length} onClick={hint}>
                  Pedir pista ({p.hints_shown}/{p.hints.length})
                </button>
              )}
              <button
                className="btn small"
                disabled={nudging || busy || !draft.trim() || nudges.length >= MAX_NUDGES}
                onClick={nudge}
                title={draft.trim() ? "Una pista hecha para lo que venís pensando" : "Escribí lo que venís pensando primero"}
              >
                {nudging ? "Pensando un empujón…" : `Necesito un empujón (${nudges.length}/${MAX_NUDGES})`}
              </button>
            </div>
          )}
        </section>

        {busy && <p className="muted">Corrigiendo…</p>}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {lastInput && (
              <div className="row">
                <button className="btn" onClick={() => submit(lastInput)}>
                  Reintentar
                </button>
              </div>
            )}
          </div>
        )}

        {last && !retrying && (
          <section className={`card verdict-card verdict-${last.verdict}`} aria-label="Corrección" data-testid="verdict">
            <div className="row-between">
              <span className={`verdict verdict-${last.verdict}`}>{VERDICT_LABEL[last.verdict]}</span>
              <span className="muted small">
                Tu respuesta: “{last.answer}”{last.hints_used ? ` · ${last.hints_used} pista${last.hints_used > 1 ? "s" : ""}` : ""}
              </span>
            </div>
            <p>{last.feedback}</p>
            {showSolution && (
              <div className="solution" aria-label="Solución">
                {p.solution_by_model && <p className="muted small" data-testid="solution-by-model">Solución escrita por Eureka, no por tu guía: verificala.</p>}
                <Markdown text={p.solution} />
              </div>
            )}
            <div className="row-end">
              <button className="btn ghost" onClick={() => setShowSolution((v) => !v)}>
                {showSolution ? "Ocultar solución" : "Ver solución"}
              </button>
              {last.verdict !== "correct" && p.solution_by_model && (
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => submit({ text: last.answer, confidence: last.confidence, thinking: `${last.thinking ? `${last.thinking}\n` : ""}Creo que mi respuesta está bien: revisá si la solución de referencia tiene un error.` })}
                >
                  Creo que mi respuesta está bien
                </button>
              )}
              {last.verdict !== "correct" && (
                <button className="btn" onClick={() => setRetrying(true)}>
                  Reintentar
                </button>
              )}
              <button className="btn primary" onClick={() => go(isFinished(set) ? set.problems.length : index + 1)}>
                {index >= total - 1 || isFinished(set) ? "Ver resumen" : "Siguiente"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
