import { describe, expect, it } from "vitest";
import { buildTranscript, needsAgent, parseAction } from "./transcript";
import type { Msg, Session } from "../types";

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

function session(messages: Msg[], extra: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "t",
    goal: "g",
    phase: "probe",
    created_at: "",
    updated_at: "",
    findings: [],
    plan: [],
    pending_question: null,
    messages,
    ...extra,
  };
}

describe("buildTranscript", () => {
  it("renders an answered question with the learner's answer attached", () => {
    const s = session([
      { role: "user", content: "Quiero entender: g" },
      { role: "assistant", content: "Hola", tool_calls: [call("q1", "ask_question", { question: "¿Qué?", purpose: "probe" })] },
      { role: "tool", tool_call_id: "q1", content: "x", meta: { kind: "answer", text: "esto", confidence: 3, thinking: "" } },
    ]);
    const items = buildTranscript(s);
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "question"]);
    const q = items[2];
    expect(q.kind === "question" && q.answer?.text).toBe("esto");
    expect(q.kind === "question" && q.pending).toBe(false);
  });

  it("marks only the pending question as pending", () => {
    const s = session(
      [{ role: "assistant", tool_calls: [call("q1", "ask_question", { question: "a", purpose: "check" })] }],
      { pending_question: "q1" },
    );
    const [q] = buildTranscript(s);
    expect(q.kind === "question" && q.pending).toBe(true);
  });

  it("turns state tools into short event labels and hides tool messages", () => {
    const s = session(
      [
        {
          role: "assistant",
          tool_calls: [
            call("c1", "record_finding", { concept: "Límite", level: "partial", evidence: "" }),
            call("c2", "update_node", { id: "lim", status: "understood" }),
            call("c3", "set_phase", { phase: "teach" }),
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "ok" },
      ],
      { plan: [{ id: "lim", title: "Límites", summary: "", depends_on: [], status: "understood", note: "" }] },
    );
    const labels = buildTranscript(s).map((i) => (i.kind === "event" ? i.label : i.kind));
    expect(labels).toEqual(["Diagnóstico: Límite → parcial", "Límites → entendido", "Fase: Enseñar"]);
  });

  it("skips malformed tool arguments instead of crashing", () => {
    const s = session([
      { role: "assistant", tool_calls: [{ id: "x", type: "function", function: { name: "ask_question", arguments: "{oops" } }] },
    ]);
    expect(buildTranscript(s)).toEqual([]);
  });
});

describe("needsAgent", () => {
  it("is true for a fresh session and after an answer", () => {
    expect(needsAgent(session([{ role: "user", content: "Quiero entender: g" }]))).toBe(true);
    expect(needsAgent(session([{ role: "assistant", tool_calls: [call("q", "ask_question", {})] }, { role: "tool", tool_call_id: "q", content: "a" }]))).toBe(true);
  });

  it("is false when a turn ended on another tool with no closing text", () => {
    const closed = session([{ role: "assistant", tool_calls: [call("u", "update_node", {}), call("p", "set_phase", { phase: "done" })] }, { role: "tool", tool_call_id: "u", content: "ok" }, { role: "tool", tool_call_id: "p", content: "ok" }], { phase: "done" });
    expect(needsAgent(closed)).toBe(false);
    expect(needsAgent(session([]))).toBe(false);
  });

  it("is false while a question waits or after the assistant spoke", () => {
    expect(needsAgent(session([{ role: "user", content: "x" }], { pending_question: "q" }))).toBe(false);
    expect(needsAgent(session([{ role: "assistant", content: "hola" }]))).toBe(false);
  });
});

