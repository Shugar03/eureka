// features/mis-problemas.feature — AC-173 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer } from "./helpers.ts";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function openOwn(app: App, screen: Screen) {
  await app.open("/");
  await nav(screen).getByRole("button", "Práctica").click();
  const card = screen.getByRole("region", "Practicar mis problemas");
  await card.getByRole("button", "Traer mis problemas").click();
  return card;
}

test("AC-173 pegar mi guía, revisar lo leído y practicarla aunque el grafo esté vacío", async ({ app, screen }) => {
  const card = await openOwn(app, screen);
  await card.getByLabel("Nombre de la práctica").fill("Guía 2 de Física");
  await card.getByLabel("Tus ejercicios").fill("Guía 2 — Cinemática\n1) Un auto va a 20 m/s durante 3 s. ¿Cuánto recorre? Rta: 60 m\n2) ¿Y en 5 s?\n3) Un tren recorre 100 m en 4 s. ¿Qué rapidez tiene?");
  await card.getByRole("button", "Leer los ejercicios").click();
  const list = card.getByRole("list", "Ejercicios leídos");
  await expect(list.getByRole("checkbox")).toHaveCount(3, { timeout: 10_000 });
  await expect(list.getByText(/respuesta de tu guía/i)).toHaveCount(1);
  await expect(list.getByText(/solución de eureka: verificala/i)).toHaveCount(2);

  // Fix one statement and drop another before practicing.
  await card.getByLabel("Enunciado del ejercicio 2").fill("2) Un auto va a 20 m/s durante 5 s. ¿Cuánto recorre?");
  await card.getByLabel("Practicar el ejercicio 3").uncheck();
  await card.getByRole("button", "Practicar (2)").click();

  await expect(screen.getByRole("heading", "Guía 2 de Física")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 1 de 2");
  await answer(screen, { text: "Recorre 60 m", confidence: 4 });
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await screen.getByRole("button", "Siguiente").click();
  await expect(screen.getByRole("region", "Pregunta pendiente")).toContainText("durante 5 s");
});

test("AC-173 con la solución de Eureka: lo avisa y puedo pedir que la revise", async ({ app, screen }) => {
  const card = await openOwn(app, screen);
  await card.getByLabel("Tus ejercicios").fill("1) ¿Cuántos lados tiene un hexágono?");
  await card.getByRole("button", "Leer los ejercicios").click();
  await card.getByRole("button", "Practicar (1)").click();
  await expect(screen.getByRole("heading", "Mis problemas (1)")).toBeVisible({ timeout: 10_000 });
  await answer(screen, { text: "seis", confidence: 5 });
  await expect(screen.getByTestId("verdict")).toContainText("Incorrecto", { timeout: 10_000 });
  await screen.getByRole("button", "Ver solución").click();
  await expect(screen.getByTestId("solution-by-model")).toContainText("verificala");
  await screen.getByRole("button", "Creo que mi respuesta está bien").click();
  await expect(screen.getByTestId("verdict")).toContainText("Correcto", { timeout: 10_000 });
  await expect(screen.getByTestId("verdict")).toContainText("la referencia");
});

test("AC-173 desde una foto: se lee con el modelo y se avisa que hay que revisarla", async ({ app, screen, browser }) => {
  const card = await openOwn(app, screen);
  await browser.locator('input[aria-label="Archivo con ejercicios"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(card.getByLabel("Tus ejercicios")).toHaveValue(/Un móvil recorre 120 km en 2 h/, { timeout: 10_000 });
  await expect(card).toContainText("Lo leí de una imagen");
  await expect(card.getByLabel("Nombre de la práctica")).toHaveValue("foto-guia");
  await card.getByRole("button", "Leer los ejercicios").click();
  await expect(card.getByRole("list", "Ejercicios leídos").getByRole("checkbox")).toHaveCount(2, { timeout: 10_000 });
});

test("AC-173 sin texto no hay nada para leer", async ({ app, screen }) => {
  const card = await openOwn(app, screen);
  await expect(card.getByRole("button", "Leer los ejercicios")).toBeDisabled();
  await card.getByRole("button", "Cancelar").click();
  await expect(card.getByRole("button", "Traer mis problemas")).toBeVisible();
});

test("AC-174 desde el chat: pego mis ejercicios y pido practicarlos", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("Quiero practicar estos ejercicios:\n1) Un auto va a 20 m/s durante 3 s. ¿Cuánto recorre? Rta: 60 m\n2) ¿Y en 5 s?");
  await screen.getByRole("button", "Enviar").click();
  const card = screen.getByRole("region", "Practicar mis problemas");
  await expect(card.getByLabel("Tus ejercicios")).toHaveValue(/Un auto va a 20 m\/s/, { timeout: 10_000 });
  await expect(card.getByLabel("Nombre de la práctica")).toHaveValue("Mis ejercicios");
  await card.getByRole("button", "Leer los ejercicios").click();
  await expect(card.getByRole("list", "Ejercicios leídos").getByRole("checkbox")).toHaveCount(2, { timeout: 10_000 });
  await card.getByRole("button", "Practicar (2)").click();
  await expect(screen.getByRole("heading", "Mis ejercicios")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByTestId("problem-progress")).toHaveText("Problema 1 de 2");
});

test("AC-174 desde el chat: la guía que adjunté a la biblioteca", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("Quiero practicar esta guía. Adjunté a mi biblioteca: «Guía 2 de Física».");
  await screen.getByRole("button", "Enviar").click();
  const card = screen.getByRole("region", "Practicar mis problemas");
  await expect(card).toContainText("Los ejercicios de «Guía 2 de Física», de tu biblioteca", { timeout: 10_000 });
  await card.getByRole("button", "Leer los ejercicios").click();
  await expect(card.getByRole("list", "Ejercicios leídos").getByRole("checkbox")).toHaveCount(2, { timeout: 10_000 });
  await expect(card.getByRole("button", "Volver al texto")).toHaveCount(0);
});
