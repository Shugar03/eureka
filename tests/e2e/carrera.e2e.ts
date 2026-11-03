// features/carrera.feature — AC-155 … AC-157 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function openCareer(app: App, screen: Screen) {
  await app.open("/");
  await nav(screen).getByRole("button", "Mi cursada").click({ timeout: 30_000 });
  await screen.getByRole("tab", "Mi carrera").click();
}

const row = (screen: Screen, name: string) => screen.getByRole("listitem", name);

test("AC-155 cargar el plan desde una foto: se transcribe, se lee, se revisa y se guarda al confirmar", async ({ app, screen, browser }) => {
  await openCareer(app, screen);
  await screen.getByRole("button", "Cargar mi plan de estudios").click();
  const panel = screen.getByRole("region", "Cargar el plan de estudios");
  await browser.locator('input[aria-label="Leer el plan desde una foto o un PDF"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(panel.getByRole("status")).toContainText("Leí foto-guia.png con el modelo", { timeout: 10_000 });
  await expect(panel.getByLabel("Plan de estudios para leer")).toHaveValue(/Análisis Matemático I \(AM1\)/);
  await panel.getByRole("button", "Leer el plan").click();
  const preview = screen.getByRole("region", "Lo que entendí del plan");
  await expect(preview).toContainText("4 materias en 3 años", { timeout: 10_000 });
  await expect(preview).toContainText("para cursar: AM1, AGA");
  await preview.getByRole("button", "Guardar mi carrera").click();

  await expect(screen.getByTestId("career-progress")).toHaveText("0 de 4 materias aprobadas (0 %)");
  await expect(screen.getByRole("region", "Primer año")).toContainText("Análisis Matemático I");
  await expect(row(screen, "Análisis Matemático I")).toContainText("Podés cursarla");
  await expect(row(screen, "Probabilidad y Estadística")).toContainText("Para cursarla te falta regularizar: Análisis Matemático II");
});

test("AC-156 aprobadas, regulares y aplazos: el promedio y lo que se puede cursar o rendir", async ({ app, screen }) => {
  await openCareer(app, screen);
  await screen.getByRole("button", "Cargar mi plan de estudios").click();
  await screen.getByLabel("Plan de estudios para leer").fill("1.º año Análisis Matemático I, Álgebra");
  await screen.getByRole("button", "Leer el plan").click();
  await screen.getByRole("button", "Guardar mi carrera").click({ timeout: 10_000 });

  await row(screen, "Análisis Matemático I").getByRole("button", "Editar Análisis Matemático I").click();
  const form = screen.getByRole("group", "Editar Análisis Matemático I");
  await form.getByLabel("Estado").selectOption("Aprobada");
  await form.getByRole("button", "Guardar").click();
  await expect(form.getByRole("alert")).toContainText("Poné la nota");
  await form.getByLabel("Nota final").fill("8");
  await form.getByLabel("Notas de los finales desaprobados").fill("2");
  await form.getByRole("button", "Guardar").click();
  await expect(screen.getByTestId("career-average")).toContainText("8");
  await expect(screen.getByTestId("career-average")).toContainText("5 con aplazos");
  await expect(row(screen, "Análisis Matemático I")).toContainText("Aplazos: 2");

  await screen.getByLabel("Estado de Álgebra y Geometría Analítica").selectOption("Regular");
  await expect(row(screen, "Álgebra y Geometría Analítica")).toContainText("Podés rendir el final");
  await expect(row(screen, "Análisis Matemático II")).toContainText("Podés cursarla");
  const summary = screen.getByRole("region", "Resumen de tu carrera");
  await expect(summary).toContainText("Podés rendir el final de: Álgebra y Geometría Analítica");
  await expect(summary).toContainText("Podés cursar: Análisis Matemático II");
  await expect(screen.getByTestId("career-progress")).toHaveText("1 de 4 materias aprobadas (25 %)");
  await expect(screen.getByRole("progressbar", "Materias aprobadas")).toHaveAttribute("aria-valuenow", "1");

  // Reloading the plan keeps what was marked.
  await screen.getByRole("button", "Volver a cargar el plan").click();
  await screen.getByLabel("Plan de estudios para leer").fill("1.º año Análisis Matemático I, Álgebra");
  await screen.getByRole("button", "Leer el plan").click();
  await screen.getByRole("button", "Guardar mi carrera").click({ timeout: 10_000 });
  await expect(screen.getByTestId("career-progress")).toHaveText("1 de 4 materias aprobadas (25 %)");

  await screen.getByRole("button", "Borrar mi carrera").click();
  await screen.getByRole("button", "¿Seguro? Borrar mi carrera").click();
  await expect(screen.getByRole("button", "Cargar mi plan de estudios")).toBeVisible();
});
