import { useEffect, useState } from "react";
import { api, backupApi, codeApi, errorText, learnerApi } from "../api";
import { keepFile } from "../lib/saveFile";
import { onPhone, thisDevice, yourDevice } from "../lib/platform";
import { DEFAULT_LOCAL_SPEECH, LOCAL_SPEECH, type Accessibility, type LearnerProfile, type ModelRef, type PromptView, type ProviderInput, type RememberedSession, type Roles, type Runtime, type SettingsView } from "../types";
import { langLabel } from "../lib/code";
import { speechModelWarning } from "../lib/speechModel";
import { LocalSpeech } from "./settings/LocalSpeech";
import { loadReminderSettings, saveReminderSettings } from "./Reminders";
import type { ReminderSettings } from "../lib/reminders";
import { validReminders } from "../lib/reminders";
import { Markdown } from "./Markdown";
import { ChatGptCard } from "./ChatGptCard";
import { ReadAloud } from "./a11y/ReadAloud";
import { WorkspaceTab } from "./workspace/WorkspaceTab";
import { QuickSetup } from "./QuickSetup";
import { AboutEureka } from "./UpdateNotice";
import { ModelPicker } from "./settings/ModelPicker";
import { useAccessibility } from "./a11y/AccessibilityContext";

interface ProviderDraft extends ProviderInput {
  has_key: boolean;
}

const ROLE_INFO: { id: keyof Roles; label: string; hint: string }[] = [
  { id: "teacher", label: "Profesor", hint: "El modelo principal: planifica y enseña. Es el que elegís en «Conexión»." },
  { id: "prober", label: "Diagnóstico", hint: "Mide lo que ya sabés. Vacío = usa el modelo principal." },
  { id: "extractor", label: "Extractor", hint: "Arma el grafo al terminar. Un modelo barato alcanza. Vacío = el principal." },
  { id: "practice", label: "Práctica", hint: "Genera y corrige problemas. Vacío = el principal." },
  { id: "researcher", label: "Investigador", hint: "Resume búsquedas web con fuentes. Vacío = el principal." },
  { id: "speech", label: "Voz", hint: "Transcribe tu voz (micrófono y speaking): «En esta PC» usa Parakeet v3 (o Whisper, más liviano) sin internet; o whisper-1 (OpenAI), whisper-large-v3 (Groq). Vacío = sin voz." },
];

const PROMPT_LABEL: Record<string, string> = {
  shared: "Base (todas las fases)",
  probe: "Fase Medir",
  plan: "Fase Planificar",
  teach: "Fase Enseñar",
  done: "Fase Terminada",
  extract: "Extractor (grafo)",
  practice_generate: "Práctica: generador",
  practice_grade: "Práctica: corrector",
  research: "Investigador",
  exam_syllabus: "Examen: lector de la guía",
  exam_questions: "Examen: simulacros",
  exam_guide: "Examen: buscador de guías",
  exam_cheat_sheet: "Examen: hoja de repaso",
  exam_check: "Examen: verificador",
  exam_explain: "Examen: dudas sobre preguntas",
  cards_generate: "Tarjetas: generador",
  code_explain: "Código: explicar errores",
  code_exercise: "Código: ejercicios",
  code_review: "Código: revisión",
  lang_path: "Rutas de programación",
  vision_transcribe: "Lectura de imágenes",
  code_project: "Código: proyectos",
  lang_listening: "Idiomas: listening",
  lang_speaking: "Idiomas: speaking",
  companion: "Acompañamiento: conversación",
  companion_entry: "Acompañamiento: entrada del diario",
};

const ADVANCED_KEY = "la.advanced";
const readAdvanced = () => {
  try {
    return localStorage.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
};

export type SettingsTab = "connection" | "models" | "workspace" | "accessibility" | "prompts";

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
      <div className="settings-body">{tab === "connection" ? <ConnectionTab /> : tab === "models" ? <ModelsTab /> : tab === "workspace" ? <WorkspaceTab /> : tab === "accessibility" ? <AccessibilityTab /> : <PromptsTab />}</div>
      <footer className="settings-foot">
        <label className="check small">
          <input type="checkbox" checked={advanced} onChange={(e) => toggleAdvanced(e.target.checked)} />
          <span>Modo avanzado: mostrar el editor de prompts del agente</span>
        </label>
      </footer>
    </div>
  );
}

