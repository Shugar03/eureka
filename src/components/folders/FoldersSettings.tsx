import { useEffect, useState } from "react";
import { errorText, folderApi } from "../../api";
import type { SharedFolder } from "../../types";
import { Icon } from "../Icon";

/**
 * AC-219: Ajustes → Carpetas. The folders the teacher can use, each one read-only
 * or «leer y organizar», and what sharing means.
 */
export function FoldersSettings() {
  const [list, setList] = useState<SharedFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    folderApi.list().then(setList).catch(() => setList([]));
  }, []);

  const run = async (f: () => Promise<SharedFolder[] | SharedFolder | null>) => {
    setError(null);
    try {
      await f();
      setList(await folderApi.list());
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="stack">
      <section className="card fo-intro" aria-label="Carpetas de trabajo">
        <h2>Carpetas de trabajo</h2>
        <p className="muted small">
          Compartí carpetas de esta computadora para que el profesor pueda mirarlas, ordenarlas y crear documentos (Excel, Word, notas) adentro. Solo ve las carpetas que elijas, nunca el resto. Los cambios siempre te los propone en un plan que aplicás vos, nada se borra ni se pisa (lo que sobra va a una papelera de Eureka dentro de la misma carpeta) y cada plan se puede deshacer.
        </p>
        <p className="muted small">Lo que el profesor lee de tus archivos viaja a tu proveedor del modelo, como lo que escribís en el chat. Los archivos ocultos y los que parecen claves o contraseñas nunca se leen.</p>
        <div className="row">
          <button className="btn primary" onClick={() => run(() => folderApi.share(true))}>
            <Icon name="folder" size={16} /> Compartir una carpeta
          </button>
        </div>
        {error && (
          <p className="error-text small" role="alert">
            {error}
          </p>
        )}
      </section>
      {list && list.length > 0 && (
        <ul className="fo-list" aria-label="Carpetas compartidas">
          {list.map((f) => (
            <li key={f.id} className="card fo-item">
              <span className="fo-icon" aria-hidden>
                <Icon name="folder" size={18} />
              </span>
              <span className="fo-text">
                <strong>{f.label}</strong>
                <small title={f.path}>{f.path}</small>
              </span>
              <label className="fo-mode">
                <span className="sr-only">Permiso de {f.label}</span>
                <select value={f.writable ? "write" : "read"} onChange={(e) => run(() => folderApi.setWritable(f.id, e.target.value === "write"))} aria-label={`Permiso de ${f.label}`}>
                  <option value="write">Leer y organizar</option>
                  <option value="read">Solo leer</option>
                </select>
              </label>
              <button
                className={`btn small ${armed === f.id ? "danger" : "ghost"}`}
                onBlur={() => setArmed(null)}
                onClick={() => (armed === f.id ? (setArmed(null), run(() => folderApi.remove(f.id))) : setArmed(f.id))}
                aria-label={armed === f.id ? `¿Seguro? Dejar de compartir ${f.label}` : `Dejar de compartir ${f.label}`}
              >
                {armed === f.id ? "¿Seguro?" : "Dejar de compartir"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list && list.length === 0 && <p className="muted small">Todavía no compartiste ninguna carpeta.</p>}
    </div>
  );
}
