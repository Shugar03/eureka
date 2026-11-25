import { useEffect, useState } from "react";
import { api, errorText } from "../../api";
import { yourDevice } from "../../lib/platform";
import type { SettingsView } from "../../types";
import { ChatGptCard } from "../ChatGptCard";
import { QuickSetup } from "../QuickSetup";
import { AboutEureka } from "../UpdateNotice";
import { ModelPicker } from "./ModelPicker";

const KEY_HELP: Record<string, string> = {
  openrouter: "Creala en openrouter.ai → Keys.",
  openai: "Creala en platform.openai.com → API keys.",
  anthropic: "Creala en console.anthropic.com → API Keys.",
  gemini: "Creala gratis en aistudio.google.com → Get API key.",
  deepseek: "Creala en platform.deepseek.com → API keys.",
  "opencode-go": "La encontrás en tu cuenta de OpenCode Go.",
};

/** Plain-language version of what went wrong when asking a service for its models. */
function friendlyError(e: unknown): string {
  const t = errorText(e);
  if (/401|403|unauthor|invalid.*key|api key/i.test(t)) return "La clave no parece válida. Revisá que la copiaste completa.";
  if (/404/.test(t)) return "No encontré ese servicio en esa dirección. Revisá la configuración en Avanzado.";
  if (/402|429|quota|credit/i.test(t)) return "El servicio dice que no tenés saldo o llegaste al límite.";
  return `No pude conectarme: ${t}`;
}

