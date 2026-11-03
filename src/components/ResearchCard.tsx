import type { ResearchMeta } from "../types";
import { Markdown } from "./Markdown";

/** A research step (AC-29/30): question, summary and sources, or why it did not run. */
export function ResearchCard({ question, result }: { question: string; result: ResearchMeta | null }) {
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
                <span className="muted small">{new URL(s.url).hostname}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
