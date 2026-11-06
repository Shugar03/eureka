// features/piensa-y-se-adapta.feature — AC-166 … AC-168 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, pending, phase, startSession } from "./helpers.ts";

const DERIVADA = "La derivada es la pendiente de la recta tangente";
const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function withGraph(app: App, screen: Screen) {
  await startSession(app, screen, "qué es una derivada");
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
}

async function newPractice(screen: Screen) {
  await nav(screen).getByRole("button", "Práctica").click();
  await screen.getByRole("checkbox", DERIVADA).check();
  await screen.getByRole("radio", "3 problemas").click();
  await screen.getByRole("button", /^Generar/).click();
  await expect(screen.getByTestId("problem-progress")).toBeVisible({ timeout: 10_000 });
}

test("AC-166 lo que pienso mientras leo viaja con mi respuesta", async ({ app, screen }) => {
  await startSession(app, screen, "qué es una derivada");
  await finishProbe(screen);
  const notes = screen.getByRole("textbox", "Lo que voy pensando mientras leo");
  await expect(notes).toHaveCount(1);
  await notes.fill("no me cierra por qué la tangente toca en un solo punto");
  await answer(screen, { text: "una recta", confidence: 3 });
  await expect(screen.getByTestId("answer").filter({ hasText: "una recta" })).toContainText("Mientras leías: “no me cierra por qué la tangente toca en un solo punto”", { timeout: 10_000 });
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("textbox", "Lo que voy pensando mientras leo")).toHaveValue("");
});

test("AC-167 la práctica se escribe de a uno y sube de nivel", async ({ app, screen }) => {
  await withGraph(app, screen);
  await newPractice(screen);
  const progress = screen.getByTestId("problem-progress");
  await expect(progress).toContainText("Problema 1 de 3");
  await expect(screen.getByTestId("problem-level")).toHaveText(/^una idea · contexto conocido$/i);
  await answer(screen, { text: "Va a 6 m/s", confidence: 5 });
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await screen.getByRole("button", "Siguiente").click();
  await expect(progress).toContainText("Problema 2 de 3", { timeout: 10_000 });
  await expect(screen.getByTestId("problem-level")).toHaveText(/^una idea · contexto nuevo$/i);
  await expect(pending(screen)).toBeVisible();
});

test("AC-168 un empujón desde lo que vengo pensando", async ({ app, screen }) => {
  await withGraph(app, screen);
  await newPractice(screen);
  const hints = screen.getByRole("region", "Pistas");
  const nudge = hints.getByRole("button", /^Necesito un empujón/);
  await expect(nudge).toBeDisabled();
  await pending(screen).getByRole("textbox", "Tu respuesta").fill("derivé y me dio 2t");
  await expect(nudge).toBeEnabled();
  await nudge.click();
  await expect(screen.getByTestId("nudge")).toContainText("derivé y me dio 2t", { timeout: 10_000 });
  await expect(hints).toContainText(/empujón 1/i);
  await expect(hints.getByRole("button", "Necesito un empujón (1/3)")).toBeVisible();

  await pending(screen).getByRole("button", "+ Contar cómo lo pensé").click();
  await pending(screen).getByRole("textbox", "Pensando en voz alta").fill("2 por 3 es 6, listo");
  await hints.getByRole("button", "Necesito un empujón (1/3)").click();
  await expect(hints.getByRole("status")).toContainText("mandalo como respuesta", { timeout: 10_000 });
  await expect(screen.getByTestId("nudge")).toHaveCount(1);
});
