// Turns the raw message list (OpenAI wire format) into what the chat shows.
import { parseProposal } from "./academic";
import { parseExamProposal } from "./examChat";
import { uiCommandLabel } from "./uiControl";
import { parseCodeProposal, parseDeckProposal, parseOwnProposal, parsePracticeProposal } from "./proposals";
import type { AnswerMeta, CodeProposal, DeckProposal, OwnProposal, PracticeProposal, ExamProposal, Level, NodeStatus, Phase, Proposal, ProposedAction, QuestionArgs, ResearchMeta, Session, Lang } from "../types";

import { LANG_IDS } from "./code";

export type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "question"; key: string; callId: string; args: QuestionArgs; answer: AnswerMeta | null; pending: boolean; /** Answered by writing in the chat (the message shows below). */ inChat?: boolean }
  | { kind: "event"; key: string; label: string }
  | { kind: "diagram"; key: string; title: string; code: string }
  | { kind: "demo"; key: string; title: string; html: string }
  | { kind: "code"; key: string; title: string; lang: Lang; code: string; task: string }
  | { kind: "research"; key: string; question: string; result: ResearchMeta | null }
  | { kind: "action"; key: string; action: ProposedAction }
  | { kind: "exam"; key: string; proposal: ExamProposal }
  | { kind: "timetable"; key: string; proposal: Proposal }
  | { kind: "deck"; key: string; proposal: DeckProposal }
  | { kind: "practice"; key: string; proposal: PracticeProposal }
  | { kind: "codeOffer"; key: string; proposal: CodeProposal }
  | { kind: "ownProblems"; key: string; proposal: OwnProposal };

const ACTION_SCREENS = ["library", "practice", "exams", "cards", "agenda", "code", "language", "graph", "companion", "academic", "classes", "progress", "settings"];

/** What a `propose_action` call may show: the same checks the backend makes, so a bad one never becomes a button. */
export function parseAction(raw: string): ProposedAction | null {
  const a = safeJson<ProposedAction>(raw);
  if (!a || typeof a.label !== "string" || !a.label.trim() || a.label.length > 60) return null;
  const inRange = (v: unknown, lo: number, hi: number) => v === undefined || (typeof v === "number" && v >= lo && v <= hi);
  if (a.kind === "open_screen") return a.screen && ACTION_SCREENS.includes(a.screen) ? a : null;
  if (a.kind === "start_pomodoro") return inRange(a.minutes, 5, 90) ? a : null;
  if (a.kind === "set_reminders") return (a.stand_minutes !== undefined || a.water_minutes !== undefined) && inRange(a.stand_minutes, 10, 240) && inRange(a.water_minutes, 10, 240) ? a : null;
  const named = (v: unknown) => typeof v === "string" && !!v.trim() && v.length <= 120;
  if (a.kind === "open_exam") return named(a.exam) && (a.activity === undefined || ["simulacro", "hoja", "repaso"].includes(a.activity)) ? a : null;
  if (a.kind === "open_deck") return named(a.deck) ? a : null;
  return null;
}

export const PHASES: { id: Phase; label: string }[] = [
  { id: "probe", label: "Medir" },
  { id: "plan", label: "Planificar" },
  { id: "teach", label: "Enseñar" },
  { id: "done", label: "Listo" },
];

export const LEVEL_LABEL: Record<Level, string> = {
  solid: "sólido",
  partial: "parcial",
  missing: "falta",
  misconception: "confusión",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  known: "ya lo sabés",
  pending: "pendiente",
  current: "ahora",
  understood: "entendido",
  repair: "a reparar",
};

export const PURPOSE_LABEL: Record<QuestionArgs["purpose"], string> = {
  probe: "Diagnóstico",
  predict: "Predicción",
  check: "Verificación",
};

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function phaseLabel(p: string): string {
  return PHASES.find((x) => x.id === p)?.label ?? p;
}

