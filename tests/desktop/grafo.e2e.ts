// features/grafo.feature on the REAL app: Rust extractor (forced tool call),
// validation, append-only ledger on disk, and AC-20 in the teacher's prompt.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { answer, finishProbe, goTo, pending, phase, startSession } from "../e2e/helpers.ts";
import { dataDir, fakeProvider } from "./launch.ts";

const ledger = () => {
  const f = join(dataDir(), "graph", "extractions.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test("D-11 terminar una sesión la extrae al grafo y el profesor lo usa en la siguiente", async ({ app, screen }) => {
  await fakeProvider.reset();
  await startSession(app, screen);
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 15_000 });
  await expect(screen.getByTestId("graph-banner")).toContainText("4 ideas · 2 cadenas", { timeout: 15_000 });

  // The extractor request forced the tool and carried the transcript.
  const reqs = (await fakeProvider.requests()) as unknown as { tool_choice?: { function: { name: string } }; messages: { content?: string }[] }[];
  const ext = reqs.find((r) => r.tool_choice?.function.name === "record_knowledge")!;
  expect(ext.messages[1].content).toContain("Respuesta del aprendiz");
  // Append-only ledger on disk.
  expect(ledger().length).toBe(1);
  expect(ledger()[0].source.kind).toBe("session");

  await screen.getByTestId("graph-banner").getByRole("button", "Volver a extraer").click();
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 15_000 });
  expect(ledger().length).toBe(2); // history kept…
  await goTo(screen, "Grafo");
  await expect(screen.getByTestId("graph-counts")).toHaveText("4 ideas · 2 cadenas"); // …but no duplicates

  // AC-20: a new related session gets the graph in its state block.
  await fakeProvider.reset();
  await screen.getByRole("button", "Nueva sesión").click();
  await screen.getByLabel("Mensaje").fill("quiero entender la derivada de x al cubo");
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 15_000 });
  // AC-89: the chat turn hands over to Medir, whose request carries the graph.
  const asked = await fakeProvider.requests();
  // The state block travels in the last message (<estado_app>), not in the system prompt.
  const sys = (asked[asked.length - 1] as { messages: { content?: string }[] }).messages.map((m) => m.content ?? "").join("\n");
  expect(sys).toContain("## Ya en el grafo");
  expect(sys).toContain("La derivada es la pendiente de la recta tangente");
});

test("D-12 importar notas en la app real", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await goTo(screen, "Grafo");
  await screen.getByRole("button", "Importar notas").click();
  await screen.getByLabel("Título de las notas").fill("Apuntes de física");
  await screen.getByLabel("Texto de las notas").fill("- La velocidad es la derivada de la posición\n- La aceleración es la derivada de la velocidad");
  await screen.getByRole("button", "Importar").click();
  await expect(screen.getByTestId("graph-counts")).toHaveText("2 ideas · 1 cadenas", { timeout: 15_000 });
  expect(ledger()[0].source).toMatchObject({ kind: "notes", title: "Apuntes de física" });
});

test("D-13 una extracción fallida deja el grafo intacto", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await goTo(screen, "Grafo");
  await screen.getByRole("button", "Importar notas").click();
  await screen.getByLabel("Título de las notas").fill("x");
  await screen.getByLabel("Texto de las notas").fill("una idea");
  await fakeProvider.mode("fail-http", true);
  await screen.getByRole("button", "Importar").click();
  await expect(screen.getByRole("alert")).toContainText("503", { timeout: 15_000 });
  expect(ledger().length).toBe(0);
  await screen.getByRole("button", "Importar").click(); // retry succeeds
  await expect(screen.getByTestId("graph-counts")).toHaveText("1 ideas · 0 cadenas", { timeout: 15_000 });
});
