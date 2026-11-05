// The ONLY module that talks to the Rust backend. Everything in the UI goes
// through here, so tests can swap the backend with @tauri-apps/api/mocks.
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  UsageSummary,
  ClassRecord,
  ClassSummary,
  BreakInput,
  DayActivity,
  Accessibility,
  AcademicData,
  CourseInput,
  DateInput,
  ImportReport,
  Proposal,
  TermInput,
  Identity,
  CompanionView,
  EntryDraft,
  HelpResource,
  Book,
  BookSummary,
  LibraryHit,
  AgentEvent,
  CardSource,
  Deck,
  DeckSummary,
  AnkiPackage,
  SetupOutcome,
  CareerProposal,
  CareerSubjectInput,
  CareerView,
  SharedDeckIncoming,
  Grade,
  LearnerProfile,
  Listening,
  LocalSpeechModel,
  RememberedSession,
  StudentModel,
  Suggestion,
  SpeakingInput,
  Project,
  ProjectFile,
  ProjectSummary,
  CodeExercise,
  Lang,
  RunResult,
  Runtime,
  StudyContext,
  StudyEntry,
  Exam,
  ExamGoal,
  ExamKind,
  Slot,
  ExamSummary,
  ExamQuestion,
  ExplainTurn,
  MockFocus,
  FoundGuide,
  GraphSource,
  GraphView,
  LearnerInput,
  PracticeNudge,
  OwnProblem,
  PracticeSet,
  PracticeSummary,
  PromptView,
  Session,
  SessionSummary,
  SettingsInput,
  SettingsView,
  AccountView,
  ModelInfo,
} from "./types";

