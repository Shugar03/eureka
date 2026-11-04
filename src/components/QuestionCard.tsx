import { useEffect, useState } from "react";
import type { AnswerMeta, LearnerInput, QuestionArgs } from "../types";
import { PURPOSE_LABEL } from "../lib/transcript";
import { Markdown } from "./Markdown";
import { ReadAloud } from "./a11y/ReadAloud";
import { Dictate } from "./a11y/Dictate";
import { useAccessibility } from "./a11y/AccessibilityContext";
import { MicButton } from "./chat/ChatTools";

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

export function QuestionCard({ args, answer, pending, busy, onSubmit, onDraft, tag, inChat, step, onEnough }: Props) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");
  const options = args.options?.filter(Boolean) ?? [];
  // «Responder dictando» (Ajustes) adds its own Dictar button; otherwise the microphone is always there, as in the chat box.
  const { a } = useAccessibility();
  const append = (setter: (f: (s: string) => string) => void) => (t: string) => setter((d) => (d.trim() ? `${d.trim()} ${t}` : t));

  const response = options.length ? [choice, text.trim()].filter(Boolean).join(" — ") : text.trim();
  const canSend = pending && !busy && response.length > 0 && confidence !== null;
  const draft = [response, thinking.trim()].filter(Boolean).join("\n");
  useEffect(() => onDraft?.(draft), [draft, onDraft]);

  const submit = () => {
    if (canSend) onSubmit({ text: response, confidence, thinking: thinking.trim() });
  };

  return (
    <section
      className={`question ${pending ? "is-pending" : ""}`}
      aria-label={pending ? "Pregunta pendiente" : "Pregunta"}
      data-testid={pending ? "question-pending" : "question"}
      data-purpose={args.purpose}
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
      <Markdown text={args.question} />
      {pending && <ReadAloud markdown={[args.question, ...options.map((o, i) => `Opción ${i + 1}: ${o}`)].join("\n")} label="Escuchar la pregunta" />}

      {inChat && <p className="muted small">Respondiste escribiendo en el chat.</p>}

      {answer && (
        <div className="answer" data-testid="answer">
          <div className="answer-text">{answer.text}</div>
          <div className="answer-meta">
            {answer.confidence != null && <span>Confianza {answer.confidence}/5</span>}
            {answer.thinking && <span className="answer-thinking">“{answer.thinking}”</span>}
            {answer.reading && <span className="answer-thinking">Mientras leías: “{answer.reading}”</span>}
          </div>
        </div>
      )}

      {pending && (
        <div className="answer-form">
          {options.length > 0 && (
            <div className="options" role="radiogroup" aria-label="Opciones">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={choice === o}
                  className={`option ${choice === o ? "is-selected" : ""}`}
                  onClick={() => setChoice(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <div className="field-voice">
            <label className="field">
              <span>{options.length ? "Comentario (opcional)" : "Tu respuesta"}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={options.length ? 1 : 3}
                placeholder={options.length ? "" : "Respondé con tus palabras…"}
                aria-label={options.length ? "Comentario" : "Tu respuesta"}
              />
            </label>
            {!a.dictation && <MicButton label={options.length ? "Dictar el comentario" : "Responder con la voz"} onText={append(setText)} />}
          </div>
          <Dictate onText={append(setText)} />
          <div className="field">
            <span>¿Qué tan seguro estás?</span>
            <div className="confidence" role="radiogroup" aria-label="Confianza">
              {CONFIDENCE.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={confidence === i + 1}
                  className={`conf ${confidence === i + 1 ? "is-selected" : ""}`}
                  onClick={() => setConfidence(i + 1)}
                  aria-label={`Confianza ${i + 1}: ${label}`}
                >
                  {i + 1}
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="field-voice">
            <label className="field">
              <span>Pensando en voz alta (opcional)</span>
              <textarea
                value={thinking}
                onChange={(e) => setThinking(e.target.value)}
                rows={2}
                placeholder="Cómo lo razonaste, qué dudas tenés, qué te hace ruido…"
                aria-label="Pensando en voz alta"
              />
            </label>
            {!a.dictation && <MicButton label="Contar cómo lo pensaste con la voz" onText={append(setThinking)} />}
          </div>
          <div className="row-end">
            {onEnough && (
              <button type="button" className="btn ghost" onClick={onEnough} disabled={busy} title="Con lo que ya sé alcanza para armar el plan">
                Con esto alcanza, empecemos
              </button>
            )}
            <button className="btn primary" onClick={submit} disabled={!canSend}>
              Responder
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
