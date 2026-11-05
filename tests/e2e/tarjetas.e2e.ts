// features/tarjetas.feature — AC-47, AC-48 (web, scripted backend).
import { readFile } from "node:fs/promises";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { goTo } from "./helpers.ts";
import type { App, Screen } from "e2e";
import { SAMPLE_GUIDE } from "../../src/e2e/examScript.ts";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function openCards(app: App, screen: Screen) {
  await app.open("/");
  await nav(screen).getByRole("button", "Tarjetas").click();
}

test("AC-47 mazo a mano: agregar, editar y borrar tarjetas", async ({ app, screen }) => {
  await openCards(app, screen);
  await expect(screen.getByRole("button", "Crear mazo")).toBeDisabled();
  await screen.getByLabel("Nombre del mazo").fill("Puertos");
  await screen.getByRole("button", "Crear mazo").click();
  await expect(screen.getByRole("heading", "Puertos")).toBeVisible();
  await expect(screen.getByRole("heading", "Nada pendiente hoy")).toBeVisible();

  await screen.getByLabel("Frente").fill("¿Puerto de HTTPS?");
  await screen.getByLabel("Dorso").fill("443");
  await screen.getByRole("button", "Agregar tarjeta").click();
  const list = screen.getByRole("region", "Tarjetas del mazo");
  await expect(list).toContainText("¿Puerto de HTTPS?");
  await expect(list).toContainText("nueva");
  await expect(screen.getByRole("heading", "1 para hoy")).toBeVisible();

  await list.getByRole("button", "Editar ¿Puerto de HTTPS?").click();
  await screen.getByLabel("Dorso").fill("443/TCP");
  await screen.getByRole("button", "Guardar cambios").click();
  await expect(list).toContainText("443/TCP");

  await list.getByRole("button", "Borrar ¿Puerto de HTTPS?").click();
  await list.getByRole("button", "Confirmar borrar ¿Puerto de HTTPS?").click();
  await expect(screen.getByRole("region", "Tarjetas del mazo")).toHaveCount(0);
});

test("AC-47 generar tarjetas de apuntes y de un examen", async ({ app, screen }) => {
  await openCards(app, screen);
  await screen.getByLabel("Nombre del mazo").fill("Apuntes de IAM");
  await screen.getByRole("radio", "De mis apuntes").click();
  await screen.getByLabel("Apuntes").fill("- IAM: usuarios, grupos y roles\n- Menor privilegio: solo los permisos necesarios");
  await screen.getByRole("button", "Generar mazo").click();
  const list = screen.getByRole("region", "Tarjetas del mazo");
  await expect(list.getByRole("listitem")).toHaveCount(2, { timeout: 10_000 });
  await expect(list).toContainText("solo los permisos necesarios");

  // From an exam: its topics and objectives.
  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByLabel("Nombre del examen").fill("AWS Certified Cloud Practitioner");
  await screen.getByLabel("Guía oficial del examen").fill(SAMPLE_GUIDE);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await screen.getByRole("region", "Tarjetas de memoria").getByRole("button", "Crear tarjetas").click();
  await expect(screen.getByRole("heading", "AWS Certified Cloud Practitioner")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("region", "Tarjetas del mazo")).toContainText("Gestión de identidades con IAM");
  await screen.getByRole("button", "Volver a Tarjetas").click();
  await expect(screen.getByRole("region", "Mazos")).toContainText(/AWS Certified Cloud Practitioner.*para hoy/);
});

test("AC-48 estudiar: mostrar, calificar, 'otra vez' vuelve a la fila", async ({ app, screen }) => {
  await openCards(app, screen);
  await screen.getByLabel("Nombre del mazo").fill("Repaso");
  await screen.getByRole("radio", "De mis apuntes").click();
  await screen.getByLabel("Apuntes").fill("- S3: almacenamiento de objetos\n- EC2: máquinas virtuales");
  await screen.getByRole("button", "Generar mazo").click();
  await screen.getByRole("button", "Estudiar (2)").click({ timeout: 10_000 });

  const tarjeta = screen.getByRole("region", "Tarjeta");
  await expect(tarjeta).toContainText("S3");
  await expect(screen.getByTestId("card-back")).toHaveCount(0);
  await screen.getByRole("button", "Mostrar respuesta").click();
  await expect(screen.getByTestId("card-back")).toContainText("almacenamiento de objetos");
  const grades = screen.getByRole("group", "¿Qué tan bien la recordaste?");
  await expect(grades.getByRole("button", /^Otra vez/)).toContainText("hoy");
  await expect(grades.getByRole("button", /^Bien/)).toContainText("1 día");
  await expect(grades.getByRole("button", /^Fácil/)).toContainText("4 días");
  await grades.getByRole("button", /^Otra vez/).click();

  await expect(tarjeta).toContainText("EC2");
  await expect(screen.getByTestId("study-progress")).toContainText("Quedan 2");
  await screen.getByRole("button", "Mostrar respuesta").click();
  await grades.getByRole("button", /^Bien/).click();
  await expect(tarjeta).toContainText("S3"); // back from "Otra vez"
  await screen.getByRole("button", "Mostrar respuesta").click();
  await grades.getByRole("button", /^Fácil/).click();

  await expect(screen.getByTestId("study-summary")).toContainText("Repasaste 2 tarjetas (1 volvió a la fila)");
  await screen.getByRole("button", "Volver al mazo").click();
  await expect(screen.getByRole("heading", "Nada pendiente hoy")).toBeVisible();
  const list = screen.getByRole("region", "Tarjetas del mazo");
  await expect(list).toContainText("vuelve en 1 día");
  await expect(list).toContainText("vuelve en 4 días");
});

