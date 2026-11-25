import { useState } from "react";
import { backupApi, errorText } from "../../api";
import { onPhone } from "../../lib/platform";
import { keepFile } from "../../lib/saveFile";

/** AC-60: a .zip of everything (never the API keys), and restoring it. */
export function BackupSection() {
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