export const api = {
  getSettings: () => invoke<SettingsView>("get_settings"),
  saveSettings: (input: SettingsInput) => invoke<SettingsView>("save_settings", { input }),
  listModels: (providerId: string) => invoke<string[]>("list_models", { providerId }),
  /** AC-158/159: one key → provider, model, context and a test call. */
  quickSetup: (key: string, provider: string | null) => invoke<SetupOutcome>("quick_setup", { key, provider }),
  /** Cuenta con suscripción: el sign-in abre el navegador y vuelve solo. */
  chatgptStatus: () => invoke<AccountView | null>("chatgpt_status"),
  chatgptConnect: () => invoke<AccountView>("chatgpt_connect"),
  chatgptDisconnect: () => invoke<void>("chatgpt_disconnect"),
  /** Los modelos que la cuenta puede usar: dependen del plan, no de Settings. */
  chatgptModels: () => invoke<ModelInfo[]>("chatgpt_models"),

  listSessions: () => invoke<SessionSummary[]>("list_sessions"),
  createSession: (goal: string) => invoke<Session>("create_session", { goal }),
  /** AC-89: a free conversation; the agent decides what to do with it. */
  startChat: (message: string) => invoke<Session>("start_chat", { message }),
  getSession: (id: string) => invoke<Session>("get_session", { id }),
  /** AC-107: `forget` also removes what was learned in it (graph ideas, confusions). */
  deleteSession: (id: string, forget = false) => invoke<void>("delete_session", { id, forget }),
  updateSessionMeta: (id: string, meta: { title?: string; pinned?: boolean; archived?: boolean }) => invoke<SessionSummary>("update_session_meta", { id, ...meta }),
  sessionMemories: () => invoke<RememberedSession[]>("session_memories"),
  forgetSessionMemory: (id: string) => invoke<RememberedSession[]>("forget_session_memory", { id }),

  /** Runs one agent turn; resolves when the turn ends. */
  sendMessage: (id: string, input: LearnerInput | null, onEvent: (e: AgentEvent) => void, ui: string | null = null) => {
    const ch = new Channel<AgentEvent>();
    ch.onmessage = onEvent;
    // `ui`: what is on screen right now (pomodoro, theme…), so the agent can see it (AC-107).
    return invoke<void>("send_message", { id, input, ui, onEvent: ch });
  },
  stopAgent: (id: string) => invoke<void>("stop_agent", { id }),

  listPrompts: () => invoke<PromptView[]>("list_prompts"),
  savePrompt: (name: string, content: string) => invoke<void>("save_prompt", { name, content }),
  resetPrompt: (name: string) => invoke<void>("reset_prompt", { name }),

  getGraph: () => invoke<GraphView>("get_graph"),
  extractSession: (id: string) => invoke<Session>("extract_session", { id }),
  importNotes: (title: string, text: string) => invoke<GraphView>("import_notes", { title, text }),
  /** Audit M10: the source's ideas leave the graph (the ledger keeps the history). */
  forgetSource: (source: GraphSource) => invoke<GraphView>("forget_source", { source }),

  listPractice: () => invoke<PracticeSummary[]>("list_practice"),
  getPractice: (id: string) => invoke<PracticeSet>("get_practice", { id }),
  createPractice: (nodeIds: string[], count: number) => invoke<PracticeSet>("create_practice", { nodeIds, count }),
  revealHint: (setId: string, problemId: string) => invoke<PracticeSet>("reveal_hint", { setId, problemId }),
  readOwnProblems: (text: string, book?: string) => invoke<OwnProblem[]>("read_own_problems", { text, book: book || null }),
  createOwnPractice: (title: string, problems: OwnProblem[]) => invoke<PracticeSet>("create_own_practice", { title, problems }),
  nextProblem: (setId: string, have: number) => invoke<PracticeSet>("next_problem", { setId, have }),
  practiceNudge: (setId: string, problemId: string, draft: string) => invoke<PracticeNudge>("practice_nudge", { setId, problemId, draft }),
  answerProblem: (setId: string, problemId: string, input: LearnerInput) =>
    invoke<PracticeSet>("answer_problem", { setId, problemId, input }),
  deletePractice: (id: string) => invoke<void>("delete_practice", { id }),

  listExams: () => invoke<ExamSummary[]>("list_exams"),
  getExam: (id: string) => invoke<Exam>("get_exam", { id }),
  createExam: (name: string, guide: string, kind: ExamKind = "certification") => invoke<Exam>("create_exam", { name, guide, kind }),
  setExamSchedule: (examId: string, slots: Slot[]) => invoke<Exam>("set_exam_schedule", { examId, slots }),
  createLanguagePath: (lang: Lang, level: string, goal: string) => invoke<Exam>("create_language_path", { lang, level, goal }),
  recordExercise: (examId: string, topicId: string) => invoke<Exam>("record_exercise", { examId, topicId }),
  deleteExam: (id: string) => invoke<void>("delete_exam", { id }),
  findExamGuide: (name: string) => invoke<FoundGuide>("find_exam_guide", { name }),
  studyTopic: (examId: string, topicId: string) => invoke<Session>("study_topic", { examId, topicId }),
  /** `minutes` null: untimed. */
  createMock: (examId: string, count: number, minutes: number | null, focus: MockFocus | null = null) =>
    invoke<Exam>("create_mock", { examId, count, minutes, focus }),
  createCheatSheet: (examId: string) => invoke<Exam>("create_cheat_sheet", { examId }),
  explainQuestion: (examId: string, question: ExamQuestion, chosen: number[], history: ExplainTurn[], ask: string) =>
    invoke<string>("explain_question", { examId, question, chosen, history, ask }),
  reportQuestion: (examId: string, mockId: string, questionId: string, reason: string) =>
    invoke<Exam>("report_question", { examId, mockId, questionId, reason }),
  reportReview: (examId: string, reviewId: string) => invoke<Exam>("report_review", { examId, reviewId }),
  setExamGoal: (examId: string, goal: ExamGoal) => invoke<Exam>("set_exam_goal", { examId, goal }),
  answerReview: (examId: string, reviewId: string, choice: number[]) => invoke<Exam>("answer_review", { examId, reviewId, choice }),
  submitMock: (examId: string, mockId: string, answers: number[][]) => invoke<Exam>("submit_mock", { examId, mockId, answers }),
};

