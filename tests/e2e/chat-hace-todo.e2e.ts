// features/chat-hace-todo.feature — AC-160 … AC-165 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { answer, finishProbe, phase, startSession } from "./helpers.ts";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function say(app: App, screen: Screen, text: string, open = true) {
  if (open) await app.open("/");
  else await nav(screen).getByRole("button", "Nueva sesión").click();
  await screen.getByLabel("Mensaje").fill(text);
  await screen.getByRole("button", "Enviar").click();
}

test("AC-161 pedir un mazo: se editan las tarjetas y se crea al confirmar", async ({ app, screen }) => {
  await say(app, screen, "haceme tarjetas de verbos irregulares");
  const card = screen.getByRole("region", "Mazo «Verbos irregulares»");
  await expect(card.getByLabel("Frente 1")).toHaveValue("to go", { timeout: 30_000 });
  await card.getByLabel("Dorso 2").fill("saw · seen (ver)");
  await card.getByRole("button", "Sacar la tarjeta 3").click();
  await card.getByLabel("Nombre del mazo propuesto").fill("Verbos en inglés");
  await card.getByRole("button", "Crear el mazo (2)").click();
  await expect(card.getByRole("status")).toContainText("2 tarjetas");
  await card.getByRole("button", "Estudiar el mazo").click();
  await expect(screen.getByRole("heading", "Verbos en inglés")).toBeVisible();
  await expect(screen.getByRole("region", "Tarjetas del mazo")).toContainText("saw · seen (ver)");

  // AC-164: a deck by its name, from the chat.
  await say(app, screen, "quiero estudiar el mazo Verbos en inglés", false);
  const open = screen.getByRole("group", "Estudiar el mazo");
  await expect(open).toContainText("Abre el mazo «Verbos en inglés»", { timeout: 30_000 });
  await open.getByRole("button", "Estudiar el mazo").click();
  await expect(screen.getByRole("heading", "Verbos en inglés")).toBeVisible();
});

test("AC-164 un examen que no existe: el botón lo dice y no abre nada", async ({ app, screen }) => {
  await say(app, screen, "quiero hacer un simulacro");
  const offer = screen.getByRole("group", "Hacer un simulacro");
  await expect(offer).toContainText("No encontré la preparación «AWS Certified Cloud Practitioner»", { timeout: 30_000 });
  await expect(offer.getByRole("button", "Hacer un simulacro")).toBeDisabled();
});

test("AC-163 un ejercicio de programación: se ajusta el tema y se genera en Código", async ({ app, screen }) => {
  await say(app, screen, "dame un ejercicio de python");
  const card = screen.getByRole("region", "Ejercicio de programación propuesto");
  await expect(card.getByLabel("Tema del ejercicio")).toHaveValue("recorrer listas con for", { timeout: 30_000 });
  await card.getByLabel("Tema del ejercicio").fill("diccionarios");
  await card.getByLabel("Nivel del ejercicio").selectOption("medio");
  await card.getByRole("button", "Generar un ejercicio nuevo en Código").click();
  await expect(screen.getByLabel("Tema del ejercicio")).toHaveValue("diccionarios", { timeout: 10_000 });
});

test("AC-160 duraciones del pomodoro y perfil, pedidos en el chat", async ({ app, screen }) => {
  await say(app, screen, "poné el pomodoro de 50 y descanso de 10");
  await expect(screen.getByText("Pomodoro: foco 50 min, descanso 10 min")).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole("region", "Pomodoro")).toContainText("50:00");
  await say(app, screen, "me llamo Ana", false);
  await expect(screen.getByText("Actualizó tu perfil")).toBeVisible({ timeout: 30_000 });
});

test("AC-165 la tarjeta del examen y la del horario se corrigen antes de confirmar", async ({ app, screen }) => {
  await say(app, screen, "quiero rendir una certificación");
  const exam = screen.getByRole("region", "Preparación de AWS Certified AI Practitioner");
  await exam.getByRole("button", "Corregir").click({ timeout: 30_000 });
  await exam.getByLabel("Horas por semana").fill("10");
  await exam.getByLabel("Nombre del examen").fill("AWS AI Practitioner (AIF-C01)");
  await exam.getByRole("button", "Listo").click();
  await expect(exam).toContainText("10");
  await expect(exam.getByRole("heading")).toHaveText("Preparar «AWS AI Practitioner (AIF-C01)»");

  await say(app, screen, "te paso mi horario", false);
  const tt = screen.getByRole("region", "Propuesta para Mi cursada");
  await tt.getByRole("button", "Corregir").click({ timeout: 30_000 });
  await tt.getByLabel("Nombre de la materia 1").fill("Análisis Matemático I");
  await tt.getByRole("button", "Sacar Física I").click();
  await tt.getByRole("button", "Listo").click();
  await expect(tt).not.toContainText("Física I");
  await tt.getByRole("button", "Guardar en Mi cursada").click();
  await expect(tt.getByRole("status")).toContainText("1 materia nueva, 1 fecha nueva");
});

test("AC-162 practicar desde el chat con las ideas del grafo", async ({ app, screen }) => {
  await startSession(app, screen, "qué es una derivada");
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });

  await say(app, screen, "quiero practicar derivadas", false);
  const card = screen.getByRole("region", "Práctica propuesta");
  await expect(card.getByRole("checkbox", "La derivada es la pendiente de la recta tangente")).toBeChecked({ timeout: 30_000 });
  await card.getByRole("radio", "5").click();
  await card.getByRole("button", "Generar una práctica nueva").click();
  await expect(screen.getByRole("heading", /derivada/i).first()).toBeVisible({ timeout: 15_000 });
});
