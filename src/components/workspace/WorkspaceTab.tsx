import { useRef, useState } from "react";
import { colorName, effectiveAccent, PRESETS, readWallpaper, sceneUrl, suggestedAccents, swatchesFromUrl, wallpaperUrl } from "../../lib/workspace";
import type { Theme } from "../../lib/theme";
import { EMPTY_IDENTITY, useWorkspace } from "./WorkspaceContext";
import { AboutFields, NameFields, TreatmentFields } from "./IdentityFields";
import { QuotesSection } from "../quotes/QuotesSection";
import { thisDevice, yourDevice } from "../../lib/platform";

const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Oscuro" },
  { id: "system", label: "Según el sistema" },
];

/** AC-78..81: "Mi espacio" — name, wallpaper, accent colour and theme. */
export function WorkspaceTab() {
  const { ws, update, tone, theme, setTheme, saved, identity, setIdentity } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const suggestions = suggestedAccents(ws, tone);
  const accent = effectiveAccent(ws, tone);
  const following = ws.accent === null;
  const isPreset = (id: string) => ws.wallpaper.kind === "preset" && ws.wallpaper.id === id;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const url = await readWallpaper(f);
      const swatches = await swatchesFromUrl(url);
      update({ wallpaper: { kind: "custom", url }, palette: swatches.map((s) => s.hex), accent: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude usar esa imagen.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const preview = wallpaperUrl(ws, tone);

  return (
    <div className="stack">
      <p className="muted small">Este es tu lugar. Elegí cómo se ve y cómo te saluda: es solo tuyo y queda guardado en {thisDevice()}.</p>

      <section className="card" aria-label="Sobre vos">
        <h2>Sobre vos</h2>
        <p className="muted small">Todo es opcional. Se usa para saludarte y para que el asistente te hable como pediste: tu nombre, cómo preferís que te hablemos y qué estudiás se comparten con el modelo de IA que elijas.</p>
        <NameFields identity={identity ?? EMPTY_IDENTITY} onChange={setIdentity} />
        <AboutFields identity={identity ?? EMPTY_IDENTITY} onChange={setIdentity} />
        <TreatmentFields identity={identity ?? EMPTY_IDENTITY} onChange={setIdentity} />
        <div>
          <button className="btn small" onClick={() => setIdentity({ onboarded: false })}>
            Volver a ver la bienvenida
          </button>
        </div>
      </section>

      <section className="card" aria-label="Fondo de pantalla">
        <h2>Fondo de pantalla</h2>
        <div className="wp-grid" role="radiogroup" aria-label="Fondos">
          <button type="button" role="radio" aria-checked={ws.wallpaper.kind === "auto"} className={`wp-tile ${ws.wallpaper.kind === "auto" ? "is-selected" : ""}`} onClick={() => update({ wallpaper: { kind: "auto" }, palette: [] })}>
            <span className="wp-thumb" style={{ backgroundImage: `url("${sceneUrl(tone === "light" ? "amanecer" : "noche")}")` }} />
            <span className="wp-label">Automático</span>
          </button>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={isPreset(p.id)} className={`wp-tile ${isPreset(p.id) ? "is-selected" : ""}`} onClick={() => update({ wallpaper: { kind: "preset", id: p.id }, palette: [] })}>
              <span className="wp-thumb" style={{ backgroundImage: `url("${sceneUrl(p.id)}")` }} />
              <span className="wp-label">{p.label}</span>
            </button>
          ))}
          {ws.wallpaper.kind === "custom" && (
            <button type="button" role="radio" aria-checked className="wp-tile is-selected" onClick={() => file.current?.click()}>
              <span className="wp-thumb" style={{ backgroundImage: `url("${ws.wallpaper.url}")` }} />
              <span className="wp-label">Tu imagen</span>
            </button>
          )}
          <button type="button" role="radio" aria-checked={ws.wallpaper.kind === "none"} className={`wp-tile ${ws.wallpaper.kind === "none" ? "is-selected" : ""}`} onClick={() => update({ wallpaper: { kind: "none" }, palette: [] })}>
            <span className="wp-thumb wp-plain" />
            <span className="wp-label">Sin imagen</span>
          </button>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Leyendo la imagen…" : "Usar una imagen mía"}
          </button>
          <input ref={file} type="file" accept="image/*" hidden aria-label="Elegir una imagen de fondo" onChange={(e) => upload(e.target.files?.[0])} />
          <span className="muted small">La imagen no sale de {yourDevice()}.</span>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-label="Color de acento">
        <h2>Color de acento</h2>
        {suggestions.length > 0 ? (
          <p className="muted small" data-testid="accent-hint">
            Este fondo se ve sobre todo {colorName(suggestions[0])}. {following ? "Estamos usando ese color." : "Podés usarlo, o quedarte con el tuyo."}
          </p>
        ) : (
          <p className="muted small">Sin imagen no hay colores para sugerir: elegí el que quieras.</p>
        )}
        <div className="swatches" role="radiogroup" aria-label="Colores del fondo">
          {suggestions.map((c, i) => {
            const on = following ? i === 0 : ws.accent === c;
            return (
              <button key={c} type="button" role="radio" aria-checked={on} aria-label={`${colorName(c)}${i === 0 ? " (sugerido)" : ""}`} className={`swatch ${on ? "is-selected" : ""}`} style={{ background: c }} onClick={() => update({ accent: i === 0 ? null : c })} />
            );
          })}
        </div>
        <label className="a11y-check check">
          <input type="checkbox" checked={following} disabled={suggestions.length === 0} onChange={(e) => update({ accent: e.target.checked ? null : accent })} />
          <span>
            Tomar el color del fondo
            <small className="muted">Si cambiás de fondo, el acento cambia con él.</small>
          </span>
        </label>
        <label className="field color-field">
          <span>O elegí cualquier color</span>
          <input type="color" value={accent} aria-label="Elegir un color de acento" onChange={(e) => update({ accent: e.target.value })} />
        </label>
        <p className="muted small">Ajustamos el tono para que el texto siempre se lea bien.</p>
      </section>

      <section className="card" aria-label="Tema">
        <h2>Luz</h2>
        <div className="tabs" role="radiogroup" aria-label="Tema de la app">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-label={`Tema ${t.label.toLowerCase()}`} aria-checked={theme === t.id} className={theme === t.id ? "is-active" : ""} onClick={() => setTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <QuotesSection />

      <section className="card" aria-label="Vista previa del espacio">
        <h2>Así se ve</h2>
        <div className="ws-preview" style={preview ? { backgroundImage: `url("${preview}")` } : undefined}>
          <div className="ws-preview-card">
            <strong>{(identity?.first_name.trim() || ws.name.trim()) ? `Hola, ${identity?.first_name.trim() || ws.name.trim()}` : "Hola"}</strong>
            <span>¿Qué querés entender hoy?</span>
            <span className="ws-preview-btn">Empezar</span>
          </div>
        </div>
      </section>

      {!saved && <p className="warn-text small">Este equipo no dejó guardar tus cambios: se ven ahora, pero se pierden al cerrar la app.</p>}
    </div>
  );
}
