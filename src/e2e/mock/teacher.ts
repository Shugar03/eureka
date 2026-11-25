// Scripted teacher turn execution for the e2e mock backend.
import type { Channel } from "@tauri-apps/api/core";
import type { AgentEvent, LearnerInput, Msg, NodeStatus, Phase, PlanNode, ResearchMeta, Session, ToolCall } from "../../types";
import { excelPlan, organizePlan, overviewMeta } from "../folderMock";
import { mockRouteProposal } from "../routeMock";
import { nextStep, type Call, type TeacherView } from "../teacherScript";
import { DELAY, clone, failMode, nid, noSearch, sleep, store } from "./state";

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
    case "propose_route":
      return "route";
    case "folder_overview":
    case "organize_folder":
    case "propose_changes":
      return "folder";
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
  const meta = { kind: "answer" as const, text: input.text, confidence: input.confidence ?? null, thinking: input.thinking ?? "", ...(input.free ? { free: true } : {}), ...(input.reading?.trim() ? { reading: input.reading.trim() } : {}), ...(input.grade ? { grade: input.grade } : {}) };
  if (s.pending_question) {
    s.messages.push({ role: "tool", tool_call_id: s.pending_question, content: input.text, meta });
    s.pending_question = null;
  } else s.messages.push({ role: "user", content: input.text, meta });
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
    // AC-206: an open PDF to add to the library (the demo serves a fixture in its place).
    documents: [{ title: "Apuntes de física", url: "https://fisica.example/apuntes-fisica.pdf" }],
    uncovered: ["derivada en biología"],
  };
}

export async function runTurn(id: string, input: LearnerInput | null, ch: Channel<AgentEvent>) {
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
      } else if (outcome === "folder") {
        // AC-219/AC-220: the demo has no disk: a sample folder and its plans.
        const folder = store.folders.find((f) => f.label === c.args.folder) ?? store.folders[0];
        if (!folder) s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "error: no hay carpetas compartidas" });
        else if (c.name === "folder_overview") s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "carpeta", meta: overviewMeta(folder.label) });
        else {
          await sleep(DELAY * 8);
          const meta = c.name === "organize_folder" ? organizePlan(calls[j].id, folder) : excelPlan(calls[j].id, folder);
          s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "plan mostrado", meta });
        }
      } else if (outcome === "route") {
        // AC-215: the app researches how it is taught and plans the classes.
        await sleep(DELAY * 10);
        const proposal = mockRouteProposal(String(c.args.topic ?? "Machine Learning"));
        s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "propuesta mostrada", meta: { kind: "route_proposal", proposal } });
      } else s.messages.push({ role: "tool", tool_call_id: calls[j].id, content: "ok" });
    }
    s.updated_at = new Date().toISOString();
    emit({ type: "session", session: clone(s) });
    if (!calls.length) break;
    await sleep(DELAY * 5);
  }
  emit({ type: "done" });
}
