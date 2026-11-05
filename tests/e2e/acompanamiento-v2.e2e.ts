// features/acompanamiento-v2.feature — AC-93, AC-94, AC-95 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { goTo } from "./helpers.ts";
import type { App, Screen } from "e2e";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function open(app: App, screen: Screen, query: string, tab: string) {
  await app.open(`/${query}`);
  await goTo(screen, "Acompañamiento");
  await screen.getByRole("tab", tab).click();
}

test("AC-93 un registro de pensamientos, de a una pregunta, que queda en el diario", async ({ app, screen }) => {
  await open(app, screen, "?companionReady", "Herramientas");
  await screen.getByRole("button", "Empezar un registro").click();
  const w = screen.getByRole("region", "Registro de pensamientos");
  await expect(screen.getByTestId("wizard-step")).toHaveText("Paso 1 de 5");
  await expect(w.getByRole("button", "Siguiente")).toBeDisabled();
  await w.getByRole("textbox", "Qué pasó").fill("Me fue mal en el parcial de Física");
  await w.getByRole("button", "Siguiente").click();
  await w.getByRole("textbox", "Qué pensaste").fill("Voy a desaprobar todo");
  await w.getByRole("button", "Siguiente").click();

  await w.getByRole("radio", "Miedo").click();
  await w.getByRole("button", "ansioso").click();
  await w.getByLabel("Intensidad antes").fill("80");
  await w.getByRole("button", "Siguiente").click();

  await w.getByRole("textbox", "Lo que apoya el pensamiento").fill("Me equivoqué en dos ejercicios");
  await w.getByRole("textbox", "Lo que no encaja con el pensamiento").fill("Aprobé los dos parciales anteriores");
  await w.getByRole("button", "Siguiente").click();

  await expect(screen.getByTestId("wizard-step")).toHaveText("Paso 5 de 5");
  await w.getByRole("textbox", "Otra mirada").fill("Un parcial no decide toda la materia");
  await w.getByRole("checkbox", /Volver a medir/).click();
  await w.getByLabel("Intensidad ahora").fill("40");
  await w.getByRole("button", "Guardar en mi diario").click();
  await expect(screen.getByText("Guardado en tu diario.")).toBeVisible();

  await screen.getByRole("tab", "Diario").click();
  const entry = screen.getByTestId("entry");
  await expect(entry).toContainText("Registro de pensamientos");
  await expect(entry).toContainText("Situación: Me fue mal en el parcial de Física");
  await expect(entry).toContainText("Lo que no encaja: Aprobé los dos parciales anteriores");
  await expect(entry).toContainText("Otra mirada: Un parcial no decide toda la materia");
  await expect(entry).toContainText("Intensidad 80 → 40");
  await expect(entry).toContainText("ansioso");
});

test("AC-93 se puede cancelar en cualquier momento sin guardar nada", async ({ app, screen }) => {
  await open(app, screen, "?companionReady", "Herramientas");
  await screen.getByRole("button", "Empezar un registro").click();
  await screen.getByRole("textbox", "Qué pasó").fill("algo que prefiero no anotar");
  await screen.getByRole("button", "Cancelar").click();
  await expect(screen.getByRole("button", "Empezar un registro")).toBeVisible();
  await screen.getByRole("tab", "Diario").click();
  await expect(screen.getByTestId("entry")).toHaveCount(0);
});

test("AC-94 la rueda de emociones va de la familia a la palabra, y se guarda como check-in", async ({ app, screen }) => {
  await open(app, screen, "?companionReady", "Herramientas");
  const wheel = screen.getByRole("region", "Rueda de emociones");
  await wheel.getByRole("radio", "Tristeza").click();
  await wheel.getByRole("button", "desanimado").click();
  await wheel.getByRole("radio", "Agobio").click();
  await wheel.getByRole("button", "cansado").click();
  await expect(wheel.getByTestId("wheel-chosen")).toContainText("desanimado, cansado");
  await expect(wheel.getByRole("button", "Guardar como check-in")).toBeDisabled();
  await wheel.getByRole("radio", "Mal").click();
  await wheel.getByRole("button", "Guardar como check-in").click();
  await expect(wheel.getByText("Guardado como check-in en tu diario.")).toBeVisible();

  await screen.getByRole("tab", "Diario").click();
  const today = screen.getByRole("region", "Hoy");
  await expect(today).toContainText("desanimado");
  await expect(today).toContainText("cansado");
});

test("AC-94 también está dentro del check-in, para cuando falta la palabra", async ({ app, screen }) => {
  await open(app, screen, "?companionReady", "Diario");
  await screen.getByRole("button", /No encuentro la palabra/).click();
  await screen.getByRole("radio", "Enojo").click();
  await screen.getByRole("button", "frustrado").click();
  await screen.getByRole("radio", "Mal").click();
  await screen.getByRole("button", "Guardar check-in").click();
  await expect(screen.getByRole("region", "Hoy")).toContainText("frustrado");
});

test("AC-95 sin datos suficientes no inventa nada: dice cuánto falta", async ({ app, screen }) => {
  await open(app, screen, "?companionReady", "Diario");
  await expect(screen.getByTestId("insights-empty")).toHaveText("Con 8 anotaciones más con tu ánimo, empiezo a ver cosas.");
  await screen.getByRole("radio", "Bien").click();
  await screen.getByRole("button", "Guardar check-in").click();
  await expect(screen.getByTestId("insights-empty")).toHaveText("Con 7 anotaciones más con tu ánimo, empiezo a ver cosas.");
});

test("AC-95 lo que noté: son suposiciones que la persona confirma o descarta", async ({ app, screen }) => {
  await open(app, screen, "?companionSeed", "Diario");
  const panel = screen.getByRole("region", "Lo que noté");
  await expect(panel).toContainText("no son un diagnóstico ni explican por qué");
  await expect(panel).toContainText("Los domingos suelen costarte más");
  await expect(panel).toContainText("«Ansiedad» aparece cuando te anotás mal");
  await expect(panel).not.toContainText("porque");

  // Confirm one: it moves to "Lo que ya confirmé".
  await panel.getByRole("button", "Me suena: Los domingos suelen costarte más").click();
  await expect(panel.getByLabel("Lo que ya confirmé")).toContainText("Los domingos suelen costarte más");
  // Take it back.
  await panel.getByRole("button", "Quitar de lo confirmado: Los domingos suelen costarte más").click();
  await expect(panel.getByLabel("Lo que ya confirmé")).toHaveCount(0);

  // Reject one: it disappears, and can be shown again.
  await panel.getByRole("button", "No es así: «Ansiedad» aparece cuando te anotás mal").click();
  await expect(panel).not.toContainText("«Ansiedad» aparece cuando te anotás mal");
  await panel.getByRole("button", "Ver las que descarté (1)").click();
  await panel.getByRole("button", "Volver a mostrar: «Ansiedad» aparece cuando te anotás mal").click();
  await expect(panel).toContainText("«Ansiedad» aparece cuando te anotás mal");
});
