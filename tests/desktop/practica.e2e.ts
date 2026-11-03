// features/practica.feature on the REAL app: forced-tool generator and
// grader in Rust, practice files on disk, nothing written to the graph.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { answer } from "../e2e/helpers.ts";
import { dataDir, fakeProvider } from "./launch.ts";

const nav = (s: import("e2e").Screen) => s.getByRole("navigation", "Navegación");

test("D-14 práctica completa contra el loop real", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  // Seed the graph through the real extractor (notes import).
  await nav(screen).getByRole("button", "Grafo").click();
  await screen.getByRole("button", "Importar notas").click();
  await screen.getByLabel("Título de las notas").fill("Apuntes");
  await screen.getByLabel("Texto de las notas").fill("La derivada es la pendiente de la recta tangente\nUn límite describe a qué valor se acerca algo");
  await screen.getByRole("button", "Importar").click();
  await expect(screen.getByTestId("graph-counts")).toHaveText("2 ideas · 1 cadenas", { timeout: 15_000 });
  const graphBefore = readFileSync(join(dataDir(), "graph", "extractions.jsonl"), "utf8");

  await nav(screen).getByRole("button", "Práctica").click();
  await screen.getByRole("checkbox", "La derivada es la pendiente de la recta tangente").check();
  await screen.getByRole("button", /^Generar/).click();
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 1 de 3", { timeout: 15_000 });

  await screen.getByRole("region", "Pistas").getByRole("button", "Pedir pista (0/3)").click();
  await answer(screen, { text: "6 m/s", confidence: 4, thinking: "pendiente de la tangente" });
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 15_000 });
  await expect(screen.getByTestId("verdict")).toContainText("1 pista");

  // Requests: generator and grader with forced tools; grader saw hints used.
  const reqs = (await fakeProvider.requests()) as unknown as { tool_choice?: { function: { name: string } }; messages: { content?: string }[] }[];
  const names = reqs.map((r) => r.tool_choice?.function.name);
  expect(names).toContain("set_problems");
  expect(names).toContain("grade_answer");
  expect(reqs.find((r) => r.tool_choice?.function.name === "grade_answer")!.messages[1].content).toContain("Pistas usadas: 1 de 3");

  // On disk: one practice file with the attempt; the graph is untouched.
  const files = readdirSync(join(dataDir(), "practice"));
  expect(files.length).toBe(1);
  const saved = JSON.parse(readFileSync(join(dataDir(), "practice", files[0]), "utf8"));
  expect(saved.problems[0].attempts[0]).toMatchObject({ verdict: "correct", hints_used: 1, confidence: 4 });
  expect(readFileSync(join(dataDir(), "graph", "extractions.jsonl"), "utf8")).toBe(graphBefore);
});

test("D-15 un corrector caído no pierde la respuesta", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await nav(screen).getByRole("button", "Grafo").click();
  await screen.getByRole("button", "Importar notas").click();
  await screen.getByLabel("Título de las notas").fill("x");
  await screen.getByLabel("Texto de las notas").fill("La derivada es la pendiente de la recta tangente");
  await screen.getByRole("button", "Importar").click();
  await expect(screen.getByTestId("graph-counts")).toHaveText("1 ideas · 0 cadenas", { timeout: 15_000 });
  await nav(screen).getByRole("button", "Práctica").click();
  await screen.getByRole("checkbox", "La derivada es la pendiente de la recta tangente").check();
  await screen.getByRole("button", /^Generar/).click();
  await expect(screen.getByTestId("problem-progress")).toBeVisible({ timeout: 15_000 });

  await fakeProvider.mode("fail-http", true);
  await answer(screen, { text: "6 m/s", confidence: 4 });
  await expect(screen.getByRole("alert")).toContainText("503", { timeout: 15_000 });
  await screen.getByRole("alert").getByRole("button", "Reintentar").click();
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 15_000 });
});
