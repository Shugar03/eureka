import { useEffect, useMemo, useState } from "react";
import { api, cardsApi, errorText, visionApi } from "../../api";
import type { CardSource, DeckSummary, ExamSummary, GraphView } from "../../types";
import { filterGraph } from "../../lib/graphView";
import { localDate } from "../../lib/exam";
import { DECK_FILES, readDeckFile, type PendingImport } from "../../lib/deckImport";
import { imageToDataUrl } from "../../lib/images";
import { DeckView } from "./DeckView";

interface Props {
  /** Open this deck directly (e.g. just generated from an exam). */
  initialId: string | null;
  /** AC-154: a shared deck Eureka was opened with, to review before importing. */
  incoming?: PendingImport | null;
  /** The incoming deck was imported or dismissed: it is not offered again. */
  onIncomingDone?: () => void;
}

export function CardsScreen({ initialId, incoming = null, onIncomingDone = () => {} }: Props) {
  const [openId, setOpenId] = useState<string | null>(initialId);
  useEffect(() => setOpenId(initialId), [initialId]);
  return openId ? <DeckView key={openId} id={openId} onBack={() => setOpenId(null)} /> : <DecksHome onOpen={setOpenId} incoming={incoming} onIncomingDone={onIncomingDone} />;
}

type Kind = "manual" | "exam" | "graph" | "notes";
const KINDS: { id: Kind; label: string }[] = [
  { id: "manual", label: "Vacío" },
  { id: "exam", label: "De un examen" },
  { id: "graph", label: "De ideas del grafo" },
  { id: "notes", label: "De mis apuntes" },
];
const COUNTS = [10, 20, 30];

