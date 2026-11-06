// Distribution: like any desktop app, Eureka tells you when a new version is
// ready and installs it with one click. A build without an update source
// (development, the e2e demo) answers "off" or has no command: nothing shows.
// AC-202: the installer runs without a window; the download shows here, and the
// new version opens with what it brings.
import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { errorText } from "../api";
import { Markdown } from "./Markdown";

type Check = { status: "off" } | { status: "current"; version: string } | { status: "available"; version: string; current: string; notes: string };
type Progress = { stage: "downloading"; done: number; total: number | null } | { stage: "installing" };
type WhatsNew = { version: string; from: string; notes: string };

const updates = {
  version: () => invoke<string>("app_version"),
  check: () => invoke<Check>("update_check"),
  install: (onProgress: (p: Progress) => void) => {
    const ch = new Channel<Progress>();
    ch.onmessage = onProgress;
    return invoke<void>("update_install", { onProgress: ch });
  },
  whatsNew: () => invoke<WhatsNew | null>("update_whats_new"),
};

/** Checks again every few hours, for an Eureka left open for days. */
const EVERY_MS = 6 * 60 * 60 * 1000;
/** Not on the first paint: the welcome and the session come first. */
const FIRST_MS = import.meta.env.MODE === "e2e" ? 300 : 8000;
const SKIP_KEY = "la.update.skip";

function skipped(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
}

const mb = (bytes: number) => (bytes / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: bytes < 10_000_000 ? 1 : 0 });

function useInstall() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setInstalling(true);
    setError(null);
    setProgress({ stage: "downloading", done: 0, total: null });
    try {
      // Eureka closes and opens again on the new version.
      await updates.install(setProgress);
    } catch (e) {
      setError(errorText(e));
      setInstalling(false);
      setProgress(null);
    }
  };
  return { installing, progress, error, install };
}

/** The bar while the new version downloads, then the few seconds of installing. */
function InstallProgress({ progress }: { progress: Progress }) {
  if (progress.stage === "installing") {
    return (
      <div className="update-progress" role="status">
        <progress aria-label="Instalando la actualización" />
        <p className="small">Instalando… Eureka se cierra unos segundos y se vuelve a abrir sola.</p>
      </div>
    );
  }
  const { done, total } = progress;
  return (
    <div className="update-progress" role="status">
      <progress aria-label="Descarga de la actualización" max={total ?? undefined} value={total ? done : undefined} />
      <p className="small muted">{total ? `Descargando… ${mb(done)} de ${mb(total)} MB` : "Descargando…"}</p>
    </div>
  );
}

/** The card in the corner when a new version is ready. */
export function UpdateNotice() {
  const [found, setFound] = useState<Extract<Check, { status: "available" }> | null>(null);
  const { installing, progress, error, install } = useInstall();

  useEffect(() => {
    let alive = true;
    const look = () =>
      updates
        .check()
        .then((c) => alive && c.status === "available" && c.version !== skipped() && setFound(c))
        .catch(() => {});
    const first = setTimeout(look, FIRST_MS);
    const again = setInterval(look, EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(again);
    };
  }, []);

  if (!found) return <WhatsNewCard />;
  const later = () => {
    try {
      localStorage.setItem(SKIP_KEY, found.version);
    } catch {}
    setFound(null);
  };

  return (
    <>
      <aside className="update-notice card" role="status" aria-label="Actualización disponible">
        <span className="update-kicker">Nueva versión</span>
        <strong className="update-title">Eureka {found.version} está lista</strong>
        <p className="muted small">Tenés la {found.current}. Se baja, Eureka se cierra unos segundos y se vuelve a abrir sola; tus datos no se tocan.</p>
        {found.notes && !installing && (
          <div className="small update-notes">
            <Markdown text={found.notes} />
          </div>
        )}
        {progress && <InstallProgress progress={progress} />}
        {error && (
          <p className="error-text small" role="alert">
            {error}
          </p>
        )}
        {!installing && (
          <div className="row-end">
            <button className="btn ghost small" onClick={later}>
              Más tarde
            </button>
            <button className="btn primary small" onClick={install}>
              Actualizar ahora
            </button>
          </div>
        )}
      </aside>
      <WhatsNewCard />
    </>
  );
}

/** Right after updating itself: what this version brings, once. */
function WhatsNewCard() {
  const [news, setNews] = useState<WhatsNew | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    updates
      .whatsNew()
      .then((n) => n && setNews(n))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (news) done.current?.focus();
  }, [news]);
  if (!news) return null;
  const close = () => setNews(null);
  return (
    <div className="whats-new-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="whats-new card" role="dialog" aria-modal="true" aria-labelledby="whats-new-title" onKeyDown={(e) => e.key === "Escape" && close()}>
        <span className="update-kicker">Actualizada</span>
        <h2 id="whats-new-title">Novedades de Eureka {news.version}</h2>
        <p className="muted small">Antes tenías la {news.from}. Tus sesiones, tarjetas y biblioteca siguen como estaban.</p>
        {news.notes ? (
          <div className="whats-new-notes">
            <Markdown text={news.notes} />
          </div>
        ) : null}
        <div className="row-end">
          <button ref={done} className="btn primary" onClick={close}>
            Listo
          </button>
        </div>
      </section>
    </div>
  );
}

/** Ajustes → Conexión: the version and a manual check. */
export function AboutEureka() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const { installing, progress, error, install } = useInstall();

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
            {installing ? "Actualizando…" : `Actualizar a la ${state.version}`}
          </button>
        ) : (
          <button className="btn small" onClick={check} disabled={checking}>
            {checking ? "Buscando…" : "Buscar actualizaciones"}
          </button>
        )}
      </div>
      {progress && <InstallProgress progress={progress} />}
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
