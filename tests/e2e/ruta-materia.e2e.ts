// features/clases.feature — AC-150 (web, scripted backend): a course of Mi cursada with its study route.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

const PROGRAM = `Unidad 1: Cinemática
- Movimiento rectilíneo uniforme
- Movimiento uniformemente variado
Unidad 2: Dinámica
- Leyes de Newton
- Rozamiento`;

function localDay(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("AC-150 la materia arma su ruta, que apunta al próximo parcial y sigue al siguiente cuando se rinde", async ({ app, screen }) => {
  await app.open("/?panel");
  const nav = screen.getByRole("navigation", "Navegación");
  await nav.getByRole("button", "Mi cursada").click({ timeout: 30_000 });
  const fisica = screen.getByTestId("course").filter({ hasText: "Física I" });
  await fisica.getByRole("button", "Armar la ruta de estudio de Física I").click();

  // The exam form comes filled in as a subject with the course's name.
  await expect(screen.getByRole("radio", "Materia")).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByLabel("Nombre del examen")).toHaveValue("Física I");
  await screen.getByLabel("Guía oficial del examen").fill(PROGRAM);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await expect(screen.getByRole("heading", "Física I")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByLabel("Fecha del examen")).toHaveValue(localDay(3));

  // Back in Mi cursada: the course shows its route; a final later on, and the first parcial done.
  await nav.getByRole("button", "Mi cursada").click();
  await expect(fisica.getByTestId("course-route")).toContainText("Ruta de estudio: Física I · apunta al");
  await screen.getByRole("button", "Agregar fecha").click();
  await screen.getByLabel("Título de la fecha").fill("Final de Física");
  await screen.getByLabel("Tipo de fecha").selectOption({ label: "Final" });
  await screen.getByLabel("Materia de la fecha").selectOption({ label: "Física I" });
  await screen.getByLabel("Fecha", { exact: true }).fill(localDay(40));
  await screen.getByRole("button", "Guardar fecha").click();
  await screen.getByRole("checkbox", "Marcar como hecho: Primer parcial").check();

  await fisica.getByRole("button", "Abrir la ruta de Física I").click();
  await expect(screen.getByLabel("Fecha del examen")).toHaveValue(localDay(40));
});
