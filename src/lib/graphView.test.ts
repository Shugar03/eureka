import { describe, expect, it } from "vitest";
import { bestMatch, crossEdges, depthOf, details, filterGraph, GNODE_W, layoutByDepth, layoutGraph, linkedSessions } from "./graphView";
import { fold } from "../e2e/graphFold";
import { DERIVATIVE, scriptedExtraction } from "../e2e/extractScript";

const session = { kind: "session" as const, id: "s1", title: "qué es una derivada" };
const g = fold([{ source: session, at: 1, ...DERIVATIVE }]);
const id = (text: string) => g.nodes.find((n) => n.text.startsWith(text))!.id;

describe("graph view helpers", () => {
  it("filters ignoring case and accents, keeping only inner edges", () => {
    const f = filterGraph(g, "TANGENTE");
    expect(f.nodes.map((n) => n.text)).toEqual([
      "La recta tangente es el límite de las rectas secantes cuando los dos puntos se juntan",
      "La derivada es la pendiente de la recta tangente",
    ]);
    expect(f.edges).toEqual([{ from: id("La recta tangente"), to: id("La derivada") }]);
    expect(filterGraph(g, "limite").nodes.length).toBe(2);
    expect(filterGraph(g, "  ")).toBe(g);
  });

  it("keeps only the chains whose premises and conclusion all survive the filter", () => {
    const n = (id: string, text: string) => ({ id, text, sources: [session] });
    const ch = (premises: string[], conclusion: string) => ({ premises, conclusion, source: session });
    const small = {
      nodes: [n("a", "uno x"), n("b", "dos x"), n("c", "tres")],
      chains: [ch(["a"], "b"), ch(["a", "c"], "b"), ch(["c"], "a"), ch(["a"], "c")],
      edges: [],
    };
    expect(filterGraph(small, "x").chains).toEqual([ch(["a"], "b")]);
  });

  it("positions are top-left corners and ignore edges to unknown nodes", () => {
    const one = { nodes: [g.nodes[0]], chains: [], edges: [{ from: g.nodes[0].id, to: "ghost" }] };
    const pos = layoutGraph(one);
    expect([...pos.keys()]).toEqual([g.nodes[0].id]);
    expect(pos.get(g.nodes[0].id)).toEqual({ x: 0, y: 0 });
  });

  it("lays premises above conclusions", () => {
    const pos = layoutGraph(g);
    expect(pos.get(id("Un límite"))!.y).toBeLessThan(pos.get(id("La recta tangente"))!.y);
    expect(pos.get(id("La recta tangente"))!.y).toBeLessThan(pos.get(id("La derivada"))!.y);
  });

  it("details list where a node comes from and what it leads to", () => {
    const d = details(g, id("La recta tangente"))!;
    expect(d.from.map((x) => x.premises.map((p) => p.text))).toEqual([["Un límite describe el valor al que se acerca una expresión"]]);
    expect(d.to.map((x) => x.conclusion.text)).toEqual(["La derivada es la pendiente de la recta tangente"]);
    expect(details(g, "nope")).toBeNull();
  });
});

describe("mock graph fold + scripted extraction", () => {
  it("merges the same idea from notes into one node with two sources", () => {
    const notes = { kind: "notes" as const, id: "n1", title: "Apuntes" };
    const raw = scriptedExtraction("# Notas del aprendiz: Apuntes\n\n- la pendiente mide cuanto sube una recta por cada paso a la derecha.\n- Otra idea");
    const merged = fold([{ source: session, at: 1, ...DERIVATIVE }, { source: notes, at: 2, ...raw }]);
    expect(merged.nodes.length).toBe(5);
    expect(merged.nodes[0].sources).toEqual([session, notes]);
  });

  it("re-extracting a source replaces it", () => {
    const again = fold([
      { source: session, at: 1, ...DERIVATIVE },
      { source: session, at: 2, propositions: [{ key: "a", text: "Solo esta" }], chains: [] },
    ]);
    expect(again.nodes.map((n) => n.text)).toEqual(["Solo esta"]);
  });
});

