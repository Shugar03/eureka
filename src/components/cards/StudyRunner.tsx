import { useEffect, useState } from "react";
import { cardsApi, errorText } from "../../api";
import type { Card, Deck, Grade } from "../../types";
import { dueQueue, GRADES, intervalLabel, nextInterval } from "../../lib/cards";
import { localDate } from "../../lib/exam";
import { Markdown } from "../Markdown";

interface Props {
  deck: Deck;
  onChanged: (d: Deck) => void;
  onDone: () => void;
}

/** AC-48: today's cards one by one; "Otra vez" sends a card to the end of the session. */
export function StudyRunner({ deck, onChanged, onDone }: Props) {
  const [today] = useState(() => localDate(new Date()));
  const [queue, setQueue] = useState<string[]>(() => dueQueue(deck, today).map((c) => c.id));
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card: Card | undefined = deck.cards.find((c) => c.id === queue[0]);

  const grade = async (g: Grade) => {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await cardsApi.gradeCard(deck.id, card.id, g, today));
      setQueue((q) => (g === "again" ? [...q.slice(1), q[0]] : q.slice(1)));
      if (g === "again") setAgain((n) => n + 1);
      else setDone((n) => n + 1);
      setShown(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Space/Enter shows the answer; 1–4 grade it (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) grade(g.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) {
    return (
      <section className="card" aria-label="Fin del estudio">
        <h2>¡Listo por hoy!</h2>
        <p data-testid="study-summary">
          Repasaste {done} {done === 1 ? "tarjeta" : "tarjetas"}
          {again ? ` (${again} ${again === 1 ? "volvió" : "volvieron"} a la fila)` : ""}. Las próximas te van a aparecer cuando estén por olvidarse.
        </p>
        <div className="row-end">
          <button className="btn primary" onClick={onDone}>
            Volver al mazo
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="study">
      <p className="muted small" data-testid="study-progress">
        Quedan {queue.length} · {card.reviewed ? "repaso" : "nueva"}
      </p>
      <section className="card flashcard" aria-label="Tarjeta">
        <div className="flash-front">
          <Markdown text={card.front} />
        </div>
        {shown && (
          <div className="flash-back" data-testid="card-back">
            <Markdown text={card.back} />
          </div>
        )}
      </section>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {shown ? (
        <div className="grade-row" role="group" aria-label="¿Qué tan bien la recordaste?">
          {GRADES.map((g) => (
            <button key={g.id} className={`btn grade-${g.id}`} disabled={busy} onClick={() => grade(g.id)} aria-keyshortcuts={g.key}>
              <span>{g.label}</span>
              <span className="grade-next">{intervalLabel(nextInterval(card, g.id))}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="row-end">
          <span className="muted small">Espacio para ver la respuesta · 1–4 para calificar</span>
          <button className="btn primary" onClick={() => setShown(true)}>
            Mostrar respuesta
          </button>
        </div>
      )}
    </div>
  );
}
