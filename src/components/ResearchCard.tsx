import { useState } from "react";
import { errorText, researchApi } from "../api";
import type { ResearchMeta } from "../types";
import { addPdf } from "../lib/scanned";
import { Markdown } from "./Markdown";

type DocState = { kind: "working"; text: string } | { kind: "ask"; text: string; answer: (yes: boolean) => void } | { kind: "done"; text: string } | { kind: "error"; text: string };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** AC-206: an open PDF the research found, into the library with one tap (OCR included). */
function OpenDocument({ title, url }: { title: string; url: string }) {
  const [state, setState] = useState<DocState | null>(null);
  const busy = state?.kind === "working" || state?.kind === "ask";
  const add = async () => {
    setState({ kind: "working", text: "Bajando el PDF…" });
    try {
      const bytes = await researchApi.fetchDocument(url);
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "documento.pdf");
      const file = new File([bytes], /\.pdf$/i.test(name) ? name : `${name}.pdf`, { type: "application/pdf" });
      const added = await addPdf(file, title, {
        onStatus: (text) => setState({ kind: "working", text }),
        confirm: (_pages, text) => new Promise<boolean>((answer) => setState({ kind: "ask", text, answer })),
      });
      setState({ kind: "done", text: added.ocr === "started" ? "En tu biblioteca · leyendo con OCR" : "En tu biblioteca" });
    } catch (e) {
      setState({ kind: "error", text: errorText(e) });
    }
  };
  return (
    <li className="research-doc">
      <div className="research-doc-head">
        <a href={url} target="_blank" rel="noreferrer noopener">
          {title}
        </a>
        <span className="muted small">{host(url)}</span>
      </div>
      {state?.kind === "done" ? (
        <span className="small research-doc-done" role="status">
          ✓ {state.text}
        </span>
      ) : (
        <button type="button" className="btn small" onClick={add} disabled={busy} aria-label={`Sumar a mi biblioteca: ${title}`}>
          {busy ? "Sumando…" : "Sumar a mi biblioteca"}
        </button>
      )}
      {state?.kind === "working" && (
        <span className="muted small" role="status">
          {state.text}
        </span>
      )}
      {state?.kind === "ask" && (
        <div className="research-doc-ask" role="group" aria-label="Leer con OCR">
          <span className="small">{state.text}</span>
          <button type="button" className="btn small primary" onClick={() => state.answer(true)}>
            Leerlo
          </button>
          <button type="button" className="btn small ghost" onClick={() => state.answer(false)}>
            Solo el texto
          </button>
        </div>
      )}
      {state?.kind === "error" && (
        <span className="error-text small" role="alert">
          No pude sumarlo: {state.text}
        </span>
      )}
    </li>
  );
}

/** A research step (AC-29/30): question, summary and sources, or why it did not run. */
export function ResearchCard({ question, result }: { question: string; result: ResearchMeta | null }) {
  const documents = result?.documents ?? [];
  const uncovered = result?.uncovered ?? [];
  return (
    <section className="research" aria-label="Investigación" data-testid="research">
      <header className="row-between">
        <span className="tag tag-research">Investigación</span>
        <span className="muted small">{question}</span>
      </header>
      {!result ? (
        <p className="muted small">Buscando…</p>
      ) : result.pending ? (
        <p className="muted small" role="status" data-testid="research-pending">
          Investigando en segundo plano… podés seguir: el resultado aparece acá y le llega al profesor.
        </p>
      ) : result.error ? (
        <p className="muted small" data-testid="research-error">
          No se investigó: {result.error}.
        </p>
      ) : (
        <>
          <Markdown text={result.summary} />
          <ol className="sources" aria-label="Fuentes">
            {result.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.title}
                </a>{" "}
                <span className="muted small">{host(s.url)}</span>
              </li>
            ))}
          </ol>
          {documents.length > 0 && (
            <div className="research-docs">
              <h3 className="small">Documentos abiertos que encontré</h3>
              <ul aria-label="Documentos abiertos">
                {documents.map((d) => (
                  <OpenDocument key={d.url} title={d.title} url={d.url} />
                ))}
              </ul>
            </div>
          )}
          {uncovered.length > 0 && <p className="muted small">Sin resultados útiles para: {uncovered.join("; ")}.</p>}
        </>
      )}
    </section>
  );
}
