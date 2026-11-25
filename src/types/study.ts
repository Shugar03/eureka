// Practice, exam prep, language exams and spaced-repetition flashcards.
import type { Lang } from "./code";

// ── Practice (Phase 3) ──────────────────────────────────────────────────────

export type Verdict = "correct" | "partial" | "incorrect";

export interface PracticeAttempt {
  answer: string;
  confidence: number | null;
  thinking: string;
  hints_used: number;
  verdict: Verdict;
  feedback: string;
  at: string;
}

export interface Problem {
  id: string;
  statement: string;
  targets: string[];
  hints: string[];
  solution: string;
  hints_shown: number;
  /** AC-167: 1 one idea, familiar · 2 one idea, new context · 3 two ideas · 4 two or more, new context; 0 = an older set. */
  level?: number;
  /** AC-168: hints written for where the learner's reasoning was. */
  nudges?: string[];
  /** AC-173: an own problem whose reference solution Eureka wrote (it may be wrong). */
  solution_by_model?: boolean;
  attempts: PracticeAttempt[];
}

/** AC-168: a hint for what the learner is thinking; `solved` = it already solves it (not counted). */
export interface PracticeNudge {
  set: PracticeSet;
  hint: string;
  solved: boolean;
}

export interface PracticeSet {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  targets: { id: string; text: string }[];
  problems: Problem[];
  /** AC-167: how many it will have, written one by one; null = an older set, generated whole. */
  planned?: number | null;
  /** AC-173: the learner brought these problems. */
  own?: boolean;
}

/** AC-174: the chat proposes practicing the person's own exercises (what they sent, or a library document). */
export interface OwnProposal {
  title: string;
  text: string;
  book: string;
}

/** AC-173: one problem read from the learner's own guide, before it becomes a practice. */
export interface OwnProblem {
  statement: string;
  solution: string;
  /** The guide itself gives the answer. */
  given: boolean;
  hints: string[];
  ideas: string[];
}

export interface PracticeSummary {
  id: string;
  title: string;
  updated_at: string;
  total: number;
  done: number;
  correct: number;
}

// ── Exam prep (Phase 5) ─────────────────────────────────────────────────────

export interface SourceRef {
  title: string;
  url: string;
}

/** An exam guide found on the web, to review before creating the exam. */
export interface FoundGuide {
  guide: string;
  sources: SourceRef[];
}

export interface ExamLink {
  exam_id: string;
  exam_name: string;
  domain: string;
  weight: number;
  topic_id: string;
  objectives: string[];
  /** Programming paths: "python", "rust"… */
  lang?: string | null;
}

export interface ExamTopic {
  id: string;
  title: string;
  objectives: string[];
  session_id: string | null;
  /** Console exercises of this topic that passed (programming paths). */
  exercises_passed: number;
}

export interface ExamDomain {
  id: string;
  name: string;
  /** Percent of the exam; all domains add up to 100. */
  weight: number;
  topics: ExamTopic[];
}

export interface ExamQuestion {
  id: string;
  domain_id: string;
  topic_id: string | null;
  stem: string;
  options: string[];
  /** Indices of the correct options: one, or several for "Elegí N". */
  answer: number[];
  explanation: string;
  /** Reported by the learner as wrong (their reason): it no longer counts. */
  reported?: string | null;
}

export interface DomainScore {
  domain_id: string;
  correct: number;
  total: number;
}

export interface MockResult {
  /** The learner's choices per question (empty = blank). */
  answers: number[][];
  correct: number;
  total: number;
  by_domain: DomainScore[];
  at: string;
  /** From the questions being shown to the submission. */
  elapsed_secs: number;
}

export interface MockExam {
  id: string;
  created_at: string;
  questions: ExamQuestion[];
  result: MockResult | null;
  /** Timed like the real exam; the clock starts at created_at. */
  time_limit_secs: number | null;
  /** What a targeted mock covers; null = the whole exam by weight. */
  focus: string | null;
  /** Questions a second model disagreed with and were dropped (null = not checked). */
  dropped?: number | null;
}

export interface ExplainTurn {
  role: "user" | "assistant";
  content: string;
}

/** Limits a mock to some domains and/or topics (both empty = all). */
export interface MockFocus {
  domain_ids: string[];
  topic_ids: string[];
}

/** Passing mark (an approximation of scaled scores), exam date, weekly hours. */
export interface ExamGoal {
  passing_pct: number | null;
  /** Local calendar date, YYYY-MM-DD. */
  exam_date: string | null;
  hours_per_week: number | null;
}

/** A question failed in a mock exam, waiting to be reviewed. */
export interface ReviewItem {
  id: string;
  question: ExamQuestion;
  mock_id: string;
  /** Right answers in a row; at 2 it leaves the list. */
  streak: number;
  added_at: string;
}

export interface Exam {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  domains: ExamDomain[];
  mocks: MockExam[];
  review: ReviewItem[];
  goal: ExamGoal;
  cheat_sheet: { markdown: string; at: string } | null;
  /** A certification/exam, or a course subject (its program as the syllabus). */
  kind: ExamKind;
  schedule: Slot[];
  /** The language of a programming path. */
  lang: Lang | null;
}

export type ExamKind = "certification" | "subject" | "language";

/** A weekly class or study block. weekday: 1 = Monday … 7 = Sunday. */
export interface Slot {
  weekday: number;
  /** "HH:MM" local time. */
  start: string;
  end: string;
  kind: "class" | "study";
  place: string;
}

export interface ExamSummary {
  id: string;
  name: string;
  updated_at: string;
  domains: number;
  topics: number;
  started: number;
  last_score: number | null;
  to_review: number;
  kind: ExamKind;
  exam_date: string | null;
  schedule: Slot[];
}

// ── Language exams ──────────────────────────────────────────────────────────

export interface Listening {
  title: string;
  transcript: string;
  questions: ExamQuestion[];
}

export interface SpeakingInput {
  language: string;
  level: string;
  task: string;
  transcript: string;
  seconds: number;
}

// ── Flashcards (spaced repetition) ──────────────────────────────────────────

export type Grade = "again" | "hard" | "good" | "easy";

export interface Card {
  id: string;
  front: string;
  back: string;
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  /** Next review, local YYYY-MM-DD. */
  due: string;
  /** Last review day; null = new card. */
  reviewed: string | null;
}

export type DeckSource = { kind: "manual" } | { kind: "exam"; id: string } | { kind: "graph" } | { kind: "notes" };

export interface Deck {
  id: string;
  name: string;
  source: DeckSource;
  created_at: string;
  updated_at: string;
  cards: Card[];
}

/** AC-152: what an Anki package had (media is not imported). */
export interface AnkiPackage {
  cards: [string, string][];
  media_only: number;
  empty: number;
}

/** AC-154: a deck someone shared (a `.eureka` file), checked before importing. */
export interface SharedDeckIncoming {
  name: string;
  cards: [string, string][];
  skipped: number;
}

export interface DeckSummary {
  id: string;
  name: string;
  source: DeckSource;
  updated_at: string;
  total: number;
  new: number;
  due: number;
}

export type CardSource = { kind: "exam"; id: string } | { kind: "graph"; node_ids: string[] } | { kind: "notes"; text: string };
