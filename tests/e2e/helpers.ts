// Shared steps for the flow tests. They follow the scripted teacher in
// src/e2e/mockBackend.ts, so the questions and options are known in advance.
import { expect } from "e2e";
import type { App, Screen } from "e2e";

export const GOAL = "qué es una derivada";

export async function startSession(app: App, screen: Screen, goal = GOAL, query = "") {
  await app.open(`/${query}`);
  // A chat first: saying what you want to understand is what makes the agent start the method.
  await screen.getByLabel("Mensaje").fill(`Quiero entender ${goal}`);
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
}

/** The one question waiting for an answer. */
export const pending = (screen: Screen) => screen.getByTestId("question-pending");

export async function answer(
  screen: Screen,
  opts: { text?: string; option?: string; confidence?: number; thinking?: string },
) {
  const q = pending(screen);
  if (opts.option) await q.getByRole("radio", opts.option).click();
  if (opts.text) await q.getByRole("textbox", opts.option ? "Comentario" : "Tu respuesta").fill(opts.text);
  await q.getByRole("radio", new RegExp(`^Confianza ${opts.confidence ?? 4}:`)).click();
  if (opts.thinking) {
    await q.getByRole("button", "+ Contar cómo lo pensé").click();
    await q.getByRole("textbox", "Pensando en voz alta").fill(opts.thinking);
  }
  await q.getByRole("button", "Responder").click();
}

/** Answers the two diagnostic questions; the agent then plans and starts teaching. */
export async function finishProbe(screen: Screen) {
  await answer(screen, { text: "por cada paso a la derecha sube 2", confidence: 4, thinking: "lo vi en el colegio" });
  await expect(pending(screen)).toContainText("Crece sin límite", { timeout: 10_000 });
  await answer(screen, { option: "A 0", confidence: 3 });
  await expect(pending(screen)).toContainText("zoom infinito", { timeout: 10_000 });
}

export const phase = (screen: Screen, label: string) =>
  screen.getByRole("list", "Fases").getByRole("listitem").filter({ hasText: label });

export const planNode = (screen: Screen, id: string) => screen.getByTestId(`plan-${id}`);

/** Picks, in an exam question, every option whose text matches: one radio,
 *  or all matching checkboxes in an "Elegí N" question. */
export async function pick(question: ReturnType<Screen["getByRole"]>, option: RegExp) {
  const boxes = question.getByRole("checkbox", option);
  if (await boxes.count()) {
    for (const b of await boxes.all()) await b.check();
  } else await question.getByRole("radio", option).first().check();
}

/**
 * Goes to a screen of the sidebar. Grafo, Acompañamiento, Código and Idiomas live in the «Más» group,
 * which is collapsed until opened (or until one of its screens is the current one).
 */
export async function goTo(screen: Screen, label: "Grafo" | "Acompañamiento" | "Código" | "Idiomas") {
  const nav = screen.getByRole("navigation", "Navegación");
  const item = nav.getByRole("button", label);
  if (!(await item.isVisible())) await nav.getByText("Más").click();
  await item.click({ timeout: 30_000 });
}
