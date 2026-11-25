// Mirrors the Rust types for sessions, messages, agent events and student memory.
import type { Lang } from "./code";
import type { FolderMeta, FolderPlanMeta } from "./folders";
import type { GraphSummary } from "./library";
import type { RouteLink, RouteProposal } from "./routes";
import type { ExamLink } from "./study";

export type Phase = "chat" | "probe" | "plan" | "teach" | "done";
export type Level = "solid" | "partial" | "missing" | "misconception";
export type NodeStatus = "known" | "pending" | "current" | "understood" | "repair";

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface AnswerMeta {
  kind: "answer";
  text: string;
  confidence: number | null;
  thinking: string;
  /** Written in the chat box instead of answering with the question's form (AC-121). */
  free?: boolean;
  /** AC-166: what they thought while reading the explanation before it. */
  reading?: string;
  /** AC-208: how the app corrected a closed question. */
  grade?: { correct: boolean; right: number; total: number } | null;
}

/** AC-120: an exam preparation the agent proposed from what the person said. */
export interface ExamProposal {
  name: string;
  kind: "certification" | "subject";
  exam_date: string | null;
  hours_per_week: number | null;
  passing_pct: number | null;
  guide: string | null;
}

/** AC-72: passages a `library_search` returned, numbered for the whole session. */
export interface LibraryMeta {
  kind: "library";
  query: string;
  /** Estimated tokens the passages add to the teacher's context. */
  tokens?: number;
  refs: { n: number; book_id: string; book_title: string; section_id: number; section: string; page: number | null }[];
}

export interface ResearchMeta {
  kind: "research";
  question: string;
  summary: string;
  sources: { title: string; url: string }[];
  error: string | null;
  /** AC-169: still running in the background (no summary yet). */
  pending?: boolean;
  /** AC-169: the teacher already got it after it arrived. */
  told?: boolean;
  /** AC-206: open PDFs found, offered for the library. */
  documents?: { title: string; url: string }[];
  /** AC-206: searches that found nothing useful. */
  uncovered?: string[];
}

export interface Msg {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  meta?: AnswerMeta | ResearchMeta | LibraryMeta | RouteProposalMeta | FolderMeta | FolderPlanMeta;
}

/** AC-214: the route the app planned, kept in the tool result so it survives a reload. */
export interface RouteProposalMeta {
  kind: "route_proposal";
  proposal: RouteProposal;
}

export interface Finding {
  concept: string;
  level: Level;
  evidence: string;
}

export interface PlanNode {
  id: string;
  title: string;
  summary: string;
  depends_on: string[];
  status: NodeStatus;
  note: string;
}

export interface Session {
  id: string;
  title: string;
  goal: string;
  phase: Phase;
  created_at: string;
  updated_at: string;
  findings: Finding[];
  plan: PlanNode[];
  pending_question: string | null;
  messages: Msg[];
  /** Set once extracted into the knowledge graph (AC-17). */
  graph?: GraphSummary | null;
  exam?: ExamLink | null;
  /** AC-216: the class of a learning route this session is. */
  route?: RouteLink | null;
  memory?: SessionMemory | null;
  archived?: boolean;
  pinned?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  goal: string;
  phase: Phase;
  updated_at: string;
  plan_total: number;
  plan_done: number;
  /** AC-107: hidden from the lists, still remembered. */
  archived?: boolean;
  pinned?: boolean;
  /** AC-216: set when the session is a class of a route. */
  route?: string | null;
}

/** AC-108: what a session left in memory. */
export interface SessionMemory {
  summary: string;
  pending: string[];
  struggled: string[];
  messages: number;
  at: string;
}

export interface RememberedSession {
  id: string;
  title: string;
  updated_at: string;
  archived: boolean;
  memory: SessionMemory;
}

/** A button the agent offers (AC-90); nothing runs until the learner taps it. */
export type ActionScreen = "library" | "practice" | "exams" | "cards" | "agenda" | "code" | "language" | "graph" | "companion" | "academic" | "classes" | "progress" | "routes" | "settings";

/** AC-111: the student model, built from every source. */
export type TopicStatus = "le_cuesta" | "pendiente" | "practicando" | "domina";

export interface TopicState {
  key: string;
  name: string;
  status: TopicStatus;
  evidence: string[];
  at: string;
  sources: string[];
  confusion: boolean;
}

export interface StudentModel {
  topics: TopicState[];
  pending: { item: string; session_id: string; session_title: string; at: string }[];
  upcoming: { title: string; date: string; days: number; screen: string; id: string }[];
  preferences: string[];
  cards_due: number;
  minutes_7d: number;
}

