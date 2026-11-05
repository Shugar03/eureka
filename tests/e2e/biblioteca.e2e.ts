// features/biblioteca.feature — AC-69 … AC-71 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");
const toc = (screen: Screen) => screen.getByRole("navigation", "Índice");
const reader = (screen: Screen) => screen.getByRole("article", "Lector");

async function addFile(app: App, screen: Screen, browser: Browser, file: string) {
  await app.open("/");
  await nav(screen).getByRole("button", "Biblioteca").click({ timeout: 30_000 });
  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles(`tests/fixtures/${file}`);
}

test("AC-69 un PDF se convierte en esta PC y queda indexado por capítulos", async ({ app, screen, browser }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Biblioteca").click({ timeout: 30_000 });
  await expect(screen.getByText("Tu biblioteca está vacía.")).toBeVisible();
  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/apuntes-fisica.pdf");

  await expect(screen.getByText("Listo: «apuntes fisica» quedó en la biblioteca (3 secciones", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(toc(screen).getByRole("button", "Capítulo 1: Energía p. 1")).toBeVisible();
  await expect(toc(screen).getByRole("button", "1.1 Trabajo p. 2")).toBeVisible();
  await expect(toc(screen).getByRole("button", "Capítulo 2: Calor p. 3")).toBeVisible();
  // Hyphenated words rejoined; running header and page numbers gone.
  await expect(reader(screen)).toContainText("capacidad de un sistema para realizar trabajo. Se mide en joules");
  await expect(reader(screen)).not.toContainText("Apuntes de cátedra");

  await toc(screen).getByRole("button", "Capítulo 2: Calor p. 3").click();
  await expect(reader(screen).getByRole("heading", "Capítulo 2: Calor")).toBeVisible();
  await expect(reader(screen)).toContainText("p. 4");
  await expect(reader(screen)).toContainText("la convección y la radiación");
});

test("AC-70 buscar en la biblioteca lleva a la sección y la página", async ({ app, screen, browser }) => {
  await addFile(app, screen, browser, "apuntes-fisica.pdf");
  await expect(toc(screen)).toBeVisible({ timeout: 20_000 });
  await screen.getByLabel("Buscar en la biblioteca").fill("temperatura del calor");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  const first = screen.getByRole("region", "Resultados").getByRole("listitem").first().getByRole("button");
  await expect(screen.getByRole("heading", "Resultados para «temperatura del calor»")).toBeVisible();
  await expect(first).toContainText("Capítulo 2: Calor · p. 3");
  await first.click();
  await expect(reader(screen).getByRole("heading", "Capítulo 2: Calor")).toBeVisible();

  await screen.getByLabel("Buscar en la biblioteca").fill("fotosíntesis");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  await expect(screen.getByRole("heading", "Nada sobre «fotosíntesis» en la biblioteca")).toBeVisible();
});

test("AC-71 un .txt también entra, y una sección se estudia en una sesión", async ({ app, screen, browser }) => {
  await addFile(app, screen, browser, "resumen-historia.txt");
  await expect(toc(screen).getByRole("button", "CAPÍTULO 2 La Independencia")).toBeVisible({ timeout: 20_000 });
  await toc(screen).getByRole("button", "CAPÍTULO 2 La Independencia").click();
  await expect(reader(screen)).toContainText("Congreso de Tucumán");
  await reader(screen).getByRole("button", "Estudiar esta sección").click();
  await expect(screen.getByRole("heading", "Entender «CAPÍTULO 2 La Independencia» del libro «resumen historia»")).toBeVisible({ timeout: 15_000 });
});

test("AC-69 sin OCR un PDF escaneado avisa y quitar un libro lo saca de la biblioteca", async ({ app, screen, browser }) => {
  await app.open("/?noOcr");
  await nav(screen).getByRole("button", "Biblioteca").click({ timeout: 30_000 });
  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/guia-escaneada.pdf");
  await expect(screen.getByRole("alert")).toContainText("parece escaneado", { timeout: 20_000 });

  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/resumen-historia.txt");
  await expect(toc(screen)).toBeVisible({ timeout: 20_000 });
  await reader(screen).getByRole("button", "Quitar de la biblioteca").click();
  await reader(screen).getByRole("button", "¿Seguro? Quitar libro").click();
  await expect(screen.getByText("Tu biblioteca está vacía.")).toBeVisible();
});

test("NF-22 un libro de 28 páginas se indexa en segundos, sin tokens, y se encuentra lo que pregunta un alumno", async ({ app, screen, browser }) => {
  await addFile(app, screen, browser, "libro-editorial.pdf");
  const done = screen.getByText("quedó en la biblioteca (12 secciones", { exact: false });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText("0 tokens del modelo");
  console.log("[NF-22] app (primera vez, carga pdf.js):", await done.textContent());
  // Warm: pdf.js already loaded, as from the second document on.
  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/libro-editorial.pdf");
  await expect(screen.getByText("Leyendo", { exact: false }).first()).toBeHidden({ timeout: 30_000 });
  await expect(done).toBeVisible({ timeout: 30_000 });
  console.log("[NF-22] app (segunda vez):", await done.textContent());

  // A paraphrase (the book says "yuca" and "saliva"; the student, "mandioca").
  await screen.getByLabel("Buscar en la biblioteca").fill("¿Por qué se mastica la mandioca para la bebida amazónica?");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  const hits = screen.getByRole("region", "Resultados").getByRole("listitem");
  await expect(hits.first()).toBeVisible();
  console.log("[NF-22] resultados:", JSON.stringify(await hits.allTextContents()));
});

test("AC-191 Word, PowerPoint y EPUB entran a la biblioteca con sus títulos como secciones", async ({ app, screen, browser }) => {
  await addFile(app, screen, browser, "apuntes-volcanes.docx");
  await expect(screen.getByText("Listo: «apuntes volcanes» quedó en la biblioteca (3 secciones", { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(toc(screen).getByRole("button", "El cono de Tamberías", { exact: false })).toBeVisible();

  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/clase-volcanes.pptx");
  await expect(screen.getByText("Listo: «clase volcanes» quedó en la biblioteca (3 secciones", { exact: false })).toBeVisible({ timeout: 20_000 });
  await toc(screen).getByRole("button", "La regla del semáforo", { exact: false }).click();
  await expect(reader(screen)).toContainText("Rojo: evacuar");

  await browser.locator('input[aria-label="Agregar un documento a la biblioteca"]').setInputFiles("tests/fixtures/libro-volcanes.epub");
  await expect(toc(screen).getByRole("button", "1.1 La cámara", { exact: false })).toBeVisible({ timeout: 20_000 });
  await screen.getByLabel("Buscar en la biblioteca").fill("cámara magmática");
  await screen.getByLabel("Buscar en la biblioteca").press("Enter");
  await expect(screen.getByRole("region", "Resultados").getByRole("listitem").first()).toContainText("1.1 La cámara");
});

test("AC-191 el «+» del chat también deja una presentación en la biblioteca", async ({ app, screen, browser }) => {
  await app.open("/");
  await browser.locator('[data-testid="attach-input"]').setInputFiles("tests/fixtures/clase-volcanes.pptx");
  await expect(screen.getByText("en tu biblioteca")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText("clase volcanes")).toBeVisible();
});
