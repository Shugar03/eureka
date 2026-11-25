// Shared in-memory state, query flags and helpers for the scripted e2e backend.
import type {
  Accessibility,
  AcademicData,
  Book,
  ClassRecord,
  CompanionTurn,
  Deck,
  Exam,
  HelpResource,
  Identity,
  JournalEntry,
  LearnerProfile,
  OcrPageText,
  PracticeSet,
  Project,
  Session,
  SessionSummary,
  SettingsView,
  SharedFolder,
  StudentModel,
  StudyEntry,
  Suggestion,
  TopicState,
} from "../../types";
import { DEFAULT_ACCESSIBILITY } from "../../lib/accessibility";
import { emptyAcademic } from "../academicMock";
import { scriptedExtraction } from "../extractScript";
import { DEMO_FOLDER } from "../folderMock";
import type { LedgerLine } from "../graphFold";
import { MemoryMock } from "../memoryMock";
import { progressDays, progressModel, progressSessions } from "../progressDemo";
import type { MockRoute } from "../routeMock";

export const UNHANDLED = Symbol("unhandled");
export type HandlerResult = unknown;

export const DELAY = Number(import.meta.env.VITE_E2E_DELAY ?? 12);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const params = new URLSearchParams(location.search);

export const failMode = params.has("fail");
export const failExtract = params.has("failExtract");
export const noSearch = params.has("noSearch");
export const shortTime = params.has("shortTime");
export const disputeOne = params.has("disputeOne");

export const flags = {
  failGrade: params.has("failGradeOnce"),
  failMock: params.has("failMockOnce"),
  /** AC-154: Eureka "opened" with a shared deck (double click), handed over once. */
  openedDeck: params.has("openedDeck"),
};

let seq = 0;
export const nid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
export const clone = <T>(v: T): T => structuredClone(v);

let clock = 0;
export const nextClock = () => ++clock;

/** Local day `n` days from now, YYYY-MM-DD. */
export function dayFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEFAULT_HELP: HelpResource[] = [
  { name: "Centro de Asistencia al Suicida (Argentina)", detail: "Línea 135 (gratis desde CABA y el Gran Buenos Aires) · (011) 5275-1135 desde todo el país" },
  { name: "Emergencias", detail: "911 en Argentina." },
];

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

export function freshCompanion() {
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
  if (params.has("progress")) for (const n of progressDays) m.set(dayFromNow(-n), new Set(["chat"]));
  return m;
}

export const MOCK_ACADEMIC_KEY = "la.mock.academic";
function loadMockAcademic(): AcademicData {
  if (params.has("panel")) return panelAcademic();
  try {
    return { ...emptyAcademic(), ...JSON.parse(localStorage.getItem(MOCK_ACADEMIC_KEY) ?? "{}") };
  } catch {
    return emptyAcademic();
  }
}

const MOCK_IDENTITY_KEY = "la.mock.identity";
function loadMockIdentity(): Identity {
  const base: Identity = { first_name: params.has("progress") ? "Ana" : "", last_name: "", school: "", career: "", age: null, treatment: "", treatment_other: "", onboarded: !params.has("onboarding") };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(MOCK_IDENTITY_KEY) ?? "{}") };
  } catch {
    return base;
  }
}

export function saveMockIdentity(i: Identity) {
  try {
    localStorage.setItem(MOCK_IDENTITY_KEY, JSON.stringify(i));
  } catch {
    /* private mode */
  }
}