describe("AC-170 navigable graph", () => {
  const s1 = { kind: "session" as const, id: "s1", title: "Derivadas" };
  const s2 = { kind: "session" as const, id: "s2", title: "Descenso de gradiente" };
  const n = (id: string, sources = [s1]) => ({ id, text: `idea ${id}`, sources });
  const ch = (premises: string[], conclusion: string) => ({ premises, conclusion, source: s1 });
  // a, b base → c → d; e (from s2) uses c; a cycle x ↔ y does not loop forever.
  const graph = {
    nodes: [n("a"), n("b"), n("c"), n("d"), n("e", [s2]), n("x"), n("y")],
    chains: [ch(["a", "b"], "c"), ch(["c"], "d"), ch(["c"], "e"), ch(["x"], "y"), ch(["y"], "x")],
    edges: [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
      { from: "c", to: "e" },
      { from: "x", to: "y" },
      { from: "y", to: "x" },
    ],
  };

  it("counts the reasoning steps under each idea", () => {
    const d = depthOf(graph);
    expect([d.get("a"), d.get("b"), d.get("c"), d.get("d"), d.get("e")]).toEqual([0, 0, 1, 2, 2]);
    expect(Math.max(d.get("x")!, d.get("y")!)).toBeLessThanOrEqual(2);
  });

  it("puts base ideas at the bottom and each conclusion above, under its premises", () => {
    const pos = layoutByDepth(graph);
    expect(pos.get("a")!.y).toBe(0);
    expect(pos.get("c")!.y).toBeLessThan(pos.get("a")!.y);
    expect(pos.get("d")!.y).toBeLessThan(pos.get("c")!.y);
    expect(pos.get("d")!.y).toBe(pos.get("e")!.y);
    expect(pos.size).toBe(graph.nodes.length);
    // A wide level folds into lines, still below the next level.
    const wide = { nodes: [...Array(8)].map((_, i) => n(`w${i}`)).concat([n("top")]), chains: [ch(["w0"], "top")], edges: [{ from: "w0", to: "top" }] };
    const wp = layoutByDepth(wide);
    expect(new Set([...Array(8)].map((_, i) => wp.get(`w${i}`)!.y)).size).toBe(2);
    expect(Math.max(...[...Array(8)].map((_, i) => Math.abs(wp.get(`w${i}`)!.x)))).toBeLessThanOrEqual(3 * (GNODE_W + 28));
    expect(wp.get("top")!.y).toBeLessThan(Math.min(...[...Array(8)].map((_, i) => wp.get(`w${i}`)!.y)));
  });

  it("marks links between sessions and lists the sessions an idea connects to", () => {
    expect([...crossEdges(graph)]).toEqual(["c->e"]);
    expect(linkedSessions(graph, "c")).toEqual([{ id: "s2", title: "Descenso de gradiente" }]);
    expect(linkedSessions(graph, "a")).toEqual([]);
    const both = { ...graph, nodes: graph.nodes.map((x) => (x.id === "a" ? n("a", [s1, s2]) : x)) };
    expect(linkedSessions(both, "a").map((l) => l.id)).toEqual(["s1", "s2"]);
    expect(linkedSessions(graph, "nope")).toEqual([]);
  });

  it("finds the message where an idea came up, or none when nothing is close", () => {
    const msgs = [
      { key: "m1", text: "Hola, empecemos" },
      { key: "m2", text: "La derivada es la **pendiente** de la recta tangente en ese punto." },
      { key: "m3", text: "Una recta tangente toca la curva" },
    ];
    expect(bestMatch(msgs, "La derivada es la pendiente de la recta tangente")).toBe("m2");
    expect(bestMatch(msgs, "El teorema de Bolzano")).toBeNull();
    expect(bestMatch(msgs, "y o a")).toBeNull();
  });
});
