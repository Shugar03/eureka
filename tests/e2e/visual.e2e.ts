// features/calidad.feature — visual regression. Baselines live next to this
// file (visual.e2e.ts-snapshots/). After an intended design change:
//   npx e2e run tests/e2e/visual.e2e.ts --update-snapshots
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, pending, startSession } from "./helpers.ts";

const opts = { maxDiffPixelRatio: 0.01 };

type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

// Home greets by the hour and shows a quote of the day: fixed text for those, so the
// baseline compares the design and not the clock (otherwise it failed every other day).
const freezeClock = (browser: Browser) =>
  browser.evaluate(() => {
    const set = (sel: string, text: string) => document.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.textContent = text));
    set(".eyebrow", "Buenas");
    set(".aside-title", "Hoy puede ser un gran día");
    const quote = document.querySelector<HTMLElement>("[data-testid=quote-text]");
    if (quote) quote.textContent = "“La paciencia es amarga, pero su fruto es dulce.”";
    set(".quote-author", "Jean-Jacques Rousseau");
    set(".quote-work", "");
  }, null);

// The theme lives in Ajustes → Mi espacio; the choice is saved, so reopening home keeps it.
async function theme(app: App, screen: Screen, t: "Tema oscuro" | "Tema claro") {
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Mi espacio").click();
  await screen.getByRole("radio", t).click();
  await expect(screen.getByRole("radio", t)).toHaveAttribute("aria-checked", "true");
  await app.open("/");
}

for (const [t, tag] of [["Tema oscuro", "oscuro"], ["Tema claro", "claro"]] as const) {
  test(`visual inicio (${tag})`, async ({ app, screen, browser }) => {
    await app.open("/");
    await theme(app, screen, t);
    await screen.getByRole("heading", "¿Qué querés entender?").click(); // no focus ring on the input
    await freezeClock(browser);
    await expect(screen).toHaveScreenshot(`inicio-${tag}.png`, opts);
  });

  test(`visual sesión enseñando (${tag})`, async ({ app, screen }) => {
    await app.open("/");
    await theme(app, screen, t);
    await startSession(app, screen);
    await finishProbe(screen);
    await expect(pending(screen)).toHaveAttribute("data-purpose", "predict");
    await expect(screen).toHaveScreenshot(`sesion-ensenar-${tag}.png`, opts);
    await expect(screen.getByTestId("plan-tree")).toHaveScreenshot(`plan-${tag}.png`, opts);
  });

  test(`visual ajustes y paleta (${tag})`, async ({ app, screen }) => {
    await app.open("/");
    await theme(app, screen, t);
    await screen.getByRole("button", "Ajustes").click();
    await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
    await expect(screen).toHaveScreenshot(`ajustes-${tag}.png`, opts);
    await screen.getByRole("button", "Buscar o ejecutar").click();
    await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeVisible();
    await expect(screen.getByRole("dialog", "Paleta de comandos")).toHaveScreenshot(`paleta-${tag}.png`, opts);
  });
}

test("visual pregunta con respuesta y confianza", async ({ app, screen }) => {
  await startSession(app, screen);
  await answer(screen, { text: "por cada paso a la derecha sube 2", confidence: 4, thinking: "lo vi en el colegio" });
  await expect(pending(screen)).toContainText("Crece sin límite", { timeout: 10_000 });
  await expect(screen.getByTestId("question").first()).toHaveScreenshot("pregunta-respondida.png", opts);
  await expect(pending(screen)).toHaveScreenshot("pregunta-opciones.png", opts);
});
