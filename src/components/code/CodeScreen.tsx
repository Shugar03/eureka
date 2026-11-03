import { useEffect, useMemo, useState } from "react";
import { api, codeApi, errorText } from "../../api";
import type { CodeExercise, Lang, RunResult, Runtime } from "../../types";
import { errorLines, failed, LANGS, langLabel, runSummary, testsOffset } from "../../lib/code";
import type { TsDiagnostic } from "../../lib/tsCheck";
import { Markdown } from "../Markdown";
import { CodeEditor } from "./CodeEditor";
import { ProjectPanel } from "./ProjectPanel";
import { localDate } from "../../lib/exam";
import { useStudyContext } from "../pomodoro/PomodoroContext";

/** Code handed over from a session (the teacher's show_code). */
export interface CodeSeed {
  lang: Lang;
  code: string;
  title: string;
  task?: string;
  /** From a programming path's topic: generate an exercise right away and record a pass. */
  exercise?: { topic: string; level: string; examId?: string; topicId?: string };
}

interface Props {
  seed: CodeSeed | null;
}

const draftKey = (l: Lang) => `la.code.${l}`;
const loadDraft = (l: Lang) => {
  try {
    return localStorage.getItem(draftKey(l));
  } catch {
    return null;
  }
};
const saveDraft = (l: Lang, code: string) => {
  try {
    localStorage.setItem(draftKey(l), code);
  } catch {
    /* ignore */
  }
};
const LEVELS = ["básico", "medio", "avanzado"];