test("AC-57 lo fallado se vuelve tarjeta: simulacros y errores de la consola", async ({ app, screen }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Exámenes").click({ timeout: 30_000 });
  await screen.getByLabel("Nombre del examen").fill("AWS Certified Cloud Practitioner");
  await screen.getByLabel("Guía oficial del examen").fill(SAMPLE_GUIDE);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await screen.getByRole("button", "Nuevo simulacro").click({ timeout: 10_000 });
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("button", "Entregar").click(); // all blank → 10 failed
  await expect(screen.getByTestId("elapsed")).toContainText("mazo «Falladas: AWS Certified Cloud Practitioner»", { timeout: 10_000 });

  await goTo(screen, "Código");
  await screen.getByLabel("Código").fill("x = 1/0");
  await screen.getByRole("button", "Ejecutar").click();
  await screen.getByRole("button", "Explicar este error").click();
  await screen.getByRole("button", "Guardar como tarjeta").click({ timeout: 10_000 });
  await expect(screen.getByRole("status").filter({ hasText: "Errores de Python" })).toContainText("Guardada en «Errores de Python».");
  await screen.getByRole("button", "Guardar como tarjeta").click();
  await expect(screen.getByRole("status").filter({ hasText: "ya estaba" })).toBeVisible();

  await nav(screen).getByRole("button", "Tarjetas").click();
  const decks = screen.getByRole("region", "Mazos");
  await expect(decks).toContainText(/Falladas: AWS Certified Cloud Practitioner.*10 tarjetas/);
  await expect(decks).toContainText(/Errores de Python.*1 tarjetas/);
  await decks.getByRole("button", /^Falladas/).click();
  await screen.getByRole("button", /^Estudiar/).click();
  await screen.getByRole("button", "Mostrar respuesta").click();
  await expect(screen.getByTestId("card-back")).toContainText("Lo correcto es");
});

test("AC-60 importar y exportar con Anki, y respaldo completo", async ({ app, screen, browser }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Tarjetas").click({ timeout: 30_000 });
  await browser.locator('input[aria-label="Importar un mazo de Anki o compartido"]').setInputFiles("tests/fixtures/anki-export.txt");
  const preview = screen.getByRole("region", "Mazo para importar");
  await preview.getByLabel("Nombre del mazo para importar").fill("Puertos de Anki");
  await preview.getByRole("button", "Importar 2 tarjetas").click();
  await expect(screen.getByRole("heading", "Puertos de Anki")).toBeVisible({ timeout: 10_000 });
  const list = screen.getByRole("region", "Tarjetas del mazo");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("¿Puerto de HTTPS?");

  const file = await browser.waitForDownload(() => screen.getByRole("button", "Texto plano (.txt)").click());
  const text = await readFile(file.absolutePath, "utf8");
  expect(text).toBe("#separator:tab\n#html:true\n¿Puerto de HTTPS?\t443\n¿Puerto de SSH?\t22\n");

  await nav(screen).getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  const backup = screen.getByRole("region", "Respaldo");
  await backup.getByRole("button", "Crear respaldo").click();
  await expect(backup.getByRole("status")).toContainText("Eureka-respaldo-");
  await browser.locator('input[aria-label="Elegir respaldo para restaurar"]').setInputFiles("tests/fixtures/respaldo.zip");
  await expect(backup.getByRole("alert")).toContainText("reemplaza tus datos actuales");
  await backup.getByRole("button", "Sí, restaurar").click();
  await expect(backup.getByRole("status")).toContainText("Restauré 3 archivos");
});
