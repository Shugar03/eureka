import { useEffect, useRef, useState } from "react";
import { api, companionApi, errorText } from "../../api";
import type { CompanionView } from "../../types";
import { Icon } from "../Icon";
import { ChatTab } from "./ChatTab";
import { DiaryTab } from "./DiaryTab";
import { ToolsTab } from "./ToolsTab";

type Tab = "talk" | "diary" | "tools";

/** AC-82..88: Acompañamiento — listen, write down, breathe. Never teaches. */
export function CompanionScreen() {
  const [view, setView] = useState<CompanionView | null>(null);
  const [tab, setTab] = useState<Tab>("talk");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pinned = useRef(false);

  useEffect(() => {
    companionApi.state().then(setView).catch((e) => setError(errorText(e)));
    api
      .getSettings()
      .then((s) => setProvider(s.providers.find((p) => p.id === s.roles.teacher.provider_id)?.label ?? ""))
      .catch(() => {});
    // Leaving the screen locks the diary again (if it has a PIN).
    return () => {
      if (pinned.current) companionApi.lock().catch(() => {});
    };
  }, []);
  pinned.current = !!view?.has_pin;

  if (!view) {
    return (
      <div className="companion">
        <p className={error ? "error-text" : "muted"} role={error ? "alert" : undefined}>
          {error ?? "Cargando…"}
        </p>
      </div>
    );
  }

  return (
    <div className="companion">
      <header className="chat-head">
        <h1 className="chat-title">Acompañamiento</h1>
        {view.privacy_ack && !view.locked && (
          <div className="tabs" role="tablist">
            {(
              [
                ["talk", "Charlar"],
                ["diary", "Diario"],
                ["tools", "Herramientas"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="companion-body">
        {!view.privacy_ack ? (
          <Gate provider={provider} onAccept={async () => setView(await companionApi.acknowledge())} />
        ) : view.locked ? (
          <Lock onView={setView} />
        ) : tab === "talk" ? (
          <ChatTab view={view} onView={setView} />
        ) : tab === "diary" ? (
          <DiaryTab view={view} onView={setView} />
        ) : (
          <ToolsTab onView={setView} />
        )}
      </div>
    </div>
  );
}

/** AC-82: before anything, what this is and what it is not. */
function Gate({ provider, onAccept }: { provider: string; onAccept: () => void }) {
  return (
    <section className="card gate" aria-label="Antes de empezar">
      <span className="gate-icon" aria-hidden>
        <Icon name="heart" size={26} />
      </span>
      <h2>Un lugar para hablar y para anotar cómo estás</h2>
      <ul className="gate-list">
        <li>
          <strong>Acá no se estudia.</strong> Es un espacio para que cuentes cómo te sentís, sin tareas ni planes.
        </li>
        <li>
          <strong>No es terapia</strong> y no reemplaza a una persona profesional ni a alguien de confianza. <strong>Tampoco es para emergencias</strong>: si estás en peligro, llamá a emergencias.
        </li>
        <li>
          <strong>Tus mensajes viajan a {provider ? `tu proveedor del modelo (${provider})` : "tu proveedor del modelo"}</strong> para poder responderte. Eureka no los vende ni los usa para otra cosa, pero esa empresa sí los recibe. Tu diario, en cambio, se guarda solo en esta computadora.
        </li>
        <li>
          <strong>El profesor no lee nada de esto</strong> ni se usa para enseñarte. Podés ponerle un PIN al diario y borrarlo todo cuando quieras.
        </li>
      </ul>
      <div className="row-end">
        <button className="btn primary" onClick={onAccept}>
          Entendido, seguir
        </button>
      </div>
    </section>
  );
}

/** AC-85: the PIN screen. Forgetting the PIN never traps the data: it can be erased. */
function Lock({ onView }: { onView: (v: CompanionView) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const unlock = async () => {
    setError(null);
    try {
      onView(await companionApi.unlock(pin));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card gate" aria-label="Diario bloqueado">
      <h2>Tu diario está bloqueado</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          unlock();
        }}
      >
        <input className="pin-input" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN del diario" placeholder="Tu PIN" autoFocus />
        <button className="btn primary" type="submit" disabled={!pin.trim()}>
          Desbloquear
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">¿Te olvidaste el PIN? Podés borrar todo y empezar de nuevo; no hay forma de recuperar lo anterior.</p>
      <div>
        <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={async () => (armed ? onView(await companionApi.erase()) : setArmed(true))} onBlur={() => setArmed(false)}>
          {armed ? "¿Seguro? Borrar todo para siempre" : "Olvidé mi PIN"}
        </button>
      </div>
    </section>
  );
}
