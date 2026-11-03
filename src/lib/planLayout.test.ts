import { describe, expect, it } from "vitest";
import { layoutPlan } from "./planLayout";
import type { PlanNode } from "../types";

const n = (id: string, depends_on: string[] = []): PlanNode => ({
  id,
  title: id,
  summary: "",
  depends_on,
  status: "pending",
  note: "",
});

describe("layoutPlan", () => {
  it("places dependencies above the nodes that need them", () => {
    const pos = Object.fromEntries(layoutPlan([n("goal", ["a", "b"]), n("a"), n("b", ["a"])]).map((p) => [p.node.id, p]));
    expect(pos.a.y).toBeLessThan(pos.b.y);
    expect(pos.b.y).toBeLessThan(pos.goal.y);
  });

  it("ignores dependencies on unknown nodes", () => {
    expect(() => layoutPlan([n("a", ["ghost"])])).not.toThrow();
  });
});

describe("layoutPlan geometry", () => {
  it("returns top-left corners (dagre gives centers)", () => {
    const [only] = layoutPlan([n("solo")]);
    expect(only.x).toBe(0);
    expect(only.y).toBe(0);
  });

  it("a dependency on an unknown node does not push a node down", () => {
    const pos = Object.fromEntries(layoutPlan([n("a"), n("b", ["ghost"])]).map((p) => [p.node.id, p]));
    expect(pos.b.y).toBe(pos.a.y);
  });
});
