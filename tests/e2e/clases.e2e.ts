// features/clases.feature — AC-146..AC-148 (web, scripted backend).
import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

/** A silent microphone, parts of 1.5 s instead of 50, and a voice that records what it reads. */
async function fakeClassroom(browser: Browser) {
  await browser.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
    (window as unknown as { __eurekaSegmentMs: number }).__eurekaSegmentMs = 1500;
    let current: SpeechSynthesisUtterance | null = null;
    const synth = {
      speaking: false,
      getVoices: () => [],
      speak(u: SpeechSynthesisUtterance) {
        current = u;
        this.speaking = true;
      },
      cancel() {
        current = null;
        this.speaking = false;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    (window as unknown as { __spoken: () => string | undefined }).__spoken = () => current?.text;
  }, null);
}

test("AC-146 AC-147 AC-148 grabar una clase, transcribirla de a partes y estudiar con sus apuntes", async ({ app, screen, browser }) => {
  await app.open("/?panel");
  await fakeClassroom(browser);
  const nav = screen.getByRole("navigation", "Navegación");
  await nav.getByRole("button", "Clases").click({ timeout: 30_000 });

  const form = screen.getByRole("region", "Grabar una clase");
  await form.getByLabel("Materia de la clase").selectOption({ label: "Análisis II" });
  await form.getByRole("button", "Empezar a grabar").click();

  const live = screen.getByRole("region", "Clase en curso");
  await expect(live.getByRole("status")).toContainText("Grabando");
  // Parts are transcribed while the class goes on.
  await expect(screen.getByTestId("class-progress")).toContainText("2 partes transcriptas", { timeout: 20_000 });
  await expect(screen.getByTestId("class-tail")).toContainText("la derivada es la pendiente");
  await live.getByRole("button", "Terminar la clase").click();

  const detail = screen.getByRole("region", /^Clase: Análisis II/);
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByRole("region", "Tus clases")).toContainText("Análisis II");
  await detail.getByRole("button", "Armar apuntes").click();
  await expect(screen.getByTestId("class-notes")).toContainText("pendiente de la recta tangente", { timeout: 15_000 });
  await expect(detail).toContainText("La definición con límites quedó para la próxima clase");

  // AC-148: listen to the review with the system voice.
  await detail.getByRole("button", "Escuchar el repaso").click();
  await expect.poll(() => browser.evaluate(() => (window as unknown as { __spoken: () => string | undefined }).__spoken() ?? "", null)).toContain("Las ideas clave. 1. La derivada es la pendiente de la recta tangente");

  // An announced date goes to Mi cursada; one without a day can't.
  const dates = detail.getByRole("group", "Fechas que se anunciaron");
  await expect(dates.getByRole("button", "Agregar a Mi cursada: TP de derivadas")).toHaveCount(0);
  await dates.getByRole("button", "Agregar a Mi cursada: Primer parcial").click();
  await expect(dates).toContainText("Agregada a Mi cursada");

  await detail.getByRole("button", "Hacer tarjetas").click();
  await expect(screen.getByRole("heading", "Análisis II", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByTestId("deck-stats")).toContainText("tarjetas");
  await screen.getByRole("button", "Escuchar las tarjetas").click();
  await expect.poll(() => browser.evaluate(() => (window as unknown as { __spoken: () => string | undefined }).__spoken() ?? "", null)).toContain("Tarjeta 1.");

  await nav.getByRole("button", "Mi cursada").click();
  await expect(screen.getByRole("region", "Fechas importantes")).toContainText("Primer parcial");
});

test("AC-146 sin Voz elegida, explica qué falta y lleva a Ajustes", async ({ app, screen }) => {
  await app.open("/?noSpeech");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Clases").click({ timeout: 30_000 });
  const form = screen.getByRole("region", "Grabar una clase");
  await expect(form).toContainText("hace falta elegir la Voz");
  await form.getByRole("button", "Elegir la Voz en Ajustes").click();
  await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
});
