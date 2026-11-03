import { useEffect, useState } from "react";
import { cardsApi, errorText } from "../../api";
import type { Card, Deck } from "../../types";
import { dueQueue, intervalLabel } from "../../lib/cards";
import { daysUntil, localDate } from "../../lib/exam";
import { Markdown } from "../Markdown";
import { toAnkiText } from "../../lib/anki";
import { StudyRunner } from "./StudyRunner";
import { useStudyContext } from "../pomodoro/PomodoroContext";
import { ReadAloud } from "../a11y/ReadAloud";
import { deckScript } from "../../lib/listen";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { keepFile, onPhone, saveFile } from "../../lib/saveFile";

interface Props {
  id: string;
  onBack: () => void;
}

export function DeckView({ id, onBack }: Props) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [studying, setStudying] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [saved, setSaved] = useState<{ path: string; shared: boolean } | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = localDate(new Date());
  useStudyContext(deck ? { kind: "deck", id: deck.id, title: deck.name } : null);

  useEffect(() => {
    cardsApi
      .getDeck(id)
      .then(setDeck)
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (!deck) return <div className="center muted">{error ?? "Cargando…"}</div>;

  const header = (
    <header className="chat-head">
      <button className="crumb" onClick={studying ? () => setStudying(false) : onBack} aria-label={studying ? `Volver a ${deck.name}` : "Volver a Tarjetas"}>
        {studying ? deck.name : "Tarjetas"}
      </button>
      <span className="crumb-sep" aria-hidden>
        /
      </span>
      <h1 className="chat-title">{studying ? "Estudiar" : deck.name}</h1>
    </header>
  );

  if (studying) {
    return (
      <div className="practice-screen">
        {header}
        <div className="practice-body">
          <StudyRunner deck={deck} onChanged={setDeck} onDone={() => setStudying(false)} />
        </div>
      </div>
    );
  }

  const queue = dueQueue(deck, today);
  const fresh = deck.cards.filter((c) => !c.reviewed).length;

  const save = async () => {
    setError(null);
    try {
      setDeck(await cardsApi.saveCard(deck.id, editing?.id ?? null, front, back, today));
      setFront("");
      setBack("");
      setEditing(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const edit = (c: Card) => {
    setEditing(c);
    setFront(c.front);
    setBack(c.back);
  };

  const remove = async (c: Card) => {
    if (armed !== c.id) return setArmed(c.id);
    setArmed(null);
    try {
      setDeck(await cardsApi.deleteCard(deck.id, c.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  // AC-153/154: an .apkg for Anki, or a `.eureka` to send; both land in Downloads.
  const writeFile = async (shared: boolean) => {
    setError(null);
    try {
      const path = await keepFile(await (shared ? cardsApi.shareDeck(deck.id) : cardsApi.exportApkg(deck.id)));
      if (path) setSaved({ path, shared });
    } catch (e) {
      setError(errorText(e));
    }
  };

  // AC-60: Anki's plain text (Archivo → Importar).
  const exportAnki = () => {
    saveFile(`${deck.name.replace(/[\\/:*?"<>|]+/g, "-")}.txt`, toAnkiText(deck), "text/plain").catch((e) => setError(errorText(e)));
  };

  const when = (c: Card) => {
    if (!c.reviewed) return "nueva";
    const d = daysUntil(c.due, new Date());
    return d <= 0 ? "para hoy" : `vuelve en ${intervalLabel(d)}`;
  };

  return (
    <div className="practice-screen">
      {header}
      <div className="practice-body">
        <section className="card" aria-label="Para hoy">
          <div className="row-between">
            <div>
              <h2>{queue.length ? `${queue.length} para hoy` : "Nada pendiente hoy"}</h2>
              <p className="muted small" data-testid="deck-stats">
                {deck.cards.length} tarjetas · {fresh} nuevas. Cada tarjeta vuelve justo antes de que la olvides: si la recordás bien, cada vez más espaciado.
              </p>
            </div>
            <span className="row">
              <button className="btn primary" disabled={!queue.length} onClick={() => setStudying(true)}>
                Estudiar ({queue.length})
              </button>
            </span>
          </div>
          {/* AC-148: an audio quiz with the system voice, due cards first. */}
          {deck.cards.length > 0 && <ReadAloud markdown={deckScript(deck.name, [...queue, ...deck.cards.filter((c) => !queue.includes(c))])} label="Escuchar las tarjetas" always />}
          {deck.cards.length > 0 && (
            <div className="row wrap deck-share" role="group" aria-label="Compartir y exportar">
              <button className="btn small" onClick={() => writeFile(true)} title="Un archivo .eureka para mandar por WhatsApp o mail: quien lo abre con Eureka lo importa" aria-describedby="deck-share-eureka">
                Compartir
              </button>
              <button className="btn ghost small" onClick={() => writeFile(false)} title="Un paquete .apkg para Archivo → Importar en Anki" aria-describedby="deck-share-apkg">
                Exportar a Anki (.apkg)
              </button>
              <button className="btn ghost small" onClick={exportAnki} title="Notas en texto plano, para Anki u otras apps" aria-describedby="deck-share-txt">
                Texto plano (.txt)
              </button>
              <ul className="muted small touch-hint deck-share-hints">
                <li id="deck-share-eureka">Compartir: un archivo .eureka para mandar por WhatsApp o mail; quien lo abre con Eureka lo importa.</li>
                <li id="deck-share-apkg">Anki: un paquete .apkg para Archivo → Importar en Anki.</li>
                <li id="deck-share-txt">Texto plano: notas para Anki u otras apps.</li>
              </ul>
            </div>
          )}
          {saved && (
            <p className="muted small" role="status">
              {saved.shared ? "Listo para mandar: " : "Listo para Anki: "}
              <span className="path">{saved.path}</span>
              {saved.shared ? ". Mandalo por WhatsApp o mail; quien lo abra con Eureka lo importa (sin tu progreso). " : ". En Anki: Archivo → Importar. Las tarjetas llegan como nuevas. "}
              {!onPhone() && (
                <button className="link" onClick={() => revealItemInDir(saved.path).catch(() => {})}>
                  Mostrar en la carpeta
                </button>
              )}
            </p>
          )}
        </section>

        <section className="card" aria-label={editing ? "Editar tarjeta" : "Nueva tarjeta"}>
          <h2>{editing ? "Editar tarjeta" : "Nueva tarjeta"}</h2>
          <div className="card-form">
            <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} placeholder="Frente: una pregunta o pista" aria-label="Frente" />
            <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={2} placeholder="Dorso: la respuesta" aria-label="Dorso" />
          </div>
          <div className="row-end">
            {editing && (
              <button
                className="btn ghost"
                onClick={() => {
                  setEditing(null);
                  setFront("");
                  setBack("");
                }}
              >
                Cancelar
              </button>
            )}
            <button className="btn" disabled={!front.trim() || !back.trim()} onClick={save}>
              {editing ? "Guardar cambios" : "Agregar tarjeta"}
            </button>
          </div>
        </section>

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {deck.cards.length > 0 && (
          <section aria-label="Tarjetas del mazo">
            <ul className="card-list">
              {deck.cards.map((c) => (
                <li key={c.id}>
                  <div className="card-sides">
                    <Markdown text={c.front} />
                    <div className="muted">
                      <Markdown text={c.back} />
                    </div>
                  </div>
                  <span className="muted small">{when(c)}</span>
                  <button className="btn ghost small" onClick={() => edit(c)} aria-label={`Editar ${c.front}`}>
                    Editar
                  </button>
                  <button
                    className={`btn small ${armed === c.id ? "danger" : "ghost"}`}
                    onClick={() => remove(c)}
                    onBlur={() => setArmed((a) => (a === c.id ? null : a))}
                    aria-label={armed === c.id ? `Confirmar borrar ${c.front}` : `Borrar ${c.front}`}
                  >
                    {armed === c.id ? "¿Seguro?" : "Borrar"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
