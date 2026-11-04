// Mirrors the Rust types in src-tauri/src (serde JSON shapes).

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
}

export interface Msg {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  meta?: AnswerMeta | ResearchMeta | LibraryMeta;
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

export interface Provider {
  id: string;
  label: string;
  base_url: string;
}

export interface ProviderView extends Provider {
  has_key: boolean;
}

/** A connected subscription account (ChatGPT Plus/Pro). Never carries tokens. */
export interface AccountView {
  provider_id: string;
  account_id: string;
  email: string | null;
  /** Unix milliseconds; the backend refreshes before it lapses. */
  expires: number;
}

/** One model a subscription account may call. */
export interface ModelInfo {
  id: string;
  context: number | null;
  tools: boolean;
}

/** AC-106: a Whisper model that runs on this PC. */
export interface LocalSpeechModel {
  id: string;
  label: string;
  bytes: number;
  installed: boolean;
}

/** The Voz role's provider id for the local Whisper. */
export const LOCAL_SPEECH = "local";

export interface ModelRef {
  provider_id: string;
  model: string;
  /** Context window in thousands of tokens (unset: 64). */
  context_k?: number | null;
}

export interface Roles {
  prober: ModelRef;
  teacher: ModelRef;
  extractor: ModelRef;
  practice: ModelRef;
  researcher: ModelRef;
  /** Speech to text for speaking practice; empty = off. */
  speech: ModelRef;
}

export interface SearchView {
  base_url: string;
  has_key: boolean;
}

/** AC-99…: Mi cursada — terms, courses with their weekly slots, and the dates that matter. */
export type TermKind = "cuatrimestre" | "trimestre" | "semestre" | "anual" | "otro";
export type DateKind = "parcial" | "recuperatorio" | "final" | "tp" | "entrega" | "otro";
export type SlotKind = "teoria" | "practica" | "otro";
export interface Term {
  id: string;
  name: string;
  kind: TermKind;
  start: string | null;
  end: string | null;
  /** AC-145: holidays and weeks without classes. */
  breaks?: TermBreak[];
}
/** AC-145: days without classes, both inclusive. */
export interface TermBreak {
  id: string;
  start: string;
  end: string;
  name: string;
}
export interface BreakInput {
  start: string;
  end?: string | null;
  name: string;
}
export interface ClassSlot {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  start: string;
  end: string;
  room: string;
  kind: SlotKind;
}
export interface Course {
  id: string;
  term_id: string;
  name: string;
  code: string;
  professor: string;
  room: string;
  notes: string;
  color: number;
  slots: ClassSlot[];
  /** AC-150: its study route (an exam of kind "subject"), if linked. */
  exam_id?: string | null;
}

/** AC-150: start a study route for a course from Mi cursada. */
export interface RoutePrefill {
  courseId: string;
  name: string;
}
export interface DateItem {
  id: string;
  term_id: string;
  course_id: string | null;
  kind: DateKind;
  title: string;
  date: string;
  time: string | null;
  notes: string;
  done: boolean;
  grade: number | null;
}
export interface AcademicData {
  terms: Term[];
  courses: Course[];
  dates: DateItem[];
  active_term: string | null;
}
export interface TermInput {
  id?: string | null;
  name: string;
  kind: TermKind;
  start?: string | null;
  end?: string | null;
}
export interface CourseInput {
  id?: string | null;
  term_id: string;
  name: string;
  code?: string;
  professor?: string;
  room?: string;
  notes?: string;
  color?: number | null;
  slots: ClassSlot[];
}
export interface DateInput {
  id?: string | null;
  term_id: string;
  course_id?: string | null;
  kind: DateKind;
  title: string;
  date: string;
  time?: string | null;
  notes?: string;
  done?: boolean;
  grade?: number | null;
}
/** What the agent or the importer suggests; nothing is saved until the person confirms. */
export interface Proposal {
  term?: { name: string; kind?: string; start?: string | null; end?: string | null } | null;
  courses?: { name: string; code?: string; professor?: string; room?: string; notes?: string; slots?: Partial<ClassSlot>[] }[];
  dates?: { course?: string | null; kind: string; title: string; date: string; time?: string | null; notes?: string }[];
}
export interface ImportReport {
  term: string;
  courses_added: number;
  courses_updated: number;
  dates_added: number;
  dates_skipped: number;
}

/** AC-92: what the learner told the app at the start. All optional. */
export interface Identity {
  first_name: string;
  last_name: string;
  school: string;
  career: string;
  age: number | null;
  /** "el", "ella", "elle" or "" (no preference). */
  treatment: "" | "el" | "ella" | "elle";
  treatment_other: string;
  onboarded: boolean;
}

/** A button the agent offers (AC-90); nothing runs until the learner taps it. */
export type ActionScreen = "library" | "practice" | "exams" | "cards" | "agenda" | "code" | "language" | "graph" | "companion" | "academic" | "classes" | "progress" | "settings";

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

/** AC-82..88: Acompañamiento — a listening mode and a private journal. */
export interface CompanionTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
}
export interface CompanionConversation {
  turns: CompanionTurn[];
  /** Signals of risk appeared: the help lines stay visible. */
  risk: boolean;
}
/** AC-93: a thought record — what happened, what I thought, and another way to see it. */
export interface ThoughtRecord {
  situation: string;
  thought: string;
  /** Intensity 0–100 before looking at the thought again, and (optionally) after. */
  before: number;
  after?: number | null;
  for_it: string;
  against: string;
  alternative: string;
}
export interface JournalEntry {
  id: string;
  at: string;
  kind: "entry" | "checkin" | "thought";
  title: string;
  text: string;
  mood: number | null;
  emotions: string[];
  helped: string[];
  record?: ThoughtRecord | null;
}
export interface EntryDraft {
  id?: string | null;
  title: string;
  text: string;
  mood?: number | null;
  emotions: string[];
  helped: string[];
  record?: ThoughtRecord | null;
}
export interface HelpResource {
  name: string;
  detail: string;
}
export interface CompanionView {
  locked: boolean;
  has_pin: boolean;
  privacy_ack: boolean;
  resources: HelpResource[];
  conversation: CompanionConversation;
  entries: JournalEntry[];
  /** What the person said about each noticed pattern (AC-95). */
  insights: Record<string, "confirmed" | "rejected">;
}