/** AC-53…55: write, run and debug code; practice with exercises. */
export function CodeScreen({ seed }: Props) {
  const [lang, setLang] = useState<Lang>(seed?.lang ?? "python");
  const [code, setCode] = useState(() => seed?.code ?? loadDraft(seed?.lang ?? "python") ?? LANGS[0].starter);
  const [stdin, setStdin] = useState("");
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [diags, setDiags] = useState<TsDiagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [exercise, setExercise] = useState<CodeExercise | null>(null);
  const [verdict, setVerdict] = useState<"pass" | "fail" | null>(null);
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("medio");
  const [making, setMaking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [view, setView] = useState<"file" | "project">("file");
  const [review, setReview] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [focus, setFocus] = useState("");

  useStudyContext({ kind: "code", id: lang, title: `Programación: ${langLabel(lang)}` });

  useEffect(() => {
    codeApi.runtimes().then(setRuntimes).catch(() => setRuntimes([]));
  }, []);

  // A path topic opens straight into an exercise about it.
  useEffect(() => {
    if (!seed?.exercise) return;
    setTopic(seed.exercise.topic);
    setLevel(seed.exercise.level);
    newExercise(seed.exercise.topic, seed.exercise.level);
  }, []);

  const rt = runtimes?.find((r) => r.lang === lang);
  // With an exercise's tests in front (Java, C#), the compiler's lines are shifted.
  const [shift, setShift] = useState(0);
  const marks = useMemo(() => [...new Set([...(result ? errorLines(lang, result.stderr).map((n) => n - shift).filter((n) => n > 0) : []), ...diags.map((d) => d.line)])], [result, diags, lang, shift]);

  const switchLang = (l: Lang) => {
    if (l === lang) return;
    saveDraft(lang, code);
    setLang(l);
    setCode(loadDraft(l) ?? LANGS.find((x) => x.id === l)!.starter);
    setResult(null);
    setDiags([]);
    setAnswer(null);
    setExercise(null);
    setVerdict(null);
  };

  const edit = (v: string) => {
    setCode(v);
    if (!exercise) saveDraft(lang, v);
  };

  const execute = async (withTests: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setVerdict(null);
    try {
      if (lang === "typescript") {
        const { tsCheck } = await import("../../lib/tsCheck");
        setDiags(await tsCheck(code));
      } else setDiags([]);
      const tests = withTests && exercise ? exercise.tests : undefined;
      const r = await codeApi.run(lang, code, stdin, tests);
      setShift(testsOffset(lang, tests));
      setResult(r);
      if (withTests) {
        setVerdict(failed(r) ? "fail" : "pass");
        if (!failed(r) && seed?.exercise?.examId && seed.exercise.topicId) api.recordExercise(seed.exercise.examId, seed.exercise.topicId).catch(() => {});
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const explain = async () => {
    setAsking(true);
    setSaved(null);
    setError(null);
    try {
      const output = [result?.stdout, result?.stderr, ...diags.map((d) => `main.ts:${d.line}:${d.column} ${d.message}`)].filter(Boolean).join("\n");
      setAnswer(await codeApi.explain(lang, code, output, ask));
      setAsk("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAsking(false);
    }
  };

  // AC-57: the explained error, as a flashcard to not fall for it again.
  const saveCard = async () => {
    if (!answer) return;
    const firstError = (result?.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop();
    const front = firstError ? `¿Qué significa y cómo se arregla?\n\n\`${firstError.slice(0, 200)}\`` : "¿Qué aprendí de este código?";
    try {
      const n = await codeApi.saveCard(lang, front, answer, localDate(new Date()));
      setSaved(n ? `Guardada en «Errores de ${langLabel(lang)}».` : "Esa tarjeta ya estaba en tu mazo.");
    } catch (e) {
      setError(errorText(e));
    }
  };

  // AC-58: a senior-style review of the current code.
  const doReview = async () => {
    setReviewing(true);
    setError(null);
    try {
      setReview(await codeApi.review(lang, code, focus));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReviewing(false);
    }
  };

  const newExercise = async (forTopic = topic, forLevel = level) => {
    setMaking(true);
    setError(null);
    try {
      const ex = await codeApi.exercise(lang, forTopic, forLevel);
      setExercise(ex);
      setCode(ex.starter);
      setResult(null);
      setDiags([]);
      setVerdict(null);
      setHints(0);
      setShowSolution(false);
      setAnswer(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMaking(false);
    }
  };

  const summary = result ? runSummary(result) : null;
  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Código</h1>
      </header>
      <div className="practice-body code-body">
        <div className="row-between">
          <div className="tabs tabs-wrap" role="radiogroup" aria-label="Lenguaje">
            {LANGS.map((l) => (
              <button key={l.id} role="radio" aria-checked={lang === l.id} className={lang === l.id ? "is-active" : ""} onClick={() => switchLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="tabs" role="radiogroup" aria-label="Modo">
            <button role="radio" aria-checked={view === "file"} className={view === "file" ? "is-active" : ""} onClick={() => setView("file")}>
              Archivo
            </button>
            <button role="radio" aria-checked={view === "project"} className={view === "project" ? "is-active" : ""} onClick={() => setView("project")}>
              Proyecto
            </button>
          </div>
          <span className="muted small" data-testid="runtime">
            {runtimes == null ? "Buscando intérpretes…" : rt?.program ? rt.version : `${langLabel(lang)} no está instalado`}
          </span>
        </div>

        {view === "project" ? (
          <ProjectPanel key={lang} lang={lang} />
        ) : (
          <>
        {(seed || exercise) && (
          <section className="card exercise" aria-label={exercise ? "Ejercicio" : "Código de la sesión"}>
            <h2>{exercise?.title ?? seed!.title}</h2>
            <Markdown text={exercise?.statement ?? seed?.task ?? "Ejecutalo, cambialo y fijate qué pasa."} />
            {exercise && (
              <>
                {exercise.hints.slice(0, hints).map((h, i) => (
                  <p key={i} className="hint">
                    <span className="tag tag-predict">Pista {i + 1}</span> {h}
                  </p>
                ))}
                <div className="row">
                  <button className="btn small" disabled={hints >= exercise.hints.length} onClick={() => setHints((n) => n + 1)}>
                    Pedir pista ({hints}/{exercise.hints.length})
                  </button>
                  <button className="btn ghost small" onClick={() => setShowSolution((v) => !v)} aria-expanded={showSolution}>
                    {showSolution ? "Ocultar solución" : "Ver solución"}
                  </button>
                </div>
                {showSolution && (
                  <pre className="code-solution" aria-label="Solución">
                    {exercise.solution}
                  </pre>
                )}
              </>
            )}
          </section>
        )}

        <CodeEditor value={code} onChange={edit} lang={lang} errorLines={marks} onRun={() => execute(false)} />

        <details className="stdin">
          <summary>Entrada (stdin){stdin ? " · con datos" : ""}</summary>
          <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} rows={3} placeholder="Lo que tu programa lee con input() / readline / stdin" aria-label="Entrada del programa" />
        </details>

        <div className="row-between">
          <span className="muted small">Ctrl+Enter para ejecutar · corre en tu PC con un límite de 10 s</span>
          <span className="row">
            <button
              className="btn ghost small"
              onClick={() => {
                setCode(exercise?.starter ?? LANGS.find((x) => x.id === lang)!.starter);
                setResult(null);
                setDiags([]);
              }}
            >
              Restablecer
            </button>
            {exercise && (
              <button className="btn" disabled={busy || !rt?.program} onClick={() => execute(true)}>
                Probar
              </button>
            )}
            <button className="btn primary" disabled={busy || !rt?.program} onClick={() => execute(false)}>
              {busy ? "Ejecutando…" : "Ejecutar"}
            </button>
          </span>
        </div>

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {diags.length > 0 && (
          <section className="card ts-diags" aria-label="Errores de tipos">
            <h2>Errores de tipos ({diags.length})</h2>
            <p className="muted small">Node ejecuta igual quitando los tipos, pero estos errores los marcaría el compilador de TypeScript.</p>
            <ul>
              {diags.map((d, i) => (
                <li key={i}>
                  <code>
                    línea {d.line}:{d.column}
                  </code>{" "}
                  {d.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        {verdict && (
          <p className={`test-verdict verdict-${verdict === "pass" ? "correct" : "incorrect"}`} role="status" data-testid="test-verdict">
            {verdict === "pass" ? "¡Pasó todas las pruebas!" : "Todavía no: alguna prueba falló. Mirá la salida."}
          </p>
        )}

        {result && summary && (
          <section className="card output" aria-label="Salida">
            <div className="row-between">
              <h2>Salida</h2>
              <span className={`run-status run-${summary.tone}`} data-testid="run-status">
                {summary.text}
              </span>
            </div>
            {result.stdout && <pre className="out-stdout">{result.stdout}</pre>}
            {result.stderr && <pre className="out-stderr">{result.stderr}</pre>}
            {!result.stdout && !result.stderr && <p className="muted small">(sin salida)</p>}
            {marks.length > 0 && <p className="muted small">El error apunta a la línea {marks.join(", ")} (marcada en el editor).</p>}
          </section>
        )}

        {(result || diags.length > 0) && (
          <section className="card" aria-label="Profesor">
            <div className="row">
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !asking && explain()}
                placeholder={result && failed(result) ? "¿Qué significa este error y cómo lo arreglo?" : "Preguntale al profesor sobre este código…"}
                aria-label="Pregunta sobre el código"
              />
              <button className="btn" disabled={asking} onClick={explain}>
                {asking ? "Pensando…" : result && failed(result) ? "Explicar este error" : "Preguntar"}
              </button>
            </div>
            {answer && (
              <>
                <div className="ask-assistant" data-testid="code-answer">
                  <Markdown text={answer} />
                </div>
                <div className="row">
                  <button className="btn ghost small" onClick={saveCard}>
                    Guardar como tarjeta
                  </button>
                  {saved && (
                    <span className="muted small" role="status">
                      {saved}
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        <section className="card" aria-label="Revisión de código">
          <h2>Revisar mi código</h2>
          <p className="muted small">Un desarrollador senior lo lee: errores escondidos, lo idiomático del lenguaje, nombres, manejo de errores y rendimiento.</p>
          <div className="row">
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Opcional: qué querés mejorar (p. ej. manejo de errores)" aria-label="Qué querés mejorar" />
            <button className="btn" disabled={reviewing || !code.trim()} onClick={doReview}>
              {reviewing ? "Revisando…" : "Revisar mi código"}
            </button>
          </div>
          {review && (
            <div className="ask-assistant" data-testid="code-review">
              <Markdown text={review} />
            </div>
          )}
        </section>

        <section className="card" aria-label="Nuevo ejercicio">
          <h2>Practicar con un ejercicio</h2>
          <p className="muted small">Un problema con pruebas ocultas: escribís la solución, tocás "Probar" y te dice si pasa. Con pistas y solución.</p>
          <div className="row">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`Tema, p. ej. ${lang === "rust" ? "ownership y préstamos" : "listas y diccionarios"}`} aria-label="Tema del ejercicio" />
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button className="btn" disabled={making || !topic.trim()} onClick={() => newExercise()}>
              {making ? "Escribiendo…" : "Nuevo ejercicio"}
            </button>
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}
