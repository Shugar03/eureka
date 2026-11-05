// features/acompanamiento.feature — AC-82 … AC-87 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { goTo } from "./helpers.ts";
import type { App, Screen } from "e2e";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function open(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await goTo(screen, "Acompañamiento");
}

async function say(screen: Screen, text: string) {
  await screen.getByRole("textbox", "Mensaje").fill(text);
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("log", "Conversación").getByText(text)).toBeVisible();
}

test("AC-82 antes de empezar dice qué es, qué no es y a dónde viajan los mensajes", async ({ app, screen }) => {
  await open(app, screen);
  const gate = screen.getByRole("region", "Antes de empezar");
  await expect(gate).toContainText("Acá no se estudia");
  await expect(gate).toContainText("No es terapia");
  await expect(gate).toContainText("Tus mensajes viajan a");
  await expect(gate).toContainText("El profesor no lee nada de esto");
  await expect(screen.getByRole("textbox", "Mensaje")).toHaveCount(0);
  await screen.getByRole("button", "Entendido, seguir").click();
  await expect(screen.getByRole("heading", "Contame cómo estás")).toBeVisible();
});

test("AC-82 escucha sin enseñar, y si el envío falla el mensaje queda en la caja", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await screen.getByRole("textbox", "Mensaje").fill("FALLA por favor");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("alert")).toContainText("boom");
  await expect(screen.getByRole("textbox", "Mensaje")).toHaveValue("FALLA por favor");

  await screen.getByRole("textbox", "Mensaje").fill("Estoy re cansado con los parciales");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByText("Suena a que venís cargado. ¿Qué fue lo más pesado de hoy?")).toBeVisible();
  await expect(screen.getByRole("region", "Líneas de ayuda")).toHaveCount(0);
});

test("AC-84 ante señales de riesgo la app responde sola y muestra líneas de ayuda que se quedan", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await say(screen, "a veces pienso en quitarme la vida");
  await expect(screen.getByText("¿Estás pensando en hacerte daño o en quitarte la vida?", { exact: false })).toBeVisible();
  const help = screen.getByRole("region", "Líneas de ayuda");
  await expect(help).toContainText("135");
  await expect(help).toContainText("llamá a emergencias");
  await say(screen, "no sé qué hacer");
  await expect(screen.getByRole("region", "Líneas de ayuda")).toBeVisible();
  // A new conversation starts clean.
  await screen.getByRole("button", "Nueva charla").click();
  await screen.getByRole("button", "¿Seguro? Empezar de nuevo").click();
  await expect(screen.getByRole("region", "Líneas de ayuda")).toHaveCount(0);
});

test("AC-83 un check-in de diez segundos y una entrada propuesta que solo se guarda si la aprobás", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await say(screen, "estoy cansado de tanto parcial");
  await expect(screen.getByRole("button", "Guardar esta charla en mi diario")).toBeDisabled();
  await say(screen, "caminar me ayudó");
  await screen.getByRole("button", "Guardar esta charla en mi diario").click();
  const editor = screen.getByRole("region", "Así quedaría tu entrada");
  await expect(editor.getByRole("textbox", "Título de la entrada")).toHaveValue("Una semana de parciales");
  await editor.getByRole("textbox", "Título de la entrada").fill("Mi semana de parciales");
  await editor.getByRole("button", "Guardar en mi diario").click();
  await expect(screen.getByText("Guardado en tu diario", { exact: false })).toBeVisible();

  await screen.getByRole("tab", "Diario").click();
  await expect(screen.getByText("Mi semana de parciales")).toBeVisible();
  await expect(screen.getByText("Me ayudó: salir a caminar")).toBeVisible();

  await screen.getByRole("radio", "Bien").click();
  await screen.getByRole("button", "alivio").click();
  await screen.getByRole("button", "Guardar check-in").click();
  const today = screen.getByRole("region", "Hoy");
  await expect(today.getByText("Check-in")).toBeVisible();
  await expect(today.getByText("alivio")).toBeVisible();

  await screen.getByRole("button", "Borrar Check-in").click();
  await screen.getByRole("button", "Confirmar borrar Check-in").click();
  await expect(today.getByText("Check-in")).toHaveCount(0);
});

