// features/hoy.feature — AC-56 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SAMPLE_GUIDE } from "../../src/e2e/examScript.ts";
import { pending } from "./helpers.ts";

function localDay(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("AC-56 Hoy: tarjetas, clases y qué estudiar de cada examen, en el inicio", async ({ app, screen }) => {
  await app.open("/");
  const nav = screen.getByRole("navigation", "Navegación");
  await expect(screen.getByRole("heading", "¿Qué querés entender?")).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole("region", "Hoy")).toHaveCount(0);

  await nav.getByRole("button", "Tarjetas").click();
  await screen.getByLabel("Nombre del mazo").fill("Puertos");
  await screen.getByRole("radio", "De mis apuntes").click();
  await screen.getByLabel("Apuntes").fill("- HTTPS: 443\n- SSH: 22");
  await screen.getByRole("button", "Generar mazo").click();
  await expect(screen.getByRole("region", "Tarjetas del mazo")).toBeVisible({ timeout: 10_000 });

  await nav.getByRole("button", "Exámenes").click();
  await screen.getByLabel("Nombre del examen").fill("AWS Certified Cloud Practitioner");
  await screen.getByLabel("Guía oficial del examen").fill(SAMPLE_GUIDE);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  const goal = screen.getByRole("region", "Meta");
  await goal.getByLabel("Fecha del examen").fill(localDay(10));
  await goal.getByRole("button", "Guardar meta").click();
  await expect(screen.getByTestId("plan-today")).toBeVisible({ timeout: 10_000 });

  await nav.getByRole("button", "Nueva sesión").click();
  const hoy = screen.getByRole("region", "Hoy");
  await expect(hoy).toContainText("2 para repasar · Puertos", { timeout: 10_000 });
  await expect(hoy).toContainText("10 d");
  await expect(hoy).toContainText("AWS Certified Cloud Practitioner · estudiá");
  await hoy.getByRole("button", "Repasar").click();
  await expect(screen.getByRole("heading", "Puertos")).toBeVisible();

  await nav.getByRole("button", "Nueva sesión").click();
  await screen.getByRole("region", "Hoy").getByRole("button", /^Estudiar /).click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
});
