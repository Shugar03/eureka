import { useEffect, useMemo, useState } from "react";
import { api, errorText, libraryApi } from "../api";
import type { Book, BookSummary, LibraryHit } from "../types";
import { pdfBook, textToMarkdown } from "../lib/bookText";
import { Markdown } from "./Markdown";
import { ReadAloud } from "./a11y/ReadAloud";

interface Props {
  /** Opens a new session to study a section. */
  onOpenSession: (id: string) => void;
}

/** Section Markdown split at its page markers, so the reader shows where each page starts. */
function pieces(markdown: string): { page: number | null; text: string }[] {
  const out: { page: number | null; text: string }[] = [];
  let page: number | null = null;
  for (const part of markdown.split(/<!-- p:(\d+) -->/)) {
    if (/^\d+$/.test(part)) {
      page = Number(part);
      continue;
    }
    if (part.trim()) out.push({ page, text: part.trim() });
  }
  return out;
}

const kb = (chars: number) => (chars > 1_000_000 ? `${(chars / 1_000_000).toFixed(1)} M` : `${Math.max(1, Math.round(chars / 1000))} k`);

/** AC-69…71: the learner's bibliography, converted and indexed on this PC. */
export function LibraryScreen({ onOpenSession }: Props) {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [section, setSection] = useState(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    libraryApi.list().then(setBooks).catch((e) => setError(errorText(e)));
  }, []);

  const openBook = async (id: string, sectionId = 0) => {
    setError(null);
    try {
      setBook(await libraryApi.get(id));
      setSection(sectionId);
      setArmed(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const add = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    const started = performance.now();
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      setProgress(`Leyendo ${file.name}…`);
      const doc = isPdf
        ? await pdfBook(await file.arrayBuffer(), (done, total) => setProgress(`Leyendo ${file.name}: página ${done} de ${total}`))
        : { markdown: /\.md$/i.test(file.name) ? await file.text() : textToMarkdown(await file.text()), pages: 0, scanned: [] as number[] };
      setProgress("Indexando…");
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      const saved = await libraryApi.import(title, file.name, doc.markdown, doc.pages, doc.scanned);
      setBooks(await libraryApi.list());
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      const scanned = doc.scanned.length ? ` ${doc.scanned.length} páginas escaneadas no tienen texto y no se pueden buscar.` : "";
      const tokens = Math.ceil(doc.markdown.replace(/<!-- p:\d+ -->/g, "").length / 3.5);
      setNotice(`Listo: «${saved.title}» quedó en la biblioteca (${saved.sections} secciones, ${secs} s, 0 tokens del modelo; el texto equivale a ~${tokens.toLocaleString("es-AR")} tokens).${scanned}`);
      await openBook(saved.id);
    } catch (e) {
      setError(typeof e === "string" ? e : `No se pudo leer ${file.name}: ${errorText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  const search = async () => {
    if (!query.trim()) return setHits(null);
    try {
      setHits(await libraryApi.search(query, 10));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const current = book?.sections.find((s) => s.id === section) ?? book?.sections[0];
  const shown = useMemo(() => (current ? pieces(current.markdown) : []), [current]);

  const study = async () => {
    if (!book || !current) return;
    setBusy(true);
    try {
      const s = await api.createSession(`Entender «${current.title}» del libro «${book.title}»`);
      onOpenSession(s.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const toGraph = async () => {
    if (!book || !current) return;
    setBusy(true);
    setError(null);
    try {
      await api.importNotes(`${book.title} — ${current.title}`, current.markdown.replace(/<!-- p:\d+ -->/g, ""));
      setNotice(`Las ideas de «${current.title}» quedaron en el grafo.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!book) return;
    if (!armed) return setArmed(true);
    try {
      await libraryApi.remove(book.id);
      setBook(null);
      setHits(null);
      setBooks(await libraryApi.list());
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="library">
      <header className="chat-head">
        <h1 className="chat-title">Biblioteca</h1>
        {books && <span className="muted small">{books.length === 1 ? "1 documento" : `${books.length} documentos`}</span>}
        <form
          className="library-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la biblioteca…" aria-label="Buscar en la biblioteca" />
        </form>
        <label className={`btn small primary file-pick ${progress ? "is-disabled" : ""}`}>
          {progress ? "Leyendo…" : "Agregar PDF o texto"}
          <input
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            aria-label="Agregar un documento a la biblioteca"
            disabled={!!progress}
            onChange={(e) => {
              add(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </header>

      {(progress || notice || error) && (
        <div className="library-status">
          {progress && (
            <p className="muted" role="status" data-testid="library-progress">
              {progress}
            </p>
          )}
          {notice && !progress && <p role="status">{notice}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="library-body">
        <aside className="library-side" aria-label="Documentos">
          {!books ? (
            <p className="muted pad">Cargando…</p>
          ) : books.length === 0 ? (
            <div className="pad">
              <p>
                <strong>Tu biblioteca está vacía.</strong>
              </p>
              <p className="muted small">Agregá un PDF, un .txt o un .md: se convierte e indexa en esta PC, sin usar el modelo. Después el profesor puede buscar ahí antes que en la web.</p>
            </div>
          ) : (
            <ul className="library-books">
              {books.map((b) => (
                <li key={b.id}>
                  <button className={`library-book ${book?.id === b.id ? "is-active" : ""}`} onClick={() => openBook(b.id)}>
                    <strong>{b.title}</strong>
                    <span className="muted small">
                      {b.pages ? `${b.pages} págs · ` : ""}
                      {b.sections} secciones · {kb(b.chars)} caracteres
                      {b.scanned ? ` · ${b.scanned} escaneadas` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {book && (
            <nav className="library-toc" aria-label="Índice">
              <h3>Índice</h3>
              {book.sections.map((s) => (
                <button key={s.id} className={`toc-item level-${s.level} ${current?.id === s.id ? "is-active" : ""}`} onClick={() => setSection(s.id)}>
                  {s.title}
                  {s.page ? <span className="muted small"> p. {s.page}</span> : null}
                </button>
              ))}
            </nav>
          )}
        </aside>

        <section className="library-main">
          {hits ? (
            <section className="library-hits" aria-label="Resultados">
              <div className="row-between">
                <h2>{hits.length ? `Resultados para «${query}»` : `Nada sobre «${query}» en la biblioteca`}</h2>
                <button className="btn ghost small" onClick={() => setHits(null)}>
                  Cerrar resultados
                </button>
              </div>
              <ul className="library-hit-list">
                {hits.map((h, i) => (
                  <li key={i}>
                    <button className="library-hit" onClick={() => openBook(h.book_id, h.section_id).then(() => setHits(null))}>
                      <span className="library-hit-src">
                        <strong>{h.book_title}</strong> · {h.section}
                        {h.page ? ` · p. ${h.page}` : ""}
                      </span>
                      <span className="muted">{h.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : !book || !current ? (
            <p className="muted pad">Elegí un documento para leerlo, o buscá en toda la biblioteca.</p>
          ) : (
            <article className="library-reader" aria-label="Lector">
              <div className="row-between library-reader-head">
                <div>
                  <span className="muted small">{book.title}</span>
                  <h2>{current.title}</h2>
                </div>
                <span className="row">
                  <button className="btn small primary" disabled={busy} onClick={study}>
                    Estudiar esta sección
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={toGraph} title="Usa el modelo para extraer las ideas">
                    Pasar al grafo
                  </button>
                  <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={remove}>
                    {armed ? "¿Seguro? Quitar libro" : "Quitar de la biblioteca"}
                  </button>
                </span>
              </div>
              <ReadAloud markdown={shown.map((p) => p.text).join("\n\n")} label="Escuchar esta sección" />
              {shown.map((p, i) => (
                <div key={i} className="library-page">
                  {p.page !== null && <div className="library-page-mark">p. {p.page}</div>}
                  <Markdown text={p.text} />
                </div>
              ))}
              {book.sections.length > 1 && (
                <div className="row-between library-nav">
                  <button className="btn ghost small" disabled={current.id === book.sections[0].id} onClick={() => setSection(current.id - 1)}>
                    ← Anterior
                  </button>
                  <button className="btn ghost small" disabled={current.id === book.sections[book.sections.length - 1].id} onClick={() => setSection(current.id + 1)}>
                    Siguiente →
                  </button>
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