/** AC-73..77: access settings the learner chose (Ajustes → Accesibilidad). */
export interface Accessibility {
  easy_reading: boolean;
  literal: boolean;
  short_steps: boolean;
  read_aloud: boolean;
  speech_rate: number;
  dictation: boolean;
  spacing: boolean;
  text_size: "normal" | "large" | "larger";
  reduce_motion: boolean;
}

export interface SettingsView {
  providers: ProviderView[];
  roles: Roles;
  search: SearchView;
  data_dir: string;
}

export interface ProviderInput extends Provider {
  api_key?: string;
  clear_key?: boolean;
}

export interface SettingsInput {
  providers: ProviderInput[];
  roles: Roles;
  search?: { base_url: string; api_key?: string; clear_key?: boolean };
}

export interface PromptView {
  name: string;
  content: string;
  default_content: string;
  overridden: boolean;
}

export interface LearnerInput {
  text: string;
  confidence?: number | null;
  thinking?: string;
  /** Typed in the chat box while a question was waiting (AC-121). */
  free?: boolean;
  /** AC-166: notes taken while reading the teacher's last explanation; sent with the next input. */
  reading?: string;
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
  options?: string[];
  /** Diagnostic questions the teacher expects to ask in total (probe only), for «pregunta 2 de ~3». */
  of?: number;
}

// ── Knowledge graph (Phase 2) ───────────────────────────────────────────────

export type GraphSource = { kind: "session"; id: string; title: string } | { kind: "notes"; id: string; title: string };

export interface GraphNode {
  id: string;
  text: string;
  sources: GraphSource[];
}

