import { useEffect, useState } from "react";
import { errorText, studentApi } from "../api";
import type { ActionScreen, StudentModel, TopicState, TopicStatus } from "../types";
import { MemorySection } from "./MemorySection";
import { SessionMemories } from "./Settings";

const GROUPS: { status: TopicStatus; title: string; empty: string }[] = [
  { status: "le_cuesta", title: "Le cuesta", empty: "Nada por ahora." },
  { status: "pendiente", title: "Quedó pendiente", empty: "Nada pendiente." },
  { status: "practicando", title: "Practicando", empty: "Todavía nada en práctica." },
  { status: "domina", title: "Ya lo domina", empty: "Aparece cuando terminás sesiones, practicás o rendís simulacros." },
];

export const daysText = (days: number) => (days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`);

/**
 * AC-113: what Eureka learned about the person, in one place: topics by state
 * with the evidence behind each, what is coming, and what it remembers of each
 * session. Everything can be corrected or forgotten.
 */
export function ProgressScreen({ onOpenScreen, onOpenSession, onStudy }: { onOpenScreen: (s: ActionScreen) => void; onOpenSession: (id: string) => void; onStudy: (message: string) => void }) {
  const [m, setM] = useState<StudentModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    studentApi.model().then(setM).catch((e) => setError(errorText(e)));
  }, []);

  const markKnown = async (t: TopicState) => {
    try {
      setM(await studentApi.markKnown(t.name));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="practice progress-screen">
      <header className="chat-head">
        <h1 className="chat-title">Mi progreso</h1>
      </header>
      <div className="practice-body stack">
        <p className="muted">Esto es lo que Eureka aprendió de vos con tus sesiones, prácticas, simulacros, tarjetas y tu cursada. El profesor lo usa para elegir por dónde empezar. Si algo no es así, corregilo.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!m ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            <section className="card progress-stats" aria-label="Resumen">
              <span>
                <strong>{Math.round(m.minutes_7d)}</strong> min de estudio en 7 días
              </span>
              <span>
                <strong>{m.cards_due}</strong> tarjetas para hoy
              </span>
              <span>
                <strong>{m.topics.filter((t) => t.status === "domina").length}</strong> temas dominados
              </span>
              {m.upcoming.length > 0 && (
                <span className="progress-upcoming">
                  Se viene:{" "}
                  {m.upcoming.slice(0, 3).map((u, i) => (
                    <button key={u.id} className="link-btn" onClick={() => onOpenScreen(u.screen as ActionScreen)}>
                      {i > 0 ? " · " : ""}
                      {u.title} {daysText(u.days)}
                    </button>
                  ))}
                </span>
              )}
            </section>

            <div className="progress-groups">
              {GROUPS.map((g) => {
                const topics = m.topics.filter((t) => t.status === g.status);
                return (
                  <section key={g.status} className={`card progress-group status-${g.status}`} aria-label={g.title}>
                    <h2>
                      {g.title} <span className="muted small">({topics.length})</span>
                    </h2>
                    {topics.length === 0 ? (
                      <p className="muted small">{g.empty}</p>
                    ) : (
                      <ul className="progress-list">
                        {topics.slice(0, 12).map((t) => (
                          <li key={t.key}>
                            <strong>{t.name}</strong>
                            <ul className="progress-evidence">
                              {t.evidence.map((e, i) => (
                                <li key={i} className="small muted">
                                  {e}
                                </li>
                              ))}
                            </ul>
                            <span className="row">
                              {g.status === "le_cuesta" && (
                                <button className="btn small" onClick={() => onStudy(`Quiero repasar ${t.name}.`)}>
                                  Repasarlo
                                </button>
                              )}
                              {t.confusion && t.status === "le_cuesta" && (
                                <button className="btn ghost small" onClick={() => markKnown(t)} aria-label={`Esto ya lo sé: ${t.name}`}>
                                  Esto ya lo sé
                                </button>
                              )}
                              {g.status === "pendiente" && (
                                <button
                                  className="btn small"
                                  onClick={() => {
                                    const p = m.pending.find((x) => x.item === t.name);
                                    if (p) onOpenSession(p.session_id);
                                    else onStudy(`Quiero retomar: ${t.name}.`);
                                  }}
                                >
                                  Retomar
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
        <MemorySection />
        <SessionMemories />
      </div>
    </div>
  );
}
