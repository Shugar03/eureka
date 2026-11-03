// Distribution: like any desktop app, Eureka tells you when a new version is
// ready and installs it with one click. A build without an update source
// (development, the e2e demo) answers "off" or has no command: nothing shows.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "../api";

type Check = { status: "off" } | { status: "current"; version: string } | { status: "available"; version: string; current: string; notes: string };

const updates = {
  version: () => invoke<string>("app_version"),
  check: () => invoke<Check>("update_check"),
  install: () => invoke<void>("update_install"),
};

/** Checks again every few hours, for an Eureka left open for days. */
const EVERY_MS = 6 * 60 * 60 * 1000;
const SKIP_KEY = "la.update.skip";

function skipped(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

function useInstall() {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      // Eureka closes and opens again on the new version.
      await updates.install();
    } catch (e) {
      setError(errorText(e));
      setInstalling(false);
    }
  };
  return { installing, error, install };
}

/** The card in the corner when a new version is ready. */
export function UpdateNotice() {
  const [found, setFound] = useState<Extract<Check, { status: "available" }> | null>(null);
  const { installing, error, install } = useInstall();

  useEffect(() => {
    let alive = true;
    const look = () =>
      updates
        .check()
        .then((c) => alive && c.status === "available" && c.version !== skipped() && setFound(c))
        .catch(() => {});
    // Not on the first paint: the welcome and the session come first.
    const first = setTimeout(look, 8000);
    const again = setInterval(look, EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(again);
    };
  }, []);

  if (!found) return null;
  const later = () => {
    try {
      localStorage.setItem(SKIP_KEY, found.version);
    } catch {}
    setFound(null);
  };

  return (
    <aside className="update-notice card" role="status" aria-label="Actualización disponible">
      <strong>Eureka {found.version} está lista</strong>
      <p className="muted small">Tenés la {found.current}. Se instala en unos segundos y Eureka se vuelve a abrir; tus datos no se tocan.</p>
      {found.notes && <p className="small update-notes">{found.notes}</p>}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      <div className="row-end">
        <button className="btn ghost small" onClick={later} disabled={installing}>
          Más tarde
        </button>
        <button className="btn primary small" onClick={install} disabled={installing}>
          {installing ? "Instalando…" : "Actualizar ahora"}
        </button>
      </div>
    </aside>
  );
}

/** Ajustes → Conexión: the version and a manual check. */
export function AboutEureka() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const { installing, error, install } = useInstall();

  useEffect(() => {
    updates.version().then(setVersion).catch(() => {});
  }, []);
  if (!version) return null;

  const check = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setState(await updates.check());
    } catch (e) {
      setCheckError(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="card" aria-label="Acerca de Eureka">
      <h2>Acerca de Eureka</h2>
      <div className="row-between">
        <span>
          Versión <strong data-testid="app-version">{version}</strong>
        </span>
        {state?.status === "available" ? (
          <button className="btn primary small" onClick={install} disabled={installing}>
            {installing ? "Instalando…" : `Actualizar a la ${state.version}`}
          </button>
        ) : (
          <button className="btn small" onClick={check} disabled={checking}>
            {checking ? "Buscando…" : "Buscar actualizaciones"}
          </button>
        )}
      </div>
      {state?.status === "current" && <p className="muted small" role="status">Tenés la última versión.</p>}
      {state?.status === "off" && <p className="muted small" role="status">Esta copia de Eureka es de desarrollo: se actualiza reconstruyéndola, no sola.</p>}
      {(checkError || error) && (
        <p className="error-text small" role="alert">
          {checkError ?? error}
        </p>
      )}
    </section>
  );
}
