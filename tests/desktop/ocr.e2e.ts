// Real app (Rust + WebView2 + the bundled PaddleOCR models): AC-187 and AC-188
// end to end, raw bytes over IPC included. Needs the models next to the exe
// (`ocr/*.onnx`, as the installer puts them) or a debug build with ocr-models/.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { fakeProvider } from "./launch.ts";

test("D-OCR-1 un PDF escaneado se lee de verdad en esta PC y se puede buscar", async ({ app, screen, browser }) => {
  await app.open("/");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Biblioteca").click({ timeout: 30_000 });
  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/fotocopia-celula.pdf");
  const reader = screen.getByRole("article", "Lector");
  await expect(reader).toContainText("Leído con OCR: puede tener errores", { timeout: 90_000 });
  await expect(screen.getByText("terminé de leerlo con OCR.", { exact: false })).toBeVisible({ timeout: 90_000 });
  // The real model reads the synthetic pages, accents included, each with its page.
  await expect(reader).toContainText("La mitocondria produce la energía que la célula usa");
  await expect(reader).toContainText("El ribosoma arma las proteínas");
  await expect(reader).toContainText("p. 3");
  await screen.getByLabel("Buscar en la biblioteca").fill("mitocondria energía");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  await expect(screen.getByRole("region", "Resultados").getByRole("listitem").first()).toContainText("fotocopia celula");
});

test("D-OCR-2 una foto de texto impreso se lee en esta PC, sin el modelo de visión", async ({ app, screen, browser }) => {
  await fakeProvider.reset();
  await app.open("/");
  await browser.locator('[data-testid="attach-input"]').setInputFiles("tests/fixtures/foto-apunte.png");
  await expect(screen.getByText("texto leído en esta PC")).toBeVisible({ timeout: 60_000 });
  expect((await fakeProvider.requests()).length).toBe(0);
});
