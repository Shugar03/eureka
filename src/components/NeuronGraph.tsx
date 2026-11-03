// AC-176: the knowledge graph as loose "neurons": every idea a glowing point
// that settles by forces (linked ideas pull together, the rest push apart),
// bigger the more it connects. Simple on purpose: one color, thin straight
// lines; choosing an idea lights up its connections and dims the rest. Drag a
// point, drag the background to move, scroll to zoom.
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import type { GraphView } from "../types";

interface Props {
  graph: GraphView;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Edge ids (`from->to`) that join two different sessions. */
  cross: Set<string>;
}

type Neuron = SimulationNodeDatum & { id: string; text: string; degree: number; sources: number };
type Synapse = { id: string; source: string | Neuron; target: string | Neuron };
type View = { x: number; y: number; k: number };

const radius = (n: Neuron) => 4 + 2.2 * Math.sqrt(n.degree);
const end = (v: string | Neuron) => v as Neuron;
const still = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** The whole idea in lines of about `width` characters (never cut: what is read aloud is what is seen). */
export function wrap(text: string, width = 30): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}
/** A stable small number from an id: each neuron breathes at its own moment. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function NeuronGraph({ graph, selected, onSelect, cross }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [, setFrame] = useState(0);
  const sim = useRef<Simulation<Neuron, Synapse> | null>(null);
  const neurons = useRef<Neuron[]>([]);
  const synapses = useRef<Synapse[]>([]);
  // Once the person moves or zooms, the view stays where they left it.
  const touched = useRef(false);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 800, h: e.contentRect.height || 500 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fits every point in the canvas.
  const fit = () => {
    const ns = neurons.current;
    if (!ns.length) return;
    const xs = ns.map((n) => n.x ?? 0);
    const ys = ns.map((n) => n.y ?? 0);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Up to a little zoom: a small graph still looks like a web, not a few big circles.
    const k = Math.min(1.25, Math.max(0.2, Math.min((size.w - 120) / Math.max(1, x1 - x0), (size.h - 120) / Math.max(1, y1 - y0))));
    setView({ k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k });
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    const before = new Map(neurons.current.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    // Points that were already there keep their place.
    const ns: Neuron[] = graph.nodes.map((n) => {
      const old = before.get(n.id);
      return { id: n.id, text: n.text, degree: degree.get(n.id) ?? 0, sources: n.sources.length, x: old?.x, y: old?.y, vx: old?.vx, vy: old?.vy };
    });
    const ids = new Set(ns.map((n) => n.id));
    const ls: Synapse[] = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to }));
    neurons.current = ns;
    synapses.current = ls;
    const s = forceSimulation(ns)
      .force("link", forceLink<Neuron, Synapse>(ls).id((d) => d.id).distance(110).strength(0.45))
      .force("charge", forceManyBody<Neuron>().strength(-340))
      .force("x", forceX<Neuron>(0).strength(0.035))
      .force("y", forceY<Neuron>(0).strength(0.045))
      .force("collide", forceCollide<Neuron>((d) => radius(d) + 16));
    sim.current = s;
    let raf = 0;
    if (still()) {
      s.stop();
      s.tick(300);
      setFrame((f) => f + 1);
      if (!touched.current) fitRef.current();
    } else {
      s.on("tick", () => {
        if (!raf) raf = requestAnimationFrame(() => ((raf = 0), setFrame((f) => f + 1)));
      });
      s.on("end", () => !touched.current && fitRef.current());
      // A first fit as soon as the points spread out.
      setTimeout(() => !touched.current && fitRef.current(), 600);
    }
    return () => {
      s.stop();
      cancelAnimationFrame(raf);
    };
  }, [graph]);

  // What lights up: the chosen (or hovered) idea and its direct connections.
  const focus = selected ?? hover;
  const lit = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of graph.edges) {
      if (e.from === focus) s.add(e.to);
      if (e.to === focus) s.add(e.from);
    }
    return s;
  }, [focus, graph]);

  const toWorld = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (cx - r.left - size.w / 2 - view.x) / view.k, y: (cy - r.top - size.h / 2 - view.y) / view.k };
  };

  const onWheel = (e: React.WheelEvent) => {
    touched.current = true;
    const r = box.current!.getBoundingClientRect();
    const px = e.clientX - r.left - size.w / 2;
    const py = e.clientY - r.top - size.h / 2;
    setView((v) => {
      const k = Math.min(4, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  const down = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: id ? "node" : "pan", id, x: e.clientX, y: e.clientY, moved: false };
    if (id) {
      const n = neurons.current.find((m) => m.id === id);
      if (n) {
        n.fx = n.x;
        n.fy = n.y;
      }
      if (!still()) sim.current?.alphaTarget(0.3).restart();
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (d.kind === "pan") {
      if (!d.moved) return;
      touched.current = true;
      const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
      d.x = e.clientX;
      d.y = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else {
      const n = neurons.current.find((m) => m.id === d.id);
      if (!n || !d.moved) return;
      const p = toWorld(e.clientX, e.clientY);
      n.fx = p.x;
      n.fy = p.y;
      if (still()) {
        n.x = p.x;
        n.y = p.y;
        setFrame((f) => f + 1);
      }
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "node") {
      const n = neurons.current.find((m) => m.id === d.id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      sim.current?.alphaTarget(0);
      if (!d.moved && d.id) onSelect(d.id === selected ? null : d.id);
    } else if (!d.moved) onSelect(null);
  };

  // Every name when there are few ideas or once zoomed in; otherwise the most connected ones.
  const showAll = graph.nodes.length <= 10 || view.k >= 1.15;
  const top = useMemo(() => new Set([...neurons.current].sort((a, b) => b.degree - a.degree).slice(0, 5).map((n) => n.id)), [graph, neurons.current.length]);
  const k = view.k;

  return (
    <div className="neuron-graph" ref={box} onWheel={onWheel} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
      <svg width={size.w} height={size.h} role="group" aria-label="Grafo de ideas como neuronas">
        <defs>
          <filter id="neuron-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <g transform={`translate(${size.w / 2 + view.x},${size.h / 2 + view.y}) scale(${k})`}>
          {synapses.current.map((l) => {
            const [a, b] = [end(l.source), end(l.target)];
            if (a.x == null || b.x == null) return null;
            const on = !lit || (lit.has(a.id) && lit.has(b.id) && (a.id === focus || b.id === focus));
            return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`synapse ${cross.has(l.id) ? "is-cross" : ""} ${lit ? (on ? "is-lit" : "is-dim") : ""}`} style={{ strokeWidth: 1 / Math.sqrt(k) }} />;
          })}
          {neurons.current.map((n) => {
            if (n.x == null) return null;
            const on = !lit || lit.has(n.id);
            const r = radius(n);
            const named = n.id === focus || (lit?.has(n.id) ?? false) || showAll || top.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                className={`neuron ${n.id === selected ? "is-selected" : ""} ${n.id === focus ? "is-focus" : ""} ${lit ? (on ? "is-lit" : "is-dim") : ""}`}
                style={{ ["--breath" as string]: `${(hash(n.id) % 40) / 10}s` }}
                data-testid="graph-node"
                data-node-id={n.id}
                role="button"
                tabIndex={0}
                aria-label={n.text}
                aria-pressed={n.id === selected}
                onPointerDown={(e) => down(e, n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(n.id === selected ? null : n.id);
                  }
                }}
              >
                <title>{`${n.text} · ${n.sources === 1 ? "1 fuente" : `${n.sources} fuentes`} · ${n.degree === 1 ? "1 conexión" : `${n.degree} conexiones`}`}</title>
                <circle r={r * 2.2} className="neuron-glow" filter="url(#neuron-glow)" />
                <circle r={r} className="neuron-core" />
                {named && (
                  <text y={r + 13 / k} className="neuron-label" style={{ fontSize: 11 / k, strokeWidth: 3 / k }} aria-hidden>
                    {wrap(n.text).map((line, i) => (
                      <tspan key={i} x={0} dy={i ? "1.2em" : 0}>
                        {i ? ` ${line}` : line}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <button
        className="btn ghost small neuron-fit"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          touched.current = false;
          fit();
        }}
      >
        Centrar
      </button>
    </div>
  );
}
