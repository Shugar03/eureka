// AC-73..77: access settings the learner chose. Display ones apply here, as
// attributes on <html> the CSS reads; the teacher ones go to the backend.
import type { Accessibility } from "../types";

export const DEFAULT_ACCESSIBILITY: Accessibility = {
  easy_reading: false,
  literal: false,
  short_steps: false,
  read_aloud: false,
  speech_rate: 1,
  dictation: false,
  spacing: false,
  text_size: "normal",
  reduce_motion: false,
};

export function applyAccessibility(a: Accessibility) {
  const d = document.documentElement.dataset;
  d.textSize = a.text_size;
  if (a.spacing) d.spacing = "on";
  else delete d.spacing;
  if (a.reduce_motion) d.motion = "reduce";
  else delete d.motion;
}

/** LaTeX as words a voice can say: `\frac{a}{b}` → "a sobre b", `x^2` → "x al cuadrado". */
function mathToWords(tex: string): string {
  return tex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 sobre $2 ")
    .replace(/\\sqrt\{([^{}]*)\}/g, " raíz de $1 ")
    .replace(/\^\{?2\}?/g, " al cuadrado ")
    .replace(/\^\{?3\}?/g, " al cubo ")
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, " a la $1$2 ")
    .replace(/_\{([^{}]*)\}|_(\S)/g, " sub $1$2 ")
    .replace(/\\cdot|\\times/g, " por ")
    .replace(/\\(?:to|rightarrow)/g, " tiende a ")
    .replace(/\\lim/g, " límite ")
    .replace(/\\(?:le|leq)\b/g, " menor o igual que ")
    .replace(/\\(?:ge|geq)\b/g, " mayor o igual que ")
    .replace(/=/g, " igual a ")
    .replace(/\\([a-zA-Z]+)/g, " $1 ")
    .replace(/[{}]/g, " ");
}

/** Markdown as plain text to read aloud: no symbols, code, citations or markup. */
export function speechText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (hay un bloque de código en pantalla) ")
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => mathToWords(t))
    .replace(/\$([^$\n]+?)\$/g, (_, t) => mathToWords(t))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:L?\d+|cita no verificada|[^\]]*\bp\. \d+)\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}.*$/gm, "")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/[*_`~]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/^[, \t]+|[, \t]+$/gm, "")
    .trim();
}

/** Splits `text` around the word starting at `at` (from a boundary event). */
export function splitAtWord(text: string, at: number): [string, string, string] {
  if (at < 0 || at >= text.length) return [text, "", ""];
  const len = /^\S*/.exec(text.slice(at))![0].length;
  return [text.slice(0, at), text.slice(at, at + len), text.slice(at + len)];
}
