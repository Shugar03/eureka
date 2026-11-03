// AC-170: "Ver dónde apareció" — the graph asks the session it opens to show
// the message where an idea came up. Lives only in memory, taken once.
let wanted: { session: string; text: string } | null = null;

export function focusIdea(session: string, text: string) {
  wanted = { session, text };
}

export function takeFocus(session: string): string | null {
  if (wanted?.session !== session) return null;
  const t = wanted.text;
  wanted = null;
  return t;
}
