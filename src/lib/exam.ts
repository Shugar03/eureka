// Pure helpers for the exam screen: topic status from its study session,
// readiness per domain and overall, and what to review next.
import type { Exam, ExamDomain, ExamTopic, MockExam, MockResult, ReviewItem, SessionSummary } from "../types";

export type TopicState = { kind: "new" } | { kind: "studying"; done: number; total: number } | { kind: "studied" };

export function topicState(t: ExamTopic, sessions: Map<string, SessionSummary>): TopicState {
  const s = t.session_id ? sessions.get(t.session_id) : undefined;
  if (!s) return { kind: "new" };
  if (s.phase === "done") return { kind: "studied" };
  return { kind: "studying", done: s.plan_done, total: s.plan_total };
}

export function topicLabel(st: TopicState): string {
  if (st.kind === "new") return "Sin empezar";
  if (st.kind === "studied") return "Estudiado";
  return st.total ? `En curso · ${st.done}/${st.total}` : "En curso";
}

/** Heaviest domains first (ties keep the guide's order). */
export function byWeight(domains: ExamDomain[]): ExamDomain[] {
  return [...domains].sort((a, b) => b.weight - a.weight);
}

/** The latest graded mock of the WHOLE exam (targeted ones don't measure it). */
export function latestResult(exam: Exam): MockResult | null {
  for (let i = exam.mocks.length - 1; i >= 0; i--) {
    const m = exam.mocks[i];
    if (m.result && !m.focus) return m.result;
  }
  return null;
}

/** AC-43: topics of the questions waiting in the review list. */
export function failedTopicIds(exam: Exam): string[] {
  return [...new Set(exam.review.flatMap((r) => (r.question.topic_id ? [r.question.topic_id] : [])))];
}

export interface Readiness {
  /** Share of topics studied (a topic in progress counts half), 0–1. */
  coverage: number;
  /** Share correct in the latest graded mock exam, if it had questions here. */
  mock: number | null;
  /** Half coverage, half mock score (a missing mock counts as 0), 0–1. */
  score: number;
}

export function domainReadiness(d: ExamDomain, result: MockResult | null, sessions: Map<string, SessionSummary>): Readiness {
  const credit = d.topics.reduce((sum, t) => {
    const st = topicState(t, sessions).kind;
    return sum + (st === "studied" ? 1 : st === "studying" ? 0.5 : 0);
  }, 0);
  const coverage = d.topics.length ? credit / d.topics.length : 0;
  const s = result?.by_domain.find((x) => x.domain_id === d.id);
  const mock = s && s.total ? s.correct / s.total : null;
  return { coverage, mock, score: (coverage + (mock ?? 0)) / 2 };
}

/** Weighted by the exam's own domain weights, 0–1. */
export function examReadiness(exam: Exam, sessions: Map<string, SessionSummary>): number {
  const result = latestResult(exam);
  const total = exam.domains.reduce((s, d) => s + d.weight, 0);
  if (!total) return 0;
  return exam.domains.reduce((s, d) => s + d.weight * domainReadiness(d, result, sessions).score, 0) / total;
}

/** AC-36: the domain with the lowest share correct (heavier wins ties). */
export function weakestDomain(exam: Exam, result: MockResult): ExamDomain | null {
  let best: { d: ExamDomain; rate: number } | null = null;
  for (const s of result.by_domain) {
    const d = exam.domains.find((x) => x.id === s.domain_id);
    if (!d || !s.total) continue;
    const rate = s.correct / s.total;
    if (rate === 1) continue;
    if (!best || rate < best.rate || (rate === best.rate && d.weight > best.d.weight)) best = { d, rate };
  }
  return best?.d ?? null;
}

export const pct = (x: number) => `${Math.round(100 * x)}%`;

// ── Timed mock exams (AC-39) ─────────────────────────────────────────────

/** A reference pace (AWS: 65 questions in 90 min); real exams vary. */
export const MIN_PER_QUESTION = 1.5;
export const suggestedMinutes = (count: number) => Math.ceil(count * MIN_PER_QUESTION);

