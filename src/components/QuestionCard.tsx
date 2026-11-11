import { useEffect, useMemo, useState } from "react";
import type { AnswerMeta, LearnerInput, QuestionArgs } from "../types";
import { PURPOSE_LABEL } from "../lib/transcript";
import { expected, formatOf, grade, gradable } from "../lib/grade";
import { Markdown } from "./Markdown";
import { ReadAloud } from "./a11y/ReadAloud";
import { Dictate } from "./a11y/Dictate";
import { useAccessibility } from "./a11y/AccessibilityContext";
import { MicButton } from "./chat/ChatTools";

export { formatOf } from "../lib/grade";
export type { Format } from "../lib/grade";

interface Props {
  args: QuestionArgs;
  answer: AnswerMeta | null;
  pending: boolean;
  /** Answered by writing in the chat: the message is the bubble below. */
  inChat?: boolean;
  busy: boolean;
  /** Overrides the purpose label (e.g. "Problema" in practice). */
  tag?: string;
  onSubmit: (input: LearnerInput) => void;
  /** AC-168: what is written so far (answer and thinking), as it changes. */
  onDraft?: (draft: string) => void;
  /** A diagnostic question: which one it is, and how many the teacher expects ("pregunta 2 de ~3"). */
  step?: { n: number; of?: number };
  /** AC-184: stops the diagnosis with what the teacher already knows. */
  onEnough?: () => void;
}

const CONFIDENCE = ["Ni idea", "Dudo mucho", "Más o menos", "Bastante seguro", "Seguro"];

/** A stable shuffle (same question, same order on every render); mostly-in-place is rotated. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out = items.map((x, i) => ({ x, k: Math.imul(h ^ (i + 1) * 2654435761, 2246822519) >>> 0 })).sort((a, b) => a.k - b.k).map((o) => o.x);
  // Mostly in place gives the answer away: then rotate, which moves every item.
  const inPlace = out.filter((x, i) => x === items[i]).length;
  return out.length > 1 && inPlace * 2 >= out.length ? [...out.slice(1), out[0]] : out;
}

/** Cloze: the question with each ___ as a numbered gap. */
const BLANK = /_{3,}/g;

/** AC-208: right after «Comprobar»: green when right, red with the right answer when not. */
function Verdict({ args, answer }: { args: QuestionArgs; answer: AnswerMeta }) {
  const g = answer.grade;
  if (!g) return null;
  return (
    <div className={`verdict ${g.correct ? "is-right" : "is-wrong"}`} role="status" data-testid="verdict">
      <strong>{g.correct ? "¡Bien!" : g.right > 0 ? "Casi" : "No era así"}</strong>
      {g.total > 1 && (
        <span className="verdict-score">
          {g.right} de {g.total}
        </span>
      )}
      {!g.correct && <span className="verdict-key">Respuesta correcta: {expected(args)}</span>}
    </div>
  );
}

