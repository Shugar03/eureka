// Fake Rust backend for browser runs (`vite --mode e2e`): every `invoke` is
// answered here through @tauri-apps/api/mocks, with an in-memory store and a
// SCRIPTED teacher. Deterministic and free — no model calls. Only bundled in
// e2e mode (see main.tsx).
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
//   ?withMemory    the student's memory also has an idea, a pending item and a contradiction
//   ?withFolder    the folder «Apuntes» is already shared (AC-219)
//   ?progress      a student a few weeks in: «Mi progreso» with paths, dates, cards and a streak (AC-210)
//   ?noRust        Rust is not installed (the console explains how to install it)
//   ?noOcr         no local OCR (like the phone): scanned PDFs are refused as before
//   ?ocrUnsure     the OCR reads photos with low confidence (the vision model reads them)
//   ?shortTime     a timed mock lasts 3 seconds per "minute" (to see the clock run out)
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Channel } from "@tauri-apps/api/core";
import type { Accessibility, AgentEvent, Identity, LearnerInput, MemoryKind, PromptView, Session, SettingsInput } from "../types";
import { NOTES_HEADER } from "./extractScript";
import { fold } from "./graphFold";
import { handleAcademic } from "./mock/academic";
import { handleCodeAndMedia } from "./mock/codeAndMedia";
import { handleCompanion } from "./mock/companion";
import { DELAY, UNHANDLED, clone, memory, newSession, nextClock, nid, params, runExtraction, saveMockIdentity, settingsView, sleep, store, studentModel, studentToday, summary, touch } from "./mock/state";
import { handleStudy } from "./mock/study";
import { runTurn } from "./mock/teacher";
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

// What 0.9.0's notes look like once published (scripts/changelog.cjs, appNotes).
const UPDATE_NOTES = "### Mejorado\n- **El profesor contesta mucho más rápido:** ya no se queda pensando en silencio antes de responder. La primera palabra aparece en unos 2 segundos en vez de 15 a 25, y la respuesta entera tarda menos de la mitad.\n- **Podés releer mientras escribe:** si subís en la conversación, ya no te tira para abajo con cada palabra nueva, y aparece «Ir al final» para volver de un toque.\n- **Mi progreso, renovado:** arriba un coach te dice cómo venís y qué te conviene hoy (con un botón para cada cosa); debajo, tu racha, tus temas por estado y tu semana; y cada sesión es un **camino de ideas** al estilo Duolingo, con lo que ya sabés, lo que te cuesta y el próximo paso marcado. Los textos ya no se cortan a la mitad y lo repetido no aparece dos veces.\n- **Acompañamiento tiene micrófono**, y el clip y el micrófono de todas las cajas se ven más limpios.\n- **Logo nuevo:** el elefante ahora es macizo, relleno de violeta, en el ícono de la app, el instalador y la barra lateral.\n\n### Corregido\n- **Hablar más de un minuto ya funciona:** con la voz en esta PC, una grabación larga se corta sola en los silencios y se transcribe entera, en vez de pedirte que la hagas de a partes.\n- Ya no aparece el cartel «Controles de la ventana» al pasar el mouse por la barra de arriba.";

// AC-110: the sessions that left something in memory, newest first.
const memories = () =>
  [...store.sessions.values()]
    .filter((s) => s.memory?.summary)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((s) => ({ id: s.id, title: s.title, updated_at: s.updated_at, archived: !!s.archived, memory: s.memory! }));

