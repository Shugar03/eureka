// Fake Rust backend for browser runs (`vite --mode e2e`): every `invoke` is
// answered here through @tauri-apps/api/mocks, with an in-memory store and a
// SCRIPTED teacher. Deterministic and free — no model calls. Only bundled in
// e2e mode (see main.tsx).
//
// The script teaches "qué es una derivada" in a fixed arc that exercises
// every phase and tool: probe (2 questions) → plan → teach 2 nodes
// (predict + check each, with one repair) → done.
//
// Query flags on the first page load:
//   ?unconfigured  start without model/API key (onboarding flows)
//   ?fail          the agent fails like a missing API key would
//   ?failExtract   the extractor fails (the graph must stay as it was)
//   ?failGradeOnce the first practice grading fails (nothing may be lost)
//   ?noSearch      web search is not configured
//   ?failMockOnce  the first mock-exam generation fails
//   ?disputeOne    the checker disagrees with the 1st question of each mock (it is dropped)
//   ?noSpeech      no speech model configured (speaking explains how)
//   ?withProfile   the learner profile has a confusion and a preference
//   ?noRust        Rust is not installed (the console explains how to install it)
//   ?shortTime     a timed mock lasts 3 seconds per "minute" (to see the clock run out)
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import type {
  Accessibility,
  CareerProposal,
  CareerSubject,
  CareerSubjectInput,
  CareerView,
  ClassRecord,
  BreakInput,
  StudentModel,
  Suggestion,
  TopicState,
  AcademicData,
  CourseInput,
  DateInput,
  Proposal,
  TermInput,
  Identity,
  CompanionTurn,
  EntryDraft,
  HelpResource,
  JournalEntry,
  ThoughtRecord,
  Book,
  AgentEvent,
  CardSource,
  Deck,
  Grade,
  LearnerProfile,
  Project,
  Lang,
  StudyEntry,
  Exam,
  ExamSummary,
  LearnerInput,
  Msg,
  NodeStatus,
  Phase,
  PlanNode,
  PracticeSet,
  PracticeSummary,
  PromptView,
  ResearchMeta,
  Session,
  SessionSummary,
  SettingsInput,
  SettingsView,
  ToolCall,
} from "../types";
import { nextStep, timetableProposal, type Call, type TeacherView } from "./teacherScript";
import { applyImport, emptyAcademic } from "./academicMock";
import { NOTES_HEADER, scriptedExtraction } from "./extractScript";
import { fold, type LedgerLine } from "./graphFold";
import * as lib from "./libraryScript";
import { scriptedGrade, scriptedProblems } from "./practiceScript";
import { isRight } from "../lib/exam";
import { DEFAULT_ACCESSIBILITY } from "../lib/accessibility";
import { scriptedExplain } from "./examScript";
import { scriptedCards } from "./cardsScript";
import { scriptedExercise, scriptedRun } from "./codeScript";
import { langLabel, withTests } from "../lib/code";
import { review as reviewCard } from "../lib/cards";
import { SAMPLE_GUIDE } from "./examScript";
import { allocate, GUIDE_HITS, normalizeWeights, parseGuide, scriptedFoundGuide, scriptedQuestions } from "./examScript";
import shared from "../../src-tauri/prompts/shared.md?raw";
import probe from "../../src-tauri/prompts/probe.md?raw";
import plan from "../../src-tauri/prompts/plan.md?raw";
import teach from "../../src-tauri/prompts/teach.md?raw";
import done from "../../src-tauri/prompts/done.md?raw";
import extract from "../../src-tauri/prompts/extract.md?raw";
import practiceGenerate from "../../src-tauri/prompts/practice_generate.md?raw";
import practiceGrade from "../../src-tauri/prompts/practice_grade.md?raw";
import researchPrompt from "../../src-tauri/prompts/research.md?raw";
import examSyllabus from "../../src-tauri/prompts/exam_syllabus.md?raw";
import examQuestions from "../../src-tauri/prompts/exam_questions.md?raw";
import examGuide from "../../src-tauri/prompts/exam_guide.md?raw";
import examCheatSheet from "../../src-tauri/prompts/exam_cheat_sheet.md?raw";
import examCheck from "../../src-tauri/prompts/exam_check.md?raw";
import examExplain from "../../src-tauri/prompts/exam_explain.md?raw";
import cardsGenerate from "../../src-tauri/prompts/cards_generate.md?raw";
import codeExplain from "../../src-tauri/prompts/code_explain.md?raw";
import codeExercise from "../../src-tauri/prompts/code_exercise.md?raw";

const DEFAULT_PROMPTS: Record<string, string> = {
  shared,
  probe,
  plan,
  teach,
  done,
  extract,
  practice_generate: practiceGenerate,
  practice_grade: practiceGrade,
  research: researchPrompt,
  exam_syllabus: examSyllabus,
  exam_questions: examQuestions,
  exam_guide: examGuide,
  exam_cheat_sheet: examCheatSheet,
  exam_check: examCheck,
  exam_explain: examExplain,
  cards_generate: cardsGenerate,
  code_explain: codeExplain,
  code_exercise: codeExercise,
};
const DELAY = Number(import.meta.env.VITE_E2E_DELAY ?? 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const params = new URLSearchParams(location.search);
const failMode = params.has("fail");
const failExtract = params.has("failExtract");
let failGrade = params.has("failGradeOnce");
const noSearch = params.has("noSearch");
/** AC-154: Eureka "opened" with a shared deck (double click), handed over once. */
let openedDeck = params.has("openedDeck");
const SHARED_SAMPLE = { name: "Repaso de Biología", cards: [["¿Qué hace la mitocondria?", "Produce la energía de la célula (ATP)."], ["¿Qué es un ribosoma?", "El orgánulo que sintetiza proteínas."]] as [string, string][], skipped: 1 };
const textOf = (raw: unknown) => new TextDecoder().decode(raw as Uint8Array);

// ── AC-155…157: la malla (the real rules live in career.rs; this is enough for the screens) ──
const SAMPLE_CURRICULUM_TEXT = "Ingeniería en Sistemas de Información — UTN FRBA\n1.º año\nAnálisis Matemático I (AM1)\nÁlgebra y Geometría Analítica (AGA)\n2.º año\nAnálisis Matemático II — correlativas: AM1, AGA\n3.º año\nProbabilidad y Estadística — correlativas: Análisis Matemático II";
const SAMPLE_CAREER: CareerProposal = {
  name: "Ingeniería en Sistemas de Información",
  institution: "UTN FRBA",
  subjects: [
    { name: "Análisis Matemático I", code: "AM1", year: 1, term: 1 },
    { name: "Álgebra y Geometría Analítica", code: "AGA", year: 1, term: 2 },
    { name: "Análisis Matemático II", code: "AM2", year: 2, para_cursar: ["AM1", "AGA"], para_rendir: ["AM1"] },
    { name: "Probabilidad y Estadística", year: 3, para_cursar: ["Análisis Matemático II"], para_rendir: ["Análisis Matemático II"] },
  ],
};
let career: CareerSubject[] | null = null;
let careerHead = { name: "", institution: "" };
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function cursadaKeys(): string[] {
  const a = store.academic;
  return a.courses.filter((c) => c.term_id === a.active_term).flatMap((c) => [norm(c.name), norm(c.code ?? "")]).filter(Boolean);
}
function careerView(cursada: string[]): CareerView | null {
  if (!career) return null;
  const all = career;
  const byId = new Map(all.map((s) => [s.id, s]));
  const regular = (id: string) => ["regular", "aprobada"].includes(byId.get(id)?.status ?? "aprobada");
  const passed = (id: string) => (byId.get(id)?.status ?? "aprobada") === "aprobada";
  const grades = all.filter((s) => s.status === "aprobada" && s.grade != null).map((s) => s.grade!);
  const failed = all.flatMap((s) => s.failed);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return {
    ...careerHead,
    subjects: all.map((s) => ({
      ...s,
      can_take: s.status === "pendiente" && s.para_cursar.every(regular),
      can_sit_final: s.status === "regular" && s.para_rendir.every(passed),
      missing: (s.status === "pendiente" ? s.para_cursar.filter((id) => !regular(id)) : s.status === "aprobada" ? [] : s.para_rendir.filter((id) => !passed(id))).map((id) => byId.get(id)!.name),
      in_cursada: cursada.includes(norm(s.name)) || (!!s.code && cursada.includes(norm(s.code))),
    })),
    approved: all.filter((s) => s.status === "aprobada").length,
    total: all.length,
    average: mean(grades),
    average_with_failed: failed.length ? mean([...grades, ...failed]) : null,
  };
}
let failMock = params.has("failMockOnce");
const shortTime = params.has("shortTime");
const disputeOne = params.has("disputeOne");

const CRISIS_REPLY = "Gracias por contármelo. Lo que decís me importa y quiero tomarlo en serio.\n\n¿Estás pensando en hacerte daño o en quitarte la vida? Si es así, no tenés que atravesar esto sin compañía: abajo te dejé líneas donde te atiende una persona, y si estás en peligro ahora, llamá a emergencias.";
const COMPANION_REPLIES = ["Suena a que venís cargado. ¿Qué fue lo más pesado de hoy?", "Tiene sentido que te sientas así. ¿Y qué te ayudó, aunque sea un poco?", "Gracias por contármelo. Acá sigo, sin apuro."];
const DEFAULT_HELP: HelpResource[] = [
  { name: "Centro de Asistencia al Suicida (Argentina)", detail: "Línea 135 (gratis desde CABA y el Gran Buenos Aires) · (011) 5275-1135 desde todo el país" },
  { name: "Emergencias", detail: "911 en Argentina." },
];
/** Mi cursada lives on disk in the real app; the demo keeps it in localStorage so a reload remembers it too. */
const MOCK_ACADEMIC_KEY = "la.mock.academic";
/** Local day `n` days from now, YYYY-MM-DD. */
function dayFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** AC-140: `?panel` — a term with a class today, dates coming up and two grades. */
function panelAcademic(): AcademicData {
  const wd = ((new Date().getDay() + 6) % 7) + 1;
  const slot = (start: string, end: string) => ({ weekday: wd, start, end, room: "", kind: "teoria" as const });
  return {
    terms: [{ id: "t-panel", name: "2.º cuatrimestre", kind: "cuatrimestre", start: null, end: null }],
    courses: [
      { id: "c-an", term_id: "t-panel", name: "Análisis II", code: "", professor: "", room: "Aula 12", notes: "", color: 2, slots: [slot("00:00", "00:01"), slot("23:58", "23:59")] },
      { id: "c-fi", term_id: "t-panel", name: "Física I", code: "", professor: "", room: "Lab 3", notes: "", color: 5, slots: [] },
    ],
    dates: [
      { id: "dp1", term_id: "t-panel", course_id: "c-fi", kind: "parcial", title: "Primer parcial", date: dayFromNow(3), time: null, notes: "", done: false, grade: null },
      { id: "dp2", term_id: "t-panel", course_id: "c-an", kind: "entrega", title: "TP 2", date: dayFromNow(1), time: null, notes: "", done: false, grade: null },
      { id: "dp3", term_id: "t-panel", course_id: "c-an", kind: "parcial", title: "Parcial 1", date: dayFromNow(-20), time: null, notes: "", done: true, grade: 7 },
      { id: "dp4", term_id: "t-panel", course_id: "c-an", kind: "tp", title: "TP 1", date: dayFromNow(-30), time: null, notes: "", done: true, grade: 8 },
    ],
    active_term: "t-panel",
  };
}
/** AC-141: `?streak` — the last six days studied, one of them taken as the rest day. */
function seedActivity(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  if (params.has("streak")) for (const n of [-1, -2, -4, -5, -6, -7]) m.set(dayFromNow(n), new Set(["chat"]));
  return m;
}
function classOf(id: string): ClassRecord {
  const c = store.classes.get(id);
  if (!c) throw "Esa clase ya no existe.";
  return c;
}
function touch(kind: string) {
  const day = dayFromNow(0);
  store.activity.set(day, (store.activity.get(day) ?? new Set<string>()).add(kind));
}
function loadMockAcademic(): AcademicData {
  if (params.has("panel")) return panelAcademic();
  try {
    return { ...emptyAcademic(), ...JSON.parse(localStorage.getItem(MOCK_ACADEMIC_KEY) ?? "{}") };
  } catch {
    return emptyAcademic();
  }
}
/** AC-150: each linked route takes its course's next parcial, recuperatorio or final. */
function syncRoutes() {
  const today = dayFromNow(0);
  for (const c of store.academic.courses) {
    const e = c.exam_id ? store.exams.get(c.exam_id) : undefined;
    if (!e) continue;
    const next = store.academic.dates
      .filter((x) => x.course_id === c.id && !x.done && x.date >= today && ["parcial", "recuperatorio", "final"].includes(x.kind))
      .map((x) => x.date)
      .sort()[0];
    e.goal = { ...e.goal, exam_date: next ?? null };
  }
}
function academicDone(): AcademicData {
  syncRoutes();
  try {
    localStorage.setItem(MOCK_ACADEMIC_KEY, JSON.stringify(store.academic));
  } catch {
    /* private mode */
  }
  return clone(store.academic);
}

/** The real backend keeps the profile on disk; the demo keeps it in localStorage so a reload remembers it too. */
const MOCK_IDENTITY_KEY = "la.mock.identity";
function loadMockIdentity(): Identity {
  const base: Identity = { first_name: "", last_name: "", school: "", career: "", age: null, treatment: "", treatment_other: "", onboarded: !params.has("onboarding") };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(MOCK_IDENTITY_KEY) ?? "{}") };
  } catch {
    return base;
  }
}
function saveMockIdentity(i: Identity) {
  try {
    localStorage.setItem(MOCK_IDENTITY_KEY, JSON.stringify(i));
  } catch {
    /* private mode */
  }
}
/** Three weeks of check-ins: Sundays are hard (and anxious), the rest are fine, walking helps. */
function seedJournal(): JournalEntry[] {
  const now = new Date();
  return Array.from({ length: 21 }, (_, daysAgo) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
    const sunday = d.getDay() === 0;
    return {
      id: `seed${daysAgo}`,
      at: d.toISOString(),
      kind: "checkin" as const,
      title: "Check-in",
      text: "",
      mood: sunday ? 1 : daysAgo % 5 === 0 ? 5 : 4,
      emotions: sunday ? ["ansiedad"] : ["calma"],
      helped: daysAgo % 3 === 0 ? ["caminar"] : [],
    };
  });
}
function freshCompanion() {
  const seeded = params.has("companionSeed");
  return {
    ack: params.has("companionReady") || seeded,
    pin: null as string | null,
    unlocked: false,
    turns: [] as CompanionTurn[],
    risk: false,
    entries: seeded ? seedJournal() : ([] as JournalEntry[]),
    insights: {} as Record<string, "confirmed" | "rejected">,
    resources: DEFAULT_HELP.map((r) => ({ ...r })),
  };
}
/** Same text the app writes for a thought record. */
function thoughtText(r: ThoughtRecord): string {
  const out = [`Situación: ${r.situation}`, `Pensé: ${r.thought} (${r.before}/100)`];
  if (r.for_it) out.push(`Lo que lo apoya: ${r.for_it}`);
  if (r.against) out.push(`Lo que no encaja: ${r.against}`);
  if (r.alternative) out.push(`Otra mirada: ${r.alternative}`);
  if (r.after !== null && r.after !== undefined) out.push(`Después, la intensidad: ${r.after}/100`);
  return out.join("\n");
}
function companionGuard() {
  if (store.companion.pin !== null && !store.companion.unlocked) throw "El diario está bloqueado. Ingresá tu PIN.";
}
function companionView() {
  const c = store.companion;
  const locked = c.pin !== null && !c.unlocked;
  return clone({ locked, has_pin: c.pin !== null, privacy_ack: c.ack, resources: c.resources, conversation: locked ? { turns: [], risk: false } : { turns: c.turns, risk: c.risk }, entries: locked ? [] : c.entries, insights: locked ? {} : c.insights });
}

