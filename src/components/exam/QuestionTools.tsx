import { useState } from "react";
import { api, errorText } from "../../api";
import type { ExamQuestion, ExplainTurn } from "../../types";
import { Markdown } from "../Markdown";
import { letter } from "./ChoiceList";

interface Props {
  examId: string;
  question: ExamQuestion;
  chosen: number[];
  /** Reports the question as wrong; resolves when saved. */
  onReport: (reason: string) => Promise<void>;
}

/** AC-45 / AC-46: under a graded question, ask the teacher about it or report it. */
export function QuestionTools({ examId, question, chosen, onReport }: Props) {
  const [open, setOpen] = useState<"ask" | "report" | null>(null);
  const wrong = chosen.find((c) => !question.answer.includes(c));
  const [ask, setAsk] = useState(wrong != null ? `¿Por qué no la ${letter(wrong)}?` : "");
  const [turns, setTurns] = useState<ExplainTurn[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const reply = await api.explainQuestion(examId, question, chosen, turns, ask);
      setTurns((t) => [...t, { role: "user", content: ask.trim() }, { role: "assistant", content: reply }]);
      setAsk("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReport(reason);
      setOpen(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="q-tools">
      <div className="row">
        <button className="btn ghost small" aria-expanded={open === "ask"} onClick={() => setOpen(open === "ask" ? null : "ask")}>
          Preguntar al profesor
        </button>
        {!question.reported && (
          <button className="btn ghost small" aria-expanded={open === "report"} onClick={() => setOpen(open === "report" ? null : "report")}>
            Esta pregunta está mal
          </button>
        )}
      </div>
      {open === "ask" && (
        <div className="ask-thread" role="region" aria-label="Duda sobre la pregunta">
          {turns.length > 0 && (
            <div role="log" className="ask-log">
              {turns.map((t, i) => (
                <div key={i} className={`ask-turn ask-${t.role}`}>
                  {t.role === "user" ? <strong>{t.content}</strong> : <Markdown text={t.content} />}
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask.trim() && !busy && send()}
              placeholder="¿Por qué no la B?"
              aria-label="Tu duda sobre la pregunta"
            />
            <button className="btn small" disabled={busy || !ask.trim()} onClick={send}>
              {busy ? "Pensando…" : "Preguntar"}
            </button>
          </div>
        </div>
      )}
      {open === "report" && (
        <div className="row report-row">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="¿Qué tiene de malo? (opcional)" aria-label="Motivo del reporte" />
          <button className="btn small danger" disabled={busy} onClick={report}>
            Reportar
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
