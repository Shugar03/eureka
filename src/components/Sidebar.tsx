import { useState, type ReactNode } from "react";
import logo from "../../assets/brand/eureka-mark.svg";
import type { SessionSummary } from "../types";
import { PHASES } from "../lib/transcript";
import { Icon, type IconName } from "./Icon";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  view: "home" | "session" | "graph" | "library" | "practice" | "exams" | "cards" | "agenda" | "academic" | "classes" | "progress" | "code" | "language" | "companion" | "settings";
  onHome: () => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onGraph: () => void;
  onLibrary: () => void;
  onPractice: () => void;
  onExams: () => void;
  onCards: () => void;
  onAgenda: () => void;
  onAcademic: () => void;
  onClasses: () => void;
  onProgress: () => void;
  onCode: () => void;
  onLanguage: () => void;
  onCompanion: () => void;
  onCommand: () => void;
  /** The learner's name (Mi espacio); the profile card opens that tab. */
  name?: string;
  onWorkspace?: () => void;
  /** Shown above the theme switch (the pomodoro). */
  footer?: ReactNode;
}

const PHASE_ICON: Record<string, string> = { chat: "○", probe: "◔", plan: "◑", teach: "◕", done: "●" };

type View = Props["view"];
type Item = { view: View; icon: IconName; label: string; run: () => void };

export function Sidebar({ sessions, activeId, view, onHome, onOpen, onSettings, onGraph, onLibrary, onPractice, onExams, onCards, onAgenda, onAcademic, onClasses, onProgress, onCode, onLanguage, onCompanion, onCommand, footer, name = "", onWorkspace }: Props) {
  const study: Item[] = [
    { view: "home", icon: "plus", label: "Nueva sesión", run: onHome },
    { view: "practice", icon: "pencil", label: "Práctica", run: onPractice },
    { view: "exams", icon: "target", label: "Exámenes", run: onExams },
    { view: "cards", icon: "cards", label: "Tarjetas", run: onCards },
  ];
  const material: Item[] = [
    { view: "library", icon: "book", label: "Biblioteca", run: onLibrary },
    { view: "agenda", icon: "calendar", label: "Agenda", run: onAgenda },
    { view: "academic", icon: "cap", label: "Mi cursada", run: onAcademic },
    { view: "classes", icon: "mic", label: "Clases", run: onClasses },
    { view: "progress", icon: "spark", label: "Mi progreso", run: onProgress },
  ];
  const more: Item[] = [
    { view: "graph", icon: "graph", label: "Grafo", run: onGraph },
    { view: "companion", icon: "heart", label: "Acompañamiento", run: onCompanion },
    { view: "code", icon: "code", label: "Código", run: onCode },
    { view: "language", icon: "globe", label: "Idiomas", run: onLanguage },
  ];
  /** null = follow the active view; a boolean = the learner toggled it. */
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const moreHasActive = more.some((it) => it.view === view);
  const initial = name.trim().charAt(0).toUpperCase();

  const renderItem = (it: Item) => (
    <button key={it.view} className={`sb-item ${view === it.view ? "is-active" : ""}`} onClick={it.run}>
      <span className="sb-icon" aria-hidden>
        <Icon name={it.icon} />
      </span>
      {it.label}
    </button>
  );

  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sb-brand">
        <span className="sb-logo" aria-hidden>
          <img src={logo} alt="" width={20} height={20} />
        </span>
        Eureka
        <button className="sb-search" onClick={onCommand} aria-label="Buscar o ejecutar" title="Buscar o ejecutar · Ctrl K">
          <Icon name="search" size={15} />
        </button>
      </div>

      <div className="sb-section">Estudiar</div>
      {study.map(renderItem)}

      <div className="sb-section">Mi material</div>
      {material.map(renderItem)}

      <details className="sb-more" open={moreOpen ?? moreHasActive} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary className="sb-section">Más</summary>
        {more.map(renderItem)}
      </details>

      <div className="sb-section">Sesiones</div>
      <div className="sb-list" role="region" aria-label="Sesiones recientes" tabIndex={0}>
        {sessions.filter((s) => !s.archived).length === 0 && <p className="sb-empty">Todavía no hay sesiones.</p>}
        {sessions.filter((s) => !s.archived).map((s) => (
          <button
            key={s.id}
            className={`sb-item sb-session ${activeId === s.id ? "is-active" : ""}`}
            aria-current={activeId === s.id ? "page" : undefined}
            onClick={() => onOpen(s.id)}
            title={`${s.title} · ${PHASES.find((p) => p.id === s.phase)?.label}`}
          >
            <span className={`sb-phase phase-${s.phase}`} aria-hidden>
              {PHASE_ICON[s.phase]}
            </span>
            <span className="sb-label">{s.title}</span>
            {s.pinned && <span className="sb-pin" aria-label="Fijada">●</span>}
          </button>
        ))}
      </div>

      {renderItem({ view: "settings", icon: "gear", label: "Ajustes", run: onSettings })}
      {footer}
      {onWorkspace && (
        <button className="sb-profile" onClick={onWorkspace} title="Cambiar el fondo, el color, el tema y tu nombre">
          <span className="sb-avatar" aria-hidden>
            {initial || <Icon name="sparkle" size={16} />}
          </span>
          <span className="sb-profile-text">
            <strong>{name.trim() || "Mi espacio"}</strong>
            <small>Personalizar</small>
          </span>
        </button>
      )}
    </nav>
  );
}
