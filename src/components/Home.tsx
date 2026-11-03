import { useEffect, useRef, useState } from "react";
import { StudyStats } from "./pomodoro/StudyStats";
import { TodayPanel } from "./TodayPanel";
import { SessionList } from "./SessionList";
import { TodayPlan } from "./TodayPlan";
import { TodayDashboard } from "./dashboard/TodayDashboard";
import { api, errorText } from "../api";
import type { ActionScreen, SessionSummary } from "../types";
import { greeting } from "../lib/workspace";
import { QuoteCard } from "./quotes/QuoteCard";
import { Icon, type IconName } from "./Icon";
import { AttachButton, AttachChips, MicButton, useAttachments } from "./chat/ChatTools";
import { composeMessage } from "../lib/attachments";
import { QuickSetup } from "./QuickSetup";

interface Props {
  sessions: SessionSummary[];
  onChanged: () => void;
  onOpen: (id: string) => void;
  onOpenSettings: () => void;
  onOpenExam?: (id: string) => void;
  onOpenDeck?: (id: string) => void;
  onOpenAgenda?: () => void;
  /** The learner's name (Mi espacio), for the greeting. */
  name?: string;
  onGo?: (to: "exams" | "cards" | "practice" | "library") => void;
  /** AC-112: where the plan for today sends the person. */
  onOpenScreen?: (s: ActionScreen) => void;
}

const QUICK: { to: "exams" | "cards" | "practice" | "library"; icon: IconName; title: string; text: string }[] = [
  { to: "practice", icon: "pencil", title: "Practicar", text: "Problemas con pistas y corrección." },
  { to: "cards", icon: "cards", title: "Repasar tarjetas", text: "Lo que toca hoy, a tu ritmo." },
  { to: "exams", icon: "target", title: "Preparar un examen", text: "Un plan hasta la fecha." },
  { to: "library", icon: "book", title: "Mis libros", text: "Subí un PDF y estudiá con él." },
];

const EXAMPLES = [
  "Por qué la derivada de eˣ es eˣ",
  "Cómo funciona la criptografía de clave pública",
  "Qué es la entropía en termodinámica",
];

export function Home({ sessions, onChanged, onOpen, onOpenSettings, onOpenExam, onOpenDeck, onOpenAgenda, name = "", onGo, onOpenScreen }: Props) {
  const [draft, setDraft] = useState("");
  const attach = useAttachments();
  const box = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const now = new Date();

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setConfigured(!!s.roles.teacher.model && s.providers.some((p) => p.id === s.roles.teacher.provider_id && p.has_key)))
      .catch(() => {});
  }, []);

  // The box grows with what is written, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // AC-89: whatever is written starts a conversation; the agent decides what to do with it.
  const canSend = (!!draft.trim() || attach.items.length > 0) && !attach.working;
  const start = async (text = composeMessage(draft, attach.items)) => {
    if (!text.trim() || attach.working) return;
    try {
      const s = await api.startChat(text);
      attach.clear();
      onChanged();
      onOpen(s.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="home">
      <div className="home-body">
      <section className="home-main">
        <span className="eyebrow">{greeting(name)}</span>
        <h1 className="hero">¿Qué querés entender?</h1>
        <p className="hero-sub">Contame qué querés aprender, preguntame lo que sea o pedime una mano para organizarte.</p>

        {/* AC-158: one key is enough to start; the manual way stays in Ajustes. */}
        {!configured && (
          <div className="home-setup">
            <QuickSetup />
            <button className="link small" onClick={onOpenSettings}>
              Prefiero configurarlo a mano en Ajustes
            </button>
          </div>
        )}

        <form
          className="goal-form"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <textarea
            ref={box}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                start();
              }
            }}
            placeholder="Escribí un mensaje…"
            aria-label="Mensaje"
            autoFocus
          />
          <AttachButton onFiles={attach.add} disabled={!!attach.working} />
          <MicButton onText={(t) => setDraft((d) => (d.trim() ? `${d.trim()} ${t}` : t))} />
          <button className="btn primary" type="submit" disabled={!canSend}>
            Enviar
          </button>
        </form>
        <AttachChips items={attach.items} working={attach.working} error={attach.error} onRemove={attach.remove} />
        {onGo && (
          <div className="quick" aria-label="Atajos">
            {QUICK.map((q) => (
              <button key={q.to} className="quick-card" onClick={() => onGo(q.to)}>
                <span className="quick-icon" aria-hidden>
                  <Icon name={q.icon} size={20} />
                </span>
                <strong>{q.title}</strong>
                <span>{q.text}</span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {onOpenScreen && <TodayDashboard onOpenScreen={onOpenScreen} onOpenExam={onOpenExam} />}

        {onOpenScreen && <TodayPlan onOpenScreen={onOpenScreen} onOpenSession={onOpen} onStartChat={(t) => void start(t)} />}

        {onOpenExam && onOpenDeck && onOpenAgenda && (
          <TodayPanel sessions={sessions.filter((s) => !s.archived)} onOpenSession={onOpen} onOpenExam={onOpenExam} onOpenDeck={onOpenDeck} onOpenAgenda={onOpenAgenda} />
        )}

        <StudyStats />

        <SessionList sessions={sessions} onOpen={onOpen} onChanged={onChanged} />
      </section>

      <aside className="home-aside" aria-label="Para hoy">
        <h2 className="aside-title">{now.getHours() >= 6 && now.getHours() < 20 ? "Hoy puede ser un gran día" : "Que la calma te acompañe"}</h2>
        <p className="aside-sub">La claridad también es una forma de avanzar.</p>
        <QuoteCard />
        <h3 className="aside-h3">Sugerencias</h3>
        <ul className="aside-list">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button className="aside-item" onClick={() => start(ex)}>
                <span>{ex}</span>
                <Icon name="arrow" size={15} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      </div>
    </div>
  );
}
