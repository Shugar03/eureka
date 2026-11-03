import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
  /** Lines the last error points at (1-based), highlighted. */
  errorLines: number[];
  /** Ctrl/Cmd+Enter. */
  onRun: () => void;
}

type CM = typeof import("./codemirror");

/** CodeMirror 6, loaded on first use; a plain textarea until then. */
export function CodeEditor({ value, onChange, lang, errorLines, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [cm, setCm] = useState<CM | null>(null);
  const view = useRef<import("@codemirror/view").EditorView | null>(null);
  const handlers = useRef({ onChange, onRun });
  handlers.current = { onChange, onRun };

  useEffect(() => {
    import("./codemirror").then(setCm).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cm || !host.current) return;
    view.current = cm.create(host.current, value, lang, (v) => handlers.current.onChange(v), () => handlers.current.onRun());
    return () => view.current?.destroy();
  }, [cm, lang]);

  // Outside changes (an exercise's starter, "Restablecer") replace the text.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    if (cm && view.current) cm.markLines(view.current, errorLines);
  }, [cm, errorLines]);

  return cm ? (
    <div className="code-editor" ref={host} />
  ) : (
    <textarea
      className="code-editor code-fallback"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && onRun()}
      aria-label="Código"
      spellCheck={false}
    />
  );
}
