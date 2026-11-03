import { useEffect, useState } from "react";
import type { AnswerMeta, LearnerInput, QuestionArgs } from "../types";
import { PURPOSE_LABEL } from "../lib/transcript";
import { Markdown } from "./Markdown";
import { ReadAloud } from "./a11y/ReadAloud";
import { Dictate } from "./a11y/Dictate";

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
}

const CONFIDENCE = ["Ni idea", "Dudo mucho", "Más o menos", "Bastante seguro", "Seguro"];

export function QuestionCard({ args, answer, pending, busy, onSubmit, onDraft, tag, inChat }: Props) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [thinking, setThinking] = useState("");
  const options = args.options?.filter(Boolean) ?? [];

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
          <Dictate onText={(t) => setText((d) => (d.trim() ? `${d.trim()} ${t}` : t))} />
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
          <div className="row-end">
            <button className="btn primary" onClick={submit} disabled={!canSend}>
              Responder
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
