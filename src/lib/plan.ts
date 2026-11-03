// Study plan to the exam date (AC-52) and the weekly agenda (AC-51): pure,
// over local calendar days (YYYY-MM-DD).
import type { Exam, ExamSummary, SessionSummary, Slot, StudyEntry } from "../types";
import { addDays } from "./cards";
import { daysUntil, domainReadiness, latestResult, localDate, topicState } from "./exam";

export interface PlanTopic {
  topicId: string;
  title: string;
  domain: string;
  /** In progress (a study session already started). */
  started: boolean;
  /** AC-149: already studied, back in the plan because its domain went badly in the last mock ("54% en el último simulacro"). */
  review?: string;
}

export interface PlanWeek {
  /** Monday … Sunday of that week, clipped to today and the exam date. */
  from: string;
  to: string;
  topics: PlanTopic[];
  /** The last week (or the only one): full mocks, review and the sheet. */
  final: boolean;
}

export interface StudyPlan {
  daysLeft: number;
  weeks: PlanWeek[];
  /** What to do today: the first pending topic, or the final-week routine. */
  today: PlanTopic | null;
  /** Minutes studied for this exam this week (Monday to today). */
  weekMinutes: number;
  /** Weekly goal in minutes (hours per week × 60), if set. */
  weekGoal: number | null;
  /** AC-149: the day of the mock the plan was re-adjusted with, when it brought topics back. */
  replannedWith: string | null;
}

/** AC-149: below this share of a domain in the last mock (or the passing mark), its studied topics come back. */
export const REVIEW_BELOW = 70;

/** Monday of the week of `day` (weeks start on Monday). */
export function monday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = Monday
  return addDays(day, -wd);
}

/** 1 = Monday … 7 = Sunday, like Slot.weekday. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
}

/**
 * Pending topics, most urgent first: heavier and weaker domains first
 * (weight × (1 − readiness)), the guide's order inside each. Studied topics
 * are out, unless their domain went badly in the last mock (AC-149): then
 * they come back to review, after that domain's new topics.
 */
export function pendingTopics(exam: Exam, sessions: Map<string, SessionSummary>): PlanTopic[] {
  const result = latestResult(exam);
  const bar = exam.goal.passing_pct ?? REVIEW_BELOW;
  const ranked = [...exam.domains].sort((a, b) => b.weight * (1 - domainReadiness(b, result, sessions).score) - a.weight * (1 - domainReadiness(a, result, sessions).score));
  return ranked.flatMap((d) => {
    const s = result?.by_domain.find((x) => x.domain_id === d.id);
    const pct = s && s.total ? Math.round((100 * s.correct) / s.total) : null;
    const weak = pct !== null && pct < bar;
    const fresh: PlanTopic[] = [];
    const again: PlanTopic[] = [];
    for (const t of d.topics) {
      const st = topicState(t, sessions).kind;
      if (st !== "studied") fresh.push({ topicId: t.id, title: t.title, domain: d.name, started: st === "studying" });
      else if (weak) again.push({ topicId: t.id, title: t.title, domain: d.name, started: false, review: `${pct}% en el último simulacro` });
    }
    return [...fresh, ...again];
  });
}

/** Minutes logged for this exam (directly, or in one of its topic sessions) from `from` on. */
export function examMinutes(exam: Exam, entries: StudyEntry[], from: string): number {
  const sessionIds = new Set(exam.domains.flatMap((d) => d.topics.flatMap((t) => (t.session_id ? [t.session_id] : []))));
  return entries
    .filter((e) => e.day >= from && e.context && ((e.context.kind === "exam" && e.context.id === exam.id) || (e.context.kind === "session" && sessionIds.has(e.context.id))))
    .reduce((s, e) => s + e.minutes, 0);
}

/** AC-52: null without an exam date, or when it already passed. */
export function studyPlan(exam: Exam, sessions: Map<string, SessionSummary>, today: string, entries: StudyEntry[], now: Date): StudyPlan | null {
  const date = exam.goal.exam_date;
  if (!date) return null;
  const daysLeft = daysUntil(date, now);
  if (daysLeft < 0) return null;

  // Calendar weeks from this one to the exam's.
  const weeks: PlanWeek[] = [];
  for (let mon = monday(today); mon <= date; mon = addDays(mon, 7)) {
    const sun = addDays(mon, 6);
    weeks.push({ from: mon < today ? today : mon, to: sun > date ? date : sun, topics: [], final: false });
  }
  weeks[weeks.length - 1].final = true;

  // Topics spread evenly over the weeks before the final one (or all, if only one).
  const pending = pendingTopics(exam, sessions);
  const study = weeks.length > 1 ? weeks.slice(0, -1) : weeks;
  // Evenly: the first weeks take one extra while the remainder lasts.
  const base = Math.floor(pending.length / study.length);
  const extra = pending.length % study.length;
  let at = 0;
  study.forEach((w, i) => {
    const n = base + (i < extra ? 1 : 0);
    w.topics = pending.slice(at, at + n);
    at += n;
  });

  const goal = exam.goal.hours_per_week;
  return {
    daysLeft,
    weeks,
    today: weeks[0].topics[0] ?? null,
    weekMinutes: examMinutes(exam, entries, monday(today)),
    weekGoal: goal ? Math.round(goal * 60) : null,
    replannedWith: pending.some((t) => t.review) ? (latestResult(exam) ? localDate(new Date(latestResult(exam)!.at)) : null) : null,
  };
}

// ── Agenda (AC-51) ───────────────────────────────────────────────────────

export interface AgendaSlot extends Slot {
  examId: string;
  name: string;
}

export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Every slot of every exam/subject on a weekday (1–7), by start time. */
export function slotsOn(exams: ExamSummary[], weekday: number): AgendaSlot[] {
  return exams
    .flatMap((e) => e.schedule.filter((s) => s.weekday === weekday).map((s) => ({ ...s, examId: e.id, name: e.name })))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Exams and subjects with a date from today on, soonest first. */
export function upcoming(exams: ExamSummary[], today: string): ExamSummary[] {
  return exams.filter((e) => e.exam_date && e.exam_date >= today).sort((a, b) => a.exam_date!.localeCompare(b.exam_date!));
}

/** Hours of class and of planned study per week. */
export function weeklyHours(exams: ExamSummary[]): { classes: number; study: number } {
  const mins = (s: Slot) => {
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    return m(s.end) - m(s.start);
  };
  const all = exams.flatMap((e) => e.schedule);
  return {
    classes: all.filter((s) => s.kind === "class").reduce((a, s) => a + mins(s), 0) / 60,
    study: all.filter((s) => s.kind === "study").reduce((a, s) => a + mins(s), 0) / 60,
  };
}
