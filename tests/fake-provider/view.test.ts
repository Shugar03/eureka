// Contract between the Rust prompt/answer formats and the fake provider.
import { describe, expect, it } from "vitest";
import { viewFrom } from "./view.ts";

const system = `# El agente\n...\n# Estado actual de la sesión\n\n- Objetivo del aprendiz: x\n- Fase: teach\n\n## Plan\n- [known] \`pendiente\` Pendiente\n- [current] \`limite\` Límite ← pendiente\n`;

describe("viewFrom: a free chat (AC-89)", () => {
  const chat = `# Estado actual de la sesión

- Fase: chat (conversación libre).
- Todavía no hay un objetivo de aprendizaje: la persona no pidió aprender nada concreto.
`;

  it("reads the chat phase and the person's message, so the script can decide", () => {
    const v = viewFrom([{ role: "system", content: "# Fase: Charla" }, { role: "user", content: "hola, quiero aprender python" }, { role: "user", content: `<estado_app>${chat}</estado_app>` }]);
    expect(v.phase).toBe("chat");
    expect(v.lastAnswer).toBe("hola, quiero aprender python");
    expect(v.afterLearner).toBe(true);
  });
});

describe("viewFrom", () => {
  it("reads phase and node statuses from the state block", () => {
    const v = viewFrom([{ role: "system", content: system }]);
    expect(v.phase).toBe("teach");
    expect(v.status("pendiente")).toBe("known");
    expect(v.status("limite")).toBe("current");
    expect(v.status("nada")).toBeUndefined();
  });

  it("counts answers and takes the latest one, right after learner input", () => {
    const v = viewFrom([
      { role: "system", content: system },
      { role: "user", content: "Quiero entender: x" },
      { role: "tool", tool_call_id: "a", content: "Respuesta del aprendiz: sube 2\nConfianza: 4/5" },
      { role: "tool", tool_call_id: "b", content: "ok" },
      { role: "tool", tool_call_id: "c", content: "Respuesta del aprendiz: A 0\nConfianza: 3/5" },
    ]);
    expect(v.answered).toBe(2);
    expect(v.lastAnswer).toBe("A 0");
    expect(v.afterLearner).toBe(true);
  });

  it("is not after learner input when the last message is a tool ack", () => {
    const v = viewFrom([
      { role: "system", content: system },
      { role: "user", content: "hola" },
      { role: "assistant", content: null, tool_calls: [] },
      { role: "tool", tool_call_id: "x", content: "ok" },
    ]);
    expect(v.afterLearner).toBe(false);
    expect(v.lastAnswer).toBe("hola");
  });

  it("reads the state from the last <estado_app> message and ignores it as learner input", () => {
    const stateMsg = { role: "user", content: `<estado_app>
(Lo genera la app.)

${system}
</estado_app>` };
    const v = viewFrom([
      { role: "system", content: "# El agente\n# Fase: ENSEÑAR" },
      { role: "user", content: "Quiero entender: x" },
      { role: "assistant", content: null, tool_calls: [] },
      { role: "tool", tool_call_id: "x", content: "ok" },
      stateMsg,
    ]);
    expect(v.phase).toBe("teach");
    expect(v.status("limite")).toBe("current");
    expect(v.afterLearner).toBe(false);
    expect(v.lastAnswer).toBe("Quiero entender: x");
  });

  it("defaults to the probe phase", () => {
    expect(viewFrom([{ role: "system", content: "sin estado" }]).phase).toBe("probe");
  });
});
