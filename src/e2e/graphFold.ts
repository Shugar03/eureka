// Minimal TS port of src-tauri/src/graph.rs fold() for the browser mock:
// latest extraction per source, same-text propositions merged, edges derived.
import type { GraphSource, GraphView } from "../types";
import type { RawExtraction } from "./extractScript";

export interface LedgerLine extends RawExtraction {
  source: GraphSource;
  at: number;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const key = (s: GraphSource) => `${s.kind}:${s.id}`;

export function fold(ledger: LedgerLine[]): GraphView {
  const latest = new Map<string, LedgerLine>();
  for (const e of ledger) {
    const prev = latest.get(key(e.source));
    if (!prev || prev.at <= e.at) latest.set(key(e.source), e);
  }
  const view: GraphView = { nodes: [], chains: [], edges: [] };
  const byId = new Map<string, GraphView["nodes"][number]>();
  for (const e of [...latest.values()].sort((a, b) => a.at - b.at)) {
    const ids = new Map<string, string>();
    for (const p of e.propositions) {
      const id = `p-${normalize(p.text)}`;
      ids.set(p.key, id);
      const node = byId.get(id);
      if (node) {
        if (!node.sources.some((s) => key(s) === key(e.source))) node.sources.push(e.source);
      } else {
        const n = { id, text: p.text, sources: [e.source] };
        byId.set(id, n);
        view.nodes.push(n);
      }
    }
    for (const c of e.chains) {
      const premises = c.premises.map((k) => ids.get(k));
      const conclusion = ids.get(c.conclusion);
      if (!conclusion || premises.some((p) => !p)) continue;
      view.chains.push({ premises: premises as string[], conclusion, source: e.source });
    }
  }
  const seen = new Set<string>();
  for (const c of view.chains)
    for (const p of c.premises)
      if (!seen.has(`${p}>${c.conclusion}`)) {
        seen.add(`${p}>${c.conclusion}`);
        view.edges.push({ from: p, to: c.conclusion });
      }
  return view;
}
