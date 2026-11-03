// Scripted flashcard generator (set_cards) shared by the browser mock and
// the fake provider: one card per "- item" line of the material.

export function scriptedCards(material: string, count: number): { cards: { front: string; back: string }[] } {
  const items = [...material.matchAll(/^\s*-\s+(?:\*\*)?([^*\n:]+?)(?:\*\*)?(?::\s*(.+))?$/gm)].map((m) => ({ topic: m[1].trim(), detail: (m[2] ?? "").trim() }));
  const cards = items.slice(0, count).map(({ topic, detail }) => ({ front: `¿Qué tenés que recordar de **${topic}**?`, back: detail || `Lo esencial de ${topic}.` }));
  return { cards };
}
