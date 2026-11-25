import { useEffect, useState } from "react";
import { api, errorText } from "../../api";
import { thisDevice } from "../../lib/platform";
import type { RememberedSession } from "../../types";

/** AC-110: what Eureka remembers of each conversation, to pick it up later — and forgetting it. */
export function SessionMemories() {
  const [list, setList] = useState<RememberedSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.sessionMemories().then(setList).catch(() => setList([]));
  }, []);
  if (!list) return null;
  const forget = async (id: string) => {
    try {
      setList(await api.forgetSessionMemory(id));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card" aria-label="Lo que recuerda de tus sesiones">
      <h2>Lo que recuerda de tus sesiones</h2>
      <p className="muted small">
        Cuando una conversación queda quieta unos minutos, Eureka anota en segundo plano qué vieron, qué quedó pendiente y qué te costó, y pasa las ideas a tu grafo. Así el profesor puede retomar otro día. Usa el modelo de la tarea Extractor y queda solo en {thisDevice()}.
      </p>
      {list.length === 0 ? (
        <p className="muted small">Todavía nada: aparece cuando una conversación lleva un rato quieta.</p>
      ) : (
        <ul className="memory-list">
          {list.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.title}</strong> <span className="muted small">· {new Date(r.updated_at).toLocaleDateString()}{r.archived ? " · archivada" : ""}</span>
                <p className="small">{r.memory.summary}</p>
                {r.memory.pending.length > 0 && <p className="small muted">Pendiente: {r.memory.pending.join("; ")}</p>}
                {r.memory.struggled.length > 0 && <p className="small muted">Le costó: {r.memory.struggled.join("; ")}</p>}
              </span>
              <button className="btn ghost small" onClick={() => forget(r.id)} aria-label={`Olvidar lo que recuerda de ${r.title}`}>
                Olvidar
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
