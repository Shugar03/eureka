// Reads the scripted teacher's inputs back out of an OpenAI chat request:
// phase and plan from the state block (src-tauri/src/prompts.rs state_block,
// sent as the last `<estado_app>` user message by context::state_message),
// answers from the tool messages (src-tauri/src/tools.rs add_learner_input).
// If either format changes, tests/fake-provider/view.test.ts fails.
import type { TeacherView } from "../../src/e2e/teacherScript.ts";

export type WireMsg = { role: string; content?: string | null; tool_call_id?: string; tool_calls?: unknown[] };

export const ANSWER = "Respuesta del aprendiz: ";

/** Messages the app adds for the model (state, notes): not the learner's. */
const synthetic = (m: WireMsg) => m.role === "user" && /^<(estado_app|nota_app)>/.test(String(m.content ?? ""));

/** Rebuilds what the script needs from the request, like a real model would. */
export function viewFrom(messages: WireMsg[]): TeacherView {
  const stateMsg = [...messages].reverse().find((m) => m.role === "user" && String(m.content ?? "").startsWith("<estado_app>"));
  const state = String((stateMsg ?? messages[0])?.content ?? "");
  const phase = (/- Fase: (\w+)/.exec(state)?.[1] ?? "probe") as TeacherView["phase"];
  const statuses = new Map<string, string>();
  for (const m of state.matchAll(/^- \[(\w+)\] `([^`]+)`/gm)) statuses.set(m[2], m[1]);

  const convo = messages.filter((m) => !synthetic(m));
  const isAnswer = (m: WireMsg) => m.role === "tool" && String(m.content ?? "").startsWith(ANSWER);
  const learnerText = (m: WireMsg) =>
    isAnswer(m) ? String(m.content).slice(ANSWER.length).split("\n")[0] : String(m.content ?? "");
  const learner = [...convo].reverse().find((m) => isAnswer(m) || m.role === "user");
  const last = convo[convo.length - 1];

  return {
    phase,
    answered: convo.filter(isAnswer).length,
    status: (id) => statuses.get(id) as ReturnType<TeacherView["status"]>,
    lastAnswer: learner ? learnerText(learner) : null,
    afterLearner: !!last && (last.role === "user" || isAnswer(last)),
    afterResearch: !!last && last.role === "tool" && /^(Investigación:|Investigación en curso|error: búsqueda)/.test(String(last.content ?? "")),
  };
}