/** Seconds left, or null for an untimed mock. Never negative. */
export function remainingSecs(mock: MockExam, nowMs: number): number | null {
  if (!mock.time_limit_secs) return null;
  const end = Date.parse(mock.created_at) + mock.time_limit_secs * 1000;
  return Math.max(0, Math.ceil((end - nowMs) / 1000));
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "ok" | "warn" (5 min or less) | "bad" (1 min or less). */
export const urgency = (secs: number) => (secs <= 60 ? "bad" : secs <= 300 ? "warn" : "ok");

/** All or nothing, like the real exams: every correct option and no other. */
export function isRight(answer: number[], chosen: number[]): boolean {
  const a = [...new Set(answer)].sort((x, y) => x - y);
  const c = [...new Set(chosen)].sort((x, y) => x - y);
  return a.length === c.length && a.every((x, i) => x === c[i]);
}

// Unsent answers survive leaving the screen (per device; best effort).
const draftKey = (mockId: string) => `la.mock.${mockId}`;

export function loadDraft(mockId: string, n: number): number[][] {
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(mockId)) ?? "null");
    if (Array.isArray(raw) && raw.length === n)
      return raw.map((x) => (Array.isArray(x) ? x.filter(Number.isInteger) : Number.isInteger(x) ? [x] : []));
  } catch {
    /* private mode or corrupt: start blank */
  }
  return Array.from({ length: n }, () => []);
}

export function saveDraft(mockId: string, answers: number[][]) {
  try {
    localStorage.setItem(draftKey(mockId), JSON.stringify(answers));
  } catch {
    /* ignore */
  }
}

export function clearDraft(mockId: string) {
  try {
    localStorage.removeItem(draftKey(mockId));
  } catch {
    /* ignore */
  }
}

// ── Review of failed questions (AC-40) ───────────────────────────────────

/** Least mastered first, then oldest. */
export function reviewQueue(exam: Exam): ReviewItem[] {
  return [...exam.review].sort((a, b) => a.streak - b.streak || a.added_at.localeCompare(b.added_at));
}

// ── Goal: passing mark, trend and exam date (AC-42) ──────────────────────

export interface ScorePoint {
  /** 1-based mock number, as listed. */
  n: number;
  /** Percent correct, 0–100. */
  pct: number;
  at: string;
}

/** Graded mocks in order, as percent correct. */
export function scoreHistory(exam: Exam): ScorePoint[] {
  return exam.mocks.flatMap((m, i) => (m.result && m.result.total && !m.focus ? [{ n: i + 1, pct: (100 * m.result.correct) / m.result.total, at: m.result.at }] : []));
}

export type Verdict =
  | { kind: "unknown" }
  | { kind: "ready" | "close" | "not"; avg: number; last: number; gap: number; weak: ExamDomain[] };

/**
 * "¿Estoy listo?": the average of the last 3 graded mocks against the passing
 * mark. Ready = 5 points of margin and the last one passed; close = within 10.
 */
export function readyVerdict(exam: Exam, passing: number | null): Verdict {
  const h = scoreHistory(exam);
  if (!h.length || passing == null) return { kind: "unknown" };
  const recent = h.slice(-3);
  const avg = recent.reduce((s, p) => s + p.pct, 0) / recent.length;
  const last = h[h.length - 1].pct;
  const result = latestResult(exam);
  const weak = exam.domains.filter((d) => {
    const s = result?.by_domain.find((x) => x.domain_id === d.id);
    return s && s.total && (100 * s.correct) / s.total < passing;
  });
  const kind = avg >= passing + 5 && last >= passing ? "ready" : avg >= passing - 10 ? "close" : "not";
  return { kind, avg, last, gap: passing - avg, weak };
}

/** Today's local calendar date as YYYY-MM-DD (toISOString would give UTC's). */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole local days from `now` to an YYYY-MM-DD date (negative if past). */
export function daysUntil(date: string, now: Date): number {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}
