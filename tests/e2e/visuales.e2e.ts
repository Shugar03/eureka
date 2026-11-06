// features/visuales.feature — AC-27 … AC-31, NF-14 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, pending, phase, startSession } from "./helpers.ts";

async function toTangent(app: App, screen: Screen, query = "") {
  await startSession(app, screen, "qué es una derivada", query);
  await finishProbe(screen);
  await answer(screen, { text: "se ve como una recta", confidence: 3 });
  await expect(pending(screen)).toHaveAttribute("data-purpose", "check", { timeout: 10_000 });
}

test("AC-27 un diagrama en la explicación", async ({ app, screen }) => {
  await toTangent(app, screen);
  const d = screen.getByRole("figure", "Diagrama: De la secante a la tangente");
  await expect(d).toBeVisible();
  await expect(d).toContainText("Tangente: 1 punto", { timeout: 10_000 }); // rendered by Mermaid
});

test("AC-28 NF-14 AC-175 una demo interactiva aislada y sin red", async ({ app, screen, browser }) => {
  await toTangent(app, screen);
  const frame = browser.locator("iframe[title='Acercá los puntos']");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("srcdoc", /default-src 'none'/);

  const demo = browser.frameLocator("iframe[title='Acercá los puntos']");
  const slope = demo.locator("#m");
  await expect(slope).toHaveText("3.50");
  await demo.locator("#h").fill("0.05");
  await expect(slope).toHaveText("2.05"); // secant → tangent slope 2
  await expect(demo.locator("body")).toHaveAttribute("data-net", "bloqueada", { timeout: 10_000 });

  // AC-175: inverting is a filter on the frame; the demo keeps its state.
  const card = screen.getByRole("figure", "Demo: Acercá los puntos");
  await card.getByRole("button", "Invertir colores").click();
  await expect(card.getByRole("button", "Invertir colores")).toHaveAttribute("aria-pressed", "true");
  await expect(frame).toHaveAttribute("class", /is-inverted/);
  await expect(slope).toHaveText("2.05");
});

test("AC-183 la demo se abre en un panel, en el lugar del plan, y se ajusta a la ventana", async ({ app, screen, browser }) => {
  await toTangent(app, screen);
  const card = screen.getByRole("figure", "Demo: Acercá los puntos");
  await card.getByRole("button", "Abrir en el panel").click();

  const pane = screen.getByTestId("demo-pane");
  await expect(pane).toBeVisible();
  await expect(screen.getByRole("heading", "Plan")).toBeHidden(); // the plan makes way
  await expect(card).toContainText("abierta en el panel");

  const demo = browser.frameLocator("iframe[title='Acercá los puntos']");
  await demo.locator("#h").fill("0.05");
  await expect(demo.locator("#m")).toHaveText("2.05");

  // Maximized, the same frame keeps its state and the whole demo fits: nothing left to scroll.
  await pane.getByRole("button", "Maximizar").click();
  await expect(demo.locator("#m")).toHaveText("2.05");
  // The demo reported its size and the panel scaled it as a whole.
  await expect(pane.getByTestId("demo-fit")).toHaveAttribute("data-fitted", "true", { timeout: 10_000 });

  await pane.getByRole("button", "Restaurar (Esc)").click();
  await pane.getByRole("button", "Cerrar panel").click();
  await expect(screen.getByRole("heading", "Plan")).toBeVisible();
  await expect(card.getByRole("button", "Abrir en el panel")).toBeVisible();
});

test("AC-29 investigar con fuentes", async ({ app, screen }) => {
  await toTangent(app, screen);
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });

  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");
  const card = screen.getByRole("region", "Investigación");
  // AC-169: it does not stop the class; the result arrives in the card.
  await expect(card.getByTestId("research-pending")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText("lo mandé a investigar", { exact: false })).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("textbox", "Mensaje").fill("sigo escribiendo mientras busca");
  await expect(card).toContainText("velocidad", { timeout: 10_000 });
  await expect(screen.getByRole("textbox", "Mensaje")).toHaveValue("sigo escribiendo mientras busca");
  await expect(card.getByRole("link", "Velocidad instantánea")).toHaveAttribute("href", "https://fisica.example/velocidad");
  await expect(card.getByRole("link", "Costo marginal")).toHaveAttribute("target", "_blank");
});

test("AC-206 un PDF abierto que encontró la investigación se suma a la biblioteca", async ({ app, screen }) => {
  await toTangent(app, screen);
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");
  const card = screen.getByRole("region", "Investigación");
  const docs = card.getByRole("list", "Documentos abiertos");
  await expect(docs).toContainText("Apuntes de física", { timeout: 15_000 });
  await expect(card.getByText("Sin resultados útiles para: derivada en biología.")).toBeVisible();
  await docs.getByRole("button", "Sumar a mi biblioteca: Apuntes de física").click();
  await expect(docs.getByText("✓ En tu biblioteca")).toBeVisible({ timeout: 20_000 });
});

test("AC-30 sin búsqueda configurada la sesión sigue", async ({ app, screen }) => {
  await toTangent(app, screen, "?noSearch");
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");
  await expect(screen.getByTestId("research-error")).toContainText("búsqueda web no configurada", { timeout: 10_000 });
  await expect(screen.getByText("Buena pregunta.", { exact: false })).toBeVisible();
});

test("AC-31 configurar la búsqueda sin mostrar la key", async ({ app, screen }) => {
  await app.open("/?noSearch");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  const box = screen.getByRole("region", "Búsqueda web");
  await expect(box.getByRole("button", "Quitar key de búsqueda")).toHaveCount(0);
  await box.getByLabel("URL de búsqueda").fill("https://buscador.example");
  await box.getByLabel("API key de búsqueda").fill("tvly-123");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();
  await expect(box.getByRole("button", "Quitar key de búsqueda")).toBeVisible();
  await expect(box.getByLabel("URL de búsqueda")).toHaveValue("https://buscador.example");
});
