// features/escritorio.feature — the REAL app (Rust + WebView2) against the
// fake provider. Every flow crosses IPC, the agent loop, SSE parsing, tool
// execution and the on-disk stores.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { answer, finishProbe, pending, phase, planNode, startSession } from "../e2e/helpers.ts";
import { dataDir, fakeProvider } from "./launch.ts";

const sessionFiles = () => {
  const dir = join(dataDir(), "sessions");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
};

test("D-02 arco completo Medir → Planificar → Enseñar → Listo por el loop real", async ({ app, screen }) => {
  await fakeProvider.reset();
  await startSession(app, screen);
  await finishProbe(screen);
  await expect(phase(screen, "Enseñar")).toHaveAttribute("aria-current", "step");
  await expect(planNode(screen, "pendiente")).toHaveAttribute("data-status", "known");

  await answer(screen, { text: "se ve como una recta", confidence: 3 });
  await expect(pending(screen)).toHaveAttribute("data-purpose", "check", { timeout: 15_000 });
  await answer(screen, { option: "En una curva", confidence: 2 });
  await expect(planNode(screen, "tangente")).toHaveAttribute("data-status", "repair", { timeout: 15_000 });
  await answer(screen, { option: "Tangente", confidence: 4 });
  await expect(pending(screen)).toContainText("Última:", { timeout: 15_000 });
  await answer(screen, { option: "6", confidence: 5 });

  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 15_000 });
  for (const id of ["limite", "tangente", "derivada"]) {
    await expect(planNode(screen, id)).toHaveAttribute("data-status", "understood");
  }

  // What reached the model: tool results carry the learner's answers.
  // The teacher's last request (reaching "done" also triggers the extractor's).
  const reqs = (await fakeProvider.requests()) as unknown as { tool_choice?: unknown; messages: { role: string; content?: string }[] }[];
  const last = reqs.filter((r) => !r.tool_choice).at(-1)!.messages;
  expect(last.filter((m) => m.role === "tool" && m.content?.startsWith("Respuesta del aprendiz")).length).toBe(6);
  expect(last.some((m) => m.content?.includes("Confianza: 5/5"))).toBe(true);

  // Free question after finishing.
  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");
  await expect(screen.getByText("Buena pregunta.", { exact: false })).toBeVisible({ timeout: 15_000 });
});

test("D-03 la sesión se guarda en disco y sobrevive a recargar la app", async ({ app, screen }) => {
  await fakeProvider.reset();
  await startSession(app, screen);
  await answer(screen, { text: "sube 2 por cada 1", confidence: 4, thinking: "lo recuerdo" });
  await expect(pending(screen)).toContainText("Crece sin límite", { timeout: 15_000 });

  const files = sessionFiles();
  expect(files.length).toBe(1);
  const saved = JSON.parse(readFileSync(join(dataDir(), "sessions", files[0]), "utf8"));
  expect(saved.phase).toBe("probe");
  expect(saved.findings[0].concept).toBe("Pendiente");
  expect(saved.pending_question).toBeTruthy();

  await app.open("/"); // full reload: state comes back from Rust/disk
  await screen.getByRole("navigation", "Navegación").getByRole("button", /qué es una derivada/).click();
  await expect(pending(screen)).toContainText("Crece sin límite", { timeout: 15_000 });
  await expect(screen.getByTestId("findings")).toContainText("Pendiente");
  await expect(screen.getByTestId("answer").first()).toContainText("lo recuerdo");
});

test("D-04 un error HTTP del proveedor se muestra y Reintentar lo recupera", async ({ app, screen }) => {
  await fakeProvider.reset();
  await fakeProvider.mode("fail-http", true);
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByRole("alert")).toContainText("503", { timeout: 15_000 });
  await expect(screen.getByRole("alert")).toContainText("proveedor no disponible");
  await screen.getByRole("button", "Reintentar").click();
  await expect(pending(screen)).toContainText("pendiente 2", { timeout: 15_000 });
  await expect(screen.getByRole("alert")).toBeHidden();
});

