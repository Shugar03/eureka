import { useState } from "react";
import { FoldersSettings } from "./folders/FoldersSettings";
import { WorkspaceTab } from "./workspace/WorkspaceTab";
import { AccessibilityTab } from "./settings/AccessibilityTab";
import { ConnectionTab } from "./settings/ConnectionTab";
import { ModelsTab } from "./settings/ModelsTab";
import { PromptsTab } from "./settings/PromptsTab";

export { SessionMemories } from "./settings/SessionMemories";

const ADVANCED_KEY = "la.advanced";
const readAdvanced = () => {
  try {
    return localStorage.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
};

export type SettingsTab = "connection" | "models" | "workspace" | "accessibility" | "folders" | "prompts";

export function Settings({ onBack, initialTab = "connection" }: { onBack: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  // Prompts are for people who want to tune the agent; everyone else never needs to see them.
  const [advanced, setAdvanced] = useState(readAdvanced);
  const showPrompts = advanced || tab === "prompts";
  const toggleAdvanced = (on: boolean) => {
    setAdvanced(on);
    try {
      localStorage.setItem(ADVANCED_KEY, on ? "1" : "0");
    } catch {
      /* private mode: it just won't be remembered */
    }
    if (!on && tab === "prompts") setTab("connection");
  };
  return (
    <div className="settings">
      <header className="chat-head">
        <button className="btn ghost" onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h1 className="chat-title">Ajustes</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "connection"} className={tab === "connection" ? "is-active" : ""} onClick={() => setTab("connection")}>
            Conexión
          </button>
          <button role="tab" aria-selected={tab === "workspace"} className={tab === "workspace" ? "is-active" : ""} onClick={() => setTab("workspace")}>
            Mi espacio
          </button>
          <button role="tab" aria-selected={tab === "accessibility"} className={tab === "accessibility" ? "is-active" : ""} onClick={() => setTab("accessibility")}>
            Accesibilidad
          </button>
          <button role="tab" aria-selected={tab === "folders"} className={tab === "folders" ? "is-active" : ""} onClick={() => setTab("folders")}>
            Carpetas
          </button>
          <button role="tab" aria-selected={tab === "models"} className={tab === "models" ? "is-active" : ""} onClick={() => setTab("models")}>
            Avanzado
          </button>
          {showPrompts && (
            <button role="tab" aria-selected={tab === "prompts"} className={tab === "prompts" ? "is-active" : ""} onClick={() => setTab("prompts")}>
              Prompts
            </button>
          )}
        </div>
      </header>
      <div className="settings-body">{tab === "connection" ? <ConnectionTab /> : tab === "models" ? <ModelsTab /> : tab === "workspace" ? <WorkspaceTab /> : tab === "accessibility" ? <AccessibilityTab /> : tab === "folders" ? <FoldersSettings /> : <PromptsTab />}</div>
      <footer className="settings-foot">
        <label className="check small">
          <input type="checkbox" checked={advanced} onChange={(e) => toggleAdvanced(e.target.checked)} />
          <span>Modo avanzado: mostrar el editor de prompts del agente</span>
        </label>
      </footer>
    </div>
  );
}
