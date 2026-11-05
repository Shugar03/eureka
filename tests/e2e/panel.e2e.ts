// features/panel.feature — AC-140..AC-143 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-140 AC-142 AC-143 el panel muestra las clases de hoy, lo que se viene y las notas", async ({ app, screen }) => {
  await app.open("/?panel");
  const dash = screen.getByRole("region", "Tu día");
  await expect(dash).toBeVisible({ timeout: 30_000 });
  const classes = dash.getByRole("article", "Clases de hoy");
  await expect(classes).toContainText("Análisis II");
  await expect(classes).toContainText("Aula 12");
  await expect(classes).toContainText("Sigue");

  const coming = dash.getByRole("article", "Lo que se viene");
  await expect(coming).toContainText("TP 2");
  await expect(coming).toContainText("1 día TP 2");
  await expect(coming).toContainText("Primer parcial");
  await expect(coming).toContainText("3 días Primer parcial");

  const grades = dash.getByRole("article", "Notas");
  await expect(grades).toContainText("TP 1: 8 · Parcial 1: 7");
  await expect(grades.getByLabel("Promedio 7,5")).toBeVisible();

  await coming.getByRole("button", /TP 2/).click();
  await expect(screen.getByRole("heading", "Mi cursada")).toBeVisible({ timeout: 10_000 });
});

test("AC-141 la racha cuenta el día libre, suma lo de hoy y nunca culpa", async ({ app, screen }) => {
  await app.open("/?streak");
  const streak = screen.getByRole("article", "Racha");
  await expect(screen.getByTestId("streak-current")).toHaveText("6 días", { timeout: 30_000 });
  // Which of the two kind messages shows depends on the weekday the seed lands on (the free day of the week), so only the part they share is checked.
  await expect(screen.getByTestId("streak-message")).toContainText("Vas 6 días.");
  await expect(streak.getByRole("listitem")).toHaveCount(7);

  await screen.getByLabel("Mensaje").fill("Quiero entender las derivadas");
  await screen.getByRole("button", "Enviar").click();
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
  await expect(screen.getByTestId("streak-current")).toHaveText("7 días", { timeout: 10_000 });
  await expect(screen.getByTestId("streak-message")).toHaveText("7 días con estudio. Hoy ya sumaste.");
});

test("AC-140 AC-141 sin nada cargado invita a empezar", async ({ app, screen }) => {
  await app.open("/");
  await expect(screen.getByTestId("streak-current")).toHaveText("0 días", { timeout: 30_000 });
  await expect(screen.getByTestId("streak-message")).toHaveText("Hoy puede ser el día uno.");
  await expect(screen.getByRole("article", "Notas")).toContainText("Todavía no hay notas.");
  await screen.getByRole("button", "Ir a Mi cursada").click();
  await expect(screen.getByRole("heading", "Mi cursada")).toBeVisible({ timeout: 10_000 });
});
