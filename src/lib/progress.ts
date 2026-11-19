// AC-210: «Mi progreso» as a coach, a few numbers and a path per unit.
// Everything here is built from data the app already has: no model call, so the
// screen opens at once and costs nothing.
import type { PlanNode, Session, StudentModel, TopicState, TopicStatus } from "../types";

export interface StatusMeta {
  status: TopicStatus;
  /** Tab and region name. */
  title: string;
  empty: string;
}

export const STATUSES: StatusMeta[] = [
  { status: "le_cuesta", title: "Te cuesta", empty: "Nada por ahora." },
  { status: "pendiente", title: "Quedó pendiente", empty: "Nada pendiente." },
  { status: "practicando", title: "Practicando", empty: "Todavía nada en práctica." },
  { status: "domina", title: "Ya lo dominás", empty: "Aparece cuando terminás sesiones, practicás o rendís simulacros." },
];

export const statusMeta = (s: TopicStatus) => STATUSES.find((x) => x.status === s)!;

// ── Evidence, said to you ───────────────────────────────────────────────────

/** One piece of evidence: where it came from (a tag) and what it says. */
export interface Evidence {
  tag: string | null;
  text: string;
  /** A date like 11/11, when the evidence carries one. */
  when: string | null;
}

const DATE = /\s*\((\d{2}\/\d{2})\)\s*$/;
const cap = (s: string) => {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** The backend writes evidence for the teacher too; here it reads as said to you. */
export function evidence(raw: string): Evidence {
  let s = raw.trim();
  let when: string | null = null;
  const d = s.match(DATE);
  if (d) {
    when = d[1];
    s = s.replace(DATE, "");
  }
  const rules: [RegExp, (m: RegExpMatchArray) => Evidence][] = [
    // What the confusion was is written in many ways («No sabía…», «Que la pendiente…»): shown as is.
    [/^confusión:\s*(.+)$/is, (m) => ({ tag: "Confusión", text: cap(m[1]), when })],
    [/^le costó en «(.+)»$/is, (m) => ({ tag: "Sesión", text: `Te costó en «${m[1]}»`, when })],
    [/^la confusión «(.+)» quedó reparada$/is, (m) => ({ tag: "Aclarada", text: `Ya no: «${m[1]}»`, when })],
    [/^hubo que repararlo en «(.+)»$/is, (m) => ({ tag: "Sesión", text: `Lo repasamos en «${m[1]}»`, when })],
    [/^quedó pendiente en «(.+)»$/is, (m) => ({ tag: "Sesión", text: `Quedó para después en «${m[1]}»`, when })],
    [/^terminaste la sesión del (\d{2}\/\d{2})(.*)$/is, (m) => ({ tag: "Sesión", text: `Terminaste la sesión${m[2]}`, when: m[1] })],
    [/^sesión en curso:\s*(.+)$/is, (m) => ({ tag: "Sesión", text: `En curso: ${m[1]}`, when })],
    [/^práctica:\s*(.+)$/is, (m) => ({ tag: "Práctica", text: cap(m[1]), when })],
    [/^simulacro de (.+?):\s*(.+)$/is, (m) => ({ tag: "Simulacro", text: `${m[2]} en ${m[1]}`, when })],
    [/^tarjetas:\s*(.+)$/is, (m) => ({ tag: "Tarjetas", text: cap(m[1]), when })],
  ];
  for (const [re, f] of rules) {
    const m = s.match(re);
    if (m) return f(m);
  }
  return { tag: null, text: cap(s), when };
}

// ── Topics ──────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ");
const words = (s: string) => new Set(norm(s).split(/\s+/).filter((w) => w.length > 3));

/** As the backend's same_topic: same name, or most of the shorter one's words in the other. */
export function sameTopic(a: string, b: string): boolean {
  if (norm(a).trim() === norm(b).trim()) return true;
  const wa = words(a);
  const wb = words(b);
  const small = Math.min(wa.size, wb.size);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return small > 0 && shared * 2 > small;
}

/** How many topics in each state. */
export function counts(topics: TopicState[]): Record<TopicStatus, number> {
  const c = { le_cuesta: 0, pendiente: 0, practicando: 0, domina: 0 } as Record<TopicStatus, number>;
  for (const t of topics) c[t.status]++;
  return c;
}

/** The tab to open first: the first state that has something, hard things first. */
export const firstTab = (topics: TopicState[]): TopicStatus => STATUSES.find((s) => topics.some((t) => t.status === s.status))?.status ?? "le_cuesta";

/** What is hard and keeps coming back: the most evidence first, then the newest. */
export function hardest(m: StudentModel): TopicState[] {
  return m.topics.filter((t) => t.status === "le_cuesta").sort((a, b) => b.evidence.length - a.evidence.length || b.at.localeCompare(a.at));
}

// ── Units: each session with a plan is a path ───────────────────────────────

export type NodeLook = "ok" | "prac" | "bad" | "todo";

export interface PathNode {
  id: string;
  title: string;
  look: NodeLook;
  /** «Ya la sabías», «Te cuesta: …». */
  note: string;
  /** The next step: where «Seguir desde acá» goes. */
  now: boolean;
}

export interface Unit {
  session_id: string;
  title: string;
  updated_at: string;
  done: boolean;
  nodes: PathNode[];
  /** Ideas understood or already known, of all of them. */
  ready: number;
  /** Days to the exam this session studies for, if it is coming. */
  exam: { name: string; days: number } | null;
}

/** The plan of a session, with what the student model says about each idea on top. */
export function unitOf(s: Session, m: StudentModel): Unit {
  const topicOf = (n: PlanNode) => m.topics.find((t) => sameTopic(t.name, n.title));
  const nodes: PathNode[] = s.plan.map((n) => {
    const t = topicOf(n);
    const why = t?.evidence[0] ? evidence(t.evidence[0]).text : "";
    let look: NodeLook;
    let note: string;
    if (n.status === "known") [look, note] = ["ok", "Ya la sabías"];
    else if (n.status === "understood") [look, note] = t?.status === "le_cuesta" ? ["bad", `Te volvió a costar${why ? `: ${lowerFirst(why)}` : ""}`] : ["ok", "La entendiste"];
    else if (n.status === "repair" || t?.status === "le_cuesta") [look, note] = ["bad", why ? `Te cuesta: ${lowerFirst(why)}` : "Te cuesta"];
    else if (n.status === "current") [look, note] = ["prac", "En esto estás"];
    else if (t?.status === "practicando") [look, note] = ["prac", "Practicando"];
    else [look, note] = ["todo", "Pendiente"];
    return { id: n.id, title: n.title, look, note, now: false };
  });
  const done = s.phase === "done";
  if (!done) {
    const next = nodes.find((n) => n.look === "bad") ?? nodes.find((n) => n.look === "prac") ?? nodes.find((n) => n.look === "todo");
    if (next) next.now = true;
  }
  const up = s.exam ? m.upcoming.find((u) => u.screen === "exams" && u.id === s.exam!.exam_id) : undefined;
  return {
    session_id: s.id,
    title: s.goal.trim() || s.title,
    updated_at: s.updated_at,
    done,
    nodes,
    ready: nodes.filter((n) => n.look === "ok").length,
    exam: up ? { name: up.title, days: up.days } : null,
  };
}

function lowerFirst(s: string) {
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/** The unit that opens by itself: the newest one still going. */
export const activeUnit = (units: Unit[]) => units.find((u) => !u.done) ?? null;

/** Topics no path shows: they come from practice, cards, exams or loose notes. */
export function looseTopics(m: StudentModel, units: Unit[]): TopicState[] {
  const shown = units.flatMap((u) => [u.title, ...u.nodes.map((n) => n.title)]);
  return m.topics.filter((t) => !shown.some((x) => sameTopic(x, t.name)));
}

// ── The coach ───────────────────────────────────────────────────────────────

export interface Coach {
  title: string;
  /** Sentences; «**x**» marks what to put in bold. */
  text: string[];
}

/** A few lines that read your week back to you, from the data alone. */
export function coach(o: { name: string; m: StudentModel; streak: number; activeToday: boolean; studied7: number; studiedEver: boolean; today: string }): Coach {
  const who = o.name ? `, ${o.name}` : "";
  const title = !o.studiedEver
    ? `Hola${who}.`
    : o.activeToday && o.streak >= 3
      ? `Vas muy bien${who}.`
      : o.streak >= 3
        ? `Vas bien${who}.`
        : o.streak === 0
          ? `Volvamos de a poco${who}.`
          : `Buen ritmo${who}.`;

  const text: string[] = [];
  const weekAgo = addDaysIso(o.today, -6);
  const mastered = o.m.topics.filter((t) => t.status === "domina" && t.at.slice(0, 10) >= weekAgo).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (o.studied7 > 0) text.push(`Esta semana estudiaste ${o.studied7} ${o.studied7 === 1 ? "día" : "días"}${mastered ? ` y dominaste **${mastered.name}**` : ""}.`);
  else if (mastered) text.push(`Dominaste **${mastered.name}**.`);

  const hard = hardest(o.m)[0];
  if (hard && hard.evidence.length > 1) text.push(`Lo que más se repite es **${hard.name}**: si lo cerrás hoy, lo que sigue se te va a hacer más fácil.`);
  else if (hard) text.push(`Lo próximo para aclarar es **${hard.name}**.`);

  const exam = o.m.upcoming.find((u) => u.days <= 7);
  if (exam) text.push(`Tenés **${exam.title}** ${exam.days === 0 ? "hoy" : exam.days === 1 ? "mañana" : `en ${exam.days} días`}.`);

  if (!text.length) text.push(o.studiedEver ? "Cuando sigas estudiando, acá te voy a decir por dónde seguir." : "Cuando termines una sesión, practiques o repases tarjetas, acá vas a ver cómo avanzás y por dónde seguir.");
  return { title, text };
}

function addDaysIso(day: string, n: number) {
  const d = new Date(`${day}T00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Today ───────────────────────────────────────────────────────────────────

export type TodayAction = { kind: "study"; message: string } | { kind: "session"; id: string } | { kind: "cards" };

export interface TodayItem {
  title: string;
  why: string;
  button: string;
  action: TodayAction;
}

/** Up to three things worth doing today, with their reason. */
export function todayPlan(m: StudentModel, units: Unit[]): TodayItem[] {
  const out: TodayItem[] = [];
  const hard = hardest(m);
  if (hard[0]) out.push(review(hard[0]));
  if (m.cards_due > 0) {
    const exam = m.upcoming.find((u) => u.days <= 14);
    out.push({ title: `${m.cards_due} ${m.cards_due === 1 ? "tarjeta" : "tarjetas"} para hoy`, why: exam ? `${exam.title} ${exam.days === 0 ? "es hoy" : `en ${exam.days} ${exam.days === 1 ? "día" : "días"}`}` : "Las que te tocan repasar hoy", button: "Repasar", action: { kind: "cards" } });
  }
  const p = m.pending[0];
  const active = activeUnit(units);
  if (p) out.push({ title: `Retomar ${lowerFirst(p.item)}`, why: `Quedó por la mitad en «${p.session_title}»`, button: "Retomar", action: { kind: "session", id: p.session_id } });
  else if (active) out.push({ title: `Seguir con ${lowerFirst(active.title)}`, why: `${active.ready} de ${active.nodes.length} ideas`, button: "Seguir", action: { kind: "session", id: active.session_id } });
  for (const t of hard.slice(1)) {
    if (out.length >= 3) break;
    out.push(review(t));
  }
  return out.slice(0, 3);
}

function review(t: TopicState): TodayItem {
  const e = t.evidence[0] ? evidence(t.evidence[0]).text : "Te viene costando";
  return { title: `Repasar ${lowerFirst(t.name)}`, why: e, button: "Empezar", action: { kind: "study", message: `Quiero repasar ${t.name}.` } };
}