test("D-05 un error a mitad del streaming se muestra", async ({ app, screen }) => {
  await fakeProvider.reset();
  await fakeProvider.mode("fail-sse", true);
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("alert")).toContainText("se cayó a mitad", { timeout: 15_000 });
});

test("D-06 Detener corta al agente a mitad de la respuesta", async ({ app, screen }) => {
  await fakeProvider.reset();
  await fakeProvider.mode("slow");
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();

  // Slow streaming: stop while the first (chat) turn is still arriving.
  await expect(screen.getByText("¡Dale!", { exact: false })).toBeVisible({ timeout: 15_000 });
  await screen.getByRole("button", "Detener").click();
  await expect(screen.getByRole("button", "Detener")).toBeHidden({ timeout: 10_000 });
  // Stopped before the question arrived: no half-received tool call ran.
  await expect(pending(screen)).toBeHidden();
  await expect(screen.getByRole("textbox", "Mensaje")).toBeVisible();
  await fakeProvider.reset();
});

test("D-07 un modelo que no para queda cortado en 12 pasos", async ({ app, screen }) => {
  await fakeProvider.reset();
  await fakeProvider.mode("runaway");
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByRole("alert")).toContainText("límite de 12 pasos", { timeout: 30_000 });
  expect((await fakeProvider.requests()).length).toBe(12);
  await fakeProvider.reset();
});

test("D-08 Ajustes reales: listar modelos, guardar key en disco sin mostrarla", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  await screen.getByRole("button", "Listar modelos").first().click();
  await expect(screen.getByText("3 modelos encontrados.")).toBeVisible({ timeout: 10_000 });

  await screen.getByLabel("API key de Proveedor falso").fill("sk-nueva-clave-123");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();

  const auth = JSON.parse(readFileSync(join(dataDir(), "auth.json"), "utf8"));
  expect(auth.fake).toBe("sk-nueva-clave-123");
  const settings = readFileSync(join(dataDir(), "settings.json"), "utf8");
  expect(settings.includes("sk-nueva")).toBe(false);
  await expect(screen.getByText("sk-nueva-clave-123")).toBeHidden();

  // The new key is what the next request uses (the fake accepts any Bearer).
  await screen.getByRole("button", "Nueva sesión").click();
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 15_000 });
});

test("D-09 un prompt editado llega al modelo en el próximo mensaje", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("checkbox", /Modo avanzado/).check();
  await screen.getByRole("tab", "Prompts").click();
  const editor = screen.getByLabel("Contenido del prompt");
  await editor.fill("# El agente\n\nMARCADOR-E2E-4242: enseñá con ejemplos de cocina.");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado. Se usa desde el próximo mensaje.")).toBeVisible();
  expect(existsSync(join(dataDir(), "prompts", "shared.md"))).toBe(true);

  await screen.getByRole("button", "Nueva sesión").click();
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 15_000 });
  // AC-89: the chat turn hands over to Medir; the edited shared prompt reaches both.
  const asked = await fakeProvider.requests();
  expect(asked.every((r) => (r.messages[0].content ?? "").includes("MARCADOR-E2E-4242"))).toBe(true);
  const sys = asked[asked.length - 1].messages[0].content ?? "";
  expect(sys.includes("Fase: MEDIR")).toBe(true);
});

test("D-10 borrar una sesión elimina su archivo", async ({ app, screen }) => {
  await fakeProvider.reset();
  await startSession(app, screen, "tema a borrar");
  expect(sessionFiles().length).toBe(1);
  await screen.getByRole("button", "Volver a Sesiones").click();
  const row = screen.getByRole("region", "Sesiones").getByRole("listitem").filter({ hasText: "tema a borrar" });
  await row.getByRole("button", "Borrar tema a borrar").click();
  await row.getByRole("group", "Confirmar borrar tema a borrar").getByRole("button", "Borrar").click();
  await expect(row).toHaveCount(0);
  expect(sessionFiles().length).toBe(0);
});
