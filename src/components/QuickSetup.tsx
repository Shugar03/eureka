import { useState } from "react";
import { api, errorText } from "../api";
import type { SetupDone, SettingsView } from "../types";
import { onPhone } from "../lib/platform";

const LABEL: Record<string, string> = { openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", deepseek: "DeepSeek", "opencode-go": "OpenCode Go" };

/**
 * AC-158/159: paste one key and it is ready. The service comes from the key's
 * format (the key only goes to that service); the model, its context and a
 * real test call are done here. When the format fits several services, the
 * person picks; nothing is tried on the others.
 */
export function QuickSetup({ onDone }: { onDone?: (d: SetupDone) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choose, setChoose] = useState<{ candidates: string[]; reason: string } | null>(null);
  const [picked, setPicked] = useState("");
  const [done, setDone] = useState<SetupDone | null>(null);
  const [model, setModel] = useState("");

  const connect = async (provider: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.quickSetup(key, provider);
      if (out.status === "choose") {
        setChoose({ candidates: out.candidates, reason: out.reason });
        setPicked(out.candidates[0] ?? "");
      } else {
        setChoose(null);
        setDone(out);
        setModel(out.model);
        setKey("");
        onDone?.(out);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Another model of the same service, keeping everything else.
  const switchModel = async (m: string) => {
    setModel(m);
    try {
      const v: SettingsView = await api.getSettings();
      await api.saveSettings({
        providers: v.providers.map(({ id, label, base_url }) => ({ id, label, base_url, api_key: "", clear_key: false })),
        roles: { ...v.roles, teacher: { provider_id: done!.provider_id, model: m } },
        search: { base_url: v.search.base_url, api_key: "", clear_key: false },
      });
      setDone((d) => d && { ...d, model: m, context_k: null });
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (done)
    return (
      <section className="card quick-setup" aria-label="Conectar con una clave">
        <h2>Listo: Eureka ya funciona</h2>
        <p data-testid="quick-setup-done">
          {done.provider} · <strong>{done.model}</strong> para todo.
        </p>
        <p className="muted small">
          {done.context_k ? `Memoria de la conversación: ${done.context_k} mil tokens (lo informa ${done.provider}).` : `${done.provider} no informa cuánto recuerda cada modelo: uso un valor seguro (64 mil tokens); lo podés ajustar en Avanzado.`}
          {!done.tools_ok && " El modelo contestó, pero sin usar herramientas: si algo no anda, probá otro."}
        </p>
        {done.alternatives.length > 0 && (
          <label className="field">
            <span>Otro modelo de {done.provider}</span>
            <select value={model} onChange={(e) => switchModel(e.target.value)} aria-label="Cambiar de modelo">
              {[done.model, ...done.alternatives.filter((a) => a !== done.model)].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        {!done.speech_ready && <p className="muted small">Para grabar clases o dictar, {onPhone() ? "elegí la Voz en Ajustes → Avanzado (por ejemplo whisper-1 de OpenAI)." : "elegí la Voz «En esta PC» en Ajustes → Avanzado: es gratis y no usa internet."}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </section>
    );

  return (
    <section className="card quick-setup" aria-label="Conectar con una clave">
      <h2>Pegá tu clave y listo</h2>
      <p className="muted small">Con la clave de tu servicio de IA (OpenCode Go, OpenRouter, OpenAI, Anthropic, Gemini o DeepSeek) Eureka elige el modelo y hace una prueba corta para ver que ande. La clave queda solo en esta computadora y se usa solo con ese servicio.</p>
      <div className="row quick-setup-row">
        <input type="password" value={key} onChange={(e) => (setKey(e.target.value), setChoose(null))} placeholder="Tu clave de acceso" aria-label="Tu clave de acceso" autoComplete="off" />
        <button className="btn primary" onClick={() => connect(null)} disabled={busy || !key.trim()}>
          {busy ? "Conectando…" : "Conectar"}
        </button>
      </div>
      {choose && (
        <fieldset className="quick-choose">
          <legend>{choose.reason}</legend>
          <div className="row wrap" role="radiogroup" aria-label="Servicio de la clave">
            {choose.candidates.map((c) => (
              <label key={c} className="check">
                <input type="radio" name="quick-provider" checked={picked === c} onChange={() => setPicked(c)} />
                {LABEL[c] ?? c}
              </label>
            ))}
          </div>
          <button className="btn small" onClick={() => connect(picked)} disabled={busy || !picked}>
            {busy ? "Conectando…" : `Conectar con ${LABEL[picked] ?? picked}`}
          </button>
        </fieldset>
      )}
      {busy && (
        <p className="muted small" role="status">
          Pidiendo la lista de modelos y probando uno…
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
