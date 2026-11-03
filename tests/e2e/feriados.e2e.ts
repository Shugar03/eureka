// features/feriados.feature — AC-145 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

function localDay(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("AC-145 un día sin clases saca las clases del inicio, y los feriados nacionales se suman una vez", async ({ app, screen }) => {
  await app.open("/?panel");
  const classes = screen.getByRole("region", "Tu día").getByRole("article", "Clases de hoy");
  await expect(classes).toContainText("Análisis II", { timeout: 30_000 });

  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi cursada").click();
  const card = screen.getByRole("region", "Feriados y días sin clases");
  await expect(card).toContainText("Ninguno por delante");
  const form = card.getByRole("group", "Agregar días sin clases");
  await form.getByLabel("Sin clases desde").fill(localDay(0));
  await form.getByLabel("Motivo").fill("Paro docente");
  await form.getByRole("button", "Agregar").click();
  await expect(card.getByRole("listitem").filter({ hasText: "Paro docente" })).toBeVisible();

  await card.getByRole("button", "Sumar feriados nacionales").click();
  await expect(card.getByRole("status")).toContainText(/Sumé \d+ feriados? nacional/);
  await card.getByRole("button", "Sumar feriados nacionales").click();
  await expect(card.getByRole("status")).toHaveText("Ya están todos los feriados nacionales de este período.");

  await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
  await expect(classes).toContainText("Hoy no hay clases: Paro docente.");
  await expect(classes).not.toContainText("Aula 12");

  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi cursada").click();
  await card.getByRole("button", "Borrar Paro docente").click();
  await expect(card.getByRole("listitem").filter({ hasText: "Paro docente" })).toHaveCount(0);
});