export function QuestionCard({ args, answer, pending, busy, onSubmit, onDraft, tag, inChat, step, onEnough }: Props) {
  const format = formatOf(args);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({});
  const items = useMemo(() => args.items?.filter(Boolean) ?? [], [args.items]);
  const bankOrder = useMemo(() => shuffled(items, args.question), [items, args.question]);
  const [order, setOrder] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<number, string>>({});
  const [leftSel, setLeftSel] = useState<number | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const options = args.options?.filter(Boolean) ?? [];
  const statements = args.statements?.filter(Boolean) ?? [];
  const pairs = useMemo(() => args.pairs?.filter((p) => p.left && p.right) ?? [], [args.pairs]);
  const rights = useMemo(() => shuffled(pairs.map((p) => p.right), args.question), [pairs, args.question]);
  const blanks = format === "cloze" ? (args.question.match(BLANK) ?? []).length : 0;
  // Cloze with a word bank (options): the words are tapped into the gaps in order.
  const wordBank = format === "cloze" && options.length > 0 ? shuffled(options, args.question) : [];
  // «Responder dictando» (Ajustes) adds its own Dictar button; otherwise the microphone is always there, as in the chat box.
  const { a } = useAccessibility();
  const append = (setter: (f: (s: string) => string) => void) => (t: string) => setter((d) => (d.trim() ? `${d.trim()} ${t}` : t));
  const checks = gradable(args);
  // Calibration matters when explaining; a tap question shows right away whether it was right.
  const needsConfidence = format === "open" && args.purpose !== "predict";
  const comment = text.trim();

  /** What the teacher reads: the learner's answer, spelled out whatever the format. */
  const response = (() => {
    const withComment = (s: string) => [s, comment].filter(Boolean).join(" — ");
    switch (format) {
      case "open":
        return comment;
      case "choice":
        return choice ? withComment(choice) : "";
      case "multi":
        return picked.length ? withComment(`Elegí: ${options.filter((o) => picked.includes(o)).join("; ")}`) : "";
      case "true_false":
        return Object.keys(verdicts).length === statements.length
          ? withComment(statements.map((s, i) => `${i + 1}. «${s}»: ${verdicts[i] ? "verdadero" : "falso"}`).join("\n"))
          : "";
      case "order":
        return order.length === items.length ? withComment(`Mi orden: ${order.map((x, i) => `${i + 1}) ${x}`).join(" ")}`) : "";
      case "match":
        return Object.keys(matches).length === pairs.length ? withComment(pairs.map((p, i) => `«${p.left}» → «${matches[i]}»`).join("\n")) : "";
      case "cloze": {
        if (gaps.filter((g) => g?.trim()).length < blanks) return "";
        let i = 0;
        return withComment(args.question.replace(BLANK, () => `[${gaps[i++].trim()}]`));
      }
    }
  })();
  const canSend = pending && !busy && response.length > 0 && (!needsConfidence || confidence !== null);
  const draft = [response, thinking.trim()].filter(Boolean).join("\n");
  useEffect(() => onDraft?.(draft), [draft, onDraft]);

  const submit = () => {
    if (!canSend) return;
    const g = grade(args, { choice, picked, verdicts, order, matches, gaps });
    onSubmit({ text: response, confidence, thinking: thinking.trim(), ...(g ? { grade: g } : {}) });
  };

  // Match: tap a left tile, then a right one; tapping a linked left tile unlinks it.
  const pickLeft = (i: number) => {
    if (matches[i] !== undefined) {
      setMatches((m) => {
        const next = { ...m };
        delete next[i];
        return next;
      });
      setLeftSel(null);
      return;
    }
    setLeftSel(leftSel === i ? null : i);
  };
  const pickRight = (r: string) => {
    if (leftSel === null) return;
    setMatches((m) => {
      const next = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== r));
      return { ...next, [leftSel]: r };
    });
    setLeftSel(null);
  };
  const pairNo = (i: number) => Object.keys(matches).map(Number).sort((x, y) => x - y).indexOf(i) + 1;

  // Cloze: tap a word into the next empty gap, tap a filled gap to empty it.
  const fillGap = (w: string) =>
    setGaps((g) => {
      const next = Array.from({ length: blanks }, (_, i) => g[i] ?? "");
      const i = next.findIndex((x) => !x);
      if (i < 0) return g;
      next[i] = w;
      return next;
    });

  let gapNo = 0;
  const question =
    format === "cloze"
      ? args.question.replace(BLANK, () => {
          const i = gapNo++;
          return wordBank.length && gaps[i] ? `**(${i + 1})** __${gaps[i]}__` : `**(${i + 1})** \\_\\_\\_\\_`;
        })
      : args.question;
  const listen = [args.question, ...options.map((o, i) => `Opción ${i + 1}: ${o}`), ...statements.map((s, i) => `Afirmación ${i + 1}: ${s}`), ...bankOrder.map((x, i) => `Elemento ${i + 1}: ${x}`)].join("\n");

  return (
    <section
      className={`question ${pending ? "is-pending" : ""}`}
      aria-label={pending ? "Pregunta pendiente" : "Pregunta"}
      data-testid={pending ? "question-pending" : "question"}
      data-purpose={args.purpose}
      data-format={format}
    >
      <header className="question-head">
        <span className={`tag tag-${args.purpose}`}>{tag ?? PURPOSE_LABEL[args.purpose] ?? args.purpose}</span>
        {step && (
          <span className="muted small" data-testid="probe-step">
            Pregunta {step.n}
            {step.of ? ` de ~${Math.max(step.of, step.n)}` : ""}
          </span>
        )}
      </header>
      <Markdown text={question} />
      {pending && <ReadAloud markdown={listen} label="Escuchar la pregunta" />}

      {inChat && <p className="muted small">Respondiste escribiendo en el chat.</p>}

      {answer && (
        <div className="answer" data-testid="answer">
          <div className="answer-text">{answer.text}</div>
          <div className="answer-meta">
            {answer.confidence != null && <span>Confianza {answer.confidence}/5</span>}
            {answer.thinking && <span className="answer-thinking">“{answer.thinking}”</span>}
            {answer.reading && <span className="answer-thinking">Mientras leías: “{answer.reading}”</span>}
          </div>
          <Verdict args={args} answer={answer} />
        </div>
      )}

      {pending && (
        <div className="answer-form">
          {format === "choice" && (
            <div className="options" role="radiogroup" aria-label="Opciones">
              {options.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={choice === o} className={`option ${choice === o ? "is-selected" : ""}`} onClick={() => setChoice(o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
          {format === "multi" && (
            <div className="options" role="group" aria-label="Opciones (podés elegir varias)">
              <span className="muted small">Puede haber más de una correcta.</span>
              {options.map((o) => {
                const on = picked.includes(o);
                return (
                  <button key={o} type="button" role="checkbox" aria-checked={on} className={`option ${on ? "is-selected" : ""}`} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== o) : [...p, o]))}>
                    {o}
                  </button>
                );
              })}
            </div>
          )}
          {format === "true_false" && (
            <ol className="tf-list" aria-label="Afirmaciones">
              {statements.map((s, i) => (
                <li key={i} className="tf-row">
                  <span className="tf-text">
                    <Markdown text={s} />
                  </span>
                  <span className="tf-pick" role="radiogroup" aria-label={`Afirmación ${i + 1}`}>
                    {[true, false].map((v) => (
                      <button key={String(v)} type="button" role="radio" aria-checked={verdicts[i] === v} className={`tf-btn ${verdicts[i] === v ? "is-selected" : ""}`} onClick={() => setVerdicts((d) => ({ ...d, [i]: v }))}>
                        {v ? "Verdadero" : "Falso"}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {format === "order" && (
            <div className="tiles-order">
              <ol className="order-slots" aria-label="Tu orden, de primero a último">
                {items.map((_, i) => (
                  <li key={i} className={`order-slot ${order[i] ? "is-filled" : ""}`}>
                    <span className="order-n">{i + 1}</span>
                    {order[i] ? (
                      <button type="button" className="tile tile-in" onClick={() => setOrder((o) => o.filter((_, j) => j !== i))} aria-label={`Sacar «${order[i]}»`}>
                        {order[i]}
                      </button>
                    ) : (
                      <span className="muted small">{i === order.length ? "Tocá la ficha que va acá" : ""}</span>
                    )}
                  </li>
                ))}
              </ol>
              <div className="tile-bank" role="group" aria-label="Fichas para ordenar">
                {bankOrder.map((x) => {
                  const used = order.includes(x);
                  return (
                    <button key={x} type="button" className={`tile ${used ? "is-used" : ""}`} disabled={used} onClick={() => setOrder((o) => [...o, x])} aria-label={`Ubicar «${x}»`}>
                      {x}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {format === "match" && (
            <div className="tiles-match" role="group" aria-label="Tocá uno de la izquierda y después su par">
              <div className="tile-col">
                {pairs.map((p, i) => {
                  const n = matches[i] !== undefined ? pairNo(i) : 0;
                  return (
                    <button key={i} type="button" className={`tile ${leftSel === i ? "is-selected" : ""} ${n ? "is-linked" : ""}`} aria-pressed={leftSel === i} onClick={() => pickLeft(i)} aria-label={n ? `${p.left}, unido con «${matches[i]}»` : p.left}>
                      {n > 0 && <span className="tile-badge">{n}</span>}
                      {p.left}
                    </button>
                  );
                })}
              </div>
              <div className="tile-col">
                {rights.map((r) => {
                  const owner = Object.entries(matches).find(([, v]) => v === r)?.[0];
                  const n = owner !== undefined ? pairNo(Number(owner)) : 0;
                  return (
                    <button key={r} type="button" className={`tile ${n ? "is-linked" : ""}`} onClick={() => pickRight(r)} disabled={leftSel === null && !n} aria-label={n ? `${r}, unido` : r}>
                      {n > 0 && <span className="tile-badge">{n}</span>}
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {format === "cloze" &&
            (wordBank.length ? (
              <div className="tile-bank" role="group" aria-label="Palabras para completar">
                {Array.from({ length: blanks }, (_, i) =>
                  gaps[i] ? (
                    <button key={`g${i}`} type="button" className="tile tile-in" onClick={() => setGaps((g) => Object.assign([...g], { [i]: "" }))} aria-label={`Vaciar el hueco ${i + 1}`}>
                      ({i + 1}) {gaps[i]}
                    </button>
                  ) : null,
                )}
                {wordBank.map((w) => {
                  const used = gaps.includes(w);
                  return (
                    <button key={w} type="button" className={`tile ${used ? "is-used" : ""}`} disabled={used} onClick={() => fillGap(w)}>
                      {w}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="cloze-gaps" role="group" aria-label="Huecos">
                {Array.from({ length: blanks }, (_, i) => (
                  <label key={i} className="cloze-gap">
                    <span>({i + 1})</span>
                    <input value={gaps[i] ?? ""} onChange={(e) => setGaps((g) => Object.assign([...g], { [i]: e.target.value }))} aria-label={`Hueco ${i + 1}`} />
                  </label>
                ))}
              </div>
            ))}

          <div className="field-voice">
            <label className="field">
              <span>{format === "open" ? "Tu respuesta" : "Comentario (opcional)"}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={format === "open" ? 3 : 1}
                placeholder={format === "open" ? "Respondé con tus palabras…" : ""}
                aria-label={format === "open" ? "Tu respuesta" : "Comentario"}
              />
            </label>
            {!a.dictation && <MicButton label={format === "open" ? "Responder con la voz" : "Dictar el comentario"} onText={append(setText)} />}
          </div>
          <Dictate onText={append(setText)} />
          <div className="confidence-row">
            <span className="small muted">{needsConfidence ? "¿Qué tan seguro estás?" : "¿Qué tan seguro? (opcional)"}</span>
            <div className="confidence" role="radiogroup" aria-label="Confianza">
              {CONFIDENCE.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={confidence === i + 1}
                  className={`conf ${confidence === i + 1 ? "is-selected" : ""}`}
                  onClick={() => setConfidence(confidence === i + 1 && !needsConfidence ? null : i + 1)}
                  aria-label={`Confianza ${i + 1}: ${label}`}
                  title={label}
                >
                  {i + 1}
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </div>
          {showThinking || thinking ? (
            <div className="field-voice">
              <label className="field">
                <span>Pensando en voz alta (opcional)</span>
                <textarea value={thinking} onChange={(e) => setThinking(e.target.value)} rows={2} placeholder="Cómo lo razonaste, qué dudas tenés, qué te hace ruido…" aria-label="Pensando en voz alta" autoFocus={!thinking} />
              </label>
              {!a.dictation && <MicButton label="Contar cómo lo pensaste con la voz" onText={append(setThinking)} />}
            </div>
          ) : null}
          <div className="row-end">
            {!showThinking && !thinking && (
              <button type="button" className="btn ghost small think-toggle" onClick={() => setShowThinking(true)}>
                + Contar cómo lo pensé
              </button>
            )}
            {onEnough && (
              <button type="button" className="btn ghost" onClick={onEnough} disabled={busy} title="Con lo que ya sé alcanza para armar el plan">
                Con esto alcanza, empecemos
              </button>
            )}
            <button className="btn primary" onClick={submit} disabled={!canSend}>
              {checks ? "Comprobar" : "Responder"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
