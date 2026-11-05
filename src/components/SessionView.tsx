import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeSeed } from "./code/CodeScreen";
import { langLabel } from "../lib/code";
import { academicApi, api, errorText } from "../api";
import type { ActionScreen, AgentEvent, LearnerInput, Session, UiCommand } from "../types";
import { buildTranscript, LEVEL_LABEL, needsAgent, PHASES } from "../lib/transcript";
import { takeFocus } from "../lib/focus";
import { bestMatch } from "../lib/graphView";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { ReadAloud } from "./a11y/ReadAloud";
import { AttachButton, AttachChips, MicButton, useAttachments } from "./chat/ChatTools";
import { composeMessage } from "../lib/attachments";
import { PlanTree } from "./PlanTree";
import { PhaseBar } from "./PhaseBar";
import { Diagram } from "./Diagram";
import { DemoFrame, DemoPane, usePaneWidth } from "./DemoFrame";
import { ResearchCard } from "./ResearchCard";
import { ActionCard } from "./ActionCard";
import { ExamProposalCard } from "./ExamProposalCard";
import { CodeProposalCard, DeckProposalCard, PracticeProposalCard } from "./chat/ProposalCards";
import { ProposalPreview } from "./academic/ProposalPreview";
import { OwnProblems } from "./OwnProblems";

interface Props {
  id: string;
  onBack: () => void;
  onOpenSettings: () => void;
  /** The session list changed (phase/progress); refresh the sidebar. */
  onChanged: () => void;
  onOpenGraph: () => void;
  /** Opens the teacher's code (show_code) in the console. */
  onOpenCode: (seed: CodeSeed) => void;
  /** A button the agent offered ("Abrir la biblioteca"). */
  onOpenScreen: (screen: ActionScreen) => void;
  /** Opens an exam preparation (the card the agent offered, once created). */
  onOpenExam: (id: string) => void;
  /** AC-161, AC-164: opens a deck (created from the chat, or by its name). */
  onOpenDeck: (id: string) => void;
  /** AC-162: opens a practice set generated from the chat. */
  onOpenPractice: (id: string) => void;
  /** Runs a control the agent was asked to (pause the pomodoro, change the theme…). */
  onUiCommand: (c: UiCommand) => void;
  /** What is on screen right now, for the agent (AC-107). */
  uiSnapshot: () => string;
}

/** Messages added after the last extraction before a finished session is re-extracted. */
const REEXTRACT_AFTER = 4;

