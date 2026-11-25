import { useEffect, useState } from "react";
import { api, errorText } from "../../api";
import { onPhone } from "../../lib/platform";
import { speechModelWarning } from "../../lib/speechModel";
import { DEFAULT_LOCAL_SPEECH, LOCAL_SPEECH, type ModelRef, type ProviderInput, type Roles, type SettingsView } from "../../types";
import { useAccessibility } from "../a11y/AccessibilityContext";
import { BackupSection } from "./BackupSection";
import { LocalSpeech } from "./LocalSpeech";
import { ModelPicker } from "./ModelPicker";
import { RemindersSection } from "./RemindersSection";
import { RuntimesSection } from "./RuntimesSection";
import { UsageSection } from "./UsageSection";

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

export function ModelsTab() {
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
          Cualquier API compatible con OpenAI sirve. Las keys se guardan solo en tu PC, en el almacén de credenciales del sistema.
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

      <UsageSection />

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
