import { useState } from "react";
import { DATED, findQuote, makeMine, MAX_MINE, QUOTES, splashEnabled } from "../../lib/quotes";
import { setQuotePrefs, useQuotePrefs } from "./useQuotePrefs";

/** AC-132, AC-133: Mi espacio › Citas — the welcome, favourites, hidden ones and the learner's own. */
export function QuotesSection() {
  const prefs = useQuotePrefs();
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const authors = new Set(QUOTES.map((q) => q.author)).size;
  const favorites = prefs.favorites.map((id) => findQuote(id, prefs.mine)).filter((q) => q !== null);
  const hidden = prefs.hidden.map((id) => findQuote(id, prefs.mine)).filter((q) => q !== null);

  const add = () => {
    const m = makeMine(text, author);
    if (!m) return;
    setQuotePrefs((p) => ({ mine: [...p.mine, m].slice(0, MAX_MINE) }));
    setText("");
    setAuthor("");
  };

  return (
    <section className="card" aria-label="Citas">
      <h2>Citas</h2>
      <p className="muted small">
        Hay {DATED.length} citas, una para cada día del año, de {authors} autores. Cada una dice de qué obra viene; las que no se escribieron en español son traducciones libres.
      </p>
      <label className="a11y-check check">
        <input type="checkbox" checked={splashEnabled(prefs, "")} onChange={(e) => setQuotePrefs({ splash: e.target.checked })} />
        <span>
          Mostrar la cita del día al abrir Eureka
          <small className="muted">Una bienvenida tranquila antes de entrar. Se cierra con «Entrar» o con Esc.</small>
        </span>
      </label>

      <h3 className="quotes-h3">Mis favoritas</h3>
      {favorites.length === 0 ? (
        <p className="muted small">Todavía no guardaste ninguna. Tocá el corazón en la cita del inicio.</p>
      ) : (
        <ul className="quote-list" aria-label="Mis favoritas">
          {favorites.map((q) => (
            <li key={q.id}>
              <span>
                “{q.text}” <span className="muted">— {q.author || "Anónimo"}</span>
              </span>
              <button className="btn ghost small" onClick={() => setQuotePrefs((p) => ({ favorites: p.favorites.filter((x) => x !== q.id) }))} aria-label={`Quitar de favoritas: ${q.text}`}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="quotes-h3">Mis frases</h3>
      <p className="muted small">Las tuyas, o las de alguien que te importa: se mezclan con las demás en «Otra cita».</p>
      {prefs.mine.length > 0 && (
        <ul className="quote-list" aria-label="Mis frases">
          {prefs.mine.map((q) => (
            <li key={q.id}>
              <span>
                “{q.text}” {q.author && <span className="muted">— {q.author}</span>}
              </span>
              <button className="btn ghost small" onClick={() => setQuotePrefs((p) => ({ mine: p.mine.filter((x) => x.id !== q.id), favorites: p.favorites.filter((x) => x !== q.id), hidden: p.hidden.filter((x) => x !== q.id) }))} aria-label={`Borrar mi frase: ${q.text}`}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="quote-form">
        <label className="field">
          <span>Frase</span>
          <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} aria-label="Nueva frase" />
        </label>
        <label className="field">
          <span>De quién (opcional)</span>
          <input maxLength={80} value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor de la frase" />
        </label>
        <div className="row-end">
          <button className="btn" onClick={add} disabled={!text.trim() || prefs.mine.length >= MAX_MINE}>
            Agregar frase
          </button>
        </div>
      </div>

      {hidden.length > 0 && (
        <div>
          <button className="link small" onClick={() => setShowHidden((s) => !s)} aria-expanded={showHidden}>
            {showHidden ? "Ocultar la lista" : `Ver las que pediste no mostrar (${hidden.length})`}
          </button>
          {showHidden && (
            <ul className="quote-list" aria-label="Citas ocultas">
              {hidden.map((q) => (
                <li key={q.id}>
                  <span>
                    “{q.text}” <span className="muted">— {q.author || "Anónimo"}</span>
                  </span>
                  <button className="btn ghost small" onClick={() => setQuotePrefs((p) => ({ hidden: p.hidden.filter((x) => x !== q.id) }))} aria-label={`Volver a mostrar: ${q.text}`}>
                    Volver a mostrar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
