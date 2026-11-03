import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export function CommandMenu({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => input.current?.focus(), []);
  // Escape closes even if focus left the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => setIndex(0), [query]);

  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = "";
  return (
    <div className="cmd-backdrop" data-testid="cmd-backdrop" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-label="Paleta de comandos" onMouseDown={(e) => {
          e.stopPropagation();
          // Keep focus in the input so arrows/Enter/Escape keep working.
          if (e.target !== input.current) e.preventDefault();
        }}
      >
        <input
          ref={input}
          className="cmd-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escribí un comando o buscá una sesión…"
          aria-label="Buscar comando"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[index]);
            }
          }}
        />
        <div className="cmd-list" id="cmd-list" role="listbox" aria-label="Resultados">
          {results.length === 0 && <p className="cmd-empty">Sin resultados</p>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {header && <div className="cmd-group">{header}</div>}
                <button
                  id={`cmd-${c.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === index}
                  className={`cmd-item ${i === index ? "is-active" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(c)}
                >
                  <span className="cmd-label">{c.label}</span>
                  {c.hint && <kbd>{c.hint}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