export interface GraphChain {
  premises: string[];
  conclusion: string;
  source: GraphSource;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphView {
  nodes: GraphNode[];
  chains: GraphChain[];
  edges: GraphEdge[];
}

// ── Library (AC-69…71) ──────────────────────────────────────────────────────

export interface BookSection {
  id: number;
  title: string;
  level: number;
  page: number | null;
  markdown: string;
}

export interface Book {
  id: string;
  title: string;
  file_name: string;
  created_at: string;
  pages: number;
  scanned: number[];
  sections: BookSection[];
}

export interface BookSummary {
  id: string;
  title: string;
  file_name: string;
  created_at: string;
  pages: number;
  sections: number;
  scanned: number;
  chars: number;
}

export interface LibraryHit {
  book_id: string;
  book_title: string;
  section_id: number;
  section: string;
  page: number | null;
  snippet: string;
  text: string;
  score: number;
}

export interface GraphSummary {
  propositions: number;
  chains: number;
  at: string;
  /** Messages the extraction saw (audit item 10: more now → re-extract). */
  messages?: number;
}

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

/** AC-158/159: what pasting one key did. */
export interface SetupDone {
  status: "done";
  provider_id: string;
  provider: string;
  model: string;
  context_k: number | null;
  alternatives: string[];
  speech_ready: boolean;
  tools_ok: boolean;
}
export type SetupOutcome = SetupDone | { status: "choose"; candidates: string[]; reason: string };

/** AC-155…157: the career's plan of studies (malla). */
export type CareerStatus = "pendiente" | "cursando" | "regular" | "aprobada";

export interface CareerSubject {
  id: string;
  name: string;
  code: string;
  year: number;
  term: number | null;
  /** Ids that must be at least regular to cursar it. */
  para_cursar: string[];
  /** Ids that must be aprobadas to rendir its final. */
  para_rendir: string[];
  status: CareerStatus;
  grade: number | null;
  failed: number[];
}

export interface CareerSubjectView extends CareerSubject {
  can_take: boolean;
  can_sit_final: boolean;
  missing: string[];
  in_cursada: boolean;
}

export interface CareerView {
  name: string;
  institution: string;
  subjects: CareerSubjectView[];
  approved: number;
  total: number;
  average: number | null;
  average_with_failed: number | null;
}

export interface CareerProposalSubject {
  name: string;
  code?: string;
  year: number;
  term?: number | null;
  para_cursar?: string[];
  para_rendir?: string[];
}

export interface CareerProposal {
  name: string;
  institution?: string;
  subjects: CareerProposalSubject[];
}

export type CareerSubjectInput = Omit<CareerSubject, "id"> & { id: string | null };

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

// ── Study log ───────────────────────────────────────────────────────────────

export interface StudyContext {
  kind: string;
  id: string;
  title: string;
}

export interface StudyEntry {
  at: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  minutes: number;
  context: StudyContext | null;
}

/** AC-147: a date or task the teacher announced in a recorded class. */
export interface AnnouncedDate {
  title: string;
  /** YYYY-MM-DD, or "" if the day wasn't said. */
  date: string;
  kind: DateKind;
}
export interface ClassNotes {
  summary: string;
  key_points: string[];
  questions: string[];
  dates: AnnouncedDate[];
}
/** AC-146: a recorded class, transcribed part by part. */
export interface ClassRecord {
  id: string;
  title: string;
  course_id: string | null;
  day: string;
  started_at: string;
  seconds: number;
  parts: number;
  transcript: string;
  notes: ClassNotes | null;
}
export interface ClassSummary {
  id: string;
  title: string;
  course_id: string | null;
  day: string;
  seconds: number;
  parts: number;
  has_notes: boolean;
}

/** AC-141: a day with study, for the kind streak. */
export interface DayActivity {
  day: string;
  kinds: ("chat" | "focus" | "cards" | "practice" | "exam" | "class")[];
  /** Minutes of finished focus blocks. */
  minutes: number;
}

// ── Code console ────────────────────────────────────────────────────────────

export type Lang = "python" | "javascript" | "typescript" | "rust" | "c" | "cpp" | "java" | "csharp" | "go" | "sql";

export interface Runtime {
  lang: Lang;
  /** The program that runs it, or null if not installed. */
  program: string | null;
  version: string | null;
}

/** A practice exercise: its tests are appended to the learner's code on "Probar". */
export interface CodeExercise {
  lang: Lang;
  title: string;
  statement: string;
  starter: string;
  tests: string;
  hints: string[];
  solution: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  /** Rust: it didn't compile (stderr has rustc's errors). */
  compile_error: boolean;
  duration_ms: number;
}

// ── Projects (multi-file) ───────────────────────────────────────────────────

export interface ProjectFile {
  path: string;
  content: string;
}

export interface Project {
  id: string;
  name: string;
  lang: Lang;
  files: ProjectFile[];
  statement: string;
  hints: string[];
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  lang: Lang;
  files: number;
  updated_at: string;
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

// ── Learner profile (what the app knows about you) ─────────────────────────

export interface LearnerProfile {
  misconceptions: { concept: string; wrong_idea: string; fixed: boolean; source: string; at: string }[];
  preferences: { text: string; source: string; at: string }[];
}