export function SessionView({ id, onBack, onOpenSettings, onChanged, onOpenGraph, onOpenCode, onOpenScreen, onOpenExam, onOpenDeck, onOpenPractice, onUiCommand, uiSnapshot }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  // The demo open in the right-hand panel (it takes the plan's place while it is open).
  const [pane, setPane] = useState<{ key: string; title: string; html: string } | null>(null);
  const [paneWidth, setPaneWidth] = usePaneWidth();
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const attach = useAttachments();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const kickedFor = useRef<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const extractedFor = useRef<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  // The latest of these, without restarting the turn runner when they change.
  const hands = useRef({ onUiCommand, uiSnapshot });
  hands.current = { onUiCommand, uiSnapshot };

  const run = useCallback(
    async (input: LearnerInput | null) => {
      setBusy(true);
      setError(null);
      setStreaming("");
      const onEvent = (e: AgentEvent) => {
        if (e.type === "text") setStreaming((t) => t + e.delta);
        else if (e.type === "activity") setActivity(e.label);
        else if (e.type === "session") {
          setSession(e.session);
          setStreaming("");
        } else if (e.type === "ui") hands.current.onUiCommand(e.command);
        else if (e.type === "error") setError(e.message);
      };
      try {
        await api.sendMessage(id, input, onEvent, hands.current.uiSnapshot());
      } catch (e) {
        setError((prev) => prev ?? errorText(e));
      } finally {
        setStreaming("");
        setActivity("");
        setBusy(false);
        // Re-sync in case the turn was interrupted between events.
        api.getSession(id).then(setSession).catch(() => {});
        onChanged();
      }
    },
    [id, onChanged],
  );

  // AC-170: "Ver dónde apareció" from the graph. Taken once (a second StrictMode run gets nothing).
  const [focusIdea, setFocusIdea] = useState<string | null>(null);
  useEffect(() => {
    const idea = takeFocus(id);
    if (idea) setFocusIdea(idea);
  }, [id]);

  useEffect(() => {
    let alive = true;
    setSession(null);
    api
      .getSession(id)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        // A fresh session (or one interrupted on the learner's side) kicks off the agent once.
        if (needsAgent(s) && kickedFor.current !== id) {
          kickedFor.current = id;
          run(null);
        }
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [id, run]);

  const items = useMemo(() => (session ? buildTranscript(session) : []), [session]);
  // AC-184: which diagnostic question each probe card is, and how many the teacher expects.
  const probeSteps = useMemo(() => {
    const steps = new Map<string, { n: number; of?: number }>();
    let n = 0;
    let of: number | undefined;
    for (const it of items) {
      if (it.kind !== "question" || it.args.purpose !== "probe") continue;
      n += 1;
      of = it.args.of ?? of;
      steps.set(it.key, { n, of });
    }
    return steps;
  }, [items]);
  const focusKey = useMemo(
    () => (focusIdea ? bestMatch(items.flatMap((it) => (it.kind === "user" || it.kind === "assistant" ? [{ key: it.key, text: it.text }] : [])), focusIdea) : null),
    [focusIdea, items],
  );
  // AC-169: research runs in the background; while one is out, look for its result.
  const researching = items.some((it) => it.kind === "research" && !!it.result?.pending);
  useEffect(() => {
    if (!researching || busy) return;
    const t = window.setInterval(() => {
      api.getSession(id).then(setSession).catch(() => {});
    }, 2000);
    return () => window.clearInterval(t);
  }, [researching, busy, id]);
  // AC-166: while being taught, a place to think while reading the latest explanation.
  const [reading, setReading] = useState("");
  const lastExplanation = useMemo(() => [...items].reverse().find((it) => it.kind === "assistant")?.key ?? null, [items]);
  const withReading = (input: LearnerInput): LearnerInput => {
    const notes = reading.trim();
    if (!notes) return input;
    setReading("");
    return { ...input, reading: notes };
  };

  const extract = useCallback(async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      setSession(await api.extractSession(id));
    } catch (e) {
      setExtractError(errorText(e));
    } finally {
      setExtracting(false);
    }
  }, [id]);

  // AC-17: a session that reaches "done" goes into the knowledge graph, and
  // again if the conversation kept going after that (audit item 10).
  useEffect(() => {
    if (session?.phase !== "done" || busy) return;
    const len = session.messages.length;
    const stale = !session.graph || (session.graph.messages ?? len) + REEXTRACT_AFTER <= len;
    const key = `${id}:${len}`;
    if (stale && extractedFor.current !== key) {
      extractedFor.current = key;
      extract();
    }
  }, [session, busy, id, extract]);

  const canSaveEarly = !!session && session.phase !== "done" && session.plan.some((n) => n.status === "understood");

  useEffect(() => {
    // Scroll only the transcript: scrollIntoView would also scroll the
    // overflow-hidden app shell and push the header off screen.
    const el = transcript.current;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [items.length, streaming]);

  // AC-170: after the scroll to the end, bring the message where the idea came up into view.
  useEffect(() => {
    const el = transcript.current;
    const target = focusKey ? el?.querySelector<HTMLElement>(`[data-item="${CSS.escape(focusKey)}"]`) : null;
    if (!el || !target) return;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 60;
    el.scrollTo({ top, behavior: "auto" });
  }, [focusKey, items.length]);

  if (!session) {
    return <div className="center muted">{error ?? "Cargando…"}</div>;
  }

  const canSend = (!!draft.trim() || attach.items.length > 0) && !attach.working;
  const sendDraft = () => {
    if (!canSend || busy) return;
    const text = composeMessage(draft, attach.items);
    setDraft("");
    attach.clear();
    // With a question waiting, writing here is a free message, not the form's answer (AC-121).
    run(withReading({ text, ...(session.pending_question ? { free: true } : {}) }));
  };

  const canRetry = !busy && needsAgent(session);
  // AC-89: a conversation with no goal yet is just a chat; the plan and diagnosis appear once the method starts.
  const chatOnly = session.phase === "chat";

  return (
    <div className={`session ${chatOnly ? "session-chat" : ""} ${pane ? "has-pane" : ""}`} style={pane ? ({ "--pane-w": `${paneWidth}px` } as React.CSSProperties) : undefined}>
      <div className="chat">
        <header className="chat-head">
          <button className="crumb" onClick={onBack} aria-label="Volver a Sesiones">
            Sesiones
          </button>
          <span className="crumb-sep" aria-hidden>
            /
          </span>
          <h1 className="chat-title" title={session.goal}>
            {session.title}
          </h1>
          <span className={`pill phase-${session.phase}`}>{PHASES.find((p) => p.id === session.phase)?.label ?? "Charla"}</span>
          {canSaveEarly && (
            <span className="row chat-head-actions">
              {extractError && (
                <span role="alert" className="graph-banner-error" title={extractError}>
                  No se pudo guardar
                </span>
              )}
              {session.graph && !extracting && !extractError && <span className="muted small">Guardado · {session.graph.propositions} ideas</span>}
              <button className="btn ghost small" onClick={extract} disabled={extracting || busy}>
                {extracting ? "Guardando…" : "Guardar lo aprendido hasta acá"}
              </button>
            </span>
          )}
        </header>

        <div className="transcript" aria-live="polite" ref={transcript}>
          {focusIdea && (
            <div className="focus-banner row-between" role="status" data-testid="focus-banner">
              <span className="small">
                {focusKey ? "Marcado el mensaje donde apareció" : "No encontré el mensaje exacto de"} «{focusIdea.length > 90 ? `${focusIdea.slice(0, 90)}…` : focusIdea}»
              </span>
              <button className="btn ghost small" onClick={() => setFocusIdea(null)}>
                Listo
              </button>
            </div>
          )}
          {items.map((it) => {
            switch (it.kind) {
              case "user":
                return (
                  <div key={it.key} className={`bubble user ${it.key === focusKey ? "is-focus" : ""}`} data-item={it.key} data-testid={it.key === focusKey ? "focus-message" : undefined}>
                    {it.text}
                  </div>
                );
              case "assistant":
                return (
                  <div key={it.key} className={`bubble assistant ${it.key === focusKey ? "is-focus" : ""}`} data-item={it.key} data-testid={it.key === focusKey ? "focus-message" : undefined}>
                    <Markdown text={it.text} />
                    <ReadAloud markdown={it.text} />
                    {session.phase === "teach" && it.key === lastExplanation && !busy && (
                      <label className="field reading-notes">
                        <span>Lo que voy pensando mientras leo</span>
                        <textarea
                          value={reading}
                          onChange={(e) => setReading(e.target.value)}
                          rows={2}
                          placeholder="Dudas, conexiones, lo que no te cierra… Se manda con tu próxima respuesta."
                        />
                      </label>
                    )}
                  </div>
                );
              case "event":
                return (
                  <div key={it.key} className="event">
                    {it.label}
                  </div>
                );
              case "timetable":
                return (
                  <div key={it.key} className="timetable-offer">
                    <ProposalPreview proposal={it.proposal} onSave={async (p) => (await academicApi.importProposal(p)).report} onOpen={() => onOpenScreen("academic")} />
                  </div>
                );
              case "exam":
                return <ExamProposalCard key={it.key} proposal={it.proposal} onOpenExam={onOpenExam} />;
              case "action":
                return <ActionCard key={it.key} action={it.action} onOpenScreen={onOpenScreen} onOpenExam={onOpenExam} onOpenDeck={onOpenDeck} />;
              case "deck":
                return <DeckProposalCard key={it.key} proposal={it.proposal} onOpenDeck={onOpenDeck} />;
              case "practice":
                return <PracticeProposalCard key={it.key} proposal={it.proposal} onOpenPractice={onOpenPractice} />;
              case "ownProblems":
                return <OwnProblems key={it.key} initial={it.proposal} onOpen={onOpenPractice} />;
              case "codeOffer":
                return <CodeProposalCard key={it.key} proposal={it.proposal} onOpenCode={onOpenCode} />;
              case "diagram":
                return <Diagram key={it.key} title={it.title} code={it.code} />;
              case "demo":
                return <DemoFrame key={it.key} title={it.title} html={it.html} opened={pane?.key === it.key} onOpen={() => setPane({ key: it.key, title: it.title, html: it.html })} onClose={() => setPane(null)} />;
              case "code":
                return (
                  <figure key={it.key} className="code-card" aria-label={`Código: ${it.title}`}>
                    <figcaption className="row-between">
                      <span>
                        <span className="tag tag-predict">{langLabel(it.lang)}</span> {it.title}
                      </span>
                      <button className="btn small" onClick={() => onOpenCode({ lang: it.lang, code: it.code, title: it.title, task: it.task })}>
                        Abrir en la consola
                      </button>
                    </figcaption>
                    {it.task && <p className="muted small">{it.task}</p>}
                    <pre>{it.code}</pre>
                  </figure>
                );
              case "research":
                return <ResearchCard key={it.key} question={it.question} result={it.result} />;
              case "question":
                return (
                  <QuestionCard
                    key={it.key}
                    args={it.args}
                    answer={it.answer}
                    pending={it.pending}
                    inChat={it.inChat}
                    busy={busy}
                    onSubmit={(input) => run(withReading(input))}
                    step={probeSteps.get(it.key)}
                    onEnough={it.pending && it.args.purpose === "probe" ? () => run(withReading({ text: "Con esto alcanza, empecemos.", free: true })) : undefined}
                  />
                );
            }
          })}
          {session.phase === "done" && (
            <section className="graph-banner" aria-label="Grafo de conocimiento" data-testid="graph-banner">
              {extracting ? (
                <span className="muted">Guardando en el grafo…</span>
              ) : extractError ? (
                <div className="row-between">
                  <span role="alert" className="graph-banner-error">
                    No se pudo guardar en el grafo: {extractError}
                  </span>
                  <button className="btn small" onClick={extract}>
                    Reintentar
                  </button>
                </div>
              ) : session.graph ? (
                <div className="row-between">
                  <span>
                    <strong>Guardado en el grafo</strong> · {session.graph.propositions} ideas · {session.graph.chains} cadenas
                  </span>
                  <span className="row">
                    <button className="btn small" onClick={onOpenGraph}>
                      Ver en el grafo
                    </button>
                    <button className="btn ghost small" onClick={extract}>
                      Volver a extraer
                    </button>
                  </span>
                </div>
              ) : null}
            </section>
          )}
          {streaming && (
            <div className="bubble assistant is-streaming">
              <Markdown text={streaming} />
            </div>
          )}
          {busy && !streaming && (
            <div className="thinking-dots" role="status" aria-label={activity || "El agente está pensando"}>
              <span /><span /><span />
              {activity && <em className="activity-label">{activity}</em>}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <p>{error}</p>
              <div className="row">
                {canRetry && (
                  <button className="btn" onClick={() => run(null)}>
                    Reintentar
                  </button>
                )}
                {/Ajustes|API key|modelo/i.test(error) && (
                  <button className="btn" onClick={onOpenSettings}>
                    Abrir ajustes
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="composer">
          {busy ? (
            <div className="row-between">
              <span className="muted">El agente está respondiendo…</span>
              <button className="btn" onClick={() => api.stopAgent(id)}>
                Detener
              </button>
            </div>
          ) : (
            <>
            <AttachChips items={attach.items} working={attach.working} error={attach.error} ask={attach.ask} onRemove={attach.remove} />
            <div className="composer-row">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendDraft();
                  }
                }}
                rows={2}
                placeholder={session.pending_question ? "Respondé la pregunta de arriba o escribí lo que quieras… (Enter para enviar)" : chatOnly ? "Escribí un mensaje… (Enter para enviar)" : "Escribí una duda o comentario… (Enter para enviar)"}
                aria-label="Mensaje"
              />
              <AttachButton onFiles={attach.add} disabled={!!attach.working} />
              <MicButton onText={(t) => setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))} />
              <button className="btn primary" onClick={sendDraft} disabled={!canSend}>
                Enviar
              </button>
            </div>
            <p className="composer-note">Eureka es una IA y puede cometer errores. Verificá lo importante con tu material o con tu docente.</p>
            </>
          )}
        </footer>
      </div>

      {pane && <DemoPane key={pane.key} title={pane.title} html={pane.html} width={paneWidth} onWidth={setPaneWidth} onClose={() => setPane(null)} />}
      {!chatOnly && !pane && (
      <aside className="side">
        <PhaseBar phase={session.phase} />
        <h2 className="side-title">Plan</h2>
        <PlanTree plan={session.plan} />
        <h2 className="side-title">Diagnóstico</h2>
        {session.findings.length === 0 ? (
          <p className="muted pad">Todavía no hay hallazgos.</p>
        ) : (
          <ul className="findings" data-testid="findings">
            {session.findings.map((f) => (
              <li key={f.concept} title={f.evidence}>
                <span className={`level level-${f.level}`}>{LEVEL_LABEL[f.level]}</span>
                {f.concept}
              </li>
            ))}
          </ul>
        )}
      </aside>
      )}
    </div>
  );
}