function eventLabel(name: string, args: Record<string, unknown> | null, plan: Session["plan"]): string | null {
  if (!args) return null;
  switch (name) {
    case "record_finding":
      return `Diagnóstico: ${args.concept} → ${LEVEL_LABEL[args.level as Level] ?? args.level}`;
    case "set_plan":
      return `Plan actualizado (${(args.nodes as unknown[] | undefined)?.length ?? 0} pasos)`;
    case "update_node": {
      const title = plan.find((n) => n.id === args.id)?.title ?? String(args.id);
      return `${title} → ${STATUS_LABEL[args.status as NodeStatus] ?? args.status}`;
    }
    case "set_phase":
      return `Fase: ${phaseLabel(String(args.phase))}`;
    case "begin_learning":
      return `Empezó a aprender: ${String(args.goal ?? "").trim()}`;
    case "make_cards": {
      const n = (args.cards as unknown[] | undefined)?.length ?? 0;
      return `Tarjetas: ${n} ${n === 1 ? "guardada" : "guardadas"} para repasar`;
    }
    default:
      return null;
  }
}

export interface LibraryRef {
  n: number;
  book_title: string;
  section: string;
  page: number | null;
}

/** "Cálculo I, «Recta tangente», p. 2": the last part of the section path is enough. */
export function citeLabel(r: LibraryRef): string {
  const section = r.section.split(" › ").pop() ?? r.section;
  return `${r.book_title}, «${section}»${r.page ? `, p. ${r.page}` : ""}`;
}

/** AC-72: `[L3]` becomes the real source; a number the library never returned is flagged. */
export function resolveCitations(text: string, refs: Map<number, LibraryRef>): string {
  return text.replace(/\[L(\d+)\]/g, (_, n: string) => {
    const r = refs.get(Number(n));
    return r ? `[${citeLabel(r)}]` : "[cita no verificada]";
  });
}