const store = {
  sessions: new Map<string, Session>(),
  prompts: {} as Record<string, string>,
  ledger: [] as LedgerLine[],
  books: new Map<string, Book>(),
  practice: new Map<string, PracticeSet>(),
  exams: new Map<string, Exam>(),
  decks: new Map<string, Deck>(),
  study: [] as StudyEntry[],
  activity: seedActivity(),
  classes: new Map<string, ClassRecord>(),
  projects: new Map<string, Project>(),
  learner: {
    misconceptions: params.has("withProfile") ? [{ concept: "Recta secante", wrong_idea: "toca la curva en un solo punto", fixed: false, source: "Sesión: derivadas", at: "" }] : [],
    preferences: params.has("withProfile") ? [{ text: "entiende mejor con ejemplos numéricos", source: "Sesión: derivadas", at: "" }] : [],
  } as LearnerProfile,
  keys: new Set<string>(params.has("unconfigured") ? [] : ["openrouter", ...(params.has("noSearch") ? [] : ["search"])]),
  searchUrl: "https://api.tavily.com",
  identity: loadMockIdentity(),
  academic: loadMockAcademic(),
  companion: freshCompanion(),
  accessibility: {
    ...DEFAULT_ACCESSIBILITY,
    ...(params.has("a11y") ? { read_aloud: true, dictation: true, easy_reading: true } : {}),
  } as Accessibility,
  settings: {
    providers: [
      { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
      { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1" },
      { id: "anthropic", label: "Anthropic", base_url: "https://api.anthropic.com/v1" },
      { id: "opencode-go", label: "OpenCode Go", base_url: "https://opencode.ai/inference/go/v1" },
    ],
    roles: params.has("unconfigured")
      ? { teacher: { provider_id: "", model: "" }, prober: { provider_id: "", model: "" }, extractor: { provider_id: "", model: "" }, practice: { provider_id: "", model: "" }, researcher: { provider_id: "", model: "" }, speech: { provider_id: "", model: "" } }
      : { teacher: { provider_id: "openrouter", model: "demo/profesor" }, prober: { provider_id: "", model: "" }, extractor: { provider_id: "", model: "" }, practice: { provider_id: "", model: "" }, researcher: { provider_id: "", model: "" }, speech: params.has("noSpeech") ? { provider_id: "", model: "" } : { provider_id: "openrouter", model: "demo/whisper" } },
  },
};

let seq = 0;
const nid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const clone = <T>(v: T): T => structuredClone(v);

function settingsView(): SettingsView {
  return {
    providers: store.settings.providers.map((p) => ({ ...p, has_key: store.keys.has(p.id) })),
    roles: clone(store.settings.roles),
    search: { base_url: store.searchUrl, has_key: store.keys.has("search") },
    data_dir: "C:\\Users\\demo\\AppData\\Roaming\\lat.eureka.app",
  };
}

function summary(s: Session): SessionSummary {
  return {
    id: s.id,
    title: s.title,
    goal: s.goal,
    phase: s.phase,
    updated_at: s.updated_at,
    plan_total: s.plan.filter((n) => n.status !== "known").length,
    plan_done: s.plan.filter((n) => n.status === "understood").length,
    archived: !!s.archived,
    pinned: !!s.pinned,
  };
}

// ── The scripted teacher (shared) ───────────────────────────────────────────

function view(s: Session, lastAnswer: string | null, afterLearner: boolean): TeacherView {
  const last = s.messages[s.messages.length - 1];
  return {
    afterResearch: last?.role === "tool" && last.meta?.kind === "research",
    phase: s.phase,
    answered: s.messages.filter((m) => m.role === "tool" && m.meta?.kind === "answer").length,
    status: (id) => s.plan.find((n) => n.id === id)?.status,
    lastAnswer,
    afterLearner,
  };
}

function applyCall(s: Session, c: Call) {
  const a = c.args as Record<string, never>;
  switch (c.name) {
    case "begin_learning":
      s.goal = String(a.goal);
      s.title = String(a.goal).slice(0, 80);
      s.phase = "probe";
      return "ok";
    case "propose_action":
      return "ok";
    case "show_diagram":
    case "show_demo":
      return "ok";
    case "research":
      return "research";
    case "ask_question":
      return "await";
    case "record_finding":
      s.findings = s.findings.filter((f) => f.concept !== a.concept).concat([{ concept: a.concept, level: a.level, evidence: a.evidence }]);
      return "ok";
    case "set_plan":
      s.plan = (a.nodes as unknown as PlanNode[]).map((n) => ({ ...n, note: "" }));
      return "ok";
    case "update_node": {
      if (a.status === "current") s.plan.forEach((n) => n.status === "current" && (n.status = "pending"));
      const n = s.plan.find((x) => x.id === a.id);
      if (n) {
        n.status = a.status as NodeStatus;
        if (a.note) n.note = a.note;
      }
      return "ok";
    }
    case "set_phase":
      s.phase = a.phase as Phase;
      return "ok";
  }
  return "ok";
}

function addInput(s: Session, input: LearnerInput) {
  const meta = { kind: "answer" as const, text: input.text, confidence: input.confidence ?? null, thinking: input.thinking ?? "", ...(input.free ? { free: true } : {}), ...(input.reading?.trim() ? { reading: input.reading.trim() } : {}) };
  if (s.pending_question) {
    s.messages.push({ role: "tool", tool_call_id: s.pending_question, content: input.text, meta });
    s.pending_question = null;
  } else s.messages.push({ role: "user", content: input.text, meta });
}

async function runTurn(id: string, input: LearnerInput | null, ch: Channel<AgentEvent>) {
  const emit = (e: AgentEvent) => ch.onmessage(e);
  const s = store.sessions.get(id);
  if (!s) throw "sesión no encontrada";
  if (input?.text.trim()) {
    addInput(s, input);
    emit({ type: "session", session: clone(s) });
  }
  await sleep(DELAY * 10);
  if (failMode) {
    const msg = "Falta la API key de OpenRouter. Cargala en Ajustes.";
    emit({ type: "error", message: msg });
    emit({ type: "done" });
    throw msg;
  }
  // A kickoff has no input: the first message is already in the session, so read it from there.
  const lastAnswer = input?.text ?? [...s.messages].reverse().find((m) => m.role === "user")?.content ?? null;
  for (let i = 0; i < 4 && !s.pending_question; i++) {
    const step = nextStep(view(s, lastAnswer, i === 0));
    if (!step) break;
    // Stream the text word by word so a headed run shows real streaming.
    if (step.text) {
      for (const w of step.text.split(/(?<= )/)) {
        emit({ type: "text", delta: w });
        await sleep(DELAY);
      }
    }
    const calls: ToolCall[] = (step.calls ?? []).map((c) => ({
      id: `call_${nid()}`,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    s.messages.push({ role: "assistant", content: step.text ?? null, tool_calls: calls.length ? calls : undefined } as Msg);
    for (const [j, c] of (step.calls ?? []).entries()) {
      // A control the person asked for reaches the screen as it happens (AC-122).
      if (c.name === "ui_command") emit({ type: "ui", command: c.args as never });
      const outcome = applyCall(s, c);
      if (outcome === "await") s.pending_question = calls[j].id;
      else if (outcome === "research") {
        // AC-169: with search configured it runs in the background and arrives later.
        const done = mockResearch(String(c.args.question));
        const callId = calls[j].id;
        if (done.error) s.messages.push({ role: "tool", tool_call_id: callId, content: "investigación", meta: done });
        else {
          s.messages.push({ role: "tool", tool_call_id: callId, content: "investigación en curso", meta: { kind: "research", question: done.question, summary: "", sources: [], error: null, pending: true } });
          setTimeout(() => {
            const m = s.messages.find((x) => x.role === "tool" && x.tool_call_id === callId);
            if (m) {
              m.content = "investigación";
              m.meta = { ...done, told: false };
              s.updated_at = new Date().toISOString();
            }
          }, Math.max(DELAY * 15, 1500));
        }
      }
      else s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "ok" });
    }
    s.updated_at = new Date().toISOString();
    emit({ type: "session", session: clone(s) });
    if (!calls.length) break;
    await sleep(DELAY * 5);
  }
  emit({ type: "done" });
}

function mockResearch(question: string): ResearchMeta {
  if (noSearch || !store.keys.has("search"))
    return { kind: "research", question, summary: "", sources: [], error: "búsqueda web no configurada (Ajustes → Búsqueda web)" };
  return {
    kind: "research",
    question,
    summary: "La derivada mide el cambio instantáneo: la **velocidad** es la derivada de la posición [1] y el costo marginal es la derivada del costo [2].",
    sources: [
      { title: "Velocidad instantánea", url: "https://fisica.example/velocidad" },
      { title: "Costo marginal", url: "https://economia.example/marginal" },
    ],
    error: null,
  };
}

// ── Knowledge graph ──────────────────────────────────────────────────────────

let clock = 0;
async function runExtraction(source: LedgerLine["source"], input: string) {
  await sleep(DELAY * 10);
  if (failExtract) throw "el proveedor respondió 503: fake: extractor no disponible";
  const raw = scriptedExtraction(input);
  store.ledger.push({ source, at: ++clock, ...raw });
  return raw;
}

// ── Practice ────────────────────────────────────────────────────────────────

function practiceSummary(s: PracticeSet): PracticeSummary {
  return {
    id: s.id,
    title: s.title,
    updated_at: s.updated_at,
    total: Math.max(s.planned ?? 0, s.problems.length),
    done: s.problems.filter((p) => p.attempts.length).length,
    correct: s.problems.filter((p) => p.attempts[p.attempts.length - 1]?.verdict === "correct").length,
  };
}

function practiceSet(id: string): PracticeSet {
  const s = store.practice.get(id);
  if (!s) throw "práctica no encontrada";
  return s;
}

// ── Exams ───────────────────────────────────────────────────────────────────

function exam(id: string): Exam {
  const e = store.exams.get(id);
  if (!e) throw "examen no encontrado";
  return e;
}

function examSummary(e: Exam): ExamSummary {
  const topics = e.domains.flatMap((d) => d.topics);
  const last = [...e.mocks].reverse().find((m) => m.result)?.result;
  return {
    id: e.id,
    name: e.name,
    updated_at: e.updated_at,
    domains: e.domains.length,
    topics: topics.length,
    started: topics.filter((t) => t.session_id).length,
    last_score: last ? Math.round((1000 * last.correct) / last.total) / 10 : null,
    to_review: e.review.length,
    kind: e.kind,
    exam_date: e.goal.exam_date,
    schedule: e.schedule,
  };
}

/** Mirror of exam::grade: reported questions count for nothing. */
function mockGrade(e: Exam, questions: Exam["mocks"][number]["questions"], answers: number[][]) {
  const counted = questions.map((_, i) => i).filter((i) => !questions[i].reported);
  const right = (i: number) => isRight(questions[i].answer, answers[i] ?? []);
  return {
    answers,
    correct: counted.filter(right).length,
    total: counted.length,
    by_domain: e.domains
      .map((d) => {
        const idx = counted.filter((i) => questions[i].domain_id === d.id);
        return { domain_id: d.id, correct: idx.filter(right).length, total: idx.length };
      })
      .filter((s) => s.total),
    at: new Date().toISOString(),
    elapsed_secs: 0,
  };
}

function deck(id: string): Deck {
  const d = store.decks.get(id);
  if (!d) throw "mazo no encontrado";
  return d;
}

function addToNamedDeck(name: string, source: Deck["source"], cards: { front: string; back: string }[]): number {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  let d = [...store.decks.values()].find((x) => x.name === name && JSON.stringify(x.source) === JSON.stringify(source));
  if (!d) {
    const now = new Date().toISOString();
    d = { id: nid(), name, source, created_at: now, updated_at: now, cards: [] };
  }
  const seen = new Set(d.cards.map((c) => c.front.toLowerCase()));
  let added = 0;
  for (const c of cards) {
    if (!c.front.trim() || !c.back.trim() || seen.has(c.front.toLowerCase())) continue;
    seen.add(c.front.toLowerCase());
    d.cards.push(newCard(c.front, c.back, today));
    added++;
  }
  if (added) {
    d.updated_at = new Date().toISOString();
    store.decks.set(d.id, d);
  }
  return added;
}

function newCard(front: string, back: string, today: string) {
  return { id: nid(), front: front.trim(), back: back.trim(), ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today, reviewed: null };
}

function newSession(goal: string): Session {
  const now = new Date().toISOString();
  const s: Session = {
    id: nid(),
    title: goal.slice(0, 80),
    goal,
    phase: "probe",
    created_at: now,
    updated_at: now,
    findings: [],
    plan: [],
    pending_question: null,
    messages: [{ role: "user", content: `Quiero entender: ${goal}` }],
  };
  store.sessions.set(s.id, s);
  return s;
}

// ── IPC router ──────────────────────────────────────────────────────────────

// AC-106/AC-185: the local speech models (sizes as in the backend; Parakeet v3 is the default).
const LOCAL_MODELS = [
  { id: "parakeet-v3", label: "Mejor calidad (Parakeet v3)", bytes: 670_479_942 },
  { id: "whisper-tiny", label: "Liviano (Whisper tiny)", bytes: 151_061_672 },
  { id: "whisper-base", label: "Liviano, mejor (Whisper base)", bytes: 290_403_936 },
];
const localInstalled = new Set<string>();
const localSpeech = () => LOCAL_MODELS.map((m) => ({ ...m, installed: localInstalled.has(m.id) }));

// AC-110: the sessions that left something in memory, newest first.
const memories = () =>
  [...store.sessions.values()]
    .filter((s) => s.memory?.summary)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at, archived: !!s.archived, memory: s.memory! }));

