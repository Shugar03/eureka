import { useEffect, useState } from "react";
import { api } from "../api";
import type { AccountView, ModelInfo } from "../types";

/**
 * ChatGPT Plus/Pro: one click, the browser does the login, and the token never
 * reaches the screen. `onChange` lets the card next to it stop asking for an
 * API key while an account is connected.
 */
export function ChatGptCard({ onChange }: { onChange: (connected: boolean) => void }) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .chatgptStatus()
      .then((a) => {
        setAccount(a);
        onChange(!!a);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    setStatus({ ok: true, text: "Terminá el inicio de sesión en el navegador. Esta ventana sigue sola." });
    try {
      const connected = await api.chatgptConnect();
      setAccount(connected);
      onChange(true);
      setStatus({ ok: true, text: "Cuenta conectada." });
    } catch (e) {
      setStatus({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.chatgptDisconnect();
    } catch (e) {
      // The tokens are still on disk: say so instead of pretending they are gone.
      setStatus({ ok: false, text: `No se pudo desconectar: ${message(e)}` });
      return;
    }
    setAccount(null);
    setModels([]);
    setStatus(null);
    onChange(false);
  };

  const seeModels = async () => {
    try {
      const list = await api.chatgptModels();
      setModels(list);
      setStatus({ ok: true, text: list.length === 0 ? "Tu cuenta no tiene modelos disponibles para la API." : `${list.length} modelos disponibles con tu cuenta.` });
    } catch (e) {
      setModels([]);
      setStatus({ ok: false, text: message(e) });
    }
  };

  return (
    <section className="card" aria-label="ChatGPT Plus/Pro">
      <h3>ChatGPT Plus/Pro</h3>
      <p className="muted small">¿Ya pagás ChatGPT? Usalo desde Eureka sin pegar ninguna clave: te abro el navegador, autorizás y volvés solo.</p>

      {account ? (
        <>
          <p data-testid="chatgpt-account">{account.email ?? "Cuenta conectada"}</p>
          <div className="row-end">
            <button className="btn ghost small" onClick={seeModels}>
              Ver modelos disponibles
            </button>
            <button className="btn ghost small" onClick={disconnect}>
              Desconectar
            </button>
          </div>
          {models.length > 0 && (
            <p className="muted small">Modelos: {models.map((m) => m.id).join(", ")}</p>
          )}
        </>
      ) : (
        <div className="row-end">
          <button className="btn primary" onClick={connect} disabled={busy}>
            {busy ? "Esperando al navegador…" : "Conectar con ChatGPT"}
          </button>
        </div>
      )}

      {status && (
        <span className={status.ok ? "muted" : "error-text"} role={status.ok ? "status" : "alert"}>
          {status.text}
        </span>
      )}
    </section>
  );
}

/** The backend already explains itself in Spanish; keep its words. */
function message(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "No se pudo conectar la cuenta.";
}