function DecksHome({ onOpen, incoming, onIncomingDone }: { onOpen: (id: string) => void; incoming: PendingImport | null; onIncomingDone: () => void }) {
  const today = localDate(new Date());
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("manual");
  const [examId, setExamId] = useState("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(incoming);
  const [reading, setReading] = useState(false);
  useEffect(() => setPending(incoming), [incoming]);

  const refresh = () =>
    cardsApi
      .listDecks(today)
      .then(setDecks)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    refresh();
    api
      .listExams()
      .then(setExams)
      .catch(() => {});
    api
      .getGraph()
      .then(setGraph)
      .catch(() => {});
  }, []);

  const ideas = useMemo(() => (graph ? filterGraph(graph, query).nodes : []), [graph, query]);
  const source = (): CardSource | null => (kind === "exam" ? { kind: "exam", id: examId } : kind === "graph" ? { kind: "graph", node_ids: [...chosen] } : kind === "notes" ? { kind: "notes", text: notes } : null);
  const ready = name.trim() && (kind === "manual" || (kind === "exam" && examId) || (kind === "graph" && chosen.size) || (kind === "notes" && notes.trim()));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = source();
      const d = s ? await cardsApi.generateDeck(name, s, count, today) : await cardsApi.createDeck(name);
      onOpen(d.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // AC-60/152/154: Anki (.apkg or plain text) or a shared deck: preview first.
  const readImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPending(null);
    setReading(true);
    try {
      setPending(await readDeckFile(file));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  };

  const confirmImport = async (p: PendingImport) => {
    setBusy(true);
    setError(null);
    try {
      const id = await cardsApi.importCards(p.name.trim() || "Mazo importado", p.cards, today);
      onIncomingDone();
      onOpen(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // AC-63: photos of handwritten notes, transcribed into the notes box.
  const readPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const images = await Promise.all([...files].slice(0, 8).map(imageToDataUrl));
      const text = await visionApi.read(images, "notes");
      setNotes((n) => (n.trim() ? `${n.trim()}\n\n${text}` : text));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    await cardsApi.deleteDeck(id).catch((e) => setError(errorText(e)));
    refresh();
  };

  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Tarjetas</h1>
      </header>
      <div className="practice-body">
        <section className="card" aria-label="Nuevo mazo">
          <h2>Nuevo mazo</h2>
          <p className="muted small">Tarjetas de memoria con repetición espaciada: cada una vuelve justo antes de que la olvides. Escribilas vos o generalas de un examen, de tu grafo o de tus apuntes.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del mazo, p. ej. AWS: servicios y límites" aria-label="Nombre del mazo" />
          <div className="tabs wrap" role="radiogroup" aria-label="Origen de las tarjetas">
            {KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={kind === k.id} className={kind === k.id ? "is-active" : ""} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          {kind === "exam" && (
            <select value={examId} onChange={(e) => setExamId(e.target.value)} aria-label="Examen">
              <option value="">Elegí un examen…</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {kind === "graph" && (
            <>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar ideas…" aria-label="Filtrar ideas para tarjetas" />
              <ul className="idea-list" aria-label="Ideas">
                {ideas.length === 0 && <li className="muted small">Tu grafo todavía no tiene ideas: terminá una sesión o importá notas.</li>}
                {ideas.map((n) => (
                  <li key={n.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.has(n.id)}
                        onChange={() =>
                          setChosen((c) => {
                            const next = new Set(c);
                            if (next.has(n.id)) next.delete(n.id);
                            else next.add(n.id);
                            return next;
                          })
                        }
                      />
                      <span>{n.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {kind === "notes" && (
            <>
              <textarea className="guide-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} placeholder="Pegá tus apuntes…" aria-label="Apuntes" />
              <label className="btn ghost small file-pick photo-pick">
                {busy ? "Leyendo fotos…" : "Leer de fotos de mis apuntes"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  aria-label="Fotos de apuntes"
                  onChange={(e) => {
                    readPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          )}
          <div className="row-between">
            {kind !== "manual" ? (
              <div className="tabs" role="radiogroup" aria-label="Cantidad de tarjetas">
                {COUNTS.map((c) => (
                  <button key={c} role="radio" aria-checked={count === c} className={count === c ? "is-active" : ""} onClick={() => setCount(c)}>
                    {c} tarjetas
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <label className="btn ghost small file-pick" title="Un mazo de Anki (.apkg o texto plano) o uno que te compartieron (.eureka)">
              {reading ? "Leyendo…" : "Importar un mazo"}
              <input
                type="file"
                accept={DECK_FILES}
                aria-label="Importar un mazo de Anki o compartido"
                aria-describedby="deck-import-hint"
                disabled={reading}
                onChange={(e) => {
                  readImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span id="deck-import-hint" className="muted small touch-hint">
              Un mazo de Anki (.apkg o texto plano) o uno que te compartieron (.eureka).
            </span>
            <button className="btn primary" disabled={busy || !ready} onClick={create}>
              {busy ? "Generando…" : kind === "manual" ? "Crear mazo" : "Generar mazo"}
            </button>
          </div>
        </section>

        {pending && (
          <ImportPreview
            pending={pending}
            busy={busy}
            onChange={setPending}
            onImport={confirmImport}
            onCancel={() => {
              setPending(null);
              onIncomingDone();
            }}
          />
        )}

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {decks.length > 0 && (
          <section className="sessions" aria-label="Mazos">
            <h2>Tus mazos</h2>
            <ul>
              {decks.map((d) => (
                <li key={d.id} className="session-row">
                  <button className="session-open" onClick={() => onOpen(d.id)}>
                    <span className="session-title">{d.name}</span>
                    <span className="session-meta">
                      {d.due + Math.min(d.new, 20) > 0 ? <strong className="due-badge">{d.due + Math.min(d.new, 20)} para hoy</strong> : "al día"} · {d.total} tarjetas
                    </span>
                  </button>
                  <button
                    className={`btn small ${armed === d.id ? "danger" : "ghost"}`}
                    onClick={() => remove(d.id)}
                    onBlur={() => setArmed((a) => (a === d.id ? null : a))}
                    aria-label={armed === d.id ? `Confirmar borrar ${d.name}` : `Borrar ${d.name}`}
                  >
                    {armed === d.id ? "¿Seguro? Borrar" : "Borrar"}
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

/** AC-152/154: what is about to be imported, with its name editable. */
function ImportPreview({ pending: p, busy, onChange, onImport, onCancel }: { pending: PendingImport; busy: boolean; onChange: (p: PendingImport) => void; onImport: (p: PendingImport) => void; onCancel: () => void }) {
  const count = `${p.cards.length} ${p.cards.length === 1 ? "tarjeta" : "tarjetas"}`;
  return (
    <section className="card draft" aria-label="Mazo para importar">
      <h2>{p.origin === "shared" ? "Te compartieron un mazo" : "Mazo de Anki"}</h2>
      <p className="muted small">
        {count}, todas como nuevas: empezás a repasarlas desde hoy.
        {p.origin === "shared" && " Revisalas: vienen de otra persona."}
      </p>
      <label className="field">
        <span>Nombre del mazo</span>
        <input value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} aria-label="Nombre del mazo para importar" />
      </label>
      <ul className="import-sample" aria-label="Primeras tarjetas">
        {p.cards.slice(0, 3).map(([front, back], i) => (
          <li key={i}>
            <strong>{front}</strong>
            <span className="muted">{back}</span>
          </li>
        ))}
      </ul>
      {p.leftOut && <p className="muted small">{p.leftOut}</p>}
      <div className="row-end">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn primary" onClick={() => onImport(p)} disabled={busy || !p.name.trim()}>
          {busy ? "Importando…" : `Importar ${count}`}
        </button>
      </div>
    </section>
  );
}
