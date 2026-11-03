import { useState } from "react";
import { findQuote, pickAnother, quoteOfDay, type ShownQuote } from "../../lib/quotes";
import { Icon } from "../Icon";
import { setQuotePrefs, useQuotePrefs } from "./useQuotePrefs";

/** The quote's source line: work, and whether the Spanish is a free translation. */
export function QuoteSource({ q }: { q: ShownQuote }) {
  return (
    <figcaption className="quote-source">
      <span className="quote-author">{q.author || "Anónimo"}</span>
      {q.work && <span className="quote-work">{q.work}</span>}
      {!q.original && <span className="quote-tr">traducción libre</span>}
      {q.mine && <span className="quote-tr">una de las tuyas</span>}
    </figcaption>
  );
}

/** AC-130, AC-131: the home card — today's quote, another one, keep it or never see it again. */
export function QuoteCard() {
  const prefs = useQuotePrefs();
  const [shownId, setShownId] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const q = (shownId && !prefs.hidden.includes(shownId) && findQuote(shownId, prefs.mine)) || quoteOfDay(new Date(), prefs.hidden);
  const fav = prefs.favorites.includes(q.id);

  const another = () => {
    const { quote, seen } = pickAnother(prefs, q.id);
    setQuotePrefs({ seen });
    setShownId(quote.id);
    setUndo(null);
  };
  const toggleFav = () => setQuotePrefs((p) => ({ favorites: fav ? p.favorites.filter((x) => x !== q.id) : [...p.favorites, q.id] }));
  const hide = () => {
    setQuotePrefs((p) => ({ hidden: [...p.hidden, q.id], favorites: p.favorites.filter((x) => x !== q.id) }));
    setUndo(q.id);
    setShownId(null);
  };

  return (
    <figure className="quote-card" aria-label="Cita">
      <blockquote className="aside-quote" data-testid="quote-text">
        “{q.text}”
      </blockquote>
      <QuoteSource q={q} />
      <div className="quote-actions">
        <button className="btn ghost small" onClick={another}>
          Otra cita
        </button>
        <button className={`btn ghost small quote-fav ${fav ? "is-on" : ""}`} aria-pressed={fav} onClick={toggleFav} aria-label={fav ? "Quitar de favoritas" : "Guardar como favorita"} title={fav ? "Quitar de favoritas" : "Guardar como favorita"}>
          <Icon name="heart" size={15} />
        </button>
        <button className="btn ghost small" onClick={hide}>
          No mostrar más
        </button>
      </div>
      <p className="muted small" role="status">
        {undo && (
          <>
            Listo, no te la vuelvo a mostrar.{" "}
            <button
              className="link"
              onClick={() => {
                setQuotePrefs((p) => ({ hidden: p.hidden.filter((x) => x !== undo) }));
                setShownId(undo);
                setUndo(null);
              }}
            >
              Deshacer
            </button>
          </>
        )}
      </p>
    </figure>
  );
}
