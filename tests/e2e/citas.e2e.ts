// features/citas.feature — AC-130, AC-131, AC-132, AC-133 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFileSync } from "node:fs";

type Quote = { id: string; day: string | null; text: string; author: string; work: string };
type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

const QUOTES: Quote[] = JSON.parse(readFileSync("src/data/quotes.json", "utf8"));

/** Today's quote, by the page's own calendar day (not the test runner's). */
async function today(browser: Browser): Promise<Quote> {
  const key = await browser.evaluate(() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, null);
  return QUOTES.find((q) => q.day === key)!;
}

test("AC-130 el inicio muestra la cita del día con su autor y su obra", async ({ app, screen, browser }) => {
  await app.open("/");
  const q = await today(browser);
  const card = screen.getByRole("figure", "Cita");
  await expect(card.getByTestId("quote-text")).toContainText(q.text, { timeout: 30_000 });
  await expect(card).toContainText(q.author);
  await expect(card).toContainText(q.work);
});

test("AC-131 otra cita, favorita y no mostrar más (con deshacer)", async ({ app, screen, browser }) => {
  await app.open("/");
  const q = await today(browser);
  const card = screen.getByRole("figure", "Cita");
  await expect(card.getByTestId("quote-text")).toContainText(q.text, { timeout: 30_000 });
  await card.getByRole("button", "Otra cita").click();
  await expect(card.getByTestId("quote-text")).not.toContainText(q.text);

  await card.getByRole("button", "Guardar como favorita").click();
  await expect(card.getByRole("button", "Quitar de favoritas")).toHaveAttribute("aria-pressed", "true");

  await card.getByRole("button", "No mostrar más").click();
  await expect(card.getByRole("status")).toContainText("no te la vuelvo a mostrar");
  await card.getByRole("button", "Deshacer").click();
  await expect(card.getByRole("status")).not.toContainText("no te la vuelvo a mostrar");
});

test("AC-132 las favoritas y las frases propias se ven en Mi espacio y se recuerdan", async ({ app, screen }) => {
  await app.open("/");
  const card = screen.getByRole("figure", "Cita");
  await card.getByRole("button", "Guardar como favorita").click({ timeout: 30_000 });
  await screen.getByRole("navigation", "Navegación").getByRole("button", /Personalizar/).click();
  const section = screen.getByRole("region", "Citas");
  await expect(section).toContainText("366 citas, una para cada día del año");
  await expect(section.getByRole("list", "Mis favoritas").getByRole("listitem")).toHaveCount(1);

  await section.getByLabel("Nueva frase").fill("Paso a paso, que se llega.");
  await section.getByLabel("Autor de la frase").fill("mi abuela");
  await section.getByRole("button", "Agregar frase").click();
  await expect(section.getByRole("list", "Mis frases")).toContainText("Paso a paso, que se llega.");

  await app.open("/");
  await screen.getByRole("navigation", "Navegación").getByRole("button", /Personalizar/).click({ timeout: 30_000 });
  await expect(screen.getByRole("region", "Citas").getByRole("list", "Mis frases")).toContainText("mi abuela");
});

test("AC-133 al abrir, una bienvenida con la cita del día que se cierra con Entrar o Esc", async ({ app, screen, browser }) => {
  await app.open("/?splash");
  const q = await today(browser);
  const splash = screen.getByRole("dialog", "Cita del día");
  await expect(splash.getByTestId("splash-quote")).toContainText(q.text, { timeout: 30_000 });
  await expect(splash).toContainText(q.author);
  await splash.getByRole("button", "Entrar").click();
  await expect(screen.getByRole("dialog", "Cita del día")).toHaveCount(0);
  // Once per launch: moving around does not bring it back.
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Biblioteca").click();
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
  await expect(screen.getByRole("dialog", "Cita del día")).toHaveCount(0);

  await app.open("/?splash");
  await expect(screen.getByRole("dialog", "Cita del día")).toBeVisible({ timeout: 30_000 });
  await screen.getByRole("dialog", "Cita del día").getByRole("button", "Entrar").press("Escape");
  await expect(screen.getByRole("dialog", "Cita del día")).toHaveCount(0);
});