test("AC-85 el PIN bloquea el diario, se vuelve a pedir al salir, y olvidarlo no atrapa los datos", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await screen.getByRole("tab", "Diario").click();
  await screen.getByRole("radio", "Mal").click();
  await screen.getByRole("button", "Guardar check-in").click();
  await expect(screen.getByRole("region", "Hoy").getByText("Check-in")).toBeVisible();

  await screen.getByLabel("PIN nuevo").fill("4321");
  await screen.getByRole("button", "Poner PIN").click();
  await expect(screen.getByRole("button", "Bloquear ahora")).toBeVisible();

  // Leaving the screen locks it again.
  await goTo(screen, "Idiomas");
  await goTo(screen, "Acompañamiento");
  const lock = screen.getByRole("region", "Diario bloqueado");
  await expect(lock).toBeVisible();
  await expect(screen.getByText("Check-in")).toHaveCount(0);

  await lock.getByLabel("PIN del diario").fill("0000");
  await lock.getByRole("button", "Desbloquear").click();
  await expect(lock.getByRole("alert")).toContainText("PIN incorrecto");
  await lock.getByLabel("PIN del diario").fill("4321");
  await lock.getByRole("button", "Desbloquear").click();
  await screen.getByRole("tab", "Diario").click();
  await expect(screen.getByRole("region", "Hoy").getByText("Check-in")).toBeVisible();

  // Forgetting the PIN: erase everything and start again.
  await screen.getByRole("button", "Bloquear ahora").click();
  await screen.getByRole("button", "Olvidé mi PIN").click();
  await screen.getByRole("button", "¿Seguro? Borrar todo para siempre").click();
  await expect(screen.getByRole("region", "Antes de empezar")).toBeVisible();
});

test("AC-86 borrar todo vuelve al principio y las líneas de ayuda se pueden cambiar", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await screen.getByRole("tab", "Diario").click();
  await screen.getByLabel("Líneas de ayuda").fill("Mi línea — 0800 123");
  await screen.getByRole("button", "Guardar líneas de ayuda").click();
  await expect(screen.getByText("Guardamos las líneas de ayuda.")).toBeVisible();
  await screen.getByRole("tab", "Charlar").click();
  await say(screen, "no quiero vivir más");
  await expect(screen.getByRole("region", "Líneas de ayuda")).toContainText("Mi línea");

  await screen.getByRole("tab", "Diario").click();
  await screen.getByRole("button", "Borrar todo").click();
  await screen.getByRole("button", "¿Seguro? Borrar todo para siempre").click();
  await expect(screen.getByRole("region", "Antes de empezar")).toBeVisible();
});

test("AC-87 respiración guiada y 5-4-3-2-1, sin conexión ni modelo", async ({ app, screen }) => {
  await open(app, screen, "?companionReady");
  await screen.getByRole("tab", "Herramientas").click();
  const breath = screen.getByRole("region", "Respiración guiada");
  await breath.getByRole("button", "Empezar").click();
  await expect(screen.getByTestId("breath-cue")).toHaveText("Inhalá");
  await expect(screen.getByTestId("breath-cue")).toHaveText("Sostené", { timeout: 8_000 });
  await breath.getByRole("button", "Terminar").click();
  await expect(screen.getByTestId("breath-cue")).toHaveText("Cuando quieras");

  const g = screen.getByRole("region", "Anclaje 5-4-3-2-1");
  await g.getByRole("button", "Empezar").click();
  await expect(g.getByTestId("grounding-step")).toContainText("5 cosas que podés ver");
  for (let i = 0; i < 4; i++) await g.getByRole("button", "Siguiente").click();
  await expect(g.getByTestId("grounding-step")).toContainText("1 cosa que podés saborear");
  await g.getByRole("button", "Terminar").click();
  await expect(g.getByText("Estás acá", { exact: false })).toBeVisible();
});