describe("buildTranscript (mutation-driven edge cases)", () => {
  it("labels a plan with its node count, and 0 when nodes are missing", () => {
    const s = session([
      { role: "assistant", tool_calls: [call("p1", "set_plan", { nodes: [{}, {}, {}] }), call("p2", "set_plan", {})] },
    ]);
    expect(buildTranscript(s).map((i) => (i.kind === "event" ? i.label : ""))).toEqual(["Plan actualizado (3 pasos)", "Plan actualizado (0 pasos)"]);
  });

  it("names the updated node by its own id, not the first plan node", () => {
    const node = (id: string, title: string) => ({ id, title, summary: "", depends_on: [], status: "pending" as const, note: "" });
    const s = session([{ role: "assistant", tool_calls: [call("u", "update_node", { id: "b", status: "current" })] }], {
      plan: [node("a", "Primero"), node("b", "Segundo")],
    });
    expect(buildTranscript(s)[0]).toMatchObject({ kind: "event", label: "Segundo → ahora" });
  });

  it("drops a diagram without code and a demo without HTML", () => {
    const s = session([
      { role: "assistant", tool_calls: [call("d", "show_diagram", { title: "D", html: "<p/>" }), call("m", "show_demo", { title: "M", mermaid: "graph TD" })] },
    ]);
    expect(buildTranscript(s)).toEqual([]);
  });

  it("falls back to the node id when the plan has no such node", () => {
    const s = session([{ role: "assistant", tool_calls: [call("u", "update_node", { id: "ghost", status: "repair" })] }]);
    expect(buildTranscript(s)[0]).toMatchObject({ kind: "event", label: "ghost → a reparar" });
  });

  it("only tool messages with answer meta count as answers", () => {
    const s = session([
      { role: "assistant", tool_calls: [call("q1", "ask_question", { question: "a", purpose: "probe" })] },
      { role: "tool", tool_call_id: "q1", content: "ok" },
    ]);
    const [q] = buildTranscript(s);
    expect(q.kind === "question" && q.answer).toBeNull();
  });

  it("skips whitespace-only assistant text and unknown tools", () => {
    const s = session([{ role: "assistant", content: "   ", tool_calls: [call("x", "mystery", { a: 1 })] }]);
    expect(buildTranscript(s)).toEqual([]);
  });

  it("uses the meta text for learner messages and keys items uniquely", () => {
    const s = session([
      { role: "user", content: "raw", meta: { kind: "answer", text: "visible", confidence: null, thinking: "" } },
      { role: "user", content: "otro" },
    ]);
    const items = buildTranscript(s);
    expect(items.map((i) => (i.kind === "user" ? i.text : ""))).toEqual(["visible", "otro"]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});

describe("library citations (AC-72)", () => {
  it("[Ln] becomes the real source and unknown numbers are flagged", () => {
    const s = session([
        { role: "user", content: "qué es la derivada" },
        { role: "assistant", content: null, tool_calls: [{ id: "l1", type: "function", function: { name: "library_search", arguments: '{"query":"derivada"}' } }] },
        { role: "tool", tool_call_id: "l1", content: "…", meta: { kind: "library", query: "derivada", tokens: 310, refs: [{ n: 1, book_id: "b", book_title: "Cálculo I", section_id: 1, section: "Derivadas › Recta tangente", page: 2 }] } },
        { role: "assistant", content: "Es la pendiente [L1], no un área [L7]." },
      ] as Msg[]);
    const items = buildTranscript(s);
    expect(items).toContainEqual({ kind: "event", key: "l1", label: "Buscó en tu biblioteca: «derivada» (1 fragmento, ~310 tokens)" });
    expect(items[items.length - 1]).toMatchObject({ kind: "assistant", text: "Es la pendiente [Cálculo I, «Recta tangente», p. 2], no un área [cita no verificada]." });
  });
});

describe("a free chat and the buttons the agent offers (AC-89, AC-90)", () => {
  it("shows begin_learning as an event and propose_action as a button, in order", () => {
    const items = buildTranscript(
      session(
        [
          { role: "user", content: "hola, quiero aprender python" },
          { role: "assistant", content: "¡Dale!", tool_calls: [call("b1", "begin_learning", { goal: "Python desde cero" }), call("a1", "propose_action", { kind: "open_screen", screen: "library", label: "Abrir la biblioteca" })] },
          { role: "tool", tool_call_id: "b1", content: "ok" },
          { role: "tool", tool_call_id: "a1", content: "botón mostrado" },
        ],
        { phase: "chat" },
      ),
    );
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "event", "action"]);
    expect(items[2]).toMatchObject({ label: "Empezó a aprender: Python desde cero" });
    expect(items[3]).toMatchObject({ kind: "action", action: { kind: "open_screen", screen: "library", label: "Abrir la biblioteca" } });
  });

  it("only turns into a button what the backend would also accept", () => {
    const ok = (a: unknown) => parseAction(JSON.stringify(a)) !== null;
    expect(ok({ kind: "open_screen", screen: "cards", label: "Tarjetas" })).toBe(true);
    expect(ok({ kind: "open_screen", screen: "bank", label: "Banco" })).toBe(false);
    expect(ok({ kind: "open_screen", label: "Sin pantalla" })).toBe(false);
    expect(ok({ kind: "start_pomodoro", label: "Pomodoro" })).toBe(true);
    expect(ok({ kind: "start_pomodoro", minutes: 90, label: "Pomodoro" })).toBe(true);
    expect(ok({ kind: "start_pomodoro", minutes: 91, label: "Pomodoro" })).toBe(false);
    expect(ok({ kind: "set_reminders", stand_minutes: 25, label: "R" })).toBe(true);
    expect(ok({ kind: "set_reminders", label: "R" })).toBe(false);
    expect(ok({ kind: "set_reminders", water_minutes: 5, label: "R" })).toBe(false);
    expect(ok({ kind: "format_disk", label: "No" })).toBe(false);
    expect(ok({ kind: "start_pomodoro", label: "  " })).toBe(false);
    expect(ok({ kind: "start_pomodoro", label: "x".repeat(61) })).toBe(false);
    expect(parseAction("no json")).toBeNull();
  });

  it("shows a timetable the agent proposes as a card to confirm, only if it would be accepted", () => {
    const good = { term: { name: "2.º cuatrimestre 2026" }, courses: [{ name: "Análisis I", slots: [{ weekday: 1, start: "10:00", end: "12:00" }] }], dates: [{ kind: "parcial", title: "Primer parcial", date: "2026-11-12" }] };
    const items = buildTranscript(
      session(
        [
          { role: "user", content: "mi horario: lunes de 10 a 12 Análisis" },
          { role: "assistant", content: "Te lo armé.", tool_calls: [call("t1", "propose_timetable", good), call("t2", "propose_timetable", { courses: [{ name: "Física", slots: [{ weekday: 2, start: "12:00", end: "10:00" }] }] })] },
          { role: "tool", tool_call_id: "t1", content: "propuesta mostrada" },
          { role: "tool", tool_call_id: "t2", content: "error: …" },
        ],
        { phase: "chat" },
      ),
    );
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "timetable"]);
    expect(items[2]).toMatchObject({ kind: "timetable", proposal: { term: { name: "2.º cuatrimestre 2026" } } });
  });
});