export const store = {
  sessions: new Map<string, Session>(params.has("progress") ? progressSessions().map((x) => [x.id, x]) : []),
  prompts: {} as Record<string, string>,
  ledger: [] as LedgerLine[],
  books: new Map<string, Book>(),
  /** The Markdown each book was built from (OCR'd pages merge into it). */
  bookMarkdown: new Map<string, string>(),
  /** AC-187: per-page OCR results by file hash. */
  ocrCache: new Map<string, Record<string, OcrPageText>>(),
  practice: new Map<string, PracticeSet>(),
  exams: new Map<string, Exam>(),
  decks: new Map<string, Deck>(),
  study: [] as StudyEntry[],
  activity: seedActivity(),
  classes: new Map<string, ClassRecord>(),
  projects: new Map<string, Project>(),
  routes: new Map<string, MockRoute>(),
  folders: (params.has("withFolder") ? [{ ...DEMO_FOLDER }] : []) as SharedFolder[],
  learner: {
    misconceptions: params.has("withProfile") ? [{ concept: "Recta secante", wrong_idea: "toca la curva en un solo punto", fixed: false, source: "Sesión: derivadas", at: "" }] : [],
    preferences: params.has("withProfile") ? [{ text: "entiende mejor con ejemplos numéricos", source: "Sesión: derivadas", at: "" }] : [],
  } as LearnerProfile,
  keys: new Set<string>(params.has("unconfigured") ? [] : ["openrouter", ...(params.has("noSearch") ? [] : ["search"])]),
  invalidKeys: new Set<string>(),
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

/** AC-199: «Lo que Eureka sabe de vos», starting from the profile above. */
export const memory = new MemoryMock(() => store.learner, params.has("withMemory"));

export function touch(kind: string) {
  const day = dayFromNow(0);
  store.activity.set(day, (store.activity.get(day) ?? new Set<string>()).add(kind));
}

export function settingsView(): SettingsView {
  return {
    providers: store.settings.providers.map((p) => ({ ...p, has_key: store.keys.has(p.id) })),
    roles: clone(store.settings.roles),
    search: { base_url: store.searchUrl, has_key: store.keys.has("search") },
    data_dir: "C:\\Users\\demo\\AppData\\Roaming\\lat.eureka.app",
  };
}

export function summary(s: Session): SessionSummary {
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

export function newSession(goal: string): Session {
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

export async function runExtraction(source: LedgerLine["source"], input: string) {
  await sleep(DELAY * 10);
  if (failExtract) throw "el proveedor respondió 503: fake: extractor no disponible";
  const raw = scriptedExtraction(input);
  store.ledger.push({ source, at: nextClock(), ...raw });
  return raw;
}

export function newCard(front: string, back: string, today: string) {
  return { id: nid(), front: front.trim(), back: back.trim(), ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today, reviewed: null };
}

export function addToNamedDeck(name: string, source: Deck["source"], cards: { front: string; back: string }[]): number {
  const today = dayFromNow(0);
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

export function studentModel(): StudentModel {
  if (params.has("progress")) return progressModel();
  const now = new Date().toISOString();
  const topics: TopicState[] = [
    ...store.learner.misconceptions.map((m) => ({ key: m.concept.toLowerCase(), name: m.concept, status: (m.fixed ? "practicando" : "le_cuesta") as TopicState["status"], evidence: [m.fixed ? `la confusión «${m.wrong_idea}» quedó reparada` : `confusión: ${m.wrong_idea}`], at: now, sources: ["confusión"], confusion: !m.fixed })),
    ...[...store.sessions.values()].filter((x) => x.phase === "done").map((x) => ({ key: x.goal.toLowerCase(), name: x.goal, status: "domina" as const, evidence: ["terminaste la sesión"], at: x.updated_at, sources: ["sesión"], confusion: false })),
  ];
  return { topics, pending: [], upcoming: [], preferences: store.learner.preferences.map((p) => p.text), cards_due: 0, minutes_7d: 0 };
}

export function studentToday(): Suggestion[] {
  const open = store.learner.misconceptions.find((m) => !m.fixed);
  return open ? [{ title: `Repasá ${open.concept}`, reason: `confusión: ${open.wrong_idea}`, screen: "chat", target_id: null, prompt: `Quiero repasar ${open.concept}: la última vez me confundí.` }] : [];
}
