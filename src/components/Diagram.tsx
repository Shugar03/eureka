import { useEffect, useId, useState } from "react";

interface Props {
  title: string;
  code: string;
}

/** The theme on screen: "system" follows the OS (a dark diagram on a light page loses its labels). */
function darkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" ? false : theme === "system" ? !!window.matchMedia?.("(prefers-color-scheme: dark)").matches : true;
}

/** Renders Mermaid lazily (the library is big); invalid code falls back to the source. */
export function Diagram({ title, code }: Props) {
  const dark = darkTheme();
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(false);
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
  }, [code, id, dark]);

  return (
    <figure className={`visual ${dark ? "is-dark" : ""}`} aria-label={`Diagrama: ${title}`} data-testid="diagram">
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
