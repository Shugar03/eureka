// features/sesiones.feature — AC-211: scrolling up to reread is not undone by the answer
// that is coming, and «Ir al final» brings the conversation back.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { finishProbe, startSession } from "./helpers.ts";

type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

const scrollUp = (browser: Browser) =>
  browser.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".transcript")!;
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  }, null);
const position = (browser: Browser) =>
  browser.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".transcript")!;
    return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight };
  }, null);

test("AC-211 subir a releer no se deshace mientras escribe, e «Ir al final» vuelve", async ({ app, screen, browser }) => {
  await startSession(app, screen);
  await finishProbe(screen);
  // A free message: the answer streams in after it.
  await screen.getByRole("textbox", "Mensaje").fill("esperá, antes explicame qué es un límite con un ejemplo");
  await screen.getByRole("button", "Enviar").click();
  await scrollUp(browser);
  await expect(screen.getByRole("button", /^Ir al final/)).toBeVisible();
  // The answer arrives and the conversation grows, but the view stays where the person left it.
  await expect(screen.getByRole("button", "Enviar")).toBeVisible({ timeout: 20_000 });
  expect((await position(browser)).top).toBeLessThan(40);
  await screen.getByRole("button", /^Ir al final/).click();
  expect((await position(browser)).gap).toBeLessThan(80);
  await expect(screen.getByRole("button", /^Ir al final/)).toHaveCount(0);
});