/** AC-112: something worth doing today, with its reason. */
export interface Suggestion {
  title: string;
  reason: string;
  screen: "exams" | "academic" | "cards" | "session" | "chat";
  target_id: string | null;
  prompt: string | null;
}

/** AC-161: a deck the person asked for in the chat. */
export interface DeckProposal {
  name: string;
  cards: { front: string; back: string }[];
}

/** AC-162: a practice on ideas of the graph. */
export interface PracticeProposal {
  ideas: string[];
  count?: number;
}

/** AC-163: an exercise for the code console. */
export interface CodeProposal {
  language: Lang;
  topic: string;
  level?: string;
}

export interface ProposedAction {
  kind: "open_screen" | "start_pomodoro" | "set_reminders" | "open_exam" | "open_deck";
  /** open_exam: the preparation's name, and what for. */
  exam?: string;
  activity?: "simulacro" | "hoja" | "repaso";
  /** open_deck: the deck's name. */
  deck?: string;
  label: string;
  screen?: ActionScreen;
  minutes?: number;
  stand_minutes?: number;
  water_minutes?: number;
}

export interface LearnerInput {
  text: string;
  confidence?: number | null;
  thinking?: string;
  /** Typed in the chat box while a question was waiting (AC-121). */
  free?: boolean;
  /** AC-166: notes taken while reading the teacher's last explanation; sent with the next input. */
  reading?: string;
  /** AC-208: the app's instant correction of a closed question. */
  grade?: { correct: boolean; right: number; total: number };
}

/** AC-122: a control of the app the agent runs because the person asked for it in words. */
export type UiCommand =
  | { command: "pomodoro_start"; minutes: number }
  | { command: "pomodoro_pause" | "pomodoro_resume" | "pomodoro_skip" | "pomodoro_reset" }
  | { command: "set_theme"; theme: "dark" | "light" | "system" }
  | { command: "set_wallpaper"; wallpaper: string }
  | { command: "set_accent"; accent: string }
  | { command: "set_sound"; enabled: boolean | null; tick_tock: boolean | null }
  | { command: "set_reminders"; stand_minutes: number | null; water_minutes: number | null }
  | ({ command: "set_accessibility"; text_size: "normal" | "large" | "larger" | null } & Partial<Record<"spacing" | "reduce_motion" | "read_aloud" | "easy_reading" | "literal" | "short_steps" | "dictation", boolean>>)
  | { command: "set_pomodoro"; focus: number | null; short: number | null; long: number | null; every: number | null }
  | { command: "set_profile"; first_name: string | null; school: string | null; career: string | null; treatment: "el" | "ella" | "elle" | "ninguno" | null };

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "ui"; command: UiCommand }
  | { type: "activity"; label: string }
  | { type: "session"; session: Session }
  | { type: "error"; message: string }
  | { type: "done" };

export interface QuestionArgs {
  question: string;
  purpose: "probe" | "predict" | "check";
  /** AC-204: how it is answered; without it, options make it a choice and no options an open question. */
  format?: "open" | "choice" | "multi" | "true_false" | "order" | "match" | "cloze";
  options?: string[];
  /** true_false: each one is marked true or false. */
  statements?: string[];
  /** order: in the right order (the card shuffles them). */
  items?: string[];
  /** match: the right pairs (the card shuffles the right column). */
  pairs?: { left: string; right: string }[];
  /** AC-208: the key (never shown before answering): choice 1-based index, multi indices, true_false booleans, cloze words. */
  answer?: number | number[] | boolean[] | string[];
  /** Diagnostic questions the teacher expects to ask in total (probe only), for «pregunta 2 de ~3». */
  of?: number;
}

// ── Learner profile (what the app knows about you) ─────────────────────────

export interface LearnerProfile {
  misconceptions: { concept: string; wrong_idea: string; fixed: boolean; source: string; at: string }[];
  preferences: { text: string; source: string; at: string }[];
}

/** AC-195..AC-200: one observation of the student's memory. */
export type MemoryKind = "le_cuesta" | "confusion" | "pendiente" | "domina" | "preferencia" | "idea";

export interface MemoryObservation {
  id: number;
  /** Stable topic key, e.g. "concepto:derivada". */
  topic: string;
  kind: MemoryKind;
  title: string;
  content: string;
  evidence: { source: string; label: string; at: string }[];
  confidence: number;
  created_at: string;
  updated_at: string;
  verified: boolean;
  by_student: boolean;
  /** Review date (YYYY-MM-DD). */
  due: string | null;
  /** "activa" | "reparada" (also "reemplazada" | "borrada", never listed). */
  state: string;
  conflict: boolean;
}