// AC-111..112: a small student model from the mock's own data (confusions and finished sessions).
function studentModel(): StudentModel {
  const now = new Date().toISOString();
  const topics: TopicState[] = [
    ...store.learner.misconceptions.map((m) => ({ key: m.concept.toLowerCase(), name: m.concept, status: (m.fixed ? "practicando" : "le_cuesta") as TopicState["status"], evidence: [m.fixed ? `la confusión «${m.wrong_idea}» quedó reparada` : `confusión: ${m.wrong_idea}`], at: now, sources: ["confusión"], confusion: !m.fixed })),
    ...[...store.sessions.values()].filter((x) => x.phase === "done").map((x) => ({ key: x.goal.toLowerCase(), name: x.goal, status: "domina" as const, evidence: ["terminaste la sesión"], at: x.updated_at, sources: ["sesión"], confusion: false })),
  ];
  return { topics, pending: [], upcoming: [], preferences: store.learner.preferences.map((p) => p.text), cards_due: 0, minutes_7d: 0 };
}

function studentToday(): Suggestion[] {
  const open = store.learner.misconceptions.find((m) => !m.fixed);
  return open ? [{ title: `Repasá ${open.concept}`, reason: `confusión: ${open.wrong_idea}`, screen: "chat", target_id: null, prompt: `Quiero repasar ${open.concept}: la última vez me confundí.` }] : [];
}