export function buildTranscript(s: Session): Item[] {
  const answers = new Map<string, AnswerMeta>();
  const research = new Map<string, ResearchMeta>();
  const freeAnswers = new Set<string>();
  const failed = new Set<string>();
  const libraryHits = new Map<string, { query: string; count: number; tokens?: number }>();
  const refs = new Map<number, LibraryRef>();
  for (const m of s.messages) {
    if (m.role !== "tool" || !m.tool_call_id) continue;
    if (typeof m.content === "string" && m.content.startsWith("error:")) failed.add(m.tool_call_id);
    if (m.meta?.kind === "answer" && m.meta.free) freeAnswers.add(m.tool_call_id);
    else if (m.meta?.kind === "answer") answers.set(m.tool_call_id, m.meta);
    else if (m.meta?.kind === "research") research.set(m.tool_call_id, m.meta);
    else if (m.meta?.kind === "library") {
      for (const r of m.meta.refs ?? []) refs.set(r.n, r);
      libraryHits.set(m.tool_call_id, { query: m.meta.query, count: m.meta.refs?.length ?? 0, tokens: m.meta.tokens });
    }
  }

  const items: Item[] = [];
  s.messages.forEach((m, i) => {
    if (m.role === "user") {
      items.push({ kind: "user", key: `u${i}`, text: (m.meta?.kind === "answer" ? m.meta.text : null) ?? m.content ?? "" });
    } else if (m.role === "tool" && m.meta?.kind === "answer" && m.meta.free) {
      items.push({ kind: "user", key: `f${i}`, text: m.meta.text });
    } else if (m.role === "assistant") {
      if (m.content?.trim()) items.push({ kind: "assistant", key: `a${i}`, text: resolveCitations(m.content, refs) });
      for (const c of m.tool_calls ?? []) {
        if (c.function.name === "ask_question") {
          const args = safeJson<QuestionArgs>(c.function.arguments);
          if (!args?.question) continue;
          items.push({
            kind: "question",
            key: c.id,
            callId: c.id,
            args,
            answer: answers.get(c.id) ?? null,
            pending: s.pending_question === c.id,
            inChat: freeAnswers.has(c.id) || undefined,
          });
        } else if (c.function.name === "show_diagram" || c.function.name === "show_demo") {
          const a = safeJson<{ title?: string; mermaid?: string; html?: string }>(c.function.arguments);
          if (!a?.title) continue;
          if (c.function.name === "show_diagram" && a.mermaid) items.push({ kind: "diagram", key: c.id, title: a.title, code: a.mermaid });
          if (c.function.name === "show_demo" && a.html) items.push({ kind: "demo", key: c.id, title: a.title, html: a.html });
        } else if (c.function.name === "show_code") {
          const a = safeJson<{ title?: string; language?: Lang; code?: string; task?: string }>(c.function.arguments);
          if (a?.title && a.code && a.language && LANG_IDS.includes(a.language)) items.push({ kind: "code", key: c.id, title: a.title, lang: a.language, code: a.code, task: a.task ?? "" });
        } else if (c.function.name === "library_search") {
          const h = libraryHits.get(c.id);
          const cost = h?.tokens ? `, ~${h.tokens} tokens` : "";
          if (h) items.push({ kind: "event", key: c.id, label: h.count ? `Buscó en tu biblioteca: «${h.query}» (${h.count} ${h.count === 1 ? "fragmento" : "fragmentos"}${cost})` : `Buscó en tu biblioteca: «${h.query}» (nada)` });
        } else if (c.function.name === "propose_timetable") {
          const proposal = parseProposal(c.function.arguments);
          if (proposal) items.push({ kind: "timetable", key: c.id, proposal });
        } else if (c.function.name === "ui_command") {
          const label = failed.has(c.id) ? null : uiCommandLabel(safeJson<Record<string, unknown>>(c.function.arguments) ?? {});
          if (label) items.push({ kind: "event", key: c.id, label });
        } else if (c.function.name === "propose_exam") {
          const proposal = parseExamProposal(c.function.arguments);
          if (proposal) items.push({ kind: "exam", key: c.id, proposal });
        } else if (c.function.name === "propose_deck") {
          const proposal = parseDeckProposal(c.function.arguments);
          if (proposal) items.push({ kind: "deck", key: c.id, proposal });
        } else if (c.function.name === "propose_practice") {
          const proposal = parsePracticeProposal(c.function.arguments);
          if (proposal) items.push({ kind: "practice", key: c.id, proposal });
        } else if (c.function.name === "propose_own_problems") {
          const proposal = parseOwnProposal(c.function.arguments);
          if (proposal) items.push({ kind: "ownProblems", key: c.id, proposal });
        } else if (c.function.name === "propose_code") {
          const proposal = parseCodeProposal(c.function.arguments);
          if (proposal) items.push({ kind: "codeOffer", key: c.id, proposal });
        } else if (c.function.name === "propose_action") {
          const action = parseAction(c.function.arguments);
          if (action) items.push({ kind: "action", key: c.id, action });
        } else if (c.function.name === "research") {
          const a = safeJson<{ question?: string }>(c.function.arguments);
          items.push({ kind: "research", key: c.id, question: a?.question ?? "", result: research.get(c.id) ?? null });
        } else {
          const label = eventLabel(c.function.name, safeJson(c.function.arguments), s.plan);
          if (label) items.push({ kind: "event", key: c.id, label });
        }
      }
    }
  });
  return items;
}

/** True when the conversation ends on the learner's side with no pending
 *  question, i.e. the agent should run (kickoff, or retry after an error).
 *  A tool result counts only when it is the learner's answer to `ask_question`:
 *  a turn that ended on, say, `set_phase` with no closing text is over, and
 *  reopening it must not start another one. */
export function needsAgent(s: Session): boolean {
  if (s.pending_question) return false;
  const last = s.messages[s.messages.length - 1];
  if (!last) return false;
  if (last.role === "user") return true;
  if (last.role !== "tool") return false;
  const asked = s.messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id);
  return asked?.function.name === "ask_question";
}
