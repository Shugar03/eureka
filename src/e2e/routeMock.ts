// AC-214..AC-217 in the demo: a researched route proposal and the routes the
// person created, with each class's state read from its session (as route.rs).
import type { ClassView, RouteProposal, RouteView, Session } from "../types";

export interface MockRoute extends Omit<RouteProposal, "note"> {
  id: string;
  adjustments: { kind: string; text: string; at: string }[];
  created_at: string;
  updated_at: string;
}

const cls = (id: string, title: string, topics: string[], minutes: number, known = false) => ({ id, title, topics, minutes, known, kind: "normal" as const, session_id: null });

/** What the app would plan for «Machine Learning» after researching how it is taught. */
export function mockRouteProposal(topic: string): RouteProposal {
  return {
    title: `${topic} desde cero`,
    goal: "Entrenar, evaluar y explicar un modelo propio con datos reales.",
    purpose: "cambiar de trabajo",
    hours_per_week: 4,
    deadline: null,
    units: [
      { id: "u1", title: "Bases matemáticas", classes: [cls("c1", "Derivadas", ["pendiente", "regla de la cadena"], 60, true), cls("c2", "Vectores y matrices", ["producto punto", "matriz por vector"], 60), cls("c3", "Probabilidad", ["distribuciones", "esperanza"], 60)] },
      { id: "u2", title: "Aprender de datos", classes: [cls("c4", "Regresión lineal", ["modelo lineal", "ajuste"], 75), cls("c5", "Error cuadrático", ["función de pérdida"], 60), cls("c6", "Descenso por gradiente", ["paso", "tasa de aprendizaje"], 80)] },
      { id: "u3", title: "Clasificar", classes: [cls("c7", "Regresión logística", ["sigmoide"], 75), cls("c8", "Métricas", ["precisión", "recall"], 60)] },
    ],
    sources: [
      { title: "CS229: Machine Learning — Syllabus", url: "https://cs229.stanford.edu/syllabus" },
      { title: "Aprendizaje automático — Programa (FCEN)", url: "https://dc.uba.ar/aprendizaje-automatico/programa" },
    ],
    researched: true,
    note: "Sigue el orden de los dos programas; salteé Derivadas porque ya la dominás.",
  };
}

export function createRoute(p: RouteProposal): MockRoute {
  const now = new Date().toISOString();
  const { note: _note, ...rest } = p;
  return { ...rest, id: `r${Math.random().toString(36).slice(2, 10)}`, adjustments: [], created_at: now, updated_at: now };
}

export function routeView(r: MockRoute, session: (id: string) => Session | undefined): RouteView {
  let number = 0;
  let current: string | null = null;
  const units = r.units.map((u) => ({
    id: u.id,
    title: u.title,
    classes: u.classes.map((c): ClassView => {
      const s = c.session_id ? session(c.session_id) : undefined;
      const state: ClassView["state"] = c.known ? "known" : s?.phase === "done" ? "done" : s ? "started" : "todo";
      if (state !== "known") number++;
      return { ...c, state, number: state === "known" ? 0 : number, done_at: state === "done" ? (s?.updated_at ?? null) : null };
    }),
  }));
  const next = units.flatMap((u) => u.classes).find((c) => c.state === "todo" || c.state === "started");
  if (next) {
    next.state = "current";
    current = next.id;
  }
  const all = units.flatMap((u) => u.classes);
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    purpose: r.purpose,
    hours_per_week: r.hours_per_week,
    deadline: r.deadline ?? null,
    sources: r.sources,
    researched: r.researched,
    adjustments: r.adjustments,
    units,
    total: all.filter((c) => c.state !== "known").length,
    done: all.filter((c) => c.state === "done").length,
    minutes_left: all.filter((c) => c.state !== "done" && c.state !== "known").reduce((n, c) => n + c.minutes, 0),
    current,
    created_at: r.created_at,
  };
}
