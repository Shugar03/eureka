// features/compartir.feature — AC-152 … AC-154 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { goTo } from "./helpers.ts";
import type { App, Screen } from "e2e";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function openCards(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await nav(screen).getByRole("button", "Tarjetas").click({ timeout: 30_000 });
}

test("AC-152 importar un .apkg de Anki: vista previa, lo que queda afuera y el mazo nuevo", async ({ app, screen, browser }) => {
  await openCards(app, screen);
  await browser.locator('input[aria-label="Importar un mazo de Anki o compartido"]').setInputFiles("tests/fixtures/mazo-anki.apkg");
  const preview = screen.getByRole("region", "Mazo para importar");
  await expect(preview.getByRole("heading", "Mazo de Anki")).toBeVisible({ timeout: 10_000 });
  await expect(preview).toContainText("3 tarjetas, todas como nuevas");
  await expect(preview).toContainText("2 notas tenían solo imagen o sonido");
  await expect(preview.getByLabel("Nombre del mazo para importar")).toHaveValue("mazo-anki");
  await preview.getByLabel("Nombre del mazo para importar").fill("Inglés de Anki");
  await preview.getByRole("button", "Importar 3 tarjetas").click();
  await expect(screen.getByRole("heading", "Inglés de Anki")).toBeVisible();
  await expect(screen.getByRole("region", "Tarjetas del mazo").getByRole("listitem")).toHaveCount(3);

  // Cancelling the preview imports nothing.
  await nav(screen).getByRole("button", "Tarjetas").click();
  await browser.locator('input[aria-label="Importar un mazo de Anki o compartido"]').setInputFiles("tests/fixtures/mazo-compartido.eureka");
  await screen.getByRole("region", "Mazo para importar").getByRole("button", "Cancelar").click();
  await expect(screen.getByRole("region", "Mazo para importar")).toHaveCount(0);
});

test("AC-153 AC-154 exportar a Anki y compartir un mazo; importar uno compartido", async ({ app, screen, browser }) => {
  await openCards(app, screen);
  await screen.getByLabel("Nombre del mazo").fill("Puertos");
  await screen.getByRole("button", "Crear mazo").click();
  await expect(screen.getByRole("group", "Compartir y exportar")).toHaveCount(0);
  await screen.getByLabel("Frente").fill("¿Puerto de HTTPS?");
  await screen.getByLabel("Dorso").fill("443");
  await screen.getByRole("button", "Agregar tarjeta").click();

  const share = screen.getByRole("group", "Compartir y exportar");
  await share.getByRole("button", "Exportar a Anki (.apkg)").click();
  await expect(screen.getByRole("status").filter({ hasText: "Listo para Anki" })).toContainText("Puertos.apkg");
  await share.getByRole("button", "Compartir").click();
  const sent = screen.getByRole("status").filter({ hasText: "Listo para mandar" });
  await expect(sent).toContainText("Puertos.eureka");
  await expect(sent).toContainText("WhatsApp");

  await nav(screen).getByRole("button", "Tarjetas").click();
  await browser.locator('input[aria-label="Importar un mazo de Anki o compartido"]').setInputFiles("tests/fixtures/mazo-compartido.eureka");
  const preview = screen.getByRole("region", "Mazo para importar");
  await expect(preview.getByRole("heading", "Te compartieron un mazo")).toBeVisible({ timeout: 10_000 });
  await expect(preview).toContainText("vienen de otra persona");
  await expect(preview).toContainText("1 tarjeta no se pudo usar");
  await expect(preview.getByRole("list", "Primeras tarjetas")).toContainText("went · gone");
  await preview.getByRole("button", "Importar 2 tarjetas").click();
  await expect(screen.getByRole("heading", "Verbos irregulares")).toBeVisible();
});

test("AC-154 abrir un .eureka con doble clic lleva a Tarjetas con la vista previa, una sola vez", async ({ app, screen }) => {
  await app.open("/?openedDeck");
  const preview = screen.getByRole("region", "Mazo para importar");
  await expect(preview.getByRole("heading", "Te compartieron un mazo")).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByLabel("Nombre del mazo para importar")).toHaveValue("Repaso de Biología");
  await preview.getByRole("button", "Cancelar").click();
  await goTo(screen, "Grafo");
  await nav(screen).getByRole("button", "Tarjetas").click();
  await expect(screen.getByRole("region", "Mazo para importar")).toHaveCount(0);
});
