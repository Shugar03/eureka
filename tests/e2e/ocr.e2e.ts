// features/ocr.feature — AC-187 (scanned PDFs read on this PC) and AC-188 (chat
// photos: local OCR first). Web, scripted backend: the mock "reads" each page with a
// fixed sentence; the PDFs are synthetic image-only fixtures (make-scanned-pdf.py).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");
const reader = (screen: Screen) => screen.getByRole("article", "Lector");
const pick = (browser: Browser, file: string) => browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles(`tests/fixtures/${file}`);

async function library(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await nav(screen).getByRole("button", "Biblioteca").click({ timeout: 30_000 });
}

test("AC-187 un PDF escaneado corto se lee con OCR solo y se puede buscar y citar por página", async ({ app, screen, browser }) => {
  await library(app, screen);
  await pick(browser, "fotocopia-celula.pdf");
  // The import notice goes away once the reading ends, so the reader is what's checked.
  await expect(reader(screen)).toContainText("Leído con OCR: puede tener errores", { timeout: 30_000 });
  await expect(reader(screen)).toContainText("La célula es la unidad básica de la vida");
  // The rest arrives in the background; then every page is there, with its number.
  await expect(screen.getByText("terminé de leerlo con OCR.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(reader(screen)).toContainText("El ribosoma arma las proteínas");
  await expect(reader(screen)).toContainText("p. 3");
  // Page 2 had a line read with little confidence: it says «revisar».
  await expect(reader(screen).getByText("· revisar")).toBeVisible();

  await screen.getByLabel("Buscar en la biblioteca").fill("ribosoma proteínas");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  await expect(screen.getByRole("region", "Resultados").getByRole("listitem").first()).toContainText("fotocopia celula");
  await expect(screen.getByRole("region", "Resultados").getByRole("listitem").first()).toContainText("p. 3");
});

test("AC-187 más de 10 páginas escaneadas: primero la estimación; cancelar y volver a agregarlo sigue donde quedó", async ({ app, screen, browser }) => {
  await library(app, screen);
  await pick(browser, "fotocopia-larga.pdf");
  const ask = screen.getByRole("group", "Leer las páginas escaneadas");
  await expect(ask).toContainText("Son 12 páginas escaneadas: leerlas lleva", { timeout: 30_000 });
  await ask.getByRole("button", "Leer con OCR").click();
  const job = screen.getByRole("status", "Lectura de «fotocopia larga»");
  await expect(job).toContainText("Leyendo página", { timeout: 30_000 });
  await expect(screen.getByText("Listo: «fotocopia larga»", { exact: false })).toBeVisible({ timeout: 30_000 });
  await job.getByRole("button", "Cancelar").click();
  await expect(job).toContainText("lectura pausada", { timeout: 30_000 });
  await expect(reader(screen)).toContainText("Faltan", { timeout: 10_000 });
  await job.getByRole("button", "Listo").click();

  // The same file again: same book (no duplicate), only the pages left.
  await pick(browser, "fotocopia-larga.pdf");
  const again = screen.getByRole("group", "Leer las páginas escaneadas");
  if (await expect(again).toBeVisible({ timeout: 5_000 }).then(() => true).catch(() => false)) await again.getByRole("button", "Leer con OCR").click();
  await expect(screen.getByText("terminé de leerlo con OCR.", { exact: false })).toBeVisible({ timeout: 40_000 });
  await expect(screen.getByRole("complementary", "Documentos").getByRole("listitem")).toHaveCount(1);
  await expect(screen.getByRole("complementary", "Documentos")).toContainText("leído con OCR");
  await expect(screen.getByRole("complementary", "Documentos")).not.toContainText("faltan");
});

test("AC-187 sin OCR (como en el celular) un PDF escaneado avisa como antes", async ({ app, screen, browser }) => {
  await library(app, screen, "?noOcr");
  await pick(browser, "fotocopia-celula.pdf");
  await expect(screen.getByRole("alert")).toContainText("parece escaneado", { timeout: 20_000 });
});

test("AC-187 el «+» del chat también lee un PDF escaneado y lo deja en la biblioteca", async ({ app, screen, browser }) => {
  await app.open("/");
  await browser.locator('[data-testid="attach-input"]').setInputFiles("tests/fixtures/fotocopia-celula.pdf");
  await expect(screen.getByText("en tu biblioteca · leyendo con OCR")).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText("terminé de leerlo con OCR.", { exact: false })).toBeVisible({ timeout: 30_000 });
});

test("AC-188 una foto de texto impreso se lee en esta PC; si el OCR duda, la lee el modelo", async ({ app, screen, browser }) => {
  await app.open("/");
  await browser.locator('[data-testid="attach-input"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(screen.getByText("texto leído en esta PC")).toBeVisible({ timeout: 20_000 });

  await app.open("/?ocrUnsure");
  await browser.locator('[data-testid="attach-input"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(screen.getByText("texto leído de la imagen")).toBeVisible({ timeout: 20_000 });
});
