import { useEffect, useState } from "react";
import { api, studentApi } from "../api";
import type { ActionScreen, RememberedSession, Suggestion } from "../types";

const LAST_VISIT = "la.lastVisit";

const readLastVisit = (): string | null => {
  try {
    return localStorage.getItem(LAST_VISIT);
  } catch {
    return null;
  }
};

/** What the background memory pass wrote since the person last opened Home. */
export const sinceLastVisit = (list: RememberedSession[], lastVisit: string | null) => (lastVisit ? list.filter((r) => r.memory.at > lastVisit) : []);

interface Props {
  onOpenScreen: (s: ActionScreen) => void;
  onOpenSession: (id: string) => void;
  onStartChat: (prompt: string) => void;
}

/**
 * AC-112: "Tu plan de hoy" (up to three things, each with its reason) and
 * "Desde la última vez" (what Eureka noted in the background), on Home.
 */
export function TodayPlan({ onOpenScreen, onOpenSession, onStartChat }: Props) {
  const [plan, setPlan] = useState<Suggestion[]>([]);
  const [news, setNews] = useState<RememberedSession[]>([]);

  useEffect(() => {
    studentApi.today().then(setPlan).catch(() => {});
    const last = readLastVisit();
    api
      .sessionMemories()
      .then((list) => setNews(sinceLastVisit(list, last)))
      .catch(() => {});
    try {
      localStorage.setItem(LAST_VISIT, new Date().toISOString());
    } catch {
      /* private mode: no "since last time", the rest works */
    }
  }, []);

  const go = (s: Suggestion) => {
    if (s.screen === "session" && s.target_id) onOpenSession(s.target_id);
    else if (s.screen === "chat" && s.prompt) onStartChat(s.prompt);
    else if (s.screen !== "session" && s.screen !== "chat") onOpenScreen(s.screen);
  };

  if (!plan.length && !news.length) return null;
  return (
    <section className="card today-plan" aria-label="Tu plan de hoy">
      {news.length > 0 && (
        <p className="since-last small" role="status">
          Desde la última vez anoté lo de {news.slice(0, 2).map((n) => `«${n.title}»`).join(" y ")}
          {news.length > 2 ? ` y ${news.length - 2} más` : ""}
          {news[0].memory.pending[0] ? `: quedó pendiente ${news[0].memory.pending[0]}.` : "."}
        </p>
      )}
      {plan.length > 0 && (
        <>
          <h2>Tu plan de hoy</h2>
          <ol className="today-plan-list">
            {plan.map((s, i) => (
              <li key={i}>
                <span>
                  <strong>{s.title}</strong>
                  <span className="muted small">{s.reason}</span>
                </span>
                <button className="btn small" onClick={() => go(s)} aria-label={`Empezar: ${s.title}`}>
                  Empezar
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