describe("an exam proposal and free messages during a question (AC-120, AC-121)", () => {
  it("shows an exam proposal as a card and ignores one the backend would refuse", () => {
    const items = buildTranscript(
      session(
        [
          { role: "user", content: "quiero rendir la AWS el 15 de diciembre" },
          { role: "assistant", content: "Dale.", tool_calls: [call("e1", "propose_exam", { name: "AWS Certified AI Practitioner", exam_date: "2026-12-15" }), call("e2", "propose_exam", { name: "X", exam_date: "mañana" })] },
        ],
        { phase: "chat" },
      ),
    );
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "exam"]);
    expect(items[2]).toMatchObject({ proposal: { name: "AWS Certified AI Practitioner", exam_date: "2026-12-15", kind: "certification" } });
  });

  it("a message written in the chat while a question waited is the person's bubble, and the question says so", () => {
    const items = buildTranscript(
      session([
        { role: "assistant", content: null, tool_calls: [call("q1", "ask_question", { question: "¿Y?", purpose: "probe" })] },
        { role: "tool", tool_call_id: "q1", content: "El aprendiz escribió libremente…", meta: { kind: "answer", text: "esperá, antes explicame algo", confidence: null, thinking: "", free: true } },
      ]),
    );
    expect(items.map((i) => i.kind)).toEqual(["question", "user"]);
    expect(items[0]).toMatchObject({ answer: null, pending: false, inChat: true });
    expect(items[1]).toMatchObject({ text: "esperá, antes explicame algo" });
  });
});
