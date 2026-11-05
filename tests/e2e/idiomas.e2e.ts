// features/idiomas.feature — AC-65 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { goTo, pick } from "./helpers.ts";

async function openLanguages(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await goTo(screen, "Idiomas");
}

test("AC-65 listening: audio leído en voz alta, preguntas y transcripción al corregir", async ({ app, screen }) => {
  await openLanguages(app, screen);
  await screen.getByLabel("Nivel").selectOption("B1");
  await screen.getByRole("button", "Nuevo listening").click();
  await expect(screen.getByRole("heading", "A call to the travel agency")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText(/change my flight to Lisbon/)).toHaveCount(0);
  await screen.getByRole("button", "Escuchar").click();
  await expect(screen.getByTestId("plays")).toHaveText("Escuchado 1 vez");
  await screen.getByRole("radiogroup", "Velocidad").getByRole("radio", "Lenta").click();

  await pick(screen.getByRole("group", "Pregunta 1"), /^To change a flight/);
  await pick(screen.getByRole("group", "Pregunta 2"), /^Wednesday/);
  await screen.getByRole("button", "Corregir").click();
  await expect(screen.getByTestId("listening-score")).toHaveText("1/2 · 50%");
  await expect(screen.getByRole("region", "Resultado del listening")).toContainText("change my flight to Lisbon");
});

test("AC-65 speaking: consigna, audio transcripto y devolución con versión mejorada", async ({ app, screen, browser }) => {
  await openLanguages(app, screen);
  await screen.getByRole("radiogroup", "Práctica").getByRole("radio", "Speaking").click();
  const task = screen.getByTestId("speaking-task");
  await expect(task).toContainText("working from home");
  await screen.getByRole("button", "Otra consigna").click();
  await expect(task).not.toContainText("working from home");

  await browser.locator('input[aria-label="Subir audio de mi respuesta"]').setInputFiles("tests/fixtures/respuesta.wav");
  const said = screen.getByLabel("Transcripción de tu respuesta");
  await expect(said).toHaveValue(/I can saves time/, { timeout: 10_000 });
  await screen.getByRole("button", "Corregir").click();
  await expect(screen.getByTestId("speaking-feedback")).toContainText("«I can saves» → «I can save»", { timeout: 10_000 });
  await expect(screen.getByRole("button", "Escuchar la versión mejorada")).toBeVisible();

  await openLanguages(app, screen, "?noSpeech");
  await screen.getByRole("radiogroup", "Práctica").getByRole("radio", "Speaking").click();
  await browser.locator('input[aria-label="Subir audio de mi respuesta"]').setInputFiles("tests/fixtures/respuesta.wav");
  await expect(screen.getByRole("alert")).toContainText("Ajustes → Voz", { timeout: 10_000 });
});
