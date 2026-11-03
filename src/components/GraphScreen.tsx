import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, errorText } from "../api";
import type { GraphSource, GraphView } from "../types";
import { crossEdges, depthOf, details, filterGraph, GNODE_W, layoutByDepth, layoutGraph, linkedSessions } from "../lib/graphView";
import { focusIdea } from "../lib/focus";

interface Props {
  onOpenSession: (id: string) => void;
  /** Opens the created practice set. */
  onPractice: (setId: string) => void;
}

const EMPTY: GraphView = { nodes: [], chains: [], edges: [] };

/** AC-170: base ideas at the bottom and reasoning going up, or the free layout. */
type Layout = "depth" | "free";
const LAYOUT_KEY = "la.graphLayout";
function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "free" ? "free" : "depth";
  } catch {
    return "depth";
  }
}

function sourceLabel(s: GraphSource) {
  return s.kind === "session" ? s.title : `notas: ${s.title}`;
}

export function GraphScreen({ onOpenSession, onPractice }: Props) {
  const [graph, setGraph] = useState<GraphView | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Two clicks to forget: the first only asks. */
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* the choice just isn't remembered */
    }
  };

  useEffect(() => {
    api.getGraph().then(setGraph).catch((e) => setError(errorText(e)));
  }, []);

  const shown = useMemo(() => filterGraph(graph ?? EMPTY, query), [graph, query]);
  const info = selected && graph ? details(graph, selected) : null;

  // AC-170: as many ideas side by side as the canvas fits, so a narrow window stays readable.
  const canvas = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(4);
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setPerRow(Math.min(6, Math.max(2, Math.floor(e.contentRect.width / (GNODE_W * 0.85))))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph]);

  const flow = useMemo(() => {
    const pos = layout === "depth" ? layoutByDepth(shown, perRow) : layoutGraph(shown);
    const depth = depthOf(shown);
    const cross = crossEdges(shown);
    const nodes: Node[] = shown.nodes.map((n) => ({
      id: n.id,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      draggable: false,
      connectable: false,
      selected: n.id === selected,
      className: `graph-node ${n.id === selected ? "is-selected" : ""}`,
      style: { width: GNODE_W },
      data: {
        label: (
          <div data-testid="graph-node" data-node-id={n.id}>
            <div className="graph-node-text">{n.text}</div>
            <div className="graph-node-meta">
              {n.sources.length === 1 ? "1 fuente" : `${n.sources.length} fuentes`}
              {layout === "depth" && <span data-testid="graph-node-depth"> · {depth.get(n.id) ? `nivel ${depth.get(n.id)}` : "base"}</span>}
            </div>
          </div>
        ),
      },
    }));
    const edges: Edge[] = shown.edges.map((e) => {
      const id = `${e.from}->${e.to}`;
      return { id, source: e.from, target: e.to, className: cross.has(id) ? "plan-edge graph-edge-cross" : "plan-edge" };
    });
    return { nodes, edges, cross: cross.size };
  }, [shown, selected, layout, perRow]);
  const links = info ? linkedSessions(graph ?? EMPTY, info.node.id) : [];

  const forget = async (s: GraphSource) => {
    setBusy(true);
    setError(null);
    try {
      setGraph(await api.forgetSource(s));
      setSelected(null);
      setConfirmForget(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const submitNotes = async () => {
    setBusy(true);
    setError(null);
    try {
      setGraph(await api.importNotes(title, text));
      setTitle("");
      setText("");
      setImporting(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="graph-screen">
      <header className="chat-head">
        <h1 className="chat-title">Grafo de conocimiento</h1>
        {graph && (
          <span className="muted small" data-testid="graph-counts">
            {graph.nodes.length} ideas · {graph.chains.length} cadenas
          </span>
        )}
        <input
          className="graph-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar ideas…"
          aria-label="Filtrar ideas"
        />
        <div className="tabs" role="radiogroup" aria-label="Vista del grafo">
          <button role="radio" aria-checked={layout === "depth"} className={layout === "depth" ? "is-active" : ""} onClick={() => chooseLayout("depth")} title="Las ideas base abajo; el razonamiento sube">
            Por profundidad
          </button>
          <button role="radio" aria-checked={layout === "free"} className={layout === "free" ? "is-active" : ""} onClick={() => chooseLayout("free")}>
            Libre
          </button>
        </div>
        <button className="btn small" onClick={() => setImporting((v) => !v)} aria-expanded={importing}>
          Importar notas
        </button>
      </header>

      {importing && (
        <form
          className="notes-form"
          aria-label="Importar notas"
          onSubmit={(e) => {
            e.preventDefault();
            submitNotes();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ej: Apuntes de física)" aria-label="Título de las notas" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Pegá tus notas: una idea por línea funciona mejor." aria-label="Texto de las notas" />
          <div className="row-end">
            <button type="button" className="btn ghost" onClick={() => setImporting(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={busy || !title.trim() || !text.trim()}>
              {busy ? "Extrayendo…" : "Importar"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="error graph-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="graph-body">
        {!graph ? (
          <p className="muted pad">Cargando…</p>
        ) : graph.nodes.length === 0 ? (
          <div className="graph-empty">
            <h2>Todavía no hay ideas</h2>
            <p className="muted">El grafo se llena solo cuando terminás una sesión, o importando tus notas.</p>
          </div>
        ) : (
          <>
            <div className="graph-canvas" data-testid="graph-canvas" ref={canvas}>
              {shown.nodes.length === 0 ? (
                <p className="muted pad">Ninguna idea coincide con “{query}”.</p>
              ) : (
                <ReactFlow
                  nodes={flow.nodes}
                  edges={flow.edges}
                  fitView
                  nodesDraggable={false}
                  nodesConnectable={false}
                  proOptions={{ hideAttribution: true }}
                  minZoom={0.2}
                  onNodeClick={(_, n) => setSelected(n.id)}
                  onPaneClick={() => setSelected(null)}
                >
                  <Background gap={20} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              )}
              {shown.nodes.length > 0 && (
                <p className="graph-legend muted small" data-testid="graph-legend">
                  {layout === "depth" ? "Abajo las ideas base; cada flecha sube de las premisas a lo que se deduce. " : ""}
                  {flow.cross > 0 ? `Punteadas: ${flow.cross === 1 ? "1 conexión" : `${flow.cross} conexiones`} entre sesiones distintas.` : ""}
                </p>
              )}
            </div>
            <aside className="graph-detail" aria-label="Detalle de la idea">
              {!info ? (
                <p className="muted">Elegí una idea para ver de dónde salió y cómo se conecta.</p>
              ) : (
                <>
                  <p className="graph-detail-text">{info.node.text}</p>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        onPractice((await api.createPractice([info.node.id], 3)).id);
                      } catch (e) {
                        setError(errorText(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Practicar esta idea
                  </button>
                  <h3>Fuentes</h3>
                  <ul className="graph-list">
                    {info.node.sources.map((s) => {
                      const key = `${s.kind}:${s.id}`;
                      return (
                        <li key={key} className="graph-source">
                          {s.kind === "session" ? (
                            <span className="row">
                              <button className="link" onClick={() => onOpenSession(s.id)}>
                                {sourceLabel(s)}
                              </button>
                              <button
                                className="btn ghost small"
                                aria-label={`Ver dónde apareció en ${sourceLabel(s)}`}
                                onClick={() => {
                                  focusIdea(s.id, info.node.text);
                                  onOpenSession(s.id);
                                }}
                              >
                                Ver dónde apareció
                              </button>
                            </span>
                          ) : (
                            <span>{sourceLabel(s)}</span>
                          )}
                          {confirmForget === key ? (
                            <span className="row">
                              <button className="btn danger small" disabled={busy} onClick={() => forget(s)}>
                                Sí, olvidar sus ideas
                              </button>
                              <button className="btn ghost small" onClick={() => setConfirmForget(null)}>
                                No
                              </button>
                            </span>
                          ) : (
                            <button className="btn ghost small" onClick={() => setConfirmForget(key)} aria-label={`Olvidar esta fuente: ${sourceLabel(s)}`}>
                              Olvidar esta fuente
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {links.length > 0 && (
                    <>
                      <h3>Conecta con otras sesiones</h3>
                      <ul className="graph-list" aria-label="Sesiones conectadas">
                        {links.map((l) => (
                          <li key={l.id}>
                            <button className="link" onClick={() => onOpenSession(l.id)}>
                              {l.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {info.from.length > 0 && (
                    <>
                      <h3>Se deduce de</h3>
                      <ul className="graph-list">
                        {info.from.map(({ premises }, i) => (
                          <li key={i}>
                            {premises.map((p) => (
                              <button key={p.id} className="chip" onClick={() => setSelected(p.id)}>
                                {p.text}
                              </button>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {info.to.length > 0 && (
                    <>
                      <h3>Lleva a</h3>
                      <ul className="graph-list">
                        {info.to.map(({ conclusion }, i) => (
                          <li key={i}>
                            <button className="chip" onClick={() => setSelected(conclusion.id)}>
                              {conclusion.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
