import { useEffect, useState } from "react";
import { codeApi } from "../../api";
import { langLabel } from "../../lib/code";
import { onPhone } from "../../lib/platform";
import type { Runtime } from "../../types";

/** AC-53: which toolchains the code console found on this PC. */
export function RuntimesSection() {
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