/** Code console: runs only on the learner's explicit "Ejecutar". */
export const codeApi = {
  runtimes: (refresh = false) => invoke<Runtime[]>("code_runtimes", { refresh }),
  /** `tests`: an exercise's hidden tests, joined by the backend in the order the language needs. */
  run: (lang: Lang, code: string, stdin: string, tests?: string) => invoke<RunResult>("run_code", { lang, code, stdin, tests: tests ?? null }),
  explain: (lang: Lang, code: string, output: string, ask: string) => invoke<string>("explain_code", { lang, code, output, ask }),
  review: (lang: Lang, code: string, focus: string) => invoke<string>("review_code", { lang, code, focus }),
  exercise: (lang: Lang, topic: string, level: string) => invoke<CodeExercise>("generate_code_exercise", { lang, topic, level }),
  /** Saves an explained error as a flashcard in "Errores de <lenguaje>"; returns how many were added (0 = already there). */
  saveCard: (lang: Lang, front: string, back: string, today: string) => invoke<number>("save_code_card", { lang, front, back, today }),
};

/** Study log: minutes of finished focus blocks, per local day. */
export const studyApi = {
  log: (day: string, minutes: number, context: StudyContext | null) => invoke<StudyEntry>("log_study", { entry: { day, minutes, context } }),
  since: (since: string) => invoke<StudyEntry[]>("study_log", { since }),
};

/** AC-146, AC-147: recorded classes. */
export const classesApi = {
  list: () => invoke<ClassSummary[]>("class_list"),
  get: (id: string) => invoke<ClassRecord>("class_get", { id }),
  start: (title: string, courseId: string | null, day: string) => invoke<ClassRecord>("class_start", { title, courseId, day }),
  append: (id: string, text: string, seconds: number) => invoke<ClassRecord>("class_append", { id, text, seconds }),
  rename: (id: string, title: string) => invoke<ClassRecord>("class_rename", { id, title }),
  remove: (id: string) => invoke<void>("class_delete", { id }),
  notes: (id: string, today: string) => invoke<ClassRecord>("class_notes", { id, today }),
};

/** AC-141: the days with study, for the streak on the home panel. */
export const activityApi = {
  days: (since: string) => invoke<DayActivity[]>("activity_days", { since }),
};

/** Harness audit M5/M10: what the app learned about the learner; viewable and erasable. */
export const companionApi = {
  state: () => invoke<CompanionView>("companion_state"),
  acknowledge: () => invoke<CompanionView>("companion_ack_privacy"),
  send: (text: string) => invoke<CompanionView>("companion_send", { text }),
  newConversation: () => invoke<CompanionView>("companion_new_conversation"),
  proposeEntry: () => invoke<EntryDraft>("companion_propose_entry"),
  saveEntry: (input: EntryDraft) => invoke<CompanionView>("companion_save_entry", { input }),
  deleteEntry: (id: string) => invoke<CompanionView>("companion_delete_entry", { id }),
  checkin: (mood: number, emotions: string[], note: string) => invoke<CompanionView>("companion_checkin", { mood, emotions, note }),
  setInsight: (key: string, verdict: "confirmed" | "rejected" | null) => invoke<CompanionView>("companion_set_insight", { key, verdict }),
  unlock: (pin: string) => invoke<CompanionView>("companion_unlock", { pin }),
  lock: () => invoke<CompanionView>("companion_lock"),
  setPin: (newPin: string | null, current: string | null) => invoke<CompanionView>("companion_set_pin", { newPin, current }),
  saveResources: (resources: HelpResource[]) => invoke<CompanionView>("companion_save_resources", { resources }),
  exportAll: () => invoke<string>("companion_export"),
  erase: () => invoke<CompanionView>("companion_erase"),
};

