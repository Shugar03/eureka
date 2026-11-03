// Pure helpers for the knowledge-graph screen: filtering, layout and the
// per-node details (sources, chains in and out).
import dagre from "@dagrejs/dagre";
import type { GraphChain, GraphNode, GraphView } from "../types";
import { normalize } from "../e2e/graphFold";

export const GNODE_W = 240;
export const GNODE_H = 72;

/** Nodes matching the filter (accent/case-insensitive) and the edges among them. */
export function filterGraph(g: GraphView, query: string): GraphView {
  const q = normalize(query);
  if (!q) return g;
  const nodes = g.nodes.filter((n) => normalize(n.text).includes(q));
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    chains: g.chains.filter((c) => ids.has(c.conclusion) && c.premises.every((p) => ids.has(p))),
    edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

/** Top-to-bottom layout: premises above their conclusions. */
export function layoutGraph(g: GraphView): Map<string, { x: number; y: number }> {
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 56 });
  d.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) d.setNode(n.id, { width: GNODE_W, height: GNODE_H });
  for (const e of g.edges) if (d.hasNode(e.from) && d.hasNode(e.to)) d.setEdge(e.from, e.to);
  dagre.layout(d);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of g.nodes) {
    const p = d.node(n.id);
    out.set(n.id, { x: p.x - GNODE_W / 2, y: p.y - GNODE_H / 2 });
  }
  return out;
}

export interface NodeDetails {
  node: GraphNode;
  /** Chains that conclude this node ("se deduce de"). */
  from: { chain: GraphChain; premises: GraphNode[] }[];
  /** Chains that use this node as a premise ("lleva a"). */
  to: { chain: GraphChain; conclusion: GraphNode }[];
}

export function details(g: GraphView, id: string): NodeDetails | null {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return null;
  return {
    node,
    from: g.chains
      .filter((c) => c.conclusion === id)
      .map((chain) => ({ chain, premises: chain.premises.map((p) => byId.get(p)).filter((n): n is GraphNode => !!n) })),
    to: g.chains
      .filter((c) => c.premises.includes(id))
      .map((chain) => ({ chain, conclusion: byId.get(chain.conclusion) }))
      .filter((x): x is { chain: GraphChain; conclusion: GraphNode } => !!x.conclusion),
  };
}

// ── AC-170: depth of reasoning, links between sessions, where an idea came up ──

/** How many reasoning steps sit under each node: 0 = a base idea (no chain concludes it). */
export function depthOf(g: GraphView): Map<string, number> {
  const premisesOf = new Map<string, string[][]>();
  for (const c of g.chains) premisesOf.set(c.conclusion, [...(premisesOf.get(c.conclusion) ?? []), c.premises]);
  const ids = new Set(g.nodes.map((n) => n.id));
  const out = new Map<string, number>();
  const visit = (id: string, path: Set<string>): number => {
    const known = out.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return 0; // a cycle: stop climbing
    path.add(id);
    let d = 0;
    for (const ps of premisesOf.get(id) ?? []) for (const p of ps) if (ids.has(p) && p !== id) d = Math.max(d, visit(p, path) + 1);
    path.delete(id);
    out.set(id, d);
    return d;
  };
  for (const n of g.nodes) visit(n.id, new Set());
  return out;
}

export const DEPTH_GAP = 120;
/** At most this many ideas side by side in one level. */
export const DEPTH_ROW = 6;

/** Base ideas at the bottom, reasoning climbing up; each row ordered under its premises. */
export function layoutByDepth(g: GraphView, perRow = DEPTH_ROW): Map<string, { x: number; y: number }> {
  const depth = depthOf(g);
  const rows = new Map<number, string[]>();
  for (const n of g.nodes) rows.set(depth.get(n.id) ?? 0, [...(rows.get(depth.get(n.id) ?? 0) ?? []), n.id]);
  const premisesOf = new Map<string, string[]>();
  for (const e of g.edges) premisesOf.set(e.to, [...(premisesOf.get(e.to) ?? []), e.from]);
  const out = new Map<string, { x: number; y: number }>();
  const step = GNODE_W + 28;
  // A wide level is folded into lines of `perRow`, stacked inside its band, so the view stays readable.
  let y = 0;
  for (const d of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(d)!;
    const under = (id: string) => {
      const xs = (premisesOf.get(id) ?? []).map((p) => out.get(p)?.x).filter((x): x is number => x !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    if (d > 0) row.sort((a, b) => under(a) - under(b));
    const per = Math.max(1, perRow);
    for (let start = 0; start < row.length; start += per) {
      const line = row.slice(start, start + per);
      line.forEach((id, i) => out.set(id, { x: (i - (line.length - 1) / 2) * step, y: y ? -y : 0 }));
      y += GNODE_H + 24;
    }
    y += DEPTH_GAP - GNODE_H - 24;
  }
  return out;
}

const sessionIds = (n: GraphNode) => n.sources.filter((s) => s.kind === "session").map((s) => s.id);

/** Edges between ideas that came from different places (no source in common). */
export function crossEdges(g: GraphView): Set<string> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const e of g.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const keys = new Set(a.sources.map((s) => `${s.kind}:${s.id}`));
    if (!b.sources.some((s) => keys.has(`${s.kind}:${s.id}`))) out.add(`${e.from}->${e.to}`);
  }
  return out;
}

/** Other sessions this idea connects to: where it also appeared, or where its premises and conclusions come from. */
export function linkedSessions(g: GraphView, id: string): { id: string; title: string }[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return [];
  const own = new Set(sessionIds(node));
  const near = g.edges.filter((e) => e.from === id || e.to === id).map((e) => byId.get(e.from === id ? e.to : e.from));
  const out = new Map<string, string>();
  if (own.size > 1) for (const s of node.sources) if (s.kind === "session") out.set(s.id, s.title);
  for (const n of near) for (const s of n?.sources ?? []) if (s.kind === "session" && !own.has(s.id)) out.set(s.id, s.title);
  return [...out].map(([id, title]) => ({ id, title }));
}

const words = (t: string) => new Set(normalize(t).split(" ").filter((w) => w.length >= 4));

/** The message that best matches an idea (shared meaningful words), or null when none is close. */
export function bestMatch(messages: { key: string; text: string }[], idea: string): string | null {
  const want = words(idea);
  if (!want.size) return null;
  let best: { key: string; score: number } | null = null;
  for (const m of messages) {
    const have = words(m.text);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const score = shared / want.size;
    if (score > (best?.score ?? 0)) best = { key: m.key, score };
  }
  return best && best.score >= 0.4 ? best.key : null;
}
