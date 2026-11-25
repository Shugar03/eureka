// Code console, projects, library/OCR, folders, vision and speech mock IPC handlers.
import type { Channel } from "@tauri-apps/api/core";
import type { Book, Lang, OcrPageInput, OcrPageText, Project } from "../../types";
import { withTests } from "../../lib/code";
import { scriptedExercise, scriptedRun } from "../codeScript";
import { SAMPLE_GUIDE } from "../examScript";
import { DEMO_FOLDER } from "../folderMock";
import * as lib from "../libraryScript";
import { SAMPLE_CURRICULUM_TEXT } from "./academic";
import { DELAY, UNHANDLED, addToNamedDeck, clone, nextClock, nid, params, sleep, store } from "./state";

/** AC-187: what the scripted OCR "reads" on each scanned page. */
const OCR_PAGES = [
  "La célula es la unidad básica de la vida: todos los seres vivos están formados por células.",
  "La mitocondria produce la energía que la célula usa para crecer y dividirse.",
  "El ribosoma arma las proteínas siguiendo las instrucciones del ADN.",
];

// AC-106/AC-185: the local speech models (sizes as in the backend; Parakeet v3 is the default).
const LOCAL_MODELS = [
  { id: "parakeet-v3", label: "Mejor calidad (Parakeet v3)", bytes: 670_479_942 },
  { id: "whisper-tiny", label: "Liviano (Whisper tiny)", bytes: 151_061_672 },
  { id: "whisper-base", label: "Liviano, mejor (Whisper base)", bytes: 290_403_936 },
];
const localInstalled = new Set<string>();
const localSpeech = () => LOCAL_MODELS.map((m) => ({ ...m, installed: localInstalled.has(m.id) }));

