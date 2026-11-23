// The «Novedades» of a version, by section and change, for the update card.
// New releases send Markdown with sections (scripts/changelog.cjs, appNotes);
// 0.9.0 and earlier sent one line joined with « · », read here the same way.

export interface NoteItem {
  /** The change's name («El profesor contesta mucho más rápido»), when it has one. */
  head: string | null;
  body: string;
}

export interface NoteSection {
  /** «Nuevo», «Mejorado», «Corregido»… or null for notes without sections. */
  title: string | null;
  items: NoteItem[];
}

/** «**Title:** text», «Title: text» (a short title) or just text. */
export function noteItem(raw: string): NoteItem {
  const t = withoutCriteria(raw).trim();
  // A bold start is a title only when a colon closes it («**Title:** text» or «**Title**: text»);
  // «**Acompañamiento tiene micrófono**, y …» is a sentence with a bold part.
  const bold = t.match(/^\*\*(.+?)\*\*\s*(:?)\s*(.*)$/s);
  if (bold && (bold[1].trim().endsWith(":") || bold[2] === ":")) return { head: bold[1].replace(/[:.]\s*$/, "").trim(), body: bold[3].trim() };
  if (bold) return { head: null, body: t };
  const colon = t.indexOf(": ");
  if (colon > 0 && colon <= 70 && !/[.!?]/.test(t.slice(0, colon))) return { head: t.slice(0, colon).trim(), body: t.slice(colon + 2).trim() };
  return { head: null, body: t };
}

/** The «(AC-219..AC-222)» references are for whoever develops Eureka, not for whoever uses it. */
export function withoutCriteria(text: string): string {
  return text.replace(/\s*\(AC-\d+(?:\s*(?:\.\.|…|–|-|,|y)\s*AC-\d+)*\)/g, "");
}

export function parseNotes(text: string): NoteSection[] {
  const t = text.trim();
  if (!t) return [];
  if (/^#{2,4}\s|^\s*[-*]\s/m.test(t)) {
    const out: NoteSection[] = [];
    let cur: NoteSection | null = null;
    for (const line of t.split(/\r?\n/)) {
      const h = line.match(/^#{2,4}\s+(.+)$/);
      if (h) {
        cur = { title: h[1].trim(), items: [] };
        out.push(cur);
        continue;
      }
      const b = line.match(/^\s*[-*]\s+(.+)$/);
      if (b) {
        if (!cur) {
          cur = { title: null, items: [] };
          out.push(cur);
        }
        cur.items.push(noteItem(b[1]));
      }
    }
    return out.filter((s) => s.items.length > 0);
  }
  // The old one-line notes.
  return [{ title: null, items: t.split(/\s+·\s+/).filter(Boolean).map(noteItem) }];
}

/** How each section is drawn. */
export function sectionKind(title: string | null): "new" | "better" | "fixed" | "other" {
  const t = (title ?? "").toLowerCase();
  if (/nuev|agreg/.test(t)) return "new";
  if (/mejor|cambi/.test(t)) return "better";
  if (/correg|arregl|fix/.test(t)) return "fixed";
  return "other";
}

/** Splits «text with **bold** parts» for inline rendering. */
export function boldParts(text: string): { bold: boolean; text: string }[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => ({ bold: i % 2 === 1, text: part }))
    .filter((x) => x.text);
}
