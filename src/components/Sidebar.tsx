import type { ReactNode } from "react";
import logo from "../../assets/brand/eureka-mark.svg";
import type { SessionSummary } from "../types";
import { PHASES } from "../lib/transcript";
import type { Theme } from "../lib/theme";
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
  theme: Theme;
  onTheme: (t: Theme) => void;
  /** The learner's name (Mi espacio); the profile card opens that tab. */
  name?: string;
  onWorkspace?: () => void;
  /** Shown above the theme switch (the pomodoro). */
  footer?: ReactNode;
}

const THEMES: { id: Theme; label: string; icon: IconName }[] = [
  { id: "dark", label: "Oscuro", icon: "moon" },
  { id: "light", label: "Claro", icon: "sun" },
  { id: "system", label: "Sistema", icon: "half" },
];

const PHASE_ICON: Record<string, string> = { chat: "○", probe: "◔", plan: "◑", teach: "◕", done: "●" };

type View = Props["view"];

export function Sidebar({ sessions, activeId, view, onHome, onOpen, onSettings, onGraph, onLibrary, onPractice, onExams, onCards, onAgenda, onAcademic, onClasses, onProgress, onCode, onLanguage, onCompanion, onCommand, theme, onTheme, footer, name = "", onWorkspace }: Props) {
  const items: { view: View; icon: IconName; label: string; run: () => void }[] = [
    { view: "home", icon: "plus", label: "Nueva sesión", run: onHome },
    { view: "graph", icon: "graph", label: "Grafo", run: onGraph },
    { view: "library", icon: "book", label: "Biblioteca", run: onLibrary },
    { view: "practice", icon: "pencil", label: "Práctica", run: onPractice },
    { view: "exams", icon: "target", label: "Exámenes", run: onExams },
    { view: "cards", icon: "cards", label: "Tarjetas", run: onCards },
    { view: "agenda", icon: "calendar", label: "Agenda", run: onAgenda },
    { view: "academic", icon: "cap", label: "Mi cursada", run: onAcademic },
    { view: "classes", icon: "mic", label: "Clases", run: onClasses },
    { view: "progress", icon: "spark", label: "Mi progreso", run: onProgress },
    { view: "code", icon: "code", label: "Código", run: onCode },
    { view: "language", icon: "globe", label: "Idiomas", run: onLanguage },
    { view: "companion", icon: "heart", label: "Acompañamiento", run: onCompanion },
    { view: "settings", icon: "gear", label: "Ajustes", run: onSettings },
  ];
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sb-brand">
        <span className="sb-logo" aria-hidden>
          <img src={logo} alt="" width={20} height={20} />
        </span>
        Eureka
      </div>

      <button className="sb-search" onClick={onCommand}>
        <span className="sb-search-label">
          <Icon name="search" size={15} /> Buscar o ejecutar…
        </span>
        <kbd>Ctrl K</kbd>
      </button>

      {items.map((it) => (
        <button key={it.view} className={`sb-item ${view === it.view ? "is-active" : ""}`} onClick={it.run}>
          <span className="sb-icon" aria-hidden>
            <Icon name={it.icon} />
          </span>
          {it.label}
        </button>
      ))}

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

      {footer}
      {onWorkspace && (
        <button className="sb-profile" onClick={onWorkspace} title="Cambiar el fondo, el color y tu nombre">
          <span className="sb-avatar" aria-hidden>
            {initial || <Icon name="sparkle" size={16} />}
          </span>
          <span className="sb-profile-text">
            <strong>{name.trim() || "Mi espacio"}</strong>
            <small>Personalizar</small>
          </span>
        </button>
      )}
      <div className="sb-theme" role="radiogroup" aria-label="Tema">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            aria-label={`Tema ${t.label.toLowerCase()}`}
            title={t.label}
            className={theme === t.id ? "is-active" : ""}
            onClick={() => onTheme(t.id)}
          >
            <Icon name={t.icon} size={15} />
          </button>
        ))}
      </div>
    </nav>
  );
}
