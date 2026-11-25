// Learning routes (AC-214..AC-217).

export interface RouteLink {
  route_id: string;
  class_id: string;
}

export interface RouteClass {
  id: string;
  title: string;
  topics: string[];
  minutes: number;
  /** Already mastered: the route skips it (it stays visible). */
  known: boolean;
  kind: "normal" | "refuerzo";
  session_id?: string | null;
}

export interface RouteUnit {
  id: string;
  title: string;
  classes: RouteClass[];
}

export interface RouteSource {
  title: string;
  url: string;
}

export interface RouteProposal {
  title: string;
  goal: string;
  purpose: string;
  hours_per_week: number;
  deadline?: string | null;
  units: RouteUnit[];
  sources: RouteSource[];
  researched: boolean;
  note: string;
}

export type ClassState = "done" | "known" | "current" | "started" | "todo";

export interface ClassView extends RouteClass {
  state: ClassState;
  /** 1-based among the classes to take (0 for a known one). */
  number: number;
  done_at: string | null;
}

export interface RouteView {
  id: string;
  title: string;
  goal: string;
  purpose: string;
  hours_per_week: number;
  deadline: string | null;
  sources: RouteSource[];
  researched: boolean;
  adjustments: { kind: string; text: string; at: string }[];
  units: { id: string; title: string; classes: ClassView[] }[];
  total: number;
  done: number;
  minutes_left: number;
  current: string | null;
  created_at: string;
}