const SIZES: { id: Accessibility["text_size"]; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "large", label: "Grande" },
  { id: "larger", label: "Muy grande" },
];

const SAMPLE = "La **derivada** mide cuánto cambia una función en un punto. Por ejemplo, si $f(x) = x^2$, en $x = 3$ cambia 6 veces más rápido que $x$.";

/** AC-73..77: access settings. Functional choices, never a diagnosis. */
function AccessibilityTab() {
  const { a, update, speechReady } = useAccessibility();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Accessibility>) =>
    update(patch)
      .then(() => {
        setError(null);
        setSaved(true);
      })
      .catch((e) => {
        setSaved(false);
        setError(errorText(e));
      });
  const check = (key: keyof Accessibility, label: string, hint: string) => (
    <label className="check a11y-check">
      <input type="checkbox" checked={a[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>
        {label}
        <small className="muted">{hint}</small>
      </span>
    </label>
  );
  return (
    <div className="stack">
      <p className="muted small">Elegí lo que te sirva para estudiar más cómodo. No hace falta ningún diagnóstico, y todo se guarda solo en {thisDevice()}. Los cambios se aplican al instante.</p>

      <section className="card" aria-label="Leer y escuchar">
        <h2>Leer y escuchar</h2>
        {check("read_aloud", "Leeme en voz alta", "Agrega «Escuchar» a cada mensaje del profesor, a cada pregunta y a las secciones de tus libros. Marca la palabra que se está leyendo.")}
        <label className="a11y-range">
          Velocidad de lectura: {a.speech_rate.toFixed(1)}×
          <input type="range" min={0.6} max={1.4} step={0.1} value={a.speech_rate} onChange={(e) => set({ speech_rate: Number(e.target.value) })} aria-label="Velocidad de lectura" aria-valuetext={`${a.speech_rate.toFixed(1)} veces`} />
        </label>
        {check("dictation", "Responder dictando", "Agrega «Dictar» donde escribís tus respuestas. El profesor no te corrige la ortografía de lo dictado.")}
        {a.dictation && !speechReady && <p className="warn-text small">Para dictar hace falta un modelo de Voz: elegilo en Avanzado → Voz.</p>}
      </section>

      <section className="card" aria-label="Cómo se ve">
        <h2>Cómo se ve</h2>
        <div className="field">
          <span>Tamaño del texto</span>
          <div className="tabs a11y-sizes" role="radiogroup" aria-label="Tamaño del texto">
            {SIZES.map((s) => (
              <button key={s.id} role="radio" aria-checked={a.text_size === s.id} className={a.text_size === s.id ? "is-active" : ""} onClick={() => set({ text_size: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {check("spacing", "Más espacio entre letras, palabras y líneas", "Renglones más cortos y separados. A muchas personas les cansa menos leer así.")}
        {check("reduce_motion", "Sin animaciones", "Quita movimientos y parpadeos de la interfaz.")}
      </section>

      <section className="card" aria-label="Cómo te habla el profesor">
        <h2>Cómo te habla el profesor</h2>
        <p className="muted small">Cambian la forma de explicar, no lo que aprendés ni cuánto se te exige.</p>
        {check("easy_reading", "Lectura fácil", "Frases cortas, una idea por frase, palabras comunes y los términos técnicos explicados al usarlos.")}
        {check("literal", "Lenguaje literal y sin sorpresas", "Sin ironías ni metáforas. Antes de cada paso te dice qué va a pasar.")}
        {check("short_steps", "Pasos cortos con meta visible", "Mensajes de pocas frases, bloques como «3 preguntas y listo» y pausas al cerrar cada idea.")}
      </section>

      <section className="card" aria-label="Vista previa">
        <h2>Vista previa</h2>
        <div className="bubble assistant">
          <Markdown text={SAMPLE} />
          <ReadAloud markdown={SAMPLE} always />
        </div>
      </section>
      <p className="muted small" role="status">
        {saved && !error ? "Guardado." : ""}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

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
function ConnectionTab() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // A connected subscription replaces the API key for its provider.
  const [chatgpt, setChatgpt] = useState(false);

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
  const label = view.providers.find((p) => p.id === t.provider_id)?.label;

  return (
    <div className="stack">
      <QuickSetup onDone={() => api.getSettings().then(setView).catch(() => {})} />
      <ChatGptCard onChange={setChatgpt} />
      <p className="muted small">O a mano: elegí el servicio que ya usás, pegá tu clave y elegí el modelo. Con eso alcanza para todo.</p>
      <p className={t.model ? "" : "warn-text"} data-testid="connection-state">
        {t.model && label ? `Conectado: ${label} · ${t.model}` : "Todavía no elegiste un modelo."}
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

function ModelsTab() {
  const { refreshSpeech } = useAccessibility();
  const [view, setView] = useState<SettingsView | null>(null);
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [roles, setRoles] = useState<Roles | null>(null);
  const [search, setSearch] = useState({ base_url: "", api_key: "", clear_key: false });
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<string | null>(null);

  const load = (v: SettingsView) => {
    setView(v);
    setProviders(v.providers.map((p) => ({ ...p, api_key: "" })));
    // Older backends/settings may lack newer roles: fill them in empty.
    const empty = { provider_id: "", model: "" };
    setRoles({ ...Object.fromEntries(ROLE_INFO.map((r) => [r.id, empty])), ...v.roles } as Roles);
    setSearch({ base_url: v.search.base_url, api_key: "", clear_key: false });
  };

  useEffect(() => {
    api.getSettings().then(load).catch((e) => setStatus(errorText(e)));
  }, []);

  if (!view || !roles) return <p className="muted">{status ?? "Cargando…"}</p>;

  const patch = (i: number, p: Partial<ProviderDraft>) =>
    setProviders((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const setRole = (role: keyof Roles, ref: Partial<ModelRef>) =>
    setRoles((r) => (r ? { ...r, [role]: { ...r[role], ...ref } } : r));

  const save = async () => {
    try {
      const saved = await api.saveSettings({
        providers: providers.map(({ id, label, base_url, api_key, clear_key }) => ({ id, label, base_url, api_key, clear_key })),
        roles,
        search,
      });
      load(saved);
      refreshSpeech();
      setStatus("Guardado.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const fetchModels = async (providerId: string) => {
    setStatus("Consultando modelos…");
    try {
      const list = await api.listModels(providerId);
      setModels((m) => ({ ...m, [providerId]: list }));
      setStatus(`${list.length} modelos encontrados.`);
    } catch (e) {
      setStatus(`No se pudieron listar los modelos: ${errorText(e)}`);
    }
  };

  const addProvider = () =>
    setProviders((ps) => [...ps, { id: `custom-${ps.length + 1}`, label: "Personalizado", base_url: "https://", api_key: "", has_key: false }]);

  return (
    <div className="stack">
      <section className="card">
        <h2>Otro modelo para una tarea (opcional)</h2>
        <p className="muted small">Normalmente alcanza con el modelo de «Conexión». Acá podés usar otro solo para una tarea; si lo dejás vacío, se usa el principal.</p>
        {ROLE_INFO.map((r) => (
          <div key={r.id} className="role-row">
            <div>
              <strong>{r.label}</strong>
              <p className="muted small">{r.hint}</p>
              {(r.id === "teacher" || r.id === "prober") && (
                <label className="muted small context-k">
                  Contexto del modelo
                  <input
                    type="number"
                    min={4}
                    step={1}
                    aria-label={`Contexto de ${r.label} (miles de tokens)`}
                    value={roles[r.id].context_k ?? ""}
                    placeholder="64"
                    onChange={(e) => setRole(r.id, { context_k: e.target.value ? Math.max(4, Math.round(Number(e.target.value))) : null })}
                  />
                  mil tokens
                </label>
              )}
            </div>
            <select
              aria-label={`Proveedor de ${r.label}`}
              value={roles[r.id].provider_id}
              onChange={(e) => setRole(r.id, e.target.value === LOCAL_SPEECH ? { provider_id: LOCAL_SPEECH, model: DEFAULT_LOCAL_SPEECH } : { provider_id: e.target.value })}
            >
              <option value="">— proveedor —</option>
              {r.id === "speech" && !onPhone() && <option value={LOCAL_SPEECH}>En esta PC</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {r.id === "speech" && roles.speech.provider_id === LOCAL_SPEECH ? (
              <LocalSpeech model={roles.speech.model} onModel={(model) => setRole("speech", { model })} onChanged={refreshSpeech} />
            ) : (
            <>
            <ModelPicker label={`Modelo de ${r.label}`} value={roles[r.id].model} models={models[roles[r.id].provider_id] ?? []} onChange={(model) => setRole(r.id, { model })} placeholder="ej: anthropic/claude-sonnet-4.5" />
            <button className="btn small" disabled={!roles[r.id].provider_id} onClick={() => fetchModels(roles[r.id].provider_id)}>
              Listar modelos
            </button>
            </>
            )}
            {r.id === "speech" && speechModelWarning(roles.speech.model, roles.speech.provider_id) && (
              <p className="warn-text small role-warning" role="note">
                {speechModelWarning(roles.speech.model, roles.speech.provider_id)}
              </p>
            )}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Proveedores</h2>
        <p className="muted small">
          Cualquier API compatible con OpenAI sirve. Las keys se guardan solo en tu PC, en <code>{view.data_dir}\auth.json</code>.
        </p>
        <p className="muted small">¿Usás OpenCode Go? Pegá tu key en su fila y elegí un modelo, por ejemplo <code>deepseek-v4.1-flash</code>, en «Conexión».</p>
        {providers.map((p, i) => (
          <div key={i} className="provider-row">
            <input aria-label="Nombre" value={p.label} onChange={(e) => patch(i, { label: e.target.value })} />
            <input aria-label="ID" value={p.id} onChange={(e) => patch(i, { id: e.target.value })} className="mono narrow" />
            <input aria-label="URL base" value={p.base_url} onChange={(e) => patch(i, { base_url: e.target.value })} className="mono" />
            <input
              aria-label={`API key de ${p.label}`}
              type="password"
              value={p.api_key ?? ""}
              onChange={(e) => patch(i, { api_key: e.target.value, clear_key: false })}
              placeholder={p.has_key && !p.clear_key ? "•••••• guardada" : "API key"}
            />
            {p.has_key && !p.clear_key && (
              <button className="btn ghost small" onClick={() => patch(i, { clear_key: true, api_key: "" })}>
                Quitar key
              </button>
            )}
            <button className="btn ghost small" onClick={() => setProviders((ps) => ps.filter((_, j) => j !== i))} aria-label={`Eliminar ${p.label}`}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" onClick={addProvider}>
          + Agregar proveedor
        </button>
      </section>

      <section className="card" aria-label="Búsqueda web">
        <h2>Búsqueda web</h2>
        <p className="muted small">
          Para que el profesor pueda investigar. Cualquier API compatible con Tavily (<code>POST /search</code>).
        </p>
        <div className="provider-row search-row">
          <input aria-label="URL de búsqueda" className="mono" value={search.base_url} onChange={(e) => setSearch((s) => ({ ...s, base_url: e.target.value }))} />
          <input
            aria-label="API key de búsqueda"
            type="password"
            value={search.api_key}
            onChange={(e) => setSearch((s) => ({ ...s, api_key: e.target.value, clear_key: false }))}
            placeholder={view.search.has_key && !search.clear_key ? "•••••• guardada" : "API key"}
          />
          {view.search.has_key && !search.clear_key && (
            <button className="btn ghost small" onClick={() => setSearch((s) => ({ ...s, clear_key: true, api_key: "" }))}>
              Quitar key de búsqueda
            </button>
          )}
        </div>
      </section>

      <RuntimesSection />

      <p className="muted small">Lo que Eureka sabe de vos y lo que recuerda de tus sesiones está en «Mi progreso».</p>

      <RemindersSection />

      <BackupSection />

      <div className="row-end">
        {status && <span className="muted" role="status">{status}</span>}
        <button className="btn primary" onClick={save}>
          Guardar
        </button>
      </div>
    </div>
  );
}

function PromptsTab() {
  const [prompts, setPrompts] = useState<PromptView[]>([]);
  const [selected, setSelected] = useState("shared");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = (keep = selected) =>
    api.listPrompts().then((ps) => {
      setPrompts(ps);
      setDraft(ps.find((p) => p.name === keep)?.content ?? "");
    });

  useEffect(() => {
    load().catch((e) => setStatus(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = prompts.find((p) => p.name === selected);
  const pick = (name: string) => {
    setSelected(name);
    setDraft(prompts.find((p) => p.name === name)?.content ?? "");
    setStatus(null);
  };

  return (
    <div className="prompts">
      <nav className="prompt-list">
        {prompts.map((p) => (
          <button key={p.name} className={p.name === selected ? "is-active" : ""} onClick={() => pick(p.name)}>
            {PROMPT_LABEL[p.name] ?? p.name}
            {p.overridden && <span className="dot" title="Modificado" />}
          </button>
        ))}
      </nav>
      <div className="prompt-editor">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Contenido del prompt" spellCheck={false} />
        <div className="row-end">
          {status && <span className="muted" role="status">{status}</span>}
          {current?.overridden && (
            <button
              className="btn"
              onClick={async () => {
                await api.resetPrompt(selected);
                await load();
                setStatus("Restaurado al original.");
              }}
            >
              Restaurar original
            </button>
          )}
          <button
            className="btn primary"
            disabled={draft === current?.content}
            onClick={async () => {
              await api.savePrompt(selected, draft);
              await load();
              setStatus("Guardado. Se usa desde el próximo mensaje.");
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/** AC-53: which toolchains the code console found on this PC. */
function RuntimesSection() {
  const [rts, setRts] = useState<Runtime[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (refresh: boolean) => {
    setBusy(true);
    codeApi
      .runtimes(refresh)
      .then(setRts)
      .catch(() => setRts([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(false), []);
  return (
    <section className="card" aria-label="Consola de código">
      <div className="row-between">
        <h2>Consola de código</h2>
        {!onPhone() && (
          <button className="btn ghost small" disabled={busy} onClick={() => load(true)}>
            {busy ? "Buscando…" : "Volver a detectar"}
          </button>
        )}
      </div>
      <p className="muted small">
        {onPhone()
          ? "En el celular solo corre SQL, que viene incluido. Los demás lenguajes están en la versión de escritorio."
          : 'El código corre con lo que tengas instalado en esta PC. Si instalás algo nuevo, tocá "Volver a detectar".'}
      </p>
      <ul className="runtime-list">
        {(rts ?? []).map((r) => (
          <li key={r.lang}>
            <strong>{langLabel(r.lang)}:</strong> {r.program ? r.version : <span className="muted">{onPhone() ? "solo en escritorio" : "no instalado"}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** AC-60: a .zip of everything (never the API keys), and restoring it. */
function BackupSection() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  const create = async () => {
    setError(null);
    try {
      const where = await keepFile(await backupApi.create());
      if (where) setStatus(`Respaldo guardado en ${where}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const restore = async () => {
    if (!pending) return;
    setError(null);
    try {
      const n = await backupApi.restore([...new Uint8Array(await pending.arrayBuffer())]);
      setStatus(`Restauré ${n} archivos. Recargando…`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="card" aria-label="Respaldo">
      <h2>Respaldo</h2>
      <p className="muted small">Un .zip con tus sesiones, grafo, exámenes, mazos, prompts y tiempo de estudio, {onPhone() ? "donde elijas guardarlo" : "en tu carpeta de Descargas"}. Las API keys no se incluyen.</p>
      <div className="row">
        <button className="btn" onClick={create}>
          Crear respaldo
        </button>
        <label className="btn ghost file-pick">
          Restaurar un respaldo…
          <input type="file" accept=".zip,application/zip" aria-label="Elegir respaldo para restaurar" onChange={(e) => setPending(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {pending && (
        <div className="notice" role="alert">
          <span>
            Restaurar <strong>{pending.name}</strong> reemplaza tus datos actuales (antes guardo una copia de lo que hay ahora).
          </span>
          <span className="row">
            <button className="btn small danger" onClick={restore}>
              Sí, restaurar
            </button>
            <button className="btn small ghost" onClick={() => setPending(null)}>
              Cancelar
            </button>
          </span>
        </div>
      )}
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

/** AC-62: what to remind and when (saved on this device). */
/** A minutes box that keeps what you type and applies it (clamped) on leaving it, so "25" can be typed. */
function Minutes({ value, label, disabled, onCommit }: { value: number; label: string; disabled: boolean; onCommit: (n: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  const commit = () => (raw.trim() !== "" && Number.isFinite(Number(raw)) ? onCommit(Number(raw)) : setRaw(String(value)));
  return <input type="number" min={10} max={240} value={raw} disabled={disabled} aria-label={label} onChange={(e) => setRaw(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function RemindersSection() {
  const [s, setS] = useState<ReminderSettings>(loadReminderSettings);
  const update = (patch: Partial<ReminderSettings>) => {
    const next = validReminders({ ...s, ...patch });
    setS(next);
    saveReminderSettings(next);
  };
  return (
    <section className="card" aria-label="Recordatorios">
      <h2>Recordatorios</h2>
      <p className="muted small">Avisos del sistema (y dentro de la app) para tus clases, fechas de examen, tarjetas del día, y para que te pares y tomes agua mientras estudiás. El sonido se apaga en los ajustes del pomodoro.</p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Recordatorios activados
      </label>
      <div className="goal-form">
        <label>
          Minutos antes de cada clase o bloque
          <input type="number" min={0} max={120} value={s.slotMinutes} disabled={!s.enabled} onChange={(e) => update({ slotMinutes: Number(e.target.value) })} aria-label="Minutos antes de cada clase" />
        </label>
        <label>
          Tarjetas del día a las
          <input type="time" value={s.cardsAt} disabled={!s.enabled} onChange={(e) => update({ cardsAt: e.target.value })} aria-label="Hora del recordatorio de tarjetas" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.exams} disabled={!s.enabled} onChange={(e) => update({ exams: e.target.checked })} /> Cuenta regresiva de exámenes (7, 3 y 1 día antes, y el mismo día)
      </label>
      <div className="health-reminders">
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked={s.stand} disabled={!s.enabled} onChange={(e) => update({ stand: e.target.checked })} aria-label="Avisarme que me pare" /> Avisarme que me pare cada
          </label>
          <Minutes value={s.standMinutes} disabled={!s.enabled || !s.stand} label="Minutos para pararme" onCommit={(n) => update({ standMinutes: n })} />
          <span className="muted small">min (un pomodoro dura 25). Un descanso del pomodoro cuenta como pararte.</span>
        </div>
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked={s.water} disabled={!s.enabled} onChange={(e) => update({ water: e.target.checked })} aria-label="Avisarme que tome agua" /> Avisarme que tome agua cada
          </label>
          <Minutes value={s.waterMinutes} disabled={!s.enabled || !s.water} label="Minutos para tomar agua" onCommit={(n) => update({ waterMinutes: n })} />
          <span className="muted small">min</span>
        </div>
      </div>
    </section>
  );
}

/** AC-110: what Eureka remembers of each conversation, to pick it up later — and forgetting it. */
export function SessionMemories() {
  const [list, setList] = useState<RememberedSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.sessionMemories().then(setList).catch(() => setList([]));
  }, []);
  if (!list) return null;
  const forget = async (id: string) => {
    try {
      setList(await api.forgetSessionMemory(id));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card" aria-label="Lo que recuerda de tus sesiones">
      <h2>Lo que recuerda de tus sesiones</h2>
      <p className="muted small">
        Cuando una conversación queda quieta unos minutos, Eureka anota en segundo plano qué vieron, qué quedó pendiente y qué te costó, y pasa las ideas a tu grafo. Así el profesor puede retomar otro día. Usa el modelo de la tarea Extractor y queda solo en {thisDevice()}.
      </p>
      {list.length === 0 ? (
        <p className="muted small">Todavía nada: aparece cuando una conversación lleva un rato quieta.</p>
      ) : (
        <ul className="memory-list">
          {list.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.title}</strong> <span className="muted small">· {new Date(r.updated_at).toLocaleDateString()}{r.archived ? " · archivada" : ""}</span>
                <p className="small">{r.memory.summary}</p>
                {r.memory.pending.length > 0 && <p className="small muted">Pendiente: {r.memory.pending.join("; ")}</p>}
                {r.memory.struggled.length > 0 && <p className="small muted">Le costó: {r.memory.struggled.join("; ")}</p>}
              </span>
              <button className="btn ghost small" onClick={() => forget(r.id)} aria-label={`Olvidar lo que recuerda de ${r.title}`}>
                Olvidar
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Audit M10: what the app learned about you across sessions — and forgetting it. */
export function LearnerSection() {
  const [p, setP] = useState<LearnerProfile | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    learnerApi.get().then(setP).catch(() => setP({ misconceptions: [], preferences: [] }));
  }, []);
  if (!p) return null;
  const empty = !p.misconceptions.length && !p.preferences.length;
  const forget = async (kind: "misconception" | "preference" | "all", i = 0) => setP(await learnerApi.forget(kind, i));
  return (
    <section className="card" aria-label="Lo que la app sabe de vos">
      <div className="row-between">
        <h2>Lo que la app sabe de vos</h2>
        {!empty && (
          <button
            className={`btn small ${armed ? "danger" : "ghost"}`}
            onClick={() => (armed ? (setArmed(false), forget("all")) : setArmed(true))}
            onBlur={() => setArmed(false)}
          >
            {armed ? "¿Seguro? Olvidar todo" : "Olvidar todo"}
          </button>
        )}
      </div>
      <p className="muted small">Cuando una sesión termina o queda quieta un rato se anotan tus confusiones y cómo aprendés mejor, para que el profesor las tenga en cuenta la próxima vez. Queda solo en {thisDevice()}.</p>
      {empty ? (
        <p className="muted small">Todavía nada: se completa cuando terminás sesiones o practicás.</p>
      ) : (
        <>
          {p.preferences.length > 0 && (
            <ul className="learner-list" aria-label="Cómo aprendés mejor">
              {p.preferences.map((x, i) => (
                <li key={`p${i}`}>
                  <span>
                    <strong>Preferís:</strong> {x.text} <span className="muted small">· {x.source}</span>
                  </span>
                  <button className="btn ghost small" onClick={() => forget("preference", i)} aria-label={`Olvidar: ${x.text}`}>
                    Olvidar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.misconceptions.length > 0 && (
            <ul className="learner-list" aria-label="Confusiones">
              {p.misconceptions.map((m, i) => (
                <li key={`m${i}`}>
                  <span>
                    <strong>{m.concept}:</strong> {m.wrong_idea} {m.fixed ? <span className="tag tag-check">reparada</span> : null} <span className="muted small">· {m.source}</span>
                  </span>
                  <button className="btn ghost small" onClick={() => forget("misconception", i)} aria-label={`Olvidar: ${m.concept}`}>
                    Olvidar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
