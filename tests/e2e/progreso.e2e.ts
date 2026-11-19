// features/progreso.feature — AC-111 … AC-113, AC-210 (web, scripted backend).
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
  const hard = screen.getByRole("tabpanel", "Te cuesta");
  await expect(hard).toContainText("Recta secante");
  await hard.getByRole("button", "Esto ya lo sé: Recta secante").click();
  await expect(hard).toContainText("Nada por ahora.");
  await screen.getByRole("tab", /Practicando/).click();
  await expect(screen.getByRole("tabpanel", "Practicando")).toContainText("Recta secante");
  // The profile and the session memories live here, folded at the end (AC-210).
  await screen.getByText("Corregir lo que Eureka anotó").click();
  await expect(screen.getByRole("region", "Lo que Eureka sabe de vos")).toBeVisible();
  await expect(screen.getByRole("region", "Lo que recuerda de tus sesiones")).toBeVisible();
});

test("AC-210 Mi progreso: el coach, los números y un camino por sesión", async ({ app, screen }) => {
  await app.open("/?progress");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi progreso").click({ timeout: 30_000 });
  const coach = screen.getByRole("region", "Cómo venís");
  await expect(coach).toContainText("Ana.");
  await expect(coach).toContainText("Lo que más se repite es Por qué se resta el gradiente");
  await expect(coach.getByRole("group", "Hoy te conviene")).toContainText("12 tarjetas para hoy");
  await expect(screen.getByRole("region", "Resumen")).toContainText("95 min de foco");
  await expect(screen.getByRole("region", "Se viene")).toContainText("Parcial de Análisis I");
  const path = screen.getByRole("list", "Ideas de Gradientes en Machine Learning");
  await expect(path).toContainText("Derivada como pendiente");
  await expect(path).toContainText("Te cuesta: no sabía qué dirección");
  // Topics a path already shows are not repeated below.
  const others = screen.getByRole("region", "Fuera de tus caminos");
  await expect(others).toContainText("Integrales por partes");
  await expect(others).not.toContainText("No pudo explicar");
  await path.getByRole("button", "Seguir desde acá: Por qué se resta el gradiente").click();
  await expect(screen.getByRole("button", "Volver a Sesiones")).toBeVisible();
});
