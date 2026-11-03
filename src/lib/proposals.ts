// AC-161…164: what the chat's proposals need on the screen side — the same
// checks as the backend (a bad one never becomes a card) and matching the
// ideas the agent named with the nodes of the person's graph.
import type { CodeProposal, DeckProposal, OwnProposal, PracticeProposal } from "../types";
import { LANG_IDS } from "./code";

const parse = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export function parseDeckProposal(raw: string): DeckProposal | null {
  const a = parse<DeckProposal>(raw);
  if (!a || typeof a.name !== "string" || !a.name.trim() || !Array.isArray(a.cards) || !a.cards.length || a.cards.length > 40) return null;
  if (a.cards.some((c) => typeof c?.front !== "string" || typeof c?.back !== "string" || !c.front.trim() || !c.back.trim())) return null;
  return { name: a.name.trim(), cards: a.cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })) };
}

export function parsePracticeProposal(raw: string): PracticeProposal | null {
  const a = parse<PracticeProposal>(raw);
  const ideas = Array.isArray(a?.ideas) ? a.ideas.filter((i) => typeof i === "string" && i.trim()).map((i) => i.trim()) : [];
  if (!a || !ideas.length || ideas.length > 8) return null;
  if (a.count !== undefined && !(Number.isInteger(a.count) && a.count >= 1 && a.count <= 10)) return null;
  return { ideas, count: a.count };
}

/** AC-174 */
export function parseOwnProposal(raw: string): OwnProposal | null {
  const a = parse<Partial<OwnProposal>>(raw);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const p = { title: str(a?.title), text: str(a?.text), book: str(a?.book) };
  return p.text || p.book ? p : null;
}

export function parseCodeProposal(raw: string): CodeProposal | null {
  const a = parse<CodeProposal>(raw);
  if (!a || !LANG_IDS.includes(a.language) || typeof a.topic !== "string" || !a.topic.trim()) return null;
  if (a.level !== undefined && !["básico", "medio", "avanzado"].includes(a.level)) return null;
  return { language: a.language, topic: a.topic.trim(), level: a.level };
}

const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 3)
    // "derivadas" and "derivada" are the same idea.
    .map((w) => (w.length > 4 ? w.replace(/s$/, "") : w));

/** Graph nodes that share a meaningful word with any of the ideas, best first. */
export function matchIdeas<T extends { id: string; text: string }>(nodes: T[], ideas: string[], limit = 8): T[] {
  const want = new Set(ideas.flatMap(words));
  return nodes
    .map((n) => ({ n, hits: words(n.text).filter((w) => want.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.n);
}
