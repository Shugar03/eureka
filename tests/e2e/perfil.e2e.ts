// Harness audit M5/M10 — what the app knows about the learner, and forgetting it (AC-66; now in Mi progreso, AC-113).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-66 ver y olvidar lo que la app sabe de vos", async ({ app, screen }) => {
  await app.open("/?withProfile");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi progreso").click({ timeout: 30_000 });
  const me = screen.getByRole("region", "Lo que la app sabe de vos");
  await expect(me.getByRole("list", "Cómo aprendés mejor")).toContainText("entiende mejor con ejemplos numéricos");
  await expect(me.getByRole("list", "Confusiones")).toContainText("Recta secante: toca la curva en un solo punto");
  await me.getByRole("button", "Olvidar: entiende mejor con ejemplos numéricos").click();
  await expect(me.getByRole("list", "Cómo aprendés mejor")).toHaveCount(0);
  await me.getByRole("button", "Olvidar todo").click();
  await me.getByRole("button", "¿Seguro? Olvidar todo").click();
  await expect(me).toContainText("Todavía nada");
});
