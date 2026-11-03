// features/mi-espacio.feature — AC-78, AC-79, AC-80, AC-81 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";

type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

const accent = (browser: Browser) => browser.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), null);

async function openSpace(app: App, screen: Screen) {
  await app.open("/");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi espacio Personalizar").click({ timeout: 30_000 });
  await expect(screen.getByRole("heading", "Fondo de pantalla")).toBeVisible();
}

test("AC-78 elegir un fondo cambia la pantalla y sugiere su color", async ({ app, screen, browser }) => {
  await openSpace(app, screen);
  const before = await accent(browser);
  await screen.getByRole("radio", "Atardecer").click();
  await expect(screen.getByTestId("accent-hint")).toContainText("rojo");
  await expect.poll(() => accent(browser)).not.toBe(before);
  await expect(screen.getByRole("radio", "rojo (sugerido)")).toHaveAttribute("aria-checked", "true");
  const wall = await browser.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wallpaper"), null);
  expect(wall).toContain("data:image/svg+xml");
});

test("AC-79 una imagen propia: se toman sus colores y se sugiere el predominante", async ({ app, screen, browser }) => {
  await openSpace(app, screen);
  await browser.locator('input[aria-label="Elegir una imagen de fondo"]').setInputFiles("tests/fixtures/fondo-rojo.png");
  await expect(screen.getByRole("radio", "Tu imagen")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByTestId("accent-hint")).toContainText("rojo");
  await expect(screen.getByRole("radio", "rojo (sugerido)")).toBeVisible();
  // The corner of blue is a second option, not forced.
  await expect(screen.getByRole("radio", "azul")).toBeVisible();
});

test("AC-80 elegir otro color a mano lo mantiene aunque cambie el fondo", async ({ app, screen, browser }) => {
  await openSpace(app, screen);
  await screen.getByRole("radio", "Océano en calma").click();
  await screen.getByLabel("Elegir un color de acento").fill("#3366cc");
  await expect(screen.getByRole("checkbox", /Tomar el color del fondo/)).not.toBeChecked();
  await expect.poll(() => accent(browser)).toMatch(/^#[0-9a-f]{6}$/);
  const mine = await accent(browser);
  await screen.getByRole("radio", "Bosque entre la niebla").click();
  expect(await accent(browser)).toBe(mine);
  await screen.getByRole("checkbox", /Tomar el color del fondo/).click();
  await expect.poll(() => accent(browser)).not.toBe(mine);
});

test("AC-81 el nombre, el fondo y el color se recuerdan y saludan", async ({ app, screen, browser }) => {
  await openSpace(app, screen);
  await screen.getByLabel("Tu nombre").fill("Ana");
  await screen.getByRole("radio", "Dunas de lavanda").click();
  await screen.getByRole("radio", "Claro").click();
  await app.open("/");
  await expect(screen.getByText(/^Buen(os días|as tardes|as noches), Ana$/)).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole("navigation", "Navegación").getByRole("button", "Ana Personalizar")).toBeVisible();
  const wall = await browser.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wallpaper"), null);
  expect(wall).toContain("data:image/svg+xml");
});
