// features/chat.feature — AC-89, AC-90, AC-120, AC-121, AC-122 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { pending, startSession } from "./helpers.ts";

test("AC-89 un saludo es solo una charla; pedir aprender arranca el método en la misma conversación", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("hola");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByText("Contame qué te gustaría aprender", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(pending(screen)).toHaveCount(0);
  await expect(screen.getByRole("heading", "Diagnóstico")).toHaveCount(0);

  await screen.getByRole("textbox", "Mensaje").fill("quiero entender qué es una derivada");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByText("Empezó a aprender: qué es una derivada")).toBeVisible({ timeout: 10_000 });
  await expect(pending(screen)).toContainText("pendiente 2", { timeout: 10_000 });
  await expect(screen.getByRole("heading", "Diagnóstico")).toBeVisible();
});

test("AC-90 el asistente ofrece botones y recién pasa algo cuando los tocás", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("ayudame con un pomodoro");
  await screen.getByRole("button", "Enviar").click();

  const pomo = screen.getByRole("region", "Pomodoro");
  const offer = screen.getByRole("group", "Empezar un pomodoro de 25 min");
  await expect(offer).toContainText("el reloj arranca ahora", { timeout: 30_000 });
  await expect(pomo.getByRole("button", "Iniciar foco")).toBeVisible();

  await offer.getByRole("button", "Empezar un pomodoro de 25 min").click();
  await expect(pomo.getByRole("button", "Pausar")).toBeVisible();
  await expect(offer).toContainText("Pomodoro en marcha");

  await screen.getByRole("group", "Abrir la biblioteca").getByRole("button", "Abrir la biblioteca").click();
  await expect(screen.getByRole("heading", "Biblioteca")).toBeVisible();
});

test("AC-120 contar que querés rendir un examen arma la preparación desde el chat", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("quiero prepararme para rendir la certificación AWS el 15 de diciembre");
  await screen.getByRole("button", "Enviar").click();

  const card = screen.getByRole("region", "Preparación de AWS Certified AI Practitioner");
  await expect(card).toContainText("15 de diciembre de 2026", { timeout: 30_000 });
  await expect(card).toContainText("todavía no la tengo");

  await card.getByRole("button", "Buscar la guía y crear mi preparación").click();
  await expect(screen.getByRole("heading", "Tu preparación está lista")).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole("list", "Ruta de estudio")).toBeVisible();
  await card.getByRole("button", "Abrir mi ruta de estudio").click();
  await expect(screen.getByText("AWS Certified AI Practitioner").first()).toBeVisible();
});

test("AC-121 con una pregunta pendiente se puede escribir libremente en el chat", async ({ app, screen }) => {
  await startSession(app, screen);
  await expect(pending(screen)).toContainText("pendiente 2");

  const box = screen.getByRole("textbox", "Mensaje");
  await expect(box).toHaveAttribute("placeholder", /Respondé la pregunta de arriba o escribí lo que quieras/);
  await box.fill("esperá, antes explicame qué es una pendiente");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByText("esperá, antes explicame qué es una pendiente")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText("Respondiste escribiendo en el chat.")).toBeVisible();
  // The conversation went on: there is a new question waiting.
  await expect(pending(screen)).toContainText("0", { timeout: 10_000 });
});

test("AC-122 el asistente maneja el pomodoro, el tema y el sonido cuando se lo pedís", async ({ app, screen, browser }) => {
  await app.open("/");
  const pomo = screen.getByRole("region", "Pomodoro");
  const html = () => browser.evaluate(() => document.documentElement.dataset.theme, null);
  await screen.getByLabel("Mensaje").fill("empezá un pomodoro de 40 min");
  await screen.getByRole("button", "Enviar").click();
  await expect(pomo.getByRole("button", "Pausar")).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText("Empezó un pomodoro de 40 min")).toBeVisible();

  await screen.getByRole("textbox", "Mensaje").fill("pausá el pomodoro");
  await screen.getByRole("button", "Enviar").click();
  await expect(pomo.getByRole("button", "Seguir")).toBeVisible({ timeout: 10_000 });

  await screen.getByRole("textbox", "Mensaje").fill("seguí con el pomodoro");
  await screen.getByRole("button", "Enviar").click();
  await expect(pomo.getByRole("button", "Pausar")).toBeVisible({ timeout: 10_000 });

  await screen.getByRole("textbox", "Mensaje").fill("poné el modo claro");
  await screen.getByRole("button", "Enviar").click();
  await expect.poll(html).toBe("light");

  await screen.getByRole("textbox", "Mensaje").fill("apagá el sonido");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByText("Apagó el sonido del pomodoro")).toBeVisible({ timeout: 10_000 });
  await pomo.getByRole("button", "Ajustes del pomodoro").click();
  await expect(pomo.getByLabel("Sonido")).not.toBeChecked();
});
