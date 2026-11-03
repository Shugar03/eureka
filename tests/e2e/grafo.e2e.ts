// features/grafo.feature — AC-17 … AC-21, NF-11 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, phase, startSession } from "./helpers.ts";

const DERIVADA = "La derivada es la pendiente de la recta tangente";
const PENDIENTE = "La pendiente mide cuánto sube una recta por cada paso a la derecha";

async function finishSession(app: App, screen: Screen, query = "") {
  await startSession(app, screen, "qué es una derivada", query);
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
}

const openGraph = (screen: Screen) => screen.getByRole("navigation", "Navegación").getByRole("button", "Grafo").click();
const node = (screen: Screen, text: string) => screen.getByTestId("graph-node").filter({ hasText: text });

test("AC-17 terminar una sesión la guarda en el grafo", async ({ app, screen }) => {
  await finishSession(app, screen);
  const banner = screen.getByTestId("graph-banner");
  await expect(banner).toContainText("Guardado en el grafo", { timeout: 10_000 });
  await expect(banner).toContainText("4 ideas · 2 cadenas");

  await banner.getByRole("button", "Ver en el grafo").click();
  await expect(screen.getByRole("heading", "Grafo de conocimiento")).toBeVisible();
  await expect(node(screen, DERIVADA)).toBeVisible();
  await expect(screen.getByTestId("graph-counts")).toHaveText("4 ideas · 2 cadenas");
});

test("AC-17 NF-12 volver a extraer no duplica", async ({ app, screen }) => {
  await finishSession(app, screen);
  const banner = screen.getByTestId("graph-banner");
  await expect(banner).toContainText("4 ideas", { timeout: 10_000 });
  await banner.getByRole("button", "Volver a extraer").click();
  await expect(banner).toContainText("Guardado en el grafo", { timeout: 10_000 });
  await openGraph(screen);
  await expect(screen.getByTestId("graph-counts")).toHaveText("4 ideas · 2 cadenas");
});

test("AC-18 AC-21 la misma idea desde notas es un solo nodo con dos fuentes", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);

  await screen.getByRole("button", "Importar notas").click();
  await screen.getByLabel("Título de las notas").fill("Apuntes de física");
  await screen.getByLabel("Texto de las notas").fill("la pendiente mide cuanto sube una recta por cada paso a la derecha.\nLa velocidad es la derivada de la posición");
  await screen.getByRole("button", "Importar").click();

  await expect(screen.getByTestId("graph-counts")).toHaveText("5 ideas · 3 cadenas", { timeout: 10_000 });
  await expect(node(screen, PENDIENTE)).toContainText("2 fuentes");
  await node(screen, PENDIENTE).click();
  const detail = screen.getByRole("complementary", "Detalle de la idea");
  await expect(detail).toContainText("qué es una derivada");
  await expect(detail).toContainText("notas: Apuntes de física");
});

test("AC-19 ver una idea, sus razonamientos y abrir su fuente", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);

  await node(screen, DERIVADA).click();
  const detail = screen.getByRole("complementary", "Detalle de la idea");
  await expect(detail).toContainText("Se deduce de");
  await expect(detail.getByRole("button", PENDIENTE)).toBeVisible();

  await detail.getByRole("button", PENDIENTE).click(); // navigate the chain
  await expect(detail).toContainText("Lleva a");
  await detail.getByRole("button", "qué es una derivada").click();
  await expect(screen.getByRole("heading", "qué es una derivada")).toBeVisible();
});

test("AC-19 filtrar el grafo", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);
  await screen.getByLabel("Filtrar ideas").fill("TANGENTE");
  await expect(screen.getByTestId("graph-node")).toHaveCount(2);
  await screen.getByLabel("Filtrar ideas").fill("zzzz");
  await expect(screen.getByText("Ninguna idea coincide", { exact: false })).toBeVisible();
});

