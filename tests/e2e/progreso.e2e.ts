// features/progreso.feature — AC-111 … AC-113 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-112 el plan de hoy propone repasar una confusión y abre la charla", async ({ app, screen }) => {
  await app.open("/?withProfile");
  const plan = screen.getByRole("region", "Tu plan de hoy");
  await expect(plan).toContainText("Repasá Recta secante", { timeout: 30_000 });
  await expect(plan).toContainText("confusión: toca la curva en un solo punto");
  await plan.getByRole("button", "Empezar: Repasá Recta secante").click();
  await expect(screen.getByRole("button", "Volver a Sesiones")).toBeVisible();
  await expect(screen.getByText("Quiero repasar Recta secante: la última vez me confundí.").first()).toBeVisible();
});

test("AC-113 Mi progreso muestra lo que cuesta y se corrige con «Esto ya lo sé»", async ({ app, screen }) => {
  await app.open("/?withProfile");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi progreso").click({ timeout: 30_000 });
  await expect(screen.getByRole("heading", "Mi progreso")).toBeVisible();
  const hard = screen.getByRole("region", "Le cuesta");
  await expect(hard).toContainText("Recta secante");
  await hard.getByRole("button", "Esto ya lo sé: Recta secante").click();
  await expect(screen.getByRole("region", "Practicando")).toContainText("Recta secante");
  await expect(hard).toContainText("Nada por ahora.");
  // The profile and the session memories live here now, not in Ajustes.
  await expect(screen.getByRole("region", "Lo que la app sabe de vos")).toBeVisible();
  await expect(screen.getByRole("region", "Lo que recuerda de tus sesiones")).toBeVisible();
});
