// features/accesibilidad.feature — AC-73, AC-74, AC-76 (web, scripted backend).
// The voice and the microphone are stubbed: headed Chromium may have no
// Spanish voice, and a real microphone would ask for permission.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { pending, startSession } from "./helpers.ts";

type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

/** A voice that reports the second word and keeps "speaking" until cancelled. */
async function fakeVoice(browser: Browser) {
  await browser.evaluate(() => {
    let current: SpeechSynthesisUtterance | null = null;
    const synth = {
      speak(u: SpeechSynthesisUtterance) {
        current = u;
        const at = u.text.indexOf(" ") + 1;
        setTimeout(() => u.onboundary?.({ name: "word", charIndex: at } as SpeechSynthesisEvent), 50);
      },
      cancel() {
        const u = current;
        current = null;
        u?.onend?.({} as SpeechSynthesisEvent);
      },
      getVoices: () => [],
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    (window as unknown as { __spoken: () => string | undefined }).__spoken = () => current?.text;
  }, null);
}

/** A silent microphone MediaRecorder can record from. */
async function fakeMic(browser: Browser) {
  await browser.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
  }, null);
}

async function openAccessibility(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Ajustes").click({ timeout: 30_000 });
  await screen.getByRole("tab", "Accesibilidad").click();
}

test("AC-73 los ajustes se aplican al instante y se recuerdan, sin pedir diagnósticos", async ({ app, screen, browser }) => {
  await openAccessibility(app, screen);
  await expect(screen.getByText("No hace falta ningún diagnóstico", { exact: false })).toBeVisible();
  await screen.getByRole("radio", "Muy grande").click();
  await screen.getByRole("checkbox", /Más espacio entre letras/).click();
  await screen.getByRole("checkbox", /Sin animaciones/).click();
  const attrs = () => browser.evaluate(() => ({ ...document.documentElement.dataset }), null);
  await expect.poll(attrs).toMatchObject({ textSize: "larger", spacing: "on", motion: "reduce" });
  // The zoomed shell fills the window exactly: no black band, nothing cut off.
  const fits = await browser.evaluate(() => Math.abs(document.querySelector(".shell")!.getBoundingClientRect().bottom - window.innerHeight) <= 2, null);
  expect(fits).toBe(true);

  await screen.getByRole("button", "Volver").click();
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Accesibilidad").click();
  await expect(screen.getByRole("radio", "Muy grande")).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByRole("checkbox", /Más espacio entre letras/)).toBeChecked();
});

test("AC-74 escuchar un mensaje marca la palabra que se lee, y se detiene", async ({ app, screen, browser }) => {
  await startSession(app, screen, undefined, "?a11y");
  await fakeVoice(browser);
  const q = pending(screen);
  await q.getByRole("button", "Escuchar la pregunta").click();
  const reading = screen.getByTestId("reading");
  await expect(reading).toBeVisible();
  const marked = () => browser.evaluate(() => document.querySelector('[data-testid="reading"] mark')?.textContent ?? "", null);
  await expect.poll(marked).not.toBe("");
  const spoken = await browser.evaluate(() => (window as unknown as { __spoken: () => string | undefined }).__spoken(), null);
  expect(spoken).toBeTruthy();
  expect(spoken).not.toMatch(/[*$`#]/);
  await q.getByRole("button", "Detener lectura").click();
  await expect(reading).toBeHidden();
});

test("AC-76 dictar una respuesta la escribe en la caja; sin modelo de voz avisa dónde configurarlo", async ({ app, screen, browser }) => {
  await startSession(app, screen, undefined, "?a11y");
  await fakeMic(browser);
  const q = pending(screen);
  await q.getByRole("button", "Dictar").click();
  await q.getByRole("button", "Terminar de dictar").click();
  await expect(q.getByRole("textbox", "Tu respuesta")).toHaveValue("la derivada es la pendiente de la recta tangente", { timeout: 10_000 });

  await startSession(app, screen, undefined, "?a11y&noSpeech");
  await expect(pending(screen).getByRole("button", "Dictar")).toBeDisabled();
  await expect(pending(screen).getByText("Para dictar, elegí un modelo de Voz en Ajustes.")).toBeVisible();
});