/** One service, one key, one model for everything. Anyone can pick the model; the rest lives in Avanzado. */
export function ConnectionTab() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // A connected subscription replaces the API key for its provider.
  const [chatgpt, setChatgpt] = useState(false);
  const [connection, setConnection] = useState<{ view: SettingsView; chatgpt: boolean; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!view) return;
    const teacher = view.roles.teacher;
    const saved = view.providers.find((p) => p.id === teacher.provider_id);
    if (!teacher.model || !saved || !(saved.has_key || (chatgpt && saved.id === "openai"))) return;
    let active = true;
    const check = async () => {
      try {
        if (chatgpt && saved.id === "openai") await api.chatgptModels();
        else await api.checkProvider(saved.id);
        if (active) setConnection({ view, chatgpt, ok: true, text: `Conectado: ${saved.label} · ${teacher.model}` });
      } catch (e) {
        const raw = errorText(e);
        const text = /falta la api key/i.test(raw)
          ? `Falta la clave de ${saved.label}. Pegala para conectarte.`
          : /401|403|unauthor|invalid.*key|api key/i.test(raw)
          ? `La clave de ${saved.label} no es válida. Pegala de nuevo.`
          : `No pude verificar la conexión con ${saved.label}. ${friendlyError(e)}`;
        if (active) setConnection({ view, chatgpt, ok: false, text });
      }
    };
    void check();
    return () => { active = false; };
  }, [view, chatgpt]);

  useEffect(() => {
    api
      .getSettings()
      .then((v) => {
        setView(v);
        setProvider(v.roles.teacher.provider_id || v.providers[0]?.id || "");
        setModel(v.roles.teacher.model);
      })
      .catch((e) => setStatus({ ok: false, text: errorText(e) }));
  }, []);

  const current = view?.providers.find((p) => p.id === provider);
  const hasKey = !!current?.has_key;

  const fetchModels = async (id: string, quiet = false) => {
    try {
      // A subscription account lists the models its plan allows, not the provider's.
      const list = chatgpt && id === "openai" ? (await api.chatgptModels()).map((m) => m.id) : await api.listModels(id);
      setModels(list);
      if (!quiet) setStatus({ ok: true, text: `${list.length} modelos disponibles. Elegí uno de la lista o escribí el nombre.` });
    } catch (e) {
      setModels([]);
      setStatus({ ok: false, text: friendlyError(e) });
    }
  };

  // Offer the list as soon as there is a key, or a connected account, to ask with.
  useEffect(() => {
    setModels([]);
    if (provider && (hasKey || (chatgpt && provider === "openai"))) fetchModels(provider, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, hasKey, chatgpt]);

  if (!view) return <p className="muted">{status?.text ?? "Cargando…"}</p>;

  const pickProvider = (id: string) => {
    setProvider(id);
    setKey("");
    setStatus(null);
    setModel(id === view.roles.teacher.provider_id ? view.roles.teacher.model : "");
  };

  const save = async () => {
    if (!provider) return setStatus({ ok: false, text: "Elegí un servicio." });
    if (!hasKey && !key.trim() && !(chatgpt && provider === "openai")) return setStatus({ ok: false, text: "Pegá tu clave de acceso para poder usar este servicio." });
    if (!model.trim()) return setStatus({ ok: false, text: "Elegí un modelo: es el «cerebro» que va a usar Eureka." });
    try {
      const saved = await api.saveSettings({
        providers: view.providers.map(({ id, label, base_url }) => ({ id, label, base_url, api_key: id === provider ? key.trim() : "", clear_key: false })),
        roles: { ...view.roles, teacher: { ...view.roles.teacher, provider_id: provider, model: model.trim() } },
        search: { base_url: view.search.base_url, api_key: "", clear_key: false },
      });
      setView(saved);
      setKey("");
      setStatus({ ok: true, text: "Guardado." });
    } catch (e) {
      setStatus({ ok: false, text: errorText(e) });
    }
  };

  const others = (["prober", "extractor", "practice", "researcher"] as const).filter((r) => view.roles[r]?.provider_id && view.roles[r]?.model).length;
  const t = view.roles.teacher;
  const teacherProvider = view.providers.find((p) => p.id === t.provider_id);
  const canCheck = !!(teacherProvider?.has_key || (chatgpt && teacherProvider?.id === "openai"));
  const checked = connection?.view === view && connection.chatgpt === chatgpt ? connection : null;
  const connectionText = !t.model || !teacherProvider ? "Todavía no elegiste un modelo."
    : !canCheck ? `Falta la clave de ${teacherProvider.label}. Pegala para conectarte.`
    : checked?.text ?? `Comprobando la conexión con ${teacherProvider.label}…`;

  return (
    <div className="stack">
      <QuickSetup onDone={() => api.getSettings().then(setView).catch(() => {})} />
      <ChatGptCard onChange={setChatgpt} />
      <p className="muted small">O a mano: elegí el servicio que ya usás, pegá tu clave y elegí el modelo. Con eso alcanza para todo.</p>
      <p className={!t.model || !teacherProvider || !canCheck || checked?.ok === false ? "warn-text" : ""} data-testid="connection-state">
        {connectionText}
      </p>

      <section className="card" aria-label="Mi conexión">
        <label className="field">
          <span>Servicio</span>
          <select value={provider} onChange={(e) => pickProvider(e.target.value)}>
            {view.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Clave de acceso</span>
          <input type="password" aria-label="Clave de acceso" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "•••••• guardada (pegá otra para cambiarla)" : "Pegala acá"} />
          <small className="muted">{chatgpt && provider === "openai" ? "Ya tenés una cuenta de ChatGPT conectada: la clave es opcional. Si la agregás, Eureka la usa en paralelo." : (KEY_HELP[provider] ?? "Te la da el servicio en tu cuenta.")} Queda solo en {yourDevice()}.</small>
        </label>

        <label className="field">
          <span>Modelo</span>
          <ModelPicker label="Modelo" value={model} models={models} onChange={setModel} placeholder={hasKey ? "Elegí uno de la lista" : "Primero guardá la clave para ver la lista"} />
          <small className="muted">Es el «cerebro» que usa Eureka. Si no sabés cuál, probá uno económico; podés cambiarlo cuando quieras.</small>
        </label>

        <div className="row-end">
          {status && (
            <span className={status.ok ? "muted" : "error-text"} role={status.ok ? "status" : "alert"}>
              {status.text}
            </span>
          )}
          {hasKey && (
            <button className="btn ghost small" onClick={() => fetchModels(provider)}>
              Ver modelos disponibles
            </button>
          )}
          <button className="btn primary" onClick={save}>
            Guardar
          </button>
        </div>
      </section>

      {others > 0 && <p className="muted small">Hay {others} {others === 1 ? "tarea que usa" : "tareas que usan"} otro modelo (en Avanzado). Si no lo necesitás, dejalas vacías para usar solo este.</p>}
      <p className="muted small">¿Querés un modelo en tu PC, otro servicio o una búsqueda web? Está todo en «Avanzado».</p>
      <AboutEureka />
    </div>
  );
}
