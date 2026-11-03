// Lays out the plan DAG top-to-bottom (foundations first, goal last).
import dagre from "@dagrejs/dagre";
import type { PlanNode } from "../types";

export const NODE_W = 220;
export const NODE_H = 64;

export interface Positioned {
  node: PlanNode;
  x: number;
  y: number;
}

export function layoutPlan(plan: PlanNode[]): Positioned[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 48 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of plan) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  const ids = new Set(plan.map((n) => n.id));
  for (const n of plan) for (const d of n.depends_on) if (ids.has(d)) g.setEdge(d, n.id);
  dagre.layout(g);
  return plan.map((node) => {
    const p = g.node(node.id);
    return { node, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  });
}
