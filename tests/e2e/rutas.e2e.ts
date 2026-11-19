// features/rutas.feature — AC-214..AC-217 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-214..AC-217 pedir un roadmap arma una ruta investigada, se crea y se cursa clase por clase", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("textbox", "Mensaje").fill("quiero aprender machine learning, armame un roadmap");
  await screen.getByRole("button", "Enviar").click();

  // AC-214/215: the route comes as a card, with its real sources and what is already known.
  const card = screen.getByRole("region", "Ruta propuesta: Machine Learning desde cero");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("CS229: Machine Learning — Syllabus");
  await expect(card).toContainText("1 ya la sabés");
  await card.getByRole("button", "Crear la ruta").click();
  await screen.getByRole("button", "Empezar la clase 1").click();

  // AC-216: the class knows where it stands.
  const strip = screen.getByRole("group", "Tu ruta");
  await expect(strip).toContainText("Clase 1 de 7");
  await expect(strip).toContainText("Unidad 1: Bases matemáticas");
  await expect(screen.getByRole("heading", "Vectores y matrices")).toBeVisible();

  // AC-217: «Mis rutas» and the home screen point to the next class.
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mis rutas").click();
  await screen.getByRole("button", /Machine Learning desde cero/).click();
  await expect(screen.getByRole("region", "Dónde estás")).toContainText(/Vas por la clase 1 de 7/i);
  await expect(screen.getByRole("list", "Clases de Bases matemáticas")).toContainText("Ya la sabías");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
  await expect(screen.getByRole("region", "Tu ruta")).toContainText("Clase 1: Vectores y matrices");
});
