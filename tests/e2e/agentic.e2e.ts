// An AI agent uses the app like a learner (agent.act / agent.assert), with a
// locator check after each step that does not depend on the model.
// Needs OPENROUTER_API_KEY (model: E2E_MODEL); skipped without it.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { pending } from "./helpers";

const skip = process.env.OPENROUTER_API_KEY ? false : "definí OPENROUTER_API_KEY para correr los tests con agente";

test("agente: un aprendiz arranca una sesión y responde el diagnóstico", { skip }, async ({ app, agent, screen }) => {
  await app.open("/");

  await agent.act("empezá una sesión para aprender {goal}", { params: { goal: "qué es una derivada" } });
  await expect(pending(screen)).toBeVisible({ timeout: 15_000 });

  await agent.act("respondé la pregunta de diagnóstico con tus palabras, elegí una confianza y enviala");
  await expect(screen.getByTestId("findings")).toContainText("Pendiente", { timeout: 15_000 });
  await agent.assert("el panel de diagnóstico muestra un hallazgo sobre la pendiente");
});

test("agente: completa el diagnóstico y ve el plan", { skip }, async ({ app, agent, screen }) => {
  await app.open("/");
  await agent.act("empezá una sesión para aprender qué es una derivada");
  await agent.act("respondé las preguntas de diagnóstico hasta que aparezca el plan de aprendizaje");

  await expect(screen.getByTestId("plan-tree")).toBeVisible({ timeout: 20_000 });
  await agent.assert("hay un árbol de pasos que termina en la derivada");
});
