// Fake OpenAI-compatible provider for desktop e2e: the REAL Rust agent loop
// talks to it over HTTP + SSE exactly as it would to OpenRouter. It teaches
// with the shared scripted teacher (src/e2e/teacherScript.ts), reading the
// session state from what the app sends: the phase and plan from the system
// prompt's state block, the answers from the tool messages.
//
// Run: node tests/fake-provider/server.ts   (FAKE_PORT, default 4010)
//
// Test control API (same host):
//   POST /__control {"mode": "normal"|"fail-http"|"fail-sse"|"slow"|"runaway", "once"?: true}
//   GET  /__requests   → every chat request body received
//   POST /__reset      → clear requests, mode back to normal
//   GET  /health
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { nextStep, type Step } from "../../src/e2e/teacherScript.ts";
import { viewFrom, type WireMsg } from "./view.ts";
import { scriptedExtraction } from "../../src/e2e/extractScript.ts";
import { scriptedGrade, scriptedProblems } from "../../src/e2e/practiceScript.ts";
import { scriptedCards } from "../../src/e2e/cardsScript.ts";
import { GUIDE_HITS, parseGuide, parseQuestionsInput, scriptedCheck, scriptedExplain, scriptedFoundGuide, scriptedQuestions } from "../../src/e2e/examScript.ts";

type Mode = "normal" | "fail-http" | "fail-sse" | "slow" | "runaway";

const PORT = Number(process.env.FAKE_PORT ?? 4010);

let mode: Mode = "normal";
let once = false;
let calls = 0;
const requests: unknown[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, v: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(v));
}

/** Replies for the forced-tool roles: extractor and practice (src-tauri/src/extract.rs, practice.rs). */
function forcedReply(tool: string, input: string): Record<string, unknown> {
  if (tool === "record_knowledge") return scriptedExtraction(input) as unknown as Record<string, unknown>;
  if (tool === "set_problems") {
    const ids = [...input.matchAll(/^- (p[0-9a-f]{16}): /gm)].map((m) => m[1]);
    const count = Number(/Generá (\d+) problemas/.exec(input)?.[1] ?? 3);
    // AC-167: one at a time, after the ones already written (one "- Nivel" line each).
    const done = (input.match(/^- Nivel \d/gm) ?? []).length;
    return { problems: scriptedProblems(ids, done + count).slice(done) };
  }
  if (tool === "give_hint") {
    const thinking = /## Lo que viene pensando\n([\s\S]*)$/.exec(input)?.[1].trim() ?? "";
    return /listo/i.test(thinking) ? { hint: "Lo que pensaste ya lo resuelve: mandalo como respuesta.", solved: true } : { hint: `Vas bien con «${thinking.slice(0, 40)}». Mirá qué pasa justo en el punto.`, solved: false };
  }
  if (tool === "set_syllabus") return { domains: parseGuide(input) };
  if (tool === "set_cards") return scriptedCards(input, Number(/Escribí (\d+) tarjetas/.exec(input)?.[1] ?? 10));
  if (tool === "check_answers") return scriptedCheck(input);
  if (tool === "submit_cheat_sheet") return { markdown: "## Repaso\n- Lo esencial de cada dominio.\n\n## Trampas frecuentes\n- Leé dos veces la pregunta." };
  if (tool === "submit_exam_guide") return scriptedFoundGuide(/^Examen: (.+)$/m.exec(input)?.[1] ?? "");
  if (tool === "set_exam_questions") return { questions: scriptedQuestions(parseQuestionsInput(input)) };
  if (tool === "submit_research")
    return { summary: "La derivada mide el cambio instantáneo: la **velocidad** es la derivada de la posición [1] y el costo marginal es la derivada del costo [2].", used: [1, 2] };
  if (tool === "grade_answer") {
    const solution = /## Solución de referencia\n([^\n]*)/.exec(input)?.[1] ?? "";
    const answer = /Respuesta del aprendiz: ([^\n]*)/.exec(input)?.[1] ?? "";
    return scriptedGrade(answer, solution);
  }
  return {};
}

/** Splits a string's UTF-8 bytes into small chunks, deliberately cutting
 *  multi-byte characters in half (the Rust parser must reassemble them). */