test("AC-19 grafo vacío", async ({ app, screen }) => {
  await app.open("/");
  await openGraph(screen);
  await expect(screen.getByRole("heading", "Todavía no hay ideas")).toBeVisible();
  await expect(screen.getByText("se llena solo cuando terminás una sesión", { exact: false })).toBeVisible();
});

test("AC-21 importar notas valida título y texto", async ({ app, screen }) => {
  await app.open("/");
  await openGraph(screen);
  await screen.getByRole("button", "Importar notas").click();
  await expect(screen.getByRole("button", "Importar")).toBeDisabled();
  await screen.getByLabel("Título de las notas").fill("Mis apuntes");
  await expect(screen.getByRole("button", "Importar")).toBeDisabled();
  await screen.getByLabel("Texto de las notas").fill("Una idea\nOtra idea");
  await screen.getByRole("button", "Importar").click();
  await expect(screen.getByTestId("graph-counts")).toHaveText("2 ideas · 1 cadenas", { timeout: 10_000 });
});

test("NF-11 una extracción fallida no rompe nada y se puede reintentar", async ({ app, screen }) => {
  await finishSession(app, screen, "?failExtract");
  const banner = screen.getByTestId("graph-banner");
  await expect(banner).toContainText("No se pudo guardar en el grafo", { timeout: 10_000 });
  await expect(banner.getByRole("button", "Reintentar")).toBeVisible();
  await openGraph(screen);
  await expect(screen.getByRole("heading", "Todavía no hay ideas")).toBeVisible();
});

test("AC-67 olvidar una fuente saca sus ideas del grafo", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);
  await node(screen, DERIVADA).click();
  const detail = screen.getByRole("complementary", "Detalle de la idea");
  await detail.getByRole("button", "Olvidar esta fuente: qué es una derivada").click();
  await detail.getByRole("button", "Sí, olvidar sus ideas").click();
  await expect(screen.getByRole("heading", "Todavía no hay ideas")).toBeVisible({ timeout: 10_000 });
});

test("AC-68 guardar lo aprendido antes de terminar", async ({ app, screen }) => {
  await startSession(app, screen, "qué es una derivada");
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await screen.getByRole("button", "Guardar lo aprendido hasta acá").click();
  await expect(screen.getByText("Guardado · 4 ideas")).toBeVisible({ timeout: 10_000 });
  await openGraph(screen);
  await expect(screen.getByTestId("graph-counts")).toHaveText("4 ideas · 2 cadenas");
});

test("AC-170 por profundidad: las ideas base abajo y el razonamiento sube", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);
  const view = screen.getByRole("radiogroup", "Vista del grafo");
  await expect(view.getByRole("radio", "Por profundidad")).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByTestId("graph-legend")).toContainText("Abajo las ideas base");
  await expect(node(screen, DERIVADA)).toContainText("nivel 2");
  await expect(node(screen, PENDIENTE)).toContainText("base");
  const y = async (text: string) => (await node(screen, text).boundingBox())!.y;
  expect(await y(DERIVADA)).toBeLessThan(await y(PENDIENTE));

  await view.getByRole("radio", "Libre").click();
  await expect(screen.getByTestId("graph-node-depth")).toHaveCount(0);
  await expect(node(screen, DERIVADA)).toBeVisible();
});

test("AC-170 ver dónde apareció una idea en su sesión", async ({ app, screen }) => {
  await finishSession(app, screen);
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await openGraph(screen);
  await node(screen, DERIVADA).click();
  const detail = screen.getByRole("complementary", "Detalle de la idea");
  await detail.getByRole("button", "Ver dónde apareció en qué es una derivada").click();
  await expect(screen.getByRole("heading", "qué es una derivada")).toBeVisible();
  await expect(screen.getByTestId("focus-banner")).toContainText("Marcado el mensaje donde apareció «La derivada es la pendiente", { timeout: 10_000 });
  await expect(screen.getByTestId("focus-message")).toContainText("pendiente");
  await screen.getByTestId("focus-banner").getByRole("button", "Listo").click();
  await expect(screen.getByTestId("focus-banner")).toHaveCount(0);
});
