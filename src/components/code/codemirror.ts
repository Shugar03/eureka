// Everything CodeMirror, in one lazily loaded chunk.
import { basicSetup } from "codemirror";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { sql, SQLite } from "@codemirror/lang-sql";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import type { Lang } from "../../types";

function language(l: Lang) {
  switch (l) {
    case "python":
      return python();
    case "rust":
      return rust();
    case "c":
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "csharp":
      return StreamLanguage.define(csharp);
    case "go":
      return go();
    case "sql":
      return sql({ dialect: SQLite });
    default:
      return javascript({ typescript: l === "typescript" });
  }
}

const setErrors = StateEffect.define<number[]>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrors)) continue;
      const lines = e.value.filter((n) => n >= 1 && n <= tr.state.doc.lines);
      deco = Decoration.set(lines.sort((a, b) => a - b).map((n) => Decoration.line({ class: "cm-error-line" }).range(tr.state.doc.line(n).from)));
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Colors come from the app's tokens, so both themes work.
const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "var(--bg)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
  ".cm-gutters": { backgroundColor: "var(--bg-2)", color: "var(--dim)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
  ".cm-error-line": { backgroundColor: "color-mix(in srgb, var(--bad) 16%, transparent)" },
});

// CodeMirror's default palette is made for white (its #a11 strings read 2:1 on the dark theme).
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--purple)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--ok)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--warn)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--dim)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--accent-ink)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: "var(--text)", fontWeight: "600" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--text-2)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--muted)" },
  { tag: t.invalid, color: "var(--bad)" },
]);

export function create(parent: HTMLElement, doc: string, lang: Lang, onChange: (v: string) => void, onRun: () => void): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        keymap.of([{ key: "Mod-Enter", run: () => (onRun(), true) }, indentWithTab]),
        basicSetup,
        language(lang),
        theme,
        syntaxHighlighting(highlight),
        errorField,
        EditorState.tabSize.of(4),
        EditorView.contentAttributes.of({ "aria-label": "Código", spellcheck: "false" }),
        EditorView.updateListener.of((u) => u.docChanged && onChange(u.state.doc.toString())),
      ],
    }),
  });
}

export function markLines(view: EditorView, lines: number[]) {
  view.dispatch({ effects: setErrors.of(lines) });
}