export function install() {
  mockIPC(async (cmd, raw) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "companion_state":
        return companionView();
      case "companion_ack_privacy":
        store.companion.ack = true;
        return companionView();
      case "companion_send": {
        companionGuard();
        const text = String(args.text ?? "").trim();
        if (!text) throw "Escribí algo para empezar.";
        if (text.includes("FALLA")) throw "el proveedor respondió 500 Internal Server Error: boom";
        const c = store.companion;
        const risky = /quitarme la vida|suicid|no quiero vivir|quiero morirme/i.test(text);
        const asked = c.turns.filter((t) => t.role === "user").length;
        const reply = risky ? CRISIS_REPLY : COMPANION_REPLIES[Math.min(asked, COMPANION_REPLIES.length - 1)];
        await sleep(DELAY * 4);
        c.turns.push({ role: "user", text, at: new Date().toISOString() }, { role: "assistant", text: reply, at: new Date().toISOString() });
        c.risk ||= risky;
        return companionView();
      }
      case "companion_new_conversation":
        companionGuard();
        store.companion.turns = [];
        store.companion.risk = false;
        return companionView();
      case "companion_propose_entry": {
        companionGuard();
        if (store.companion.turns.filter((t) => t.role === "user").length < 2) throw "Todavía no hay mucho para guardar. Charlemos un poco más.";
        return { title: "Una semana de parciales", text: "Estuve muy cansado con los parciales. Salir a caminar me ayudó.", mood: 2, emotions: ["cansancio"], helped: ["salir a caminar"] };
      }
      case "companion_save_entry": {
        companionGuard();
        const i = args.input as EntryDraft;
        const rec = i.record ?? null;
        if (rec && (!rec.situation.trim() || !rec.thought.trim())) throw "Contá qué pasó y qué pensaste.";
        if (rec && (rec.before > 100 || (rec.after ?? 0) > 100)) throw "La intensidad va de 0 a 100.";
        const text = rec ? thoughtText(rec) : i.text.trim();
        if (!text) throw "Escribí algo para guardar.";
        const found = i.id ? store.companion.entries.find((e) => e.id === i.id) : undefined;
        if (found) Object.assign(found, { title: i.title || found.title, text, mood: i.mood ?? null, emotions: i.emotions, helped: i.helped, ...(rec ? { record: rec } : {}) });
        else store.companion.entries.unshift({ id: nid(), at: new Date().toISOString(), kind: rec ? "thought" : "entry", title: i.title || (rec ? "Registro de pensamientos" : "Mi día"), text, mood: i.mood ?? null, emotions: i.emotions, helped: i.helped, record: rec });
        return companionView();
      }
      case "companion_delete_entry":
        companionGuard();
        store.companion.entries = store.companion.entries.filter((e) => e.id !== args.id);
        return companionView();
      case "companion_checkin":
        companionGuard();
        store.companion.entries.unshift({ id: nid(), at: new Date().toISOString(), kind: "checkin", title: "Check-in", text: String(args.note ?? "").trim(), mood: args.mood as number, emotions: args.emotions as string[], helped: [] });
        return companionView();
      case "companion_set_insight": {
        companionGuard();
        const key = String(args.key ?? "");
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(key)) throw "Esa observación no es válida.";
        if (args.verdict === null || args.verdict === undefined) delete store.companion.insights[key];
        else store.companion.insights[key] = args.verdict as "confirmed" | "rejected";
        return companionView();
      }
      case "companion_unlock":
        if (store.companion.pin !== String(args.pin ?? "").trim()) throw "PIN incorrecto.";
        store.companion.unlocked = true;
        return companionView();
      case "companion_lock":
        store.companion.unlocked = false;
        return companionView();
      case "companion_set_pin": {
        const c = store.companion;
        if (c.pin !== null && c.pin !== (args.current ?? "")) throw "El PIN actual no es correcto.";
        const next = args.newPin as string | null;
        if (next !== null && (next.trim().length < 4 || next.trim().length > 12)) throw "El PIN debe tener entre 4 y 12 caracteres.";
        c.pin = next === null ? null : next.trim();
        c.unlocked = true;
        return companionView();
      }
      case "companion_save_resources":
        store.companion.resources = (args.resources as HelpResource[]).filter((r) => r.name.trim());
        return companionView();
      case "companion_export":
        companionGuard();
        return JSON.stringify({ entradas: store.companion.entries, conversacion: { turns: store.companion.turns, risk: store.companion.risk } }, null, 2);
      case "companion_erase":
        // Like the app: erasing takes back the privacy acknowledgement too.
        store.companion = { ...freshCompanion(), ack: false };
        return companionView();
      case "get_accessibility":
        return clone(store.accessibility);
      case "save_accessibility": {
        const a = args.input as Accessibility;
        store.accessibility = { ...a, speech_rate: Math.min(1.4, Math.max(0.6, a.speech_rate)) };
        return clone(store.accessibility);
      }
      // Distribution: the demo is a development build, it never updates itself.
      case "app_version":
        return "0.1.0";
      case "update_check":
        return { status: "off" };
      case "get_settings":
        return settingsView();
      case "save_settings": {
        const input = args.input as SettingsInput;
        for (const p of input.providers) {
          if (p.clear_key) store.keys.delete(p.id);
          else if (p.api_key?.trim()) store.keys.add(p.id);
        }
        store.settings.providers = input.providers.map(({ id, label, base_url }) => ({ id, label, base_url }));
        store.settings.roles = clone(input.roles);
        if (input.search) {
          store.searchUrl = input.search.base_url;
          if (input.search.clear_key) store.keys.delete("search");
          else if (input.search.api_key?.trim()) store.keys.add("search");
        }
        return settingsView();
      }
      // AC-158/159: the format decides the service; "mal" in the key fails like a bad key.
      case "quick_setup": {
        const key = String(args.key ?? "").trim().replace(/^Bearer /, "");
        if (key.length < 8) throw "Pegá la clave completa.";
        const guess = args.provider ? [String(args.provider)] : key.startsWith("oc_") ? ["opencode-go"] : key.startsWith("sk-or-") ? ["openrouter"] : key.startsWith("sk-") ? ["deepseek", "openai"] : [];
        if (guess.length !== 1) return { status: "choose", candidates: guess.length ? guess : store.settings.providers.map((p) => p.id), reason: guess.length ? "Esa clave puede ser de más de un servicio: elegí de cuál es (solo se la mando a ese)." : "No reconozco el formato de esa clave: elegí de qué servicio es." };
        await sleep(DELAY * 6);
        if (key.includes("mal")) throw "La clave no funcionó con ese servicio. Revisá que la copiaste completa, o elegí otro servicio.";
        const id = guess[0];
        if (!store.settings.providers.some((p) => p.id === id)) store.settings.providers.push({ id, label: id === "deepseek" ? "DeepSeek" : id, base_url: `https://${id}.test/v1` });
        store.keys.add(id);
        const model = id === "opencode-go" ? "deepseek-v4.1-flash" : "demo/profesor";
        store.settings.roles.teacher = { provider_id: id, model };
        const label = store.settings.providers.find((p) => p.id === id)!.label;
        return { status: "done", provider_id: id, provider: label, model, context_k: id === "openrouter" ? 128 : null, alternatives: ["deepseek-v4-pro", "glm-5.3"], speech_ready: !!store.settings.roles.speech.model, tools_ok: true };
      }
      case "list_models":
        if (!store.keys.has(args.providerId as string)) throw "falta la API key";
        return ["demo/profesor", "demo/rapido", "demo/vision"];
      case "list_sessions":
        return [...store.sessions.values()].map(summary).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated_at.localeCompare(a.updated_at));
      case "update_session_meta": {
        const s = store.sessions.get(args.id as string);
        if (!s) throw "sesión no encontrada";
        if (typeof args.title === "string") {
          if (!args.title.trim()) throw "El nombre no puede quedar vacío.";
          s.title = args.title.trim().slice(0, 80);
        }
        if (typeof args.pinned === "boolean") s.pinned = args.pinned;
        if (args.pinned) s.archived = false;
        if (typeof args.archived === "boolean") s.archived = args.archived;
        if (args.archived) s.pinned = false;
        return summary(s);
      }
      case "session_memories":
        return memories();
      case "forget_session_memory": {
        const s = store.sessions.get(args.id as string);
        if (s) s.memory = { summary: "", pending: [], struggled: [], messages: s.messages.length, at: new Date().toISOString() };
        return memories();
      }
      case "create_session": {
        const goal = String(args.goal ?? "").trim();
        if (!goal) throw "Escribí qué querés entender.";
        return clone(newSession(goal));
      }
      case "start_chat": {
        const message = String(args.message ?? "").trim();
        if (!message) throw "Escribí un mensaje para empezar.";
        const now = new Date().toISOString();
        const s: Session = { id: nid(), title: message.slice(0, 60), goal: "", phase: "chat", created_at: now, updated_at: now, findings: [], plan: [], pending_question: null, messages: [{ role: "user", content: message }] };
        store.sessions.set(s.id, s);
        touch("chat");
        return clone(s);
      }
      // AC-146, AC-147: recorded classes.
      case "class_list":
        return [...store.classes.values()]
          .sort((a, b) => b.started_at.localeCompare(a.started_at))
          .map((c) => ({ id: c.id, title: c.title, course_id: c.course_id, day: c.day, seconds: c.seconds, parts: c.parts, has_notes: !!c.notes }));
      case "class_get":
        return clone(classOf(args.id as string));
      case "class_start": {
        const c: ClassRecord = { id: nid(), title: String(args.title ?? "").trim() || "Clase", course_id: (args.courseId as string | null) || null, day: String(args.day), started_at: new Date().toISOString(), seconds: 0, parts: 0, transcript: "", notes: null };
        store.classes.set(c.id, c);
        return clone(c);
      }
      case "class_append": {
        const c = classOf(args.id as string);
        const text = String(args.text ?? "").trim();
        if (text) c.transcript = c.transcript ? `${c.transcript} ${text}` : text;
        c.parts += 1;
        c.seconds += Number(args.seconds) || 0;
        if (text) touch("class");
        return clone(c);
      }
      case "class_rename": {
        const c = classOf(args.id as string);
        if (!String(args.title).trim()) throw "Poné un nombre a la clase.";
        c.title = String(args.title).trim();
        return clone(c);
      }
      case "class_delete":
        store.classes.delete(args.id as string);
        return null;
      case "class_notes": {
        const c = classOf(args.id as string);
        if (c.transcript.trim().length < 80) throw "Todavía hay muy poco transcripto para armar apuntes.";
        await sleep(DELAY * 10);
        c.notes = {
          summary: "### La derivada\n- La **derivada** en un punto es la pendiente de la recta tangente a la curva en ese punto.\n- Para $f(x) = x^2$, la pendiente en $x = 3$ es $6$.",
          key_points: ["La derivada es la pendiente de la recta tangente", "La tangente sale de acercar dos puntos de una secante"],
          questions: ["La definición con límites quedó para la próxima clase"],
          dates: [{ title: "Primer parcial", date: dayFromNow(14), kind: "parcial" }, { title: "TP de derivadas", date: "", kind: "tp" }],
        };
        return clone(c);
      }
      case "activity_days": {
        const since = String(args.since);
        const days = new Map<string, { kinds: Set<string>; minutes: number }>();
        const add = (day: string, kind: string, minutes = 0) => {
          if (day < since) return;
          const e = days.get(day) ?? { kinds: new Set<string>(), minutes: 0 };
          e.kinds.add(kind);
          e.minutes += minutes;
          days.set(day, e);
        };
        for (const [day, kinds] of store.activity) for (const k of kinds) add(day, k);
        for (const e of store.study) add(e.day, "focus", e.minutes);
        const order = ["chat", "focus", "cards", "practice", "exam", "class"];
        return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, e]) => ({ day, kinds: order.filter((k) => e.kinds.has(k)), minutes: Math.round(e.minutes) }));
      }
      case "academic_state":
        return clone(store.academic);
      case "academic_save_term": {
        const i = args.input as TermInput;
        if (!i.name.trim()) throw "Poné un nombre al período (por ejemplo «2.º cuatrimestre 2026»).";
        const found = i.id ? store.academic.terms.find((t) => t.id === i.id) : undefined;
        if (found) Object.assign(found, { name: i.name.trim(), kind: i.kind, start: i.start ?? null, end: i.end ?? null });
        else {
          const t = { id: nid(), name: i.name.trim(), kind: i.kind, start: i.start ?? null, end: i.end ?? null };
          store.academic.terms.push(t);
          store.academic.active_term = t.id;
        }
        return academicDone();
      }
      case "academic_delete_term": {
        const a = store.academic;
        a.terms = a.terms.filter((t) => t.id !== args.id);
        a.courses = a.courses.filter((c) => c.term_id !== args.id);
        a.dates = a.dates.filter((d) => d.term_id !== args.id);
        if (a.active_term === args.id) a.active_term = a.terms[a.terms.length - 1]?.id ?? null;
        return academicDone();
      }
      case "academic_set_active":
        store.academic.active_term = args.id as string;
        return academicDone();
      case "academic_save_course": {
        const i = args.input as CourseInput;
        if (!i.name.trim()) throw "Poné el nombre de la materia.";
        const found = i.id ? store.academic.courses.find((c) => c.id === i.id) : undefined;
        const fields = { name: i.name.trim(), code: i.code ?? "", professor: i.professor ?? "", room: i.room ?? "", notes: i.notes ?? "", slots: i.slots };
        if (found) Object.assign(found, fields, i.color != null ? { color: i.color } : {});
        else store.academic.courses.push({ id: nid(), term_id: i.term_id, color: i.color ?? store.academic.courses.filter((c) => c.term_id === i.term_id).length % 8, ...fields });
        return academicDone();
      }
      case "academic_delete_course": {
        const a = store.academic;
        a.courses = a.courses.filter((c) => c.id !== args.id);
        a.dates.forEach((d) => d.course_id === args.id && (d.course_id = null));
        return academicDone();
      }
      case "academic_save_date": {
        const i = args.input as DateInput;
        if (!i.title.trim()) throw "Poné un título (por ejemplo «Primer parcial»).";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw "Elegí una fecha válida.";
        const found = i.id ? store.academic.dates.find((d) => d.id === i.id) : undefined;
        const fields = { term_id: i.term_id, course_id: i.course_id ?? null, kind: i.kind, title: i.title.trim(), date: i.date, time: i.time ?? null, notes: i.notes ?? "", done: i.done ?? false, grade: i.grade ?? null };
        if (found) Object.assign(found, fields);
        else store.academic.dates.push({ id: nid(), ...fields });
        return academicDone();
      }
      case "academic_link_route": {
        const c = store.academic.courses.find((x) => x.id === args.courseId);
        if (!c) throw "Esa materia ya no existe.";
        c.exam_id = (args.examId as string | null) || null;
        return academicDone();
      }
      case "academic_add_breaks": {
        const t = store.academic.terms.find((x) => x.id === args.termId);
        if (!t) throw "Ese período ya no existe.";
        const breaks = t.breaks ?? [];
        for (const i of args.items as BreakInput[]) {
          const end = i.end?.trim() || i.start;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw "Los días sin clases van con fecha AAAA-MM-DD.";
          if (end < i.start) throw "El «hasta» es anterior al «desde».";
          if (breaks.some((b) => b.start === i.start && b.end === end)) continue;
          breaks.push({ id: nid(), start: i.start, end, name: i.name.trim() || "Sin clases" });
        }
        t.breaks = breaks.sort((a, b) => a.start.localeCompare(b.start));
        return academicDone();
      }
      case "academic_delete_break": {
        const t = store.academic.terms.find((x) => x.id === args.termId);
        if (t) t.breaks = (t.breaks ?? []).filter((b) => b.id !== args.id);
        return academicDone();
      }
      case "academic_delete_date":
        store.academic.dates = store.academic.dates.filter((d) => d.id !== args.id);
        return academicDone();
      case "academic_import": {
        const report = applyImport(store.academic, args.proposal as Proposal);
        return { data: academicDone(), report };
      }
      case "academic_parse": {
        const text = String(args.text ?? "").trim();
        if (!text) throw "Pegá tu horario o tus fechas.";
        await sleep(DELAY * 8);
        if (!/an[aá]lisis|f[ií]sica|lunes|martes|parcial|\d{1,2}:\d{2}/i.test(text)) throw "No encontré horarios ni fechas en ese texto. Probá pegarlo tal cual te lo pasaron.";
        return timetableProposal();
      }
      case "get_identity":
        return clone(store.identity);
      case "save_identity":
        store.identity = { ...(args.input as Identity) };
        saveMockIdentity(store.identity);
        return clone(store.identity);
      case "get_session": {
        const s = store.sessions.get(args.id as string);
        if (!s) throw "sesión no encontrada";
        return clone(s);
      }
      case "delete_session": {
        // AC-107: what was learned stays unless the person asks to forget it too.
        const s = store.sessions.get(args.id as string);
        if (args.forget && s?.graph) store.ledger.push({ source: { kind: "session", id: s.id, title: s.title }, at: ++clock, propositions: [], chains: [] });
        store.sessions.delete(args.id as string);
        return null;
      }
      case "get_learner":
        return clone(store.learner);
      case "student_model":
        return studentModel();
      case "student_today":
        return studentToday();
      case "student_mark_known": {
        const name = String(args.name).toLowerCase();
        store.learner.misconceptions.forEach((m) => {
          if (!m.fixed && m.concept.toLowerCase() === name) m.fixed = true;
        });
        return studentModel();
      }
      case "forget_learner": {
        const kind = String(args.kind);
        const i = Number(args.index);
        if (kind === "all") store.learner = { misconceptions: [], preferences: [] };
        else if (kind === "misconception") store.learner.misconceptions.splice(i, 1);
        else if (kind === "preference") store.learner.preferences.splice(i, 1);
        return clone(store.learner);
      }
      case "send_message":
        if (args.input) touch("chat");
        return runTurn(args.id as string, args.input as LearnerInput | null, args.onEvent as Channel<AgentEvent>);
      case "stop_agent":
        return null;
      case "list_prompts":
        return Object.entries(DEFAULT_PROMPTS).map(
          ([name, def]): PromptView => ({
            name,
            content: store.prompts[name] ?? def,
            default_content: def,
            overridden: name in store.prompts,
          }),
        );
      case "save_prompt":
        store.prompts[args.name as string] = args.content as string;
        return null;
      case "get_graph":
        return fold(store.ledger);
      case "extract_session": {
        const s = store.sessions.get(args.id as string);
        if (!s) throw "sesión no encontrada";
        const raw = await runExtraction({ kind: "session", id: s.id, title: s.title }, `# Sesión: ${s.title}`);
        s.graph = { propositions: raw.propositions.length, chains: raw.chains.length, at: new Date().toISOString(), messages: s.messages.length };
        return clone(s);
      }
      case "import_book": {
        const title = String(args.title ?? "").trim();
        if (!title) throw "Poné un título.";
        const sections = lib.sections(String(args.markdown ?? ""));
        if (!sections.some((s) => s.markdown.replace(/<!-- p:\d+ -->/g, "").trim())) throw (args.scanned as number[]).length ? "El PDF no tiene texto seleccionable (parece escaneado)." : "El documento no tiene texto.";
        const b: Book = { id: nid(), title, file_name: String(args.fileName ?? ""), created_at: new Date(++clock).toISOString(), pages: Number(args.pages ?? 0), scanned: (args.scanned as number[]) ?? [], sections };
        store.books.set(b.id, b);
        return lib.summary(b);
      }
      case "list_books":
        return [...store.books.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(lib.summary);
      case "get_book": {
        const b = store.books.get(args.id as string);
        if (!b) throw "Ese libro ya no está en la biblioteca.";
        return clone(b);
      }
      case "delete_book":
        store.books.delete(args.id as string);
        return null;
      case "search_library":
        return lib.search([...store.books.values()], String(args.query ?? ""), Number(args.limit ?? 10));
      case "forget_source": {
        const src = args.source as { kind: "session" | "notes"; id: string; title: string };
        store.ledger.push({ source: src, at: ++clock, propositions: [], chains: [] });
        return fold(store.ledger);
      }
      case "import_notes": {
        const title = String(args.title ?? "").trim();
        const text = String(args.text ?? "").trim();
        if (!title || !text) throw "Poné un título y pegá el texto de las notas.";
        await runExtraction({ kind: "notes", id: nid(), title }, `${NOTES_HEADER} ${title}
${text}`);
        return fold(store.ledger);
      }
      case "list_practice":
        return [...store.practice.values()].map(practiceSummary).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      case "get_practice":
        return clone(practiceSet(args.id as string));
      case "create_practice": {
        const ids = args.nodeIds as string[];
        const targets = fold(store.ledger).nodes.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, text: n.text }));
        if (!targets.length) throw "Elegí al menos una idea del grafo.";
        await sleep(DELAY * 10);
        const now = new Date().toISOString();
        const s: PracticeSet = {
          id: nid(),
          title: targets.length > 1 ? `${targets[0].text.slice(0, 60)} (+${targets.length - 1})` : targets[0].text.slice(0, 60),
          created_at: now,
          updated_at: now,
          targets,
          // AC-167: only the first one now; next_problem writes the rest, one by one.
          problems: scriptedProblems(targets.map((t) => t.id), Number(args.count)).slice(0, 1).map((p) => ({ ...p, id: "q1", hints_shown: 0, level: 1, attempts: [] })),
          planned: Number(args.count),
        };
        store.practice.set(s.id, s);
        return clone(s);
      }
      case "reveal_hint": {
        const s = practiceSet(args.setId as string);
        const p = s.problems.find((x) => x.id === args.problemId)!;
        p.hints_shown = Math.min(p.hints_shown + 1, p.hints.length);
        s.updated_at = new Date().toISOString();
        return clone(s);
      }
      case "read_own_problems": {
        // AC-173: one problem per numbered line; «Rta: …» on it is the guide's answer.
        // AC-174: a library document named by the chat stands for a scripted guide.
        const book = String(args.book ?? "").trim();
        const text = book && !String(args.text ?? "").trim() ? "1) Un móvil recorre 120 km en 2 h. ¿Cuál es su rapidez media? Rta: 60 km/h\n2) ¿Cuánto tarda en recorrer 300 km a esa rapidez?" : String(args.text ?? "");
        if (!text.trim()) throw "Pegá tus ejercicios o elegí un archivo.";
        await sleep(DELAY * 10);
        const problems = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^\d+[).]/.test(l))
          .map((l) => {
            const [statement, answer] = l.split(/\s*Rta:\s*/i);
            return { statement, solution: answer ?? "Resuelto por Eureka: 42", given: !!answer, hints: ["Mirá los datos que te dan."], ideas: [] as string[] };
          });
        if (!problems.length) throw "no encontré ningún ejercicio con su enunciado";
        return problems;
      }
      case "create_own_practice": {
        const kept = (args.problems as { statement: string; solution: string; given: boolean; hints: string[] }[]).filter((p) => p.statement.trim());
        if (!kept.length) throw "Dejá al menos un ejercicio con su enunciado.";
        const now = new Date().toISOString();
        const s: PracticeSet = {
          id: nid(),
          title: String(args.title ?? "").trim() || `Mis problemas (${kept.length})`,
          created_at: now,
          updated_at: now,
          targets: [],
          problems: kept.map((p, i) => ({ id: `q${i + 1}`, statement: p.statement, targets: [], hints: p.hints, solution: p.solution, hints_shown: 0, solution_by_model: !p.given, attempts: [] })),
          planned: null,
          own: true,
        };
        store.practice.set(s.id, s);
        return clone(s);
      }
      case "next_problem": {
        const s = practiceSet(args.setId as string);
        const have = Number(args.have);
        const planned = s.planned ?? s.problems.length;
        if (s.problems.length !== have || have >= planned) return clone(s);
        await sleep(DELAY * 5);
        if (s.problems.length !== have) return clone(s);
        const next = scriptedProblems(s.targets.map((t) => t.id), planned)[have];
        const last = [...s.problems].reverse().find((p) => p.attempts.length)?.attempts.slice(-1)[0];
        const prev = s.problems[have - 1]?.level || 1;
        const level = !last ? prev : last.verdict === "correct" && last.hints_used <= 1 ? Math.min(prev + 1, s.targets.length > 1 ? 4 : 2) : last.verdict === "incorrect" ? Math.max(prev - 1, 1) : prev;
        s.problems.push({ ...next, id: `q${have + 1}`, hints_shown: 0, level, attempts: [] });
        s.updated_at = new Date().toISOString();
        return clone(s);
      }
      case "practice_nudge": {
        // AC-168: the scripted hint starts from what they wrote; "listo" in it means it is already solved.
        const s = practiceSet(args.setId as string);
        const p = s.problems.find((x) => x.id === args.problemId)!;
        const draft = String(args.draft ?? "").trim();
        if (!draft) throw "Escribí lo que venís pensando y te doy un empujón desde ahí.";
        p.nudges ??= [];
        if (p.nudges.length >= 3) throw "Ya te di 3 empujones en este problema: probá con lo que tenés o mirá la solución.";
        await sleep(DELAY * 5);
        if (/listo|ya está/i.test(draft)) return { set: clone(s), hint: "Lo que pensaste ya lo resuelve: mandalo como respuesta.", solved: true };
        const hint = `Vas bien con «${draft.split("\n")[0].slice(0, 40)}». Mirá qué pasa justo en el punto que te piden.`;
        p.nudges.push(hint);
        s.updated_at = new Date().toISOString();
        return { set: clone(s), hint, solved: false };
      }
      case "answer_problem": {
        const s = practiceSet(args.setId as string);
        const p = s.problems.find((x) => x.id === args.problemId)!;
        const input = args.input as LearnerInput;
        touch("practice");
        if (!input.text.trim()) throw "Escribí una respuesta.";
        await sleep(DELAY * 10);
        if (failGrade) {
          failGrade = false;
          throw "el proveedor respondió 503: fake: corrector no disponible";
        }
        // AC-173: asked to look again at a reference Eureka wrote, the scripted grader admits the slip.
        const g = p.solution_by_model && /Creo que mi respuesta está bien/.test(input.thinking ?? "")
          ? { verdict: "correct" as const, feedback: "Revisé la referencia: tenía un error y tu razonamiento está bien." }
          : scriptedGrade(input.text, p.solution);
        p.attempts.push({ answer: input.text.trim(), confidence: input.confidence ?? null, thinking: input.thinking ?? "", hints_used: p.hints_shown + (p.nudges?.length ?? 0), ...g, at: new Date().toISOString() });
        s.updated_at = new Date().toISOString();
        return clone(s);
      }
      case "delete_practice":
        store.practice.delete(args.id as string);
        return null;
      case "list_exams":
        return [...store.exams.values()].map(examSummary).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      case "get_exam":
        return clone(exam(args.id as string));
      case "create_exam": {
        const name = String(args.name ?? "").trim();
        const guide = String(args.guide ?? "").trim();
        if (!name || !guide) throw "Poné el nombre del examen y pegá su guía oficial.";
        await sleep(DELAY * 10);
        const raw = parseGuide(guide).filter((d) => d.topics.length);
        if (!raw.length) throw "No se encontraron dominios con temas en la guía. Pegá el temario oficial del examen.";
        const weights = normalizeWeights(raw.map((d) => d.weight));
        const now = new Date().toISOString();
        const e: Exam = {
          id: nid(),
          name,
          created_at: now,
          updated_at: now,
          domains: raw.map((d, i) => ({
            id: `d${i + 1}`,
            name: d.name,
            weight: weights[i],
            topics: d.topics.map((t, j) => ({ id: `d${i + 1}t${j + 1}`, title: t.title, objectives: t.objectives, session_id: null, exercises_passed: 0 })),
          })),
          mocks: [],
          review: [],
          goal: { passing_pct: null, exam_date: null, hours_per_week: null },
          cheat_sheet: null,
          kind: args.kind === "subject" ? "subject" : "certification",
          schedule: [],
          lang: null,
        };
        store.exams.set(e.id, e);
        return clone(e);
      }
      case "find_exam_guide": {
        const name = String(args.name ?? "").trim();
        if (!name) throw "Escribí el nombre del examen.";
        if (!store.keys.has("search")) throw "La búsqueda web no está configurada (Ajustes → Búsqueda web).";
        await sleep(DELAY * 10);
        const found = scriptedFoundGuide(name);
        return { guide: found.guide, sources: found.used.map((n) => ({ title: GUIDE_HITS[n - 1].title, url: GUIDE_HITS[n - 1].url })) };
      }
      case "delete_exam":
        store.exams.delete(args.id as string);
        return null;
      case "study_topic": {
        const e = exam(args.examId as string);
        const d = e.domains.find((x) => x.topics.some((t) => t.id === args.topicId));
        const t = d?.topics.find((x) => x.id === args.topicId);
        if (!d || !t) throw "tema no encontrado";
        const existing = t.session_id ? store.sessions.get(t.session_id) : undefined;
        if (existing) return clone(existing);
        const s = newSession(t.title);
        s.exam = { exam_id: e.id, exam_name: e.name, domain: d.name, weight: d.weight, topic_id: t.id, objectives: t.objectives, lang: e.lang };
        t.session_id = s.id;
        e.updated_at = new Date().toISOString();
        return clone(s);
      }
      case "create_mock": {
        const e = exam(args.examId as string);
        await sleep(DELAY * 10);
        if (failMock) {
          failMock = false;
          throw "el proveedor respondió 503: fake: autor de simulacros no disponible";
        }
        const minutes = args.minutes == null ? null : Number(args.minutes);
        if (minutes != null && !(minutes >= 1 && minutes <= 600)) throw "El tiempo tiene que estar entre 1 y 600 minutos.";
        // Mirror of exam::focused (Rust).
        const focus = (args.focus ?? null) as { domain_ids: string[]; topic_ids: string[] } | null;
        const scope = !focus || (!focus.domain_ids.length && !focus.topic_ids.length)
          ? e.domains
          : e.domains.flatMap((d) => (focus.domain_ids.includes(d.id) ? [d] : d.topics.some((t) => focus.topic_ids.includes(t.id)) ? [{ ...d, topics: d.topics.filter((t) => focus.topic_ids.includes(t.id)) }] : []));
        if (!scope.length) throw "Elegí al menos un dominio o tema del examen.";
        const per = allocate(Math.min(40, Math.max(1, Number(args.count))), scope.map((d) => d.weight));
        // Mirror of exam::apply_check: a disputed question is dropped, ids renumbered.
        const generated = scriptedQuestions(scope.map((d, i) => ({ domain_id: d.id, topics: d.topics, n: per[i] })));
        const dropped = disputeOne && generated.length > 1 ? 1 : 0;
        const questions = generated.slice(dropped).map((q, i) => ({ ...q, id: `m${i + 1}`, reported: null }));
        const time_limit_secs = minutes == null ? null : minutes * (shortTime ? 3 : 60);
        const label = scope === e.domains ? null : scope.map((d) => d.name).join(", ");
        e.mocks.push({ id: nid(), created_at: new Date().toISOString(), questions, result: null, time_limit_secs, focus: label, dropped });
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "submit_mock": {
        const e = exam(args.examId as string);
        const m = e.mocks.find((x) => x.id === args.mockId);
        if (!m) throw "simulacro no encontrado";
        touch("exam");
        if (m.result) throw "Este simulacro ya fue entregado.";
        const given = args.answers as number[][];
        const answers = m.questions.map((_, i) => [...new Set(given[i] ?? [])].sort((a, b) => a - b));
        const right = (i: number) => isRight(m.questions[i].answer, answers[i]);
        m.result = { ...mockGrade(e, m.questions, answers), elapsed_secs: Math.max(0, Math.round((Date.now() - Date.parse(m.created_at)) / 1000)) };
        // Mirror of AC-57: failed questions also go to "Falladas: <exam>".
        const failedCards = m.questions
          .filter((q, i) => !q.reported && !right(i))
          .map((q) => ({
            front: `${q.stem}\n${q.options.map((o, j) => `- ${String.fromCharCode(65 + j)}) ${o}`).join("\n")}`,
            back: `**${q.answer.map((j) => `${String.fromCharCode(65 + j)}) ${q.options[j]}`).join(" · ")}**\n\n${q.explanation}`,
          }));
        addToNamedDeck(`Falladas: ${e.name}`, { kind: "exam", id: e.id }, failedCards);
        // Mirror of exam::add_to_review (Rust).
        m.questions.forEach((q, i) => {
          if (right(i) || q.reported) return;
          const same = e.review.find((r) => r.question.stem.toLowerCase() === q.stem.toLowerCase());
          if (same) same.streak = 0;
          else e.review.push({ id: nid(), question: clone(q), mock_id: m.id, streak: 0, added_at: new Date().toISOString() });
        });
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "code_runtimes":
        return [
          { lang: "python", program: "py -3", version: "Python 3.14.7" },
          { lang: "javascript", program: "node", version: "v24.12.0" },
          { lang: "typescript", program: "node", version: "v24.12.0 (tipos quitados por Node)" },
          params.has("noRust") ? { lang: "rust", program: null, version: null } : { lang: "rust", program: "rustc", version: "rustc 1.98.0" },
          { lang: "c", program: "gcc", version: "gcc.exe (MinGW-W64 x86_64-ucrt-posix-seh) 16.2.0" },
          { lang: "cpp", program: "g++", version: "g++.exe (MinGW-W64 x86_64-ucrt-posix-seh) 16.2.0" },
          { lang: "java", program: "java", version: "java 19.0.2 2023-01-17" },
          params.has("noDotnet") ? { lang: "csharp", program: null, version: null } : { lang: "csharp", program: "dotnet", version: ".NET SDK 10.0.403" },
          { lang: "go", program: "go", version: "go version go1.26.2 windows/amd64" },
          { lang: "sql", program: "sqlite", version: "SQLite 3.51.0 (incluido en Eureka)" },
        ];
      case "run_code": {
        const codeText = String(args.code ?? "");
        if (!codeText.trim()) throw "Escribí algo de código para ejecutar.";
        await sleep(DELAY * 5);
        const tests = args.tests ? String(args.tests) : "";
        return scriptedRun(args.lang as Lang, tests ? withTests(args.lang as Lang, codeText, tests) : codeText, String(args.stdin ?? ""));
      }
      case "explain_code": {
        await sleep(DELAY * 10);
        return /Error|error/.test(String(args.output)) ? "El error dice que **dividiste por cero** en la línea marcada: revisá el divisor antes de dividir." : "Tu código anda: imprime lo que esperabas.";
      }
      case "review_code": {
        if (!String(args.code ?? "").trim()) throw "Escribí algo de código para ejecutar.";
        await sleep(DELAY * 10);
        return `Bien: el programa hace lo que tiene que hacer.\n\n1. **L1 · Idiomático** — ${args.focus ? `Sobre «${args.focus}»: ` : ""}usá una comprensión de listas en lugar del bucle.\n2. **L2 · Errores** — validá la entrada antes de usarla.\n\nEjercicio: reescribilo sin bucles explícitos.`;
      }
      case "read_images": {
        const images = args.images as string[];
        if (!images.length || images.some((i) => !/^data:image\/(png|jpeg|webp);base64,/.test(i))) throw "Solo imágenes PNG, JPG o WebP.";
        await sleep(DELAY * 10);
        if (args.purpose === "timetable") return "Lunes 10:00 a 12:00 · Análisis I · Aula 3 · Prof. Pérez\nMiércoles 10:00 a 12:00 · Análisis I · Aula 3\nPrimer parcial de Análisis I: 12/11";
        if (args.purpose === "curriculum") return SAMPLE_CURRICULUM_TEXT;
        if (args.purpose === "problems") return "1) Un móvil recorre 120 km en 2 h. ¿Cuál es su rapidez media? Rta: 60 km/h\n2) ¿Cuánto tarda en recorrer 300 km a esa rapidez?";
        return args.purpose === "guide" ? SAMPLE_GUIDE : "- Mitocondria: produce la energía de la célula\n- Ribosoma: sintetiza proteínas";
      }
      case "generate_listening": {
        await sleep(DELAY * 10);
        return {
          title: "A call to the travel agency",
          transcript:
            "Anna: Hi, I'd like to change my flight to Lisbon. Agent: Of course. When would you like to travel? Anna: Next Friday instead of Wednesday, please, in the morning if possible. Agent: There's a flight at nine fifteen. It costs forty euros more. Anna: That's fine, I'll take it.",
          questions: [
            { id: "m1", domain_id: "l", topic_id: null, stem: "Why does Anna call?", options: ["To book a hotel", "To change a flight", "To cancel a trip"], answer: [1], explanation: "«I'd like to change my flight».", reported: null },
            { id: "m2", domain_id: "l", topic_id: null, stem: "When will she travel?", options: ["Wednesday", "Friday morning", "Friday evening"], answer: [1], explanation: "«Next Friday… in the morning».", reported: null },
          ],
        };
      }
      case "local_speech_status":
        return localSpeech();
      case "local_speech_download": {
        const m = LOCAL_MODELS.find((x) => x.id === args.model);
        if (!m) throw "Ese modelo no existe.";
        const ch = args.onProgress as Channel<{ done: number; total: number }>;
        for (const f of [0.25, 0.5, 0.75, 1]) {
          await sleep(DELAY * 2);
          ch.onmessage({ done: Math.round(m.bytes * f), total: m.bytes });
        }
        localInstalled.add(m.id);
        return localSpeech();
      }
      case "local_speech_remove":
        localInstalled.delete(args.model as string);
        return localSpeech();
      case "transcribe_audio": {
        if (store.settings.roles.speech.provider_id === "local") {
          if (!localInstalled.has(store.settings.roles.speech.model)) throw "El modelo de voz local no está descargado. Bajalo en Ajustes → Avanzado → Voz.";
          await sleep(DELAY * 10);
          return "la derivada es la pendiente de la recta tangente";
        }
        if (store.settings.roles.speech.model === "") throw "Para el speaking configurá un modelo de transcripción en Ajustes → Voz (por ejemplo whisper-1 de OpenAI o whisper-large-v3 de Groq).";
        if (!(args.audio as number[]).length) throw "La grabación está vacía o es demasiado larga.";
        await sleep(DELAY * 10);
        if (args.language === "español") return "la derivada es la pendiente de la recta tangente";
        return "I think working from home is better because I can saves time and I have more focus.";
      }
      case "speaking_feedback": {
        await sleep(DELAY * 10);
        return "1. **Nivel estimado**: B1.\n\n3. **Gramática**: «I can saves» → «I can save».\n\n7. **Versión mejorada**\n> I believe working from home is better because it saves me time and helps me focus.";
      }
      case "list_projects":
        return [...store.projects.values()].map((p) => ({ id: p.id, name: p.name, lang: p.lang, files: p.files.length, updated_at: p.updated_at }));
      case "get_project": {
        const p = store.projects.get(args.id as string);
        if (!p) throw "proyecto no encontrado";
        return clone(p);
      }
      case "save_project": {
        const p = clone(args.project as Project);
        if (!p.name.trim()) throw "Poné un nombre al proyecto.";
        if (!p.id) p.id = nid();
        p.updated_at = new Date().toISOString();
        store.projects.set(p.id, p);
        return clone(p);
      }
      case "delete_project":
        store.projects.delete(args.id as string);
        return null;
      case "run_project": {
        await sleep(DELAY * 5);
        const files = args.files as Project["files"];
        const all = files.map((f) => f.content).join("\n");
        const broken = /return a - b|todo!\(\)|TODO/.test(all);
        if (args.mode === "test")
          return broken
            ? { stdout: "", stderr: "FAIL: test_suma (test_calc.TestSuma)\nAssertionError: -1 != 5\n\nFAILED (failures=1)", exit_code: 1, timed_out: false, compile_error: false, duration_ms: 80 }
            : { stdout: "", stderr: "test_suma ... ok\n\nRan 2 tests in 0.001s\n\nOK", exit_code: 0, timed_out: false, compile_error: false, duration_ms: 80 };
        const main = files.find((f) => /^(main\.(py|js|ts)|src\/main\.rs)$/.test(f.path))?.content ?? "";
        return scriptedRun(args.lang as Lang, main.replace(/\{[^}]*\}/g, ""), String(args.stdin ?? ""));
      }
      case "generate_project": {
        if (!String(args.topic ?? "").trim()) throw "Escribí de qué querés que sea el proyecto.";
        await sleep(DELAY * 10);
        const p: Project = {
          id: nid(),
          name: `Calculadora (${String(args.topic).trim()})`,
          lang: args.lang as Lang,
          files: [
            { path: "main.py", content: 'from calc import suma\nprint("suma lista")\n' },
            { path: "calc.py", content: "def suma(a, b):\n    return a - b\n" },
            { path: "test_calc.py", content: "import unittest\nfrom calc import suma\n" },
          ],
          statement: "Arreglá `suma` en **calc.py** para que pasen las pruebas.",
          hints: ["Mirá el operador.", "Es una suma, no una resta."],
          updated_at: new Date().toISOString(),
        };
        store.projects.set(p.id, p);
        return clone(p);
      }
      case "create_backup":
        return "C:\\Users\\demo\\Downloads\\Eureka-respaldo-20261027-1530.zip";
      case "restore_backup": {
        const bytes = args.bytes as number[];
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw "Ese archivo no es un respaldo de Eureka (.zip).";
        return 3;
      }
      case "import_cards": {
        const cards = args.cards as [string, string][];
        if (!cards.length) throw "No encontré tarjetas en el archivo.";
        const name = String(args.name ?? "").trim();
        if (!name) throw "Poné un nombre al mazo.";
        const now = new Date().toISOString();
        const d: Deck = { id: nid(), name, source: { kind: "manual" }, created_at: now, updated_at: now, cards: cards.map(([f, b]) => newCard(f, b, String(args.today))) };
        store.decks.set(d.id, d);
        return d.id;
      }
      case "save_code_card": {
        const names: Record<string, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", rust: "Rust" };
        return addToNamedDeck(`Errores de ${names[String(args.lang)]}`, { kind: "manual" }, [{ front: String(args.front), back: String(args.back) }]);
      }
      case "generate_code_exercise": {
        if (!String(args.topic ?? "").trim()) throw "Escribí el tema que querés practicar.";
        await sleep(DELAY * 10);
        return scriptedExercise(args.lang as Lang, String(args.topic));
      }
      case "log_study": {
        const e = args.entry as Omit<StudyEntry, "at">;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day) || !(e.minutes > 0 && e.minutes <= 600)) throw "registro de estudio inválido";
        const entry = { at: new Date().toISOString(), day: e.day, minutes: e.minutes, context: e.context ?? null };
        store.study.push(entry);
        return clone(entry);
      }
      case "study_log":
        return clone(store.study.filter((e) => e.day >= String(args.since)));
      case "list_decks": {
        const today = String(args.today);
        return [...store.decks.values()]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .map((d) => ({
            id: d.id,
            name: d.name,
            source: d.source,
            updated_at: d.updated_at,
            total: d.cards.length,
            new: d.cards.filter((c) => !c.reviewed).length,
            due: d.cards.filter((c) => c.reviewed && c.due <= today).length,
          }));
      }
      case "get_deck":
        return clone(deck(args.id as string));
      case "create_deck":
      case "generate_deck": {
        const name = String(args.name ?? "").trim();
        if (!name) throw "Poné un nombre al mazo.";
        const now = new Date().toISOString();
        const d: Deck = { id: nid(), name: name.slice(0, 80), source: { kind: "manual" }, created_at: now, updated_at: now, cards: [] };
        if (cmd === "generate_deck") {
          const src = args.source as CardSource;
          const today = String(args.today);
          await sleep(DELAY * 10);
          let material = "";
          if (src.kind === "exam") {
            const e = exam(src.id);
            material = e.domains.flatMap((x) => x.topics.map((t) => `- ${t.title}: ${t.objectives.join("; ")}`)).join("\n");
            d.source = { kind: "exam", id: src.id };
          } else if (src.kind === "graph") {
            const ideas = fold(store.ledger).nodes.filter((n) => src.node_ids.includes(n.id));
            if (!ideas.length) throw "Elegí al menos una idea del grafo.";
            material = ideas.map((n) => `- ${n.text}`).join("\n");
            d.source = { kind: "graph" };
          } else {
            if (!src.text.trim()) throw "Pegá el texto de tus apuntes.";
            material = src.text;
            d.source = { kind: "notes" };
          }
          d.cards = scriptedCards(material, Number(args.count)).cards.map((c) => newCard(c.front, c.back, today));
          if (!d.cards.length) throw "El generador no devolvió tarjetas válidas.";
        }
        store.decks.set(d.id, d);
        return clone(d);
      }
      case "delete_deck":
        store.decks.delete(args.id as string);
        return null;
      case "save_card": {
        const d = deck(args.deckId as string);
        const front = String(args.front ?? "").trim();
        const back = String(args.back ?? "").trim();
        if (!front || !back) throw "La tarjeta necesita frente y dorso.";
        if (args.cardId) {
          const c = d.cards.find((x) => x.id === args.cardId);
          if (!c) throw "tarjeta no encontrada";
          Object.assign(c, { front, back });
        } else d.cards.push(newCard(front, back, String(args.today)));
        d.updated_at = new Date().toISOString();
        return clone(d);
      }
      case "delete_card": {
        const d = deck(args.deckId as string);
        d.cards = d.cards.filter((c) => c.id !== args.cardId);
        d.updated_at = new Date().toISOString();
        return clone(d);
      }
      case "grade_card": {
        const d = deck(args.deckId as string);
        const i = d.cards.findIndex((c) => c.id === args.cardId);
        if (i < 0) throw "tarjeta no encontrada";
        d.cards[i] = reviewCard(d.cards[i], args.grade as Grade, String(args.today));
        touch("cards");
        d.updated_at = new Date().toISOString();
        return clone(d);
      }
      case "explain_question": {
        const ask = String(args.ask ?? "").trim();
        if (!ask) throw "Escribí tu pregunta.";
        await sleep(DELAY * 10);
        return scriptedExplain(ask);
      }
      case "report_question": {
        const e = exam(args.examId as string);
        const m = e.mocks.find((x) => x.id === args.mockId);
        const q = m?.questions.find((x) => x.id === args.questionId);
        if (!m || !q) throw "pregunta no encontrada";
        q.reported = String(args.reason ?? "").trim() || "sin motivo";
        e.review = e.review.filter((r) => r.question.stem.toLowerCase() !== q.stem.toLowerCase());
        if (m.result) m.result = { ...mockGrade(e, m.questions, m.result.answers), at: m.result.at, elapsed_secs: m.result.elapsed_secs };
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "report_review": {
        const e = exam(args.examId as string);
        const before = e.review.length;
        e.review = e.review.filter((r) => r.id !== args.reviewId);
        if (e.review.length === before) throw "pregunta de repaso no encontrada";
        return clone(e);
      }
      case "create_cheat_sheet": {
        const e = exam(args.examId as string);
        await sleep(DELAY * 10);
        const failing = e.review.slice(0, 3).map((r) => `- Ojo: ${r.question.stem.replace(/\*/g, "")}`).join("\n");
        e.cheat_sheet = {
          markdown: [...e.domains].sort((a, b) => b.weight - a.weight).map((d) => `## ${d.name} (${d.weight}%)\n${d.topics.map((t) => `- **${t.title}**`).join("\n")}`).join("\n\n") + `\n\n## Trampas frecuentes\n${failing || "- Leé dos veces lo que pide la pregunta."}`,
          at: new Date().toISOString(),
        };
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "create_language_path": {
        await sleep(DELAY * 10);
        const lang = args.lang as Lang;
        const label = langLabel(lang);
        const mods: [string, [string, string][]][] = [
          ["Fundamentos", [["Variables y tipos", "Declarar y usar tipos básicos"], ["Control de flujo", "Escribir condicionales y bucles"]]],
          ["Funciones", [["Funciones y parámetros", "Escribir funciones puras"], ["Errores", "Manejar errores sin romper el programa"]]],
          ["Proyecto", [["Mini proyecto", "Armar un programa completo con tests"]]],
        ];
        const now = new Date().toISOString();
        const e: Exam = {
          id: nid(),
          name: `Ruta de ${label}`,
          created_at: now,
          updated_at: now,
          domains: mods.map(([name, topics], i) => ({
            id: `d${i + 1}`,
            name,
            weight: Math.round(1000 / mods.length) / 10,
            topics: topics.map(([title, obj], j) => ({ id: `d${i + 1}t${j + 1}`, title, objectives: [obj], session_id: null, exercises_passed: 0 })),
          })),
          mocks: [],
          review: [],
          goal: { passing_pct: null, exam_date: null, hours_per_week: null },
          cheat_sheet: null,
          kind: "language",
          schedule: [],
          lang,
        };
        store.exams.set(e.id, e);
        return clone(e);
      }
      case "record_exercise": {
        const e = exam(args.examId as string);
        const t = e.domains.flatMap((d) => d.topics).find((x) => x.id === args.topicId);
        if (!t) throw "tema no encontrado";
        t.exercises_passed += 1;
        return clone(e);
      }
      case "set_exam_schedule": {
        const e = exam(args.examId as string);
        const slots = args.slots as Exam["schedule"];
        const ok = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
        for (const s of slots) {
          if (!(s.weekday >= 1 && s.weekday <= 7)) throw "Día inválido.";
          if (!ok(s.start) || !ok(s.end)) throw "Hora inválida: usá el formato HH:MM.";
          if (s.end <= s.start) throw "La hora de fin tiene que ser después de la de inicio.";
        }
        e.schedule = [...slots].map((s) => ({ ...s, place: s.place.trim() })).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "set_exam_goal": {
        const e = exam(args.examId as string);
        const g = args.goal as Exam["goal"];
        if (g.passing_pct != null && !(g.passing_pct >= 1 && g.passing_pct <= 100)) throw "La nota para aprobar tiene que estar entre 1 y 100 %.";
        if (g.hours_per_week != null && !(g.hours_per_week >= 0.5 && g.hours_per_week <= 80)) throw "Las horas por semana tienen que estar entre 0,5 y 80.";
        const date = g.exam_date?.trim() || null;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw "La fecha del examen no es válida.";
        e.goal = { passing_pct: g.passing_pct == null ? null : Math.round(g.passing_pct * 10) / 10, exam_date: date, hours_per_week: g.hours_per_week };
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "answer_review": {
        const e = exam(args.examId as string);
        const i = e.review.findIndex((r) => r.id === args.reviewId);
        if (i < 0) throw "pregunta de repaso no encontrada";
        const item = e.review[i];
        item.streak = isRight(item.question.answer, args.choice as number[]) ? item.streak + 1 : 0;
        if (item.streak >= 2) e.review.splice(i, 1);
        e.updated_at = new Date().toISOString();
        return clone(e);
      }
      case "reset_prompt":
        delete store.prompts[args.name as string];
        return null;
      // ── AC-155…157: la malla ──
      case "career_get":
        return careerView(cursadaKeys());
      case "career_parse": {
        const text = String(args.text ?? "").trim();
        if (!text) throw "Pegá el plan de estudios de tu carrera.";
        await sleep(DELAY * 8);
        if (!/an[aá]lisis|[aá]lgebra|a[nñ]o/i.test(text)) throw "No encontré materias en ese texto. Probá pegar el plan tal cual lo publica tu facultad.";
        return clone(SAMPLE_CAREER);
      }
      case "career_save_plan": {
        const p = args.proposal as CareerProposal;
        const ids = p.subjects.map(() => nid());
        const ref = (r: string) => p.subjects.findIndex((s) => s.code === r || norm(s.name) === norm(r));
        const old = career ?? [];
        careerHead = { name: p.name, institution: p.institution ?? "" };
        career = p.subjects.map((s, i) => {
          const prev = old.find((o) => norm(o.name) === norm(s.name) || (!!s.code && o.code === s.code));
          return { id: ids[i], name: s.name, code: s.code ?? "", year: s.year, term: s.term ?? null, para_cursar: (s.para_cursar ?? []).map((r) => ids[ref(r)]), para_rendir: (s.para_rendir ?? []).map((r) => ids[ref(r)]), status: prev?.status ?? "pendiente", grade: prev?.grade ?? null, failed: prev?.failed ?? [] };
        });
        return careerView(cursadaKeys());
      }
      case "career_save_subject": {
        if (!career) throw "Todavía no cargaste tu carrera.";
        const i = args.input as CareerSubjectInput;
        if (!i.name.trim()) throw "Poné el nombre de la materia.";
        if (i.grade != null && (i.grade < 0 || i.grade > 10)) throw "La nota tiene que estar entre 0 y 10.";
        if (career.some((s) => s.id !== i.id && norm(s.name) === norm(i.name))) throw `Ya hay una materia «${i.name.trim()}».`;
        const s: CareerSubject = { ...i, id: i.id ?? nid(), name: i.name.trim(), grade: i.status === "aprobada" ? i.grade : null };
        career = i.id ? career.map((x) => (x.id === i.id ? s : x)) : [...career, s];
        return careerView(cursadaKeys());
      }
      case "career_delete_subject": {
        if (!career) throw "Todavía no cargaste tu carrera.";
        const id = args.id as string;
        career = career.filter((s) => s.id !== id).map((s) => ({ ...s, para_cursar: s.para_cursar.filter((r) => r !== id), para_rendir: s.para_rendir.filter((r) => r !== id) }));
        return careerView(cursadaKeys());
      }
      case "career_delete":
        career = null;
        return null;
      // ── AC-152…154: Anki .apkg and shared decks (the files go as the raw body) ──
      case "read_apkg": {
        const bytes = raw as Uint8Array;
        await sleep(DELAY * 4);
        if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw "Ese archivo no es un paquete de Anki (.apkg).";
        return { cards: [["Hola", "Hello"], ["La […] produce ATP.", "La mitocondria produce ATP."], ["$2+2$", "4"]], media_only: 2, empty: 0 };
      }
      case "read_shared_deck": {
        let d: { eureka?: string; name?: string; cards?: { front: string; back: string }[] };
        try {
          d = JSON.parse(textOf(raw));
        } catch {
          throw "Ese archivo no es un mazo compartido de Eureka (.eureka).";
        }
        if (d.eureka !== "mazo" || !Array.isArray(d.cards)) throw "Ese archivo no es un mazo compartido de Eureka (.eureka).";
        const cards = d.cards.map((c) => [c.front.trim(), c.back.trim()] as [string, string]).filter(([f, b]) => f && b);
        if (!cards.length) throw "Ese mazo no tiene tarjetas que se puedan usar.";
        return { name: d.name?.trim() || "Mazo compartido", cards, skipped: d.cards.length - cards.length };
      }
      case "opened_deck":
        if (!openedDeck) return null;
        openedDeck = false;
        return clone(SHARED_SAMPLE);
      case "export_apkg":
      case "share_deck": {
        const d = store.decks.get(args.deckId as string);
        if (!d) throw "mazo no encontrado";
        if (!d.cards.length) throw cmd === "share_deck" ? "El mazo no tiene tarjetas para compartir." : "El mazo no tiene tarjetas para exportar.";
        return `C:\\Users\\vos\\Downloads\\${d.name}.${cmd === "share_deck" ? "eureka" : "apkg"}`;
      }
    }
    throw `comando no simulado: ${cmd}`;
  });
}
