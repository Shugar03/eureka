// AC-60: Anki's "Notes in Plain Text" format (File → Export → Notas en texto
// plano), both ways. Header lines start with "#": #separator, #html and the
// optional #notetype/#deck/#tags columns, which are not card sides.
import type { Deck } from "../types";

const SEPARATORS: Record<string, string> = { tab: "\t", semicolon: ";", comma: ",", pipe: "|", space: " " };

/** HTML of an Anki field to plain text with line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits one line, honoring "quoted fields" (with "" as an escaped quote). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseAnkiText(text: string): { cards: [string, string][]; skipped: number } {
  let sep = "\t";
  let html = true;
  const meta = new Set<number>(); // 1-based columns that are not sides
  const cards: [string, string][] = [];
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (raw.startsWith("#")) {
      const [k, v = ""] = raw.slice(1).split(":");
      const key = k.trim().toLowerCase();
      if (key === "separator") sep = SEPARATORS[v.trim().toLowerCase()] ?? (v || "\t");
      else if (key === "html") html = v.trim() === "true";
      else if (key.endsWith(" column")) meta.add(Number(v));
      continue;
    }
    if (!raw.trim()) continue;
    const fields = splitLine(raw, sep).filter((_, i) => !meta.has(i + 1));
    const [front, back] = fields.map((f) => (html ? htmlToText(f) : f.trim()));
    if (front && back) cards.push([front, back]);
    else skipped++;
  }
  return { cards, skipped };
}

/** A deck in the same format, ready for Anki's File → Import. */
export function toAnkiText(deck: Deck): string {
  const field = (s: string) => {
    const h = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
    return /[\t"]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h;
  };
  return ["#separator:tab", "#html:true", ...deck.cards.map((c) => `${field(c.front)}\t${field(c.back)}`)].join("\n") + "\n";
}
