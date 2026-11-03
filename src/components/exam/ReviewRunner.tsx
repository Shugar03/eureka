import { useMemo, useState } from "react";
import { api, errorText } from "../../api";
import type { Exam, ReviewItem } from "../../types";
import { isRight, reviewQueue } from "../../lib/exam";
import { Markdown } from "../Markdown";
import { ChoiceList } from "./ChoiceList";
import { QuestionTools } from "./QuestionTools";

interface ReviewProps {
  exam: Exam;
  onChanged: (e: Exam) => void;
  onDone: () => void;
  onStudy: (topicId: string) => void;
}

/** AC-40: failed questions one at a time, with feedback right away. */
export function ReviewRunner({ exam, onChanged, onDone, onStudy }: ReviewProps) {
  // This round's questions, fixed at the start: a mastered one leaves the
  // exam's list but still shows its feedback here.
  const [round] = useState<ReviewItem[]>(() => reviewQueue(exam));
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<{ right: boolean; left: boolean } | null>(null);
  const [rights, setRights] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainName = useMemo(() => new Map(exam.domains.map((d) => [d.id, d.name])), [exam]);

  if (index >= round.length) {
    return (
      <div className="practice-body">
        <section className="card" aria-label="Fin del repaso">
          <h2>Repaso terminado</h2>
          <p data-testid="review-summary">
            Acertaste {rights} de {round.length}.{" "}
            {exam.review.length ? `Quedan ${exam.review.length} para repasar.` : "No te queda ninguna pregunta para repasar."}
          </p>
          <div className="row-end">
            <button className="btn primary" onClick={onDone}>
              Volver al examen
            </button>
          </div>
        </section>
      </div>
    );
  }

  const item = round[index];
  const q = item.question;
  const answer = async () => {
    if (!choice.length) return;
    setBusy(true);
    setError(null);
    try {
      const e = await api.answerReview(exam.id, item.id, choice);
      const right = isRight(q.answer, choice);
      setFeedback({ right, left: !e.review.some((r) => r.id === item.id) });
      if (right) setRights((r) => r + 1);
      onChanged(e);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    setIndex((i) => i + 1);
    setChoice([]);
    setFeedback(null);
  };

  return (
    <div className="practice-body">
      <div className="row-between">
        <span className="muted" data-testid="review-progress">
          Pregunta {index + 1} de {round.length}
        </span>
        <span className="muted small">{domainName.get(q.domain_id)}</span>
      </div>
      <fieldset className="card mock-q" aria-label="Pregunta de repaso">
        <legend className="muted small">Para salir del repaso: 2 aciertos seguidos ({item.streak}/2)</legend>
        <Markdown text={q.stem} />
        <ChoiceList name={`review-${item.id}`} options={q.options} answer={q.answer} chosen={choice} reveal={!!feedback} disabled={busy} onChange={setChoice} />
        {feedback && (
          <div className="explanation" data-testid="review-feedback">
            <strong>{feedback.right ? "Correcta." : "Incorrecta."}</strong>{" "}
            {feedback.right ? (feedback.left ? "Dos aciertos seguidos: sale del repaso." : "Una más y sale del repaso.") : "Vuelve a empezar: acertala 2 veces seguidas."}{" "}
            <Markdown text={q.explanation} />
            {!feedback.right && q.topic_id && (
              <button className="link" onClick={() => onStudy(q.topic_id!)}>
                Estudiar este tema
              </button>
            )}
          </div>
        )}
        {feedback && (
          <QuestionTools
            examId={exam.id}
            question={q}
            chosen={choice}
            onReport={async () => {
              onChanged(await api.reportReview(exam.id, item.id));
              setFeedback((f) => f && { ...f, left: true });
            }}
          />
        )}
      </fieldset>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="row-end">
        {feedback ? (
          <button className="btn primary" onClick={next}>
            {index + 1 < round.length ? "Siguiente" : "Terminar"}
          </button>
        ) : (
          <button className="btn primary" disabled={choice.length < q.answer.length || busy} onClick={answer}>
            {busy ? "Corrigiendo…" : "Responder"}
          </button>
        )}
      </div>
    </div>
  );
}