export const academicApi = {
  state: () => invoke<AcademicData>("academic_state"),
  saveTerm: (input: TermInput) => invoke<AcademicData>("academic_save_term", { input }),
  deleteTerm: (id: string) => invoke<AcademicData>("academic_delete_term", { id }),
  setActive: (id: string) => invoke<AcademicData>("academic_set_active", { id }),
  saveCourse: (input: CourseInput) => invoke<AcademicData>("academic_save_course", { input }),
  deleteCourse: (id: string) => invoke<AcademicData>("academic_delete_course", { id }),
  saveDate: (input: DateInput) => invoke<AcademicData>("academic_save_date", { input }),
  deleteDate: (id: string) => invoke<AcademicData>("academic_delete_date", { id }),
  /** AC-145: holidays and weeks without classes. */
  addBreaks: (termId: string, items: BreakInput[]) => invoke<AcademicData>("academic_add_breaks", { termId, items }),
  deleteBreak: (termId: string, id: string) => invoke<AcademicData>("academic_delete_break", { termId, id }),
  /** AC-150: link a course to its study route (null unlinks); the route takes the course's next exam date. */
  linkRoute: (courseId: string, examId: string | null) => invoke<AcademicData>("academic_link_route", { courseId, examId }),
  /** Applies a proposal the person confirmed. */
  importProposal: (proposal: Proposal) => invoke<{ data: AcademicData; report: ImportReport }>("academic_import", { proposal }),
  /** Reads a pasted timetable into a proposal (not saved). */
  parse: (text: string) => invoke<Proposal>("academic_parse", { text }),
};

export const identityApi = {
  get: () => invoke<Identity>("get_identity"),
  save: (input: Identity) => invoke<Identity>("save_identity", { input }),
};

export const accessibilityApi = {
  get: () => invoke<Accessibility>("get_accessibility"),
  save: (input: Accessibility) => invoke<Accessibility>("save_accessibility", { input }),
};

export const learnerApi = {
  get: () => invoke<LearnerProfile>("get_learner"),
  forget: (kind: "misconception" | "preference" | "all", index = 0) => invoke<LearnerProfile>("forget_learner", { kind, index }),
};

/** AC-65: listening and speaking practice. */
export const languageApi = {
  listening: (language: string, level: string, topic: string) => invoke<Listening>("generate_listening", { language, level, topic }),
  transcribe: (audio: number[], mime: string, language: string) => invoke<string>("transcribe_audio", { audio, mime, language }),
  speakingFeedback: (input: SpeakingInput) => invoke<string>("speaking_feedback", { input }),
};

/** AC-111..113: what Eureka knows about the person, and the plan for today. */
export const studentApi = {
  model: () => invoke<StudentModel>("student_model"),
  today: () => invoke<Suggestion[]>("student_today"),
  markKnown: (name: string) => invoke<StudentModel>("student_mark_known", { name }),
};

/** AC-106/AC-185: speech on this PC (Parakeet v3 or Whisper), downloaded on request (no internet or key afterwards). */
export const localSpeechApi = {
  status: () => invoke<LocalSpeechModel[]>("local_speech_status"),
  download: (model: string, onProgress: (p: { done: number; total: number }) => void) => {
    const ch = new Channel<{ done: number; total: number }>();
    ch.onmessage = onProgress;
    return invoke<LocalSpeechModel[]>("local_speech_download", { model, onProgress: ch });
  },
  remove: (model: string) => invoke<LocalSpeechModel[]>("local_speech_remove", { model }),
};

/** AC-64: multi-file projects; run/test only on the learner's click. */
export const projectApi = {
  list: () => invoke<ProjectSummary[]>("list_projects"),
  get: (id: string) => invoke<Project>("get_project", { id }),
  save: (project: Project) => invoke<Project>("save_project", { project }),
  remove: (id: string) => invoke<void>("delete_project", { id }),
  run: (lang: Lang, files: ProjectFile[], mode: "run" | "test", stdin: string) => invoke<RunResult>("run_project", { lang, files, mode, stdin }),
  generate: (lang: Lang, topic: string, level: string) => invoke<Project>("generate_project", { lang, topic, level }),
};

