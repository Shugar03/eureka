import { useEffect, useId, useState } from "react";

interface Props {
  title: string;
  code: string;
}

/** Renders Mermaid lazily (the library is big); invalid code falls back to the source. */
export function Diagram({ title, code }: Props) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(false);
    const dark = document.documentElement.dataset.theme !== "light";
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const { svg } = await mermaid.render(`mmd-${id}`, code);
        if (alive) setSvg(svg);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code, id]);

  return (
    <figure className="visual" aria-label={`Diagrama: ${title}`} data-testid="diagram">
      <figcaption className="visual-title">{title}</figcaption>
      {failed ? (
        <div className="visual-fallback">
          <p className="muted small">No se pudo dibujar el diagrama. Código:</p>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      ) : svg ? (
        // Mermaid output with securityLevel "strict" (no scripts, sanitized labels).
        <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="muted small">Dibujando…</p>
      )}
    </figure>
  );
}