function byteChunks(s: string, size: number): Buffer[] {
  const b = Buffer.from(s, "utf8");
  const out: Buffer[] = [];
  for (let i = 0; i < b.length; i += size) out.push(b.subarray(i, i + size));
  return out;
}

async function stream(res: ServerResponse, step: Step | null, delay: number) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const events: unknown[] = [];
  if (step?.text) for (const w of step.text.split(/(?<= )/)) events.push({ choices: [{ delta: { content: w } }] });
  (step?.calls ?? []).forEach((c, index) => {
    const id = `call_${++calls}`;
    const args = JSON.stringify(c.args);
    const cut = Math.floor(args.length / 2);
    // Fragmented like real providers: id+name+half the args, then the rest.
    events.push({ choices: [{ delta: { tool_calls: [{ index, id, type: "function", function: { name: c.name, arguments: args.slice(0, cut) } }] } }] });
    events.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(cut) } }] } }] });
  });
  if (mode === "fail-sse") events.splice(Math.min(1, events.length), 0, { error: { message: "fake: el modelo se cayó a mitad de la respuesta" } });

  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  for (const chunk of byteChunks(raw, 7)) {
    if (res.destroyed) return;
    res.write(chunk);
    if (delay) await sleep(delay);
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  try {
    if (url === "/health") return json(res, 200, { ok: true });
    if (url === "/__requests") return json(res, 200, requests);
    if (url === "/__reset") {
      requests.length = 0;
      mode = "normal";
      once = false;
      return json(res, 200, { ok: true });
    }
    if (url === "/__control") {
      const c = JSON.parse(await body(req)) as { mode: Mode; once?: boolean };
      mode = c.mode;
      once = !!c.once;
      return json(res, 200, { mode, once });
    }
    if (url === "/search" && req.method === "POST") {
      const q = JSON.parse(await body(req)) as { query?: string; api_key?: string };
      requests.push({ search: q });
      if (!q.api_key) return json(res, 401, { error: "fake: falta api_key" });
      if (/official exam guide/.test(q.query ?? "")) return json(res, 200, { results: GUIDE_HITS });
      return json(res, 200, {
        results: [
          { title: "Velocidad instantánea", url: "https://fisica.example/velocidad", content: "La velocidad es la derivada de la posición." },
          { title: "Costo marginal", url: "https://economia.example/marginal", content: "El costo marginal es la derivada del costo." },
        ],
      });
    }
    if (url.endsWith("/models")) {
      return json(res, 200, { data: [{ id: "demo/profesor" }, { id: "demo/rapido" }, { id: "demo/vision" }] });
    }
    if (url.endsWith("/chat/completions") && req.method === "POST") {
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("Bearer ") || auth.length < 10) return json(res, 401, { error: { message: "fake: API key inválida" } });
      const reqBody = JSON.parse(await body(req)) as { messages: WireMsg[]; tool_choice?: { function?: { name?: string } } };
      requests.push(reqBody);
      const current = mode;
      if (once) {
        mode = "normal";
        once = false;
      }
      if (current === "fail-http") return json(res, 503, { error: { message: "fake: proveedor no disponible" } });
      // Extractor requests force the record_knowledge tool (src-tauri/src/extract.rs).
      const forcedTool = reqBody.tool_choice?.function?.name;
      const input = String(reqBody.messages.find((m) => m.role === "user")?.content ?? "");
      const system = String(reqBody.messages.find((m) => m.role === "system")?.content ?? "");
      const lastUser = String([...reqBody.messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const step = forcedTool
        ? { calls: [{ name: forcedTool, args: forcedReply(forcedTool, input) }] }
        : system.startsWith("# Profesor: dudas")
          ? { text: scriptedExplain(lastUser) }
        : current === "runaway"
          ? { calls: [{ name: "record_finding", args: { concept: `bucle ${calls}`, level: "partial", evidence: "x" } }] }
          : nextStep(viewFrom(reqBody.messages));
      const saved = mode;
      mode = current; // fail-sse / slow apply to this response
      await stream(res, step, current === "slow" ? 250 : 2);
      mode = saved;
      return;
    }
    json(res, 404, { error: { message: `fake: ruta desconocida ${url}` } });
  } catch (e) {
    json(res, 500, { error: { message: `fake: ${(e as Error).message}` } });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`fake provider listening on http://127.0.0.1:${PORT}/v1`));