export function install() {
  mockIPC(async (cmd, raw) => {
    const args = (raw ?? {}) as Record<string, unknown>;

    for (const handle of [handleCompanion, handleAcademic, handleCodeAndMedia]) {
      const res = await handle(cmd, args);
      if (res !== UNHANDLED) return res;
    }
    const studyRes = await handleStudy(cmd, args, raw);
    if (studyRes !== UNHANDLED) return studyRes;

    switch (cmd) {
      case "get_accessibility":
        return clone(store.accessibility);
      case "save_accessibility": {
        const a = args.input as Accessibility;
        store.accessibility = { ...a, speech_rate: Math.min(1.4, Math.max(0.6, a.speech_rate)) };
        return clone(store.accessibility);
      }
      case "app_version":
        return "0.1.0";
      case "update_check":
        return params.has("update") ? { status: "available", version: "0.2.0", current: "0.1.0", notes: UPDATE_NOTES } : { status: "off" };
      case "update_install": {
        const ch = args.onProgress as Channel<{ stage: string; done?: number; total?: number | null }>;
        const total = 34_000_000;
        for (const f of [0.1, 0.4, 0.7, 1]) {
          await sleep(DELAY * 4 + 150);
          ch.onmessage({ stage: "downloading", done: Math.round(total * f), total });
        }
        ch.onmessage({ stage: "installing" });
        return new Promise(() => {});
      }
      case "fetch_document": {
        if (!String(args.url).endsWith(".pdf")) throw "ese enlace no es un PDF abierto";
        await sleep(DELAY * 4);
        return await (await fetch("/tests/fixtures/apuntes-fisica.pdf")).arrayBuffer();
      }
      case "update_whats_new":
        return params.has("whatsNew") ? { version: "0.1.0", from: "0.0.9", notes: UPDATE_NOTES } : null;
      case "get_settings":
        return settingsView();
      case "save_settings": {
        const input = args.input as SettingsInput;
        for (const p of input.providers) {
          if (p.clear_key) store.keys.delete(p.id);
          else if (p.api_key?.trim()) store.keys.add(p.id);
          if (p.clear_key || p.api_key?.trim()) {
            if (p.api_key?.trim() === "sk-demo-invalid" && !p.clear_key) store.invalidKeys.add(p.id);
            else store.invalidKeys.delete(p.id);
          }
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
        store.invalidKeys.delete(id);
        const model = id === "opencode-go" ? "deepseek-v4.1-flash" : "demo/profesor";
        store.settings.roles.teacher = { provider_id: id, model };
        const label = store.settings.providers.find((p) => p.id === id)!.label;
        return { status: "done", provider_id: id, provider: label, model, context_k: id === "openrouter" ? 128 : null, alternatives: ["deepseek-v4-pro", "glm-5.3"], speech_ready: !!store.settings.roles.speech.model, tools_ok: true };
      }
      case "check_provider":
        if (!store.keys.has(args.providerId as string)) throw "falta la API key";
        if (store.invalidKeys.has(args.providerId as string)) throw "401 invalid API key";
        return null;
      case "list_models":
        if (!store.keys.has(args.providerId as string)) throw "falta la API key";
        return ["demo/profesor", "demo/rapido", "demo/vision"];
      case "get_identity":
        return clone(store.identity);
      case "save_identity":
        store.identity = { ...(args.input as Identity) };
        saveMockIdentity(store.identity);
        return clone(store.identity);
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
      case "get_session": {
        const s = store.sessions.get(args.id as string);
        if (!s) throw "sesión no encontrada";
        return clone(s);
      }
      case "delete_session": {
        // AC-107: what was learned stays unless the person asks to forget it too.
        const s = store.sessions.get(args.id as string);
        if (args.forget && s?.graph) store.ledger.push({ source: { kind: "session", id: s.id, title: s.title }, at: nextClock(), propositions: [], chains: [] });
        store.sessions.delete(args.id as string);
        return null;
      }
      case "get_learner":
        return clone(store.learner);
      case "memory_list":
        return memory.view();
      case "memory_edit":
        return memory.edit(Number(args.id), String(args.title ?? ""), String(args.content ?? ""), args.kind as MemoryKind);
      case "memory_delete":
        return memory.remove(Number(args.id));
      case "memory_forget_all":
        return memory.forgetAll();
      case "memory_export":
        return memory.exportPath();
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
      case "reset_prompt":
        delete store.prompts[args.name as string];
        return null;
      case "get_graph":
        return fold(store.ledger);
      case "extract_session": {
        const s = store.sessions.get(args.id as string);
        if (!s) throw "sesión no encontrada";
        const rawExt = await runExtraction({ kind: "session", id: s.id, title: s.title }, `# Sesión: ${s.title}`);
        s.graph = { propositions: rawExt.propositions.length, chains: rawExt.chains.length, at: new Date().toISOString(), messages: s.messages.length };
        return clone(s);
      }
      case "forget_source": {
        const src = args.source as { kind: "session" | "notes"; id: string; title: string };
        store.ledger.push({ source: src, at: nextClock(), propositions: [], chains: [] });
        return fold(store.ledger);
      }
      case "import_notes": {
        const title = String(args.title ?? "").trim();
        const text = String(args.text ?? "").trim();
        if (!title || !text) throw "Poné un título y pegá el texto de las notas.";
        await runExtraction({ kind: "notes", id: nid(), title }, `${NOTES_HEADER} ${title}\n${text}`);
        return fold(store.ledger);
      }
      case "usage_summary": {
        const t = (calls: number, known: number, input: number, output: number, cached: number | null, cost: number | null) => ({ calls, known, input, output, cached, reasoning: null, cost, ms: calls * 1800 });
        return {
          today: t(14, 14, 98_400, 3_120, 61_500, 0.0213),
          week: t(52, 50, 401_200, 12_870, 236_700, 0.0874),
          by_role: [
            { key: "teacher", label: "Profesor en la sesión", totals: t(30, 30, 288_000, 8_100, 190_000, 0.061) },
            { key: "prober", label: "Diagnóstico", totals: t(8, 8, 52_400, 1_900, 31_200, 0.012) },
            { key: "memory", label: "Memoria e ideas", totals: t(6, 6, 33_800, 1_500, 0, 0.0084) },
            { key: "practice", label: "Práctica y código", totals: t(8, 6, 27_000, 1_370, 15_500, 0.006) },
          ],
          sessions: [{ key: "demo", label: "qué es una derivada", totals: t(22, 22, 171_300, 5_400, 118_000, 0.0371) }],
          keep_days: 90,
        };
      }
      case "create_backup":
        return "C:\\Users\\demo\\Downloads\\Eureka-respaldo-20261027-1530.zip";
      case "restore_backup": {
        const bytes = args.bytes as number[];
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw "Ese archivo no es un respaldo de Eureka (.zip).";
        return 3;
      }
    }
    throw `comando no simulado: ${cmd}`;
  });
}