export async function handleCodeAndMedia(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    // ── Library & OCR ──
    case "import_book": {
      const title = String(args.title ?? "").trim();
      if (!title) throw "Poné un título.";
      const ocr = args.ocr as { hash: string; pages: OcrPageInput[]; pending: number[] } | null | undefined;
      const markdown = ocr ? lib.mergePages(String(args.markdown ?? ""), ocr.pages) : String(args.markdown ?? "");
      const sections = lib.sections(markdown);
      if (!sections.some((s) => s.markdown.replace(/<!-- p:\d+ -->/g, "").trim())) throw (args.scanned as number[]).length ? "El PDF no tiene texto seleccionable (parece escaneado)." : "El documento no tiene texto.";
      const b: Book = { id: nid(), title, file_name: String(args.fileName ?? ""), created_at: new Date(nextClock()).toISOString(), pages: Number(args.pages ?? 0), scanned: (args.scanned as number[]) ?? [], sections, ocr: ocr ? { hash: ocr.hash, pages: [], pending: [], review: [] } : null };
      if (ocr) lib.applyOcr(b, ocr.pages, ocr.pending);
      store.books.set(b.id, b);
      store.bookMarkdown.set(b.id, markdown);
      return lib.summary(b);
    }
    case "import_document": {
      // Raw bytes like the real command (AC-191): the head with title and name, then the file.
      const { title, fileName, markdown } = lib.officeImport(args as unknown as Uint8Array);
      await sleep(DELAY);
      const b: Book = { id: nid(), title, file_name: fileName, created_at: new Date(nextClock()).toISOString(), pages: 0, scanned: [], sections: lib.sections(markdown), ocr: null };
      store.books.set(b.id, b);
      store.bookMarkdown.set(b.id, markdown);
      return lib.summary(b);
    }
    case "add_ocr_pages": {
      const b = store.books.get(args.id as string);
      if (!b) throw "Ese libro ya no está en la biblioteca.";
      if (!b.ocr) throw "Ese libro no se está leyendo con OCR.";
      const markdown = lib.mergePages(store.bookMarkdown.get(b.id) ?? "", args.pages as OcrPageInput[]);
      store.bookMarkdown.set(b.id, markdown);
      b.sections = lib.sections(markdown);
      lib.applyOcr(b, args.pages as OcrPageInput[], args.pending as number[]);
      return lib.summary(b);
    }
    case "ocr_available":
      return !params.has("noOcr");
    case "ocr_page": {
      // Raw bytes like the real command: width, height, page (0 = a photo), then RGBA.
      const body = args as unknown as Uint8Array;
      const head = new DataView(body.buffer, body.byteOffset, 12);
      const [w, h, page] = [head.getUint32(0, true), head.getUint32(4, true), head.getUint32(8, true)];
      if (body.length !== 12 + w * h * 4) throw "La imagen llegó incompleta.";
      await sleep(DELAY * 4);
      const text = page ? OCR_PAGES[(page - 1) % OCR_PAGES.length] : "Mitocondria: produce la energía de la célula. Ribosoma: sintetiza proteínas.";
      const confidence = page ? (page === 2 ? 0.93 : 0.98) : params.has("ocrUnsure") ? 0.55 : 0.96;
      const review = page === 2 ? ["la rnitocondria"] : [];
      return { markdown: text, lines: [{ text, confidence, bbox: [0, 0, w, h / 10] }], confidence, chars: text.replace(/[^\p{L}\p{N}]/gu, "").length, review };
    }
    case "ocr_cached":
      return { ...(store.ocrCache.get(args.hash as string) ?? {}) };
    case "ocr_cache_put": {
      const c = store.ocrCache.get(args.hash as string) ?? {};
      c[String(args.page)] = args.text as OcrPageText;
      store.ocrCache.set(args.hash as string, c);
      return null;
    }
    case "ocr_cache_clear":
      store.ocrCache.delete(args.hash as string);
      return null;
    case "list_books":
      return [...store.books.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(lib.summary);
    case "get_book": {
      const b = store.books.get(args.id as string);
      if (!b) throw "Ese libro ya no está en la biblioteca.";
      return clone(b);
    }
    case "delete_book":
      store.books.delete(args.id as string);
      store.bookMarkdown.delete(args.id as string);
      return null;
    case "search_library":
      return lib.search([...store.books.values()], String(args.query ?? ""), Number(args.limit ?? 10));

    // ── Working folders (AC-219..AC-222) ──
    case "folders_list":
      return clone(store.folders);
    case "folder_share": {
      // The demo has no folder dialog: it shares the sample «Apuntes».
      if (!store.folders.some((f) => f.id === DEMO_FOLDER.id)) store.folders.push({ ...DEMO_FOLDER, writable: !!args.writable });
      return clone(store.folders.find((f) => f.id === DEMO_FOLDER.id));
    }
    case "folder_remove":
      store.folders = store.folders.filter((f) => f.id !== args.id);
      return clone(store.folders);
    case "folder_set_writable": {
      const f = store.folders.find((x) => x.id === args.id);
      if (f) f.writable = !!args.writable;
      return clone(store.folders);
    }
    case "folder_plan_apply":
    case "folder_plan_undo": {
      const s = store.sessions.get(args.sessionId as string);
      const m = s?.messages.find((x) => x.role === "tool" && x.tool_call_id === args.callId);
      if (!s || !m || m.meta?.kind !== "folder_plan") throw "no encuentro ese plan";
      if (cmd === "folder_plan_apply") {
        if (m.meta.status !== "proposed") throw "Este plan ya se aplicó.";
        m.meta = { ...m.meta, status: "applied", done: m.meta.ops.length };
      } else {
        if (m.meta.status !== "applied") throw "Este plan no está aplicado.";
        m.meta = { ...m.meta, status: "undone", kept: [] };
      }
      return clone(s);
    }

    // ── Code console & projects ──
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
    case "save_code_card": {
      const names: Record<string, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", rust: "Rust" };
      return addToNamedDeck(`Errores de ${names[String(args.lang)]}`, { kind: "manual" }, [{ front: String(args.front), back: String(args.back) }]);
    }
    case "generate_code_exercise": {
      if (!String(args.topic ?? "").trim()) throw "Escribí el tema que querés practicar.";
      await sleep(DELAY * 10);
      return scriptedExercise(args.lang as Lang, String(args.topic));
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

    // ── Vision & language/speech ──
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
    default:
      return UNHANDLED;
  }
}
