// features/practica.feature — AC-22 … AC-26, NF-13 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, phase, startSession } from "./helpers.ts";

const DERIVADA = "La derivada es la pendiente de la recta tangente";
const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

/** Finishes the derivative session so the graph has its 4 ideas. */
async function withGraph(app: App, screen: Screen, query = "") {
  await startSession(app, screen, "qué es una derivada", query);
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
}

async function newPractice(screen: Screen, idea = DERIVADA, count = "3 problemas") {
  await nav(screen).getByRole("button", "Práctica").click();
  await screen.getByRole("checkbox", idea).check();
  await screen.getByRole("radio", count).click();
  await screen.getByRole("button", /^Generar/).click();
  await expect(screen.getByTestId("problem-progress")).toBeVisible({ timeout: 10_000 });
}

test("AC-22 crear una práctica eligiendo ideas", async ({ app, screen }) => {
  await withGraph(app, screen);
  await nav(screen).getByRole("button", "Práctica").click();
  await expect(screen.getByRole("button", /^Generar/)).toBeDisabled();
  await screen.getByLabel("Filtrar ideas para practicar").fill("tangente");
  await expect(screen.getByRole("list", "Ideas").getByRole("checkbox")).toHaveCount(2);
  await screen.getByRole("checkbox", DERIVADA).check();
  await expect(screen.getByRole("button", "Generar (1 idea)")).toBeEnabled();
  await screen.getByRole("radio", "5 problemas").click();
  await screen.getByRole("button", "Generar (1 idea)").click();
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 1 de 5", { timeout: 10_000 });
});

test("AC-22 sin ideas no hay práctica", async ({ app, screen }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Práctica").click();
  await expect(screen.getByRole("heading", "Para problemas nuevos, primero necesitás ideas en el grafo")).toBeVisible();
  await screen.getByRole("button", "Ir al grafo").click();
  await expect(screen.getByRole("heading", "Grafo de conocimiento")).toBeVisible();
});

test("AC-23 AC-24 pistas graduales", async ({ app, screen }) => {
  await withGraph(app, screen);
  await newPractice(screen);
  const hints = screen.getByRole("region", "Pistas");
  await hints.getByRole("button", "Pedir pista (0/3)").click();
  await expect(hints).toContainText(/pista 1/i);
  await hints.getByRole("button", "Pedir pista (1/3)").click();
  await expect(hints).toContainText(/pista 2/i);
  await hints.getByRole("button", "Pedir pista (2/3)").click();
  await expect(hints.getByRole("button", "Pedir pista (3/3)")).toBeDisabled();
});

test("AC-25 AC-26 corregir, reintentar, resumen y lista", async ({ app, screen }) => {
  await withGraph(app, screen);
  await newPractice(screen);

  // 1: correct.
  await answer(screen, { text: "Va a 6 m/s", confidence: 4, thinking: "es la pendiente" });
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await screen.getByRole("button", "Ver solución").click();
  await expect(screen.getByRole("region", "Corrección")).toContainText("rapidez instantánea");
  await screen.getByRole("button", "Siguiente").click();

  // 2: wrong, then retry right.
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 2 de 3");
  await answer(screen, { text: "un círculo", confidence: 2 });
  await expect(screen.getByTestId("verdict")).toContainText("Incorrecto", { timeout: 10_000 });
  await screen.getByRole("button", "Reintentar").click();
  await answer(screen, { text: "una recta", confidence: 4 });
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await screen.getByRole("button", "Siguiente").click();

  // 3: partial.
  await answer(screen, { text: "casi 1", confidence: 3 });
  await expect(screen.getByTestId("verdict")).toContainText("Parcial", { timeout: 10_000 });
  await screen.getByRole("button", "Ver resumen").click();

  const summary = screen.getByRole("region", "Resumen");
  await expect(summary).toContainText("Correcto");
  await expect(summary).toContainText("Parcial");
  await expect(summary).toContainText("Para repasar");
  await expect(summary).toContainText(DERIVADA);

  await summary.getByRole("button", "Volver a Práctica").click();
  const row = screen.getByRole("region", "Prácticas").getByRole("listitem").filter({ hasText: DERIVADA });
  await expect(row).toContainText("3/3 · 2 correctos");
});

test("AC-26 retomar donde quedó y borrar", async ({ app, screen }) => {
  await withGraph(app, screen);
  await newPractice(screen);
  await answer(screen, { text: "6", confidence: 4 });
  await expect(screen.getByTestId("verdict")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("button", "Volver a Práctica").click();

  const row = screen.getByRole("region", "Prácticas").getByRole("listitem").filter({ hasText: DERIVADA });
  await expect(row).toContainText("1/3");
  await row.getByRole("button", new RegExp(`^${DERIVADA}`)).click();
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 2 de 3");

  await screen.getByRole("button", "Volver a Práctica").click();
  await row.getByRole("button", new RegExp(`^Borrar`)).click();
  await row.getByRole("button", new RegExp(`^Confirmar borrar`)).click();
  await expect(row).toHaveCount(0);
});

test("AC-22 practicar una idea desde el grafo", async ({ app, screen }) => {
  await withGraph(app, screen);
  await nav(screen).getByRole("button", "Grafo").click();
  await screen.getByTestId("graph-node").filter({ hasText: DERIVADA }).click();
  await screen.getByRole("button", "Practicar esta idea").click();
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 1 de 3", { timeout: 10_000 });
});

test("NF-13 si el corrector falla no se pierde la respuesta", async ({ app, screen }) => {
  await withGraph(app, screen, "?failGradeOnce");
  await newPractice(screen);
  await answer(screen, { text: "6 m/s", confidence: 4 });
  await expect(screen.getByRole("alert")).toContainText("corrector no disponible", { timeout: 10_000 });
  await screen.getByRole("alert").getByRole("button", "Reintentar").click();
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await expect(screen.getByTestId("verdict")).toContainText("6 m/s");

});
