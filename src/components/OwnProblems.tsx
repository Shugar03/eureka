import { useRef, useState } from "react";
import { api, errorText } from "../api";
import type { OwnProblem, OwnProposal } from "../types";
import { fileText } from "../lib/fileText";
import { Markdown } from "./Markdown";

/** AC-173: practice the learner's own problems — paste or attach, review what was read, keep and practice.
 *  AC-174: `initial` comes from the chat (what the person sent, or a library document); nothing is read until they say so. */
export function OwnProblems({ onOpen, initial }: { onOpen: (setId: string) => void; initial?: OwnProposal }) {
  const [open, setOpen] = useState(!!initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const book = initial && !initial.text ? initial.book : "";
  const [read, setRead] = useState<(OwnProblem & { keep: boolean })[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy("Leyendo el archivo…");
    try {
      const r = await fileText(f, "problems", () => setBusy(`Leyendo ${f.name} con el modelo (es una imagen)…`));
      setText((t) => (t.trim() ? `${t.trim()}\n\n${r.text}` : r.text));
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
      setNotice(r.viaVision ? "Lo leí de una imagen: revisá que los enunciados hayan salido bien antes de seguir." : null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  const readProblems = async () => {
    setError(null);
    setBusy("Separando los ejercicios…");
    try {
      setRead((await api.readOwnProblems(text, book)).map((p) => ({ ...p, keep: true })));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const kept = read?.filter((p) => p.keep && p.statement.trim()) ?? [];
  const practice = async () => {
    setError(null);
    setBusy("Armando la práctica…");
    try {
      const set = await api.createOwnPractice(title, kept.map(({ keep: _, ...p }) => p));
      onOpen(set.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const edit = (i: number, patch: Partial<OwnProblem & { keep: boolean }>) => setRead((r) => r && r.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  if (!open)
    return (
      <section className="card own-problems" aria-label="Practicar mis problemas">
        <div className="row-between">
          <div>
            <h2>Practicar mis problemas</h2>
            <p className="muted small">Traé tu guía de ejercicios, un parcial viejo o lo que copiaste del pizarrón: los resolvés de a uno, con empujones y corrección.</p>
          </div>
          <button className="btn" onClick={() => setOpen(true)}>
            Traer mis problemas
          </button>
        </div>
      </section>
    );

  return (
    <section className="card own-problems" aria-label="Practicar mis problemas">
      <h2>Practicar mis problemas</h2>
      {!read && book ? (
        <>
          <p className="muted small">
            Los ejercicios de «{book}», de tu biblioteca. Los leo, los revisás y elegís cuáles practicar.
          </p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre (ej: Guía 3 de Física)" aria-label="Nombre de la práctica" />
          <div className="row-end">
            <button className="btn primary" disabled={!!busy} onClick={readProblems}>
              Leer los ejercicios
            </button>
          </div>
        </>
      ) : !read ? (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre (ej: Guía 3 de Física)" aria-label="Nombre de la práctica" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Pegá los enunciados. Si la guía trae las respuestas, pegalas también: se usan para corregirte." aria-label="Tus ejercicios" />
          <div className="row-between">
            <span className="row">
              <button className="btn small" disabled={!!busy} onClick={() => file.current?.click()}>
                Desde un PDF o una foto
              </button>
              <input ref={file} type="file" accept=".pdf,.txt,.md,image/*" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="Archivo con ejercicios" />
            </span>
            <span className="row">
              {!initial && (
                <button className="btn ghost" onClick={() => setOpen(false)} disabled={!!busy}>
                  Cancelar
                </button>
              )}
              <button className="btn primary" disabled={!!busy || !text.trim()} onClick={readProblems}>
                Leer los ejercicios
              </button>
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Encontré {read.length === 1 ? "1 ejercicio" : `${read.length} ejercicios`}. Corregí lo que haya salido mal y sacá los que no quieras.
          </p>
          <ol className="own-list" aria-label="Ejercicios leídos">
            {read.map((p, i) => (
              <li key={i} className={p.keep ? "" : "is-off"}>
                <label className="row">
                  <input type="checkbox" checked={p.keep} onChange={(e) => edit(i, { keep: e.target.checked })} aria-label={`Practicar el ejercicio ${i + 1}`} />
                  <span className={`tag ${p.given ? "tag-check" : "tag-predict"}`}>{p.given ? "Respuesta de tu guía" : "Solución de Eureka: verificala"}</span>
                </label>
                <textarea value={p.statement} onChange={(e) => edit(i, { statement: e.target.value })} rows={3} aria-label={`Enunciado del ejercicio ${i + 1}`} disabled={!p.keep} />
                {p.keep && (
                  <div className="own-preview muted small">
                    <Markdown text={p.statement} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="row-end">
            {!book && (
              <button className="btn ghost" disabled={!!busy} onClick={() => setRead(null)}>
                Volver al texto
              </button>
            )}
            <button className="btn primary" disabled={!!busy || kept.length === 0} onClick={practice}>
              Practicar ({kept.length})
            </button>
          </div>
        </>
      )}
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {notice && !busy && <p className="muted small">{notice}</p>}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}
