// features/sonido-recordatorios.feature — AC-97, AC-98 (web, scripted backend).
// Audio is replaced by a counter of the notes that would play, so the test
// needs no speakers and can tell "sound" from "silence".
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Screen } from "e2e";

type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function fakeAudio(browser: Browser) {
  await browser.evaluate(() => {
    const w = window as unknown as { __notes: number; AudioContext: unknown };
    w.__notes = 0;
    w.AudioContext = class {
      currentTime = 0;
      state = "running";
      destination = {};
      resume() {}
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
      }
      createOscillator() {
        w.__notes++;
        return { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} };
      }
    };
  }, null);
}

const notes = (browser: Browser) => browser.evaluate(() => (window as unknown as { __notes: number }).__notes, null);

test("AC-97 el pomodoro suena al terminar (tic-tac y campanita) y el sonido se puede apagar", async ({ app, screen, browser }) => {
  await app.open("/?fastPomodoro");
  const pomo = screen.getByRole("region", "Pomodoro");
  await expect(screen.getByRole("region", "Tiempo de estudio")).toContainText("Usá el pomodoro", { timeout: 30_000 });
  await fakeAudio(browser);

  await pomo.getByRole("button", "Ajustes del pomodoro").click();
  await pomo.getByLabel("Foco (min)").fill("1");
  await expect(pomo.getByLabel("Sonido")).toBeChecked();
  await expect(pomo.getByLabel("Tic-tac al final")).toBeChecked();
  await pomo.getByRole("button", "Iniciar foco").click();
  await expect(pomo.getByRole("status")).toContainText("¡Bloque de foco terminado!", { timeout: 10_000 });
  // The bell is three notes; the tick-tock of the last second adds at least one.
  expect(await notes(browser)).toBeGreaterThanOrEqual(4);

  // Turn the sound off: the tick-tock goes with it, and the next block is silent.
  await pomo.getByLabel("Sonido").click();
  await expect(pomo.getByLabel("Tic-tac al final")).toBeDisabled();
  await expect(pomo.getByRole("status")).toContainText("Terminó el descanso", { timeout: 10_000 });
  const before = await notes(browser);
  await pomo.getByRole("button", "Iniciar foco").click();
  await expect(pomo.getByRole("status")).toContainText("¡Bloque de foco terminado!", { timeout: 10_000 });
  expect(await notes(browser)).toBe(before);

  // And it is remembered.
  await app.open("/?fastPomodoro");
  await screen.getByRole("region", "Pomodoro").getByRole("button", "Ajustes del pomodoro").click({ timeout: 30_000 });
  await expect(screen.getByRole("region", "Pomodoro").getByLabel("Sonido")).not.toBeChecked();
});

test("AC-98 aviso de pararte y de tomar agua, configurables desde Ajustes", async ({ app, screen }) => {
  await app.open("/?fastReminders");
  await nav(screen).getByRole("button", "Ajustes").click({ timeout: 30_000 });
  const rem = screen.getByRole("region", "Recordatorios");
  await expect(rem.getByLabel("Avisarme que me pare")).not.toBeChecked();
  await expect(rem.getByLabel("Minutos para pararme")).toBeDisabled();

  await rem.getByLabel("Avisarme que me pare").click();
  await rem.getByLabel("Minutos para pararme").fill("10");
  await rem.getByLabel("Minutos para pararme").press("Enter");
  await rem.getByLabel("Avisarme que tome agua").click();
  await rem.getByLabel("Minutos para tomar agua").fill("10");
  await rem.getByLabel("Minutos para tomar agua").press("Enter");
  await expect(rem.getByLabel("Minutos para pararme")).toHaveValue("10");

  // The e2e build runs 1 minute as 1 second: ten "minutes" later both notices appear.
  await expect(screen.getByText("Hora de pararte")).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText("Hora de tomar agua")).toBeVisible({ timeout: 30_000 });
});
