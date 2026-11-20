import { useState } from "react";
import { errorText, folderApi } from "../../api";
import type { FolderOp, FolderPlanMeta, Session } from "../../types";
import { Icon, type IconName } from "../Icon";

const GROUPS: { title: string; icon: IconName; of: (o: FolderOp) => boolean }[] = [
  { title: "Carpetas nuevas", icon: "folder", of: (o) => o.op === "mkdir" },
  { title: "Mover o renombrar", icon: "arrow", of: (o) => o.op === "move" },
  { title: "Documentos nuevos", icon: "pencil", of: (o) => o.op === "write" || o.op === "xlsx" || o.op === "docx" },
  { title: "A la papelera de Eureka", icon: "stop", of: (o) => o.op === "trash" },
];

function line(o: FolderOp): { main: string; sub?: string } {
  switch (o.op) {
    case "mkdir":
      return { main: o.path };
    case "move": {
      const sameDir = o.from.split("/").slice(0, -1).join("/") === o.to.split("/").slice(0, -1).join("/");
      return { main: o.to, sub: sameDir ? `antes «${o.from.split("/").pop()}»` : `desde ${o.from}` };
    }
    case "trash":
      return { main: o.path, sub: "se aparta, no se borra" };
    case "write":
      return { main: o.path, sub: `${o.content.split("\n").length} líneas` };
    case "xlsx":
      return { main: o.path, sub: o.sheets.map((s) => `${s.name}: ${s.rows.length} filas`).join(" · ") };
    case "docx":
      return { main: o.path, sub: `${o.title ? `«${o.title}» · ` : ""}${o.blocks.length} bloques` };
  }
}

/**
 * AC-220: the plan of changes for a shared folder. Nothing changes until
 * «Aplicar»; afterwards «Deshacer» puts the folder back as it was.
 */
export function FolderPlanCard({ meta, sessionId, callId, onSession }: { meta: FolderPlanMeta; sessionId: string; callId: string; onSession: (s: Session) => void }) {
  const [open, setOpen] = useState(meta.ops.length <= 8);
  const [busy, setBusy] = useState<"apply" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: "apply" | "undo") => {
    setBusy(what);
    setError(null);
    try {
      onSession(await (what === "apply" ? folderApi.apply(sessionId, callId) : folderApi.undo(sessionId, callId)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const status = meta.status;
  return (
    <section className={`fo-plan is-${status}`} aria-label={`Cambios en «${meta.folder}»`}>
      <header className="fo-plan-head">
        <span className="fo-icon" aria-hidden>
          <Icon name="folder" size={18} />
        </span>
        <div>
          <span className="fo-kicker">{status === "proposed" ? `Plan para «${meta.folder}»` : status === "applied" ? "Hecho" : status === "undone" ? "Deshecho" : "Se cortó a mitad de camino"}</span>
          <strong>{meta.summary || "Cambios en la carpeta"}</strong>
          <small>{meta.counts}</small>
        </div>
      </header>
      {status === "proposed" && (
        <>
          <button type="button" className="fo-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Ocultar los cambios" : `Ver los ${meta.ops.length} cambios`}
          </button>
          {open && (
            // It scrolls when the plan is long: reachable with the keyboard too.
            <div className="fo-groups" role="group" aria-label="Los cambios" tabIndex={0}>
              {GROUPS.map((g) => {
                const ops = meta.ops.filter(g.of);
                if (!ops.length) return null;
                return (
                  <div key={g.title} className="fo-group" role="group" aria-label={g.title}>
                    <span className="fo-group-title">
                      <Icon name={g.icon} size={13} /> {g.title} <span className="fo-n">{ops.length}</span>
                    </span>
                    <ul>
                      {ops.map((o, i) => {
                        const l = line(o);
                        return (
                          <li key={i}>
                            <span className="fo-path">{l.main}</span>
                            {l.sub && <small>{l.sub}</small>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {status === "failed" && meta.error && <p className="error-text small">{meta.error}. Se hicieron {meta.done ?? 0} pasos: podés deshacerlos.</p>}
      {status === "undone" && <p className="muted small">La carpeta quedó como estaba.{meta.kept?.length ? ` Dejé ${meta.kept.length === 1 ? "un archivo que" : `${meta.kept.length} archivos que`} cambiaste después: ${meta.kept.join(", ")}.` : ""}</p>}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      <footer className="fo-plan-foot">
        {status === "proposed" && (
          <>
            <span className="muted small">Nada se borra ni se pisa. Se puede deshacer.</span>
            <button className="btn primary" onClick={() => run("apply")} disabled={busy !== null}>
              {busy === "apply" ? "Aplicando…" : "Aplicar"}
            </button>
          </>
        )}
        {(status === "applied" || status === "failed") && (
          <>
            <span className="muted small">{status === "applied" ? `Listo: ${meta.counts}.` : ""}</span>
            <button className="btn ghost" onClick={() => run("undo")} disabled={busy !== null}>
              {busy === "undo" ? "Deshaciendo…" : "Deshacer"}
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
