import { useEffect, useMemo, useState } from "react";
import { api, cardsApi, errorText } from "../../api";
import type { CodeProposal, DeckProposal, GraphView, PracticeProposal } from "../../types";
import { localDate } from "../../lib/exam";
import { sameName } from "../../lib/examChat";
import { matchIdeas } from "../../lib/proposals";
import type { CodeSeed } from "../code/CodeScreen";
import { langLabel } from "../../lib/code";

/**
 * AC-161: a deck the person asked for in the chat. Every card can be edited
 * or taken out before "Crear el mazo"; reopening the chat finds the deck by
 * its name instead of offering it again.
 */
export function DeckProposalCard({ proposal, onOpenDeck }: { proposal: DeckProposal; onOpenDeck: (id: string) => void }) {
  const [name, setName] = useState(proposal.name);
  const [cards, setCards] = useState(proposal.cards.map((c) => ({ ...c })));
  const [existing, setExisting] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    cardsApi
      .listDecks(localDate(new Date()))
      .then((all) => setExisting(all.find((d) => sameName(d.name, proposal.name))?.id ?? null))
      .catch(() => {});
  }, [proposal.name]);

  if (dismissed) return null;
  const ready = cards.filter((c) => c.front.trim() && c.back.trim());
  const edit = (i: number, side: "front" | "back", v: string) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, [side]: v } : c)));
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await cardsApi.importCards(name.trim(), ready.map((c) => [c.front, c.back]), localDate(new Date())));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="exam-offer" aria-label={`Mazo «${proposal.name}»`}>
      <h3>{created ? "Tu mazo está listo" : `Mazo «${proposal.name}»`}</h3>
      {created ? (
        <div className="row">
          <span className="muted small" role="status">
            {ready.length} {ready.length === 1 ? "tarjeta" : "tarjetas"}, todas para hoy.
          </span>
          <button className="btn primary small" onClick={() => onOpenDeck(created)}>
            Estudiar el mazo
          </button>
        </div>
      ) : existing ? (
        <div className="row">
          <span className="muted small">Ya tenés un mazo con este nombre.</span>
          <button className="btn small" onClick={() => onOpenDeck(existing)}>
            Abrirlo
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Nombre del mazo</span>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del mazo propuesto" />
          </label>
          <ol className="deck-edit" aria-label="Tarjetas propuestas">
            {cards.map((c, i) => (
              <li key={i}>
                <input value={c.front} onChange={(e) => edit(i, "front", e.target.value)} aria-label={`Frente ${i + 1}`} />
                <input value={c.back} onChange={(e) => edit(i, "back", e.target.value)} aria-label={`Dorso ${i + 1}`} />
                <button className="btn ghost small" onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))} aria-label={`Sacar la tarjeta ${i + 1}`}>
                  Sacar
                </button>
              </li>
            ))}
          </ol>
          <div className="row">
            <button className="btn primary small" onClick={create} disabled={busy || !ready.length || !name.trim()}>
              {busy ? "Creando…" : `Crear el mazo (${ready.length})`}
            </button>
            <button className="btn ghost small" onClick={() => setDismissed(true)} disabled={busy}>
              Ahora no
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const COUNTS = [3, 5, 10];

/**
 * AC-162: a practice on ideas of the person's graph. The ideas the agent named
 * come checked when they match; the person picks and confirms (it spends model).
 */
export function PracticeProposalCard({ proposal, onOpenPractice }: { proposal: PracticeProposal; onOpenPractice: (id: string) => void }) {
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(COUNTS.includes(proposal.count ?? 3) ? (proposal.count ?? 3) : 3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api
      .getGraph()
      .then((g) => {
        setGraph(g);
        setChosen(new Set(matchIdeas(g.nodes, proposal.ideas).map((n) => n.id)));
      })
      .catch((e) => setError(errorText(e)));
  }, [proposal.ideas]);
  const offered = useMemo(() => (graph ? matchIdeas(graph.nodes, proposal.ideas, 12) : []), [graph, proposal.ideas]);

  if (dismissed) return null;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onOpenPractice((await api.createPractice([...chosen], count)).id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) => setChosen((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));

  return (
    <section className="exam-offer" aria-label="Práctica propuesta">
      <h3>Practicar {proposal.ideas.join(", ")}</h3>
      {graph && offered.length === 0 ? (
        <p className="muted small">Todavía no hay ideas así en tu grafo: aprendelas en una sesión y después las practicás.</p>
      ) : (
        <fieldset className="practice-pick">
          <legend>Ideas de tu grafo</legend>
          {offered.map((n) => (
            <label key={n.id} className="check">
              <input type="checkbox" checked={chosen.has(n.id)} onChange={() => toggle(n.id)} />
              {n.text}
            </label>
          ))}
        </fieldset>
      )}
      <div className="row">
        <div className="tabs" role="radiogroup" aria-label="Cuántos problemas">
          {COUNTS.map((c) => (
            <button key={c} role="radio" aria-checked={count === c} className={count === c ? "is-active" : ""} onClick={() => setCount(c)}>
              {c}
            </button>
          ))}
        </div>
        <button className="btn primary small" onClick={create} disabled={busy || chosen.size === 0}>
          {busy ? "Generando…" : "Generar una práctica nueva"}
        </button>
        <button className="btn ghost small" onClick={() => setDismissed(true)} disabled={busy}>
          Ahora no
        </button>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const LEVELS = ["básico", "medio", "avanzado"];

/** AC-163: an exercise for the code console; topic and level can change before it is generated there. */
export function CodeProposalCard({ proposal, onOpenCode }: { proposal: CodeProposal; onOpenCode: (seed: CodeSeed) => void }) {
  const [topic, setTopic] = useState(proposal.topic);
  const [level, setLevel] = useState(proposal.level ?? "medio");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <section className="exam-offer" aria-label="Ejercicio de programación propuesto">
      <h3>Ejercicio de {langLabel(proposal.language)}</h3>
      <div className="row wrap">
        <label className="field grow">
          <span>Tema</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Tema del ejercicio" />
        </label>
        <label className="field">
          <span>Nivel</span>
          <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel del ejercicio">
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn primary small" disabled={!topic.trim()} onClick={() => onOpenCode({ lang: proposal.language, code: "", title: topic.trim(), exercise: { topic: topic.trim(), level } })}>
          Generar un ejercicio nuevo en Código
        </button>
        <button className="btn ghost small" onClick={() => setDismissed(true)}>
          Ahora no
        </button>
      </div>
    </section>
  );
}