/** AC-69…71: the library, converted on this PC and searched locally (BM25). */
export const libraryApi = {
  list: () => invoke<BookSummary[]>("list_books"),
  get: (id: string) => invoke<Book>("get_book", { id }),
  import: (title: string, fileName: string, markdown: string, pages: number, scanned: number[]) => invoke<BookSummary>("import_book", { title, fileName, markdown, pages, scanned }),
  remove: (id: string) => invoke<null>("delete_book", { id }),
  search: (query: string, limit = 10) => invoke<LibraryHit[]>("search_library", { query, limit }),
};

/** AC-155…157: la malla de la carrera. */
export const careerApi = {
  get: () => invoke<CareerView | null>("career_get"),
  parse: (text: string) => invoke<CareerProposal>("career_parse", { text }),
  savePlan: (proposal: CareerProposal) => invoke<CareerView | null>("career_save_plan", { proposal }),
  saveSubject: (input: CareerSubjectInput) => invoke<CareerView | null>("career_save_subject", { input }),
  deleteSubject: (id: string) => invoke<CareerView | null>("career_delete_subject", { id }),
  remove: () => invoke<null>("career_delete"),
};

/** AC-63: transcribes photos or scanned pages (data URLs) with the teacher's model. */
export const visionApi = {
  read: (images: string[], purpose: "guide" | "notes" | "timetable" | "curriculum" | "problems") => invoke<string>("read_images", { images, purpose }),
};

/** AC-186: tokens spent per call, kept only on this PC. */
export const usageApi = {
  summary: () => invoke<UsageSummary>("usage_summary"),
};

/** Backup of all learning data (never the API keys). */
export const backupApi = {
  /** Writes the .zip to Downloads; returns its path. */
  create: () => invoke<string>("create_backup"),
  /** Returns how many files were restored. */
  restore: (bytes: number[]) => invoke<number>("restore_backup", { bytes }),
};

/** Flashcards: `today` is the learner's local date (YYYY-MM-DD). */
export const cardsApi = {
  listDecks: (today: string) => invoke<DeckSummary[]>("list_decks", { today }),
  getDeck: (id: string) => invoke<Deck>("get_deck", { id }),
  createDeck: (name: string) => invoke<Deck>("create_deck", { name }),
  generateDeck: (name: string, source: CardSource, count: number, today: string) => invoke<Deck>("generate_deck", { name, source, count, today }),
  deleteDeck: (id: string) => invoke<void>("delete_deck", { id }),
  saveCard: (deckId: string, cardId: string | null, front: string, back: string, today: string) =>
    invoke<Deck>("save_card", { deckId, cardId, front, back, today }),
  deleteCard: (deckId: string, cardId: string) => invoke<Deck>("delete_card", { deckId, cardId }),
  gradeCard: (deckId: string, cardId: string, grade: Grade, today: string) => invoke<Deck>("grade_card", { deckId, cardId, grade, today }),
  /** Returns the new deck's id. */
  importCards: (name: string, cards: [string, string][], today: string) => invoke<string>("import_cards", { name, cards, today }),
  /** AC-152: the file goes as the raw body (an .apkg can weigh hundreds of MB). */
  readApkg: (bytes: Uint8Array) => invoke<AnkiPackage>("read_apkg", bytes),
  /** AC-153: writes the .apkg in Downloads; returns its path. */
  exportApkg: (deckId: string) => invoke<string>("export_apkg", { deckId }),
  /** AC-154: writes the `.eureka` in Downloads; returns its path. */
  shareDeck: (deckId: string) => invoke<string>("share_deck", { deckId }),
  readShared: (bytes: Uint8Array) => invoke<SharedDeckIncoming>("read_shared_deck", bytes),
  /** AC-154: the `.eureka` Eureka was opened with (double click), once. */
  openedDeck: () => invoke<SharedDeckIncoming | null>("opened_deck"),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
