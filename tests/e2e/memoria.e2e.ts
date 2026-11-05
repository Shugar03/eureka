// features/memoria.feature — «Lo que Eureka sabe de vos» (AC-199, AC-200), web build with the mock backend.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-199 ver la memoria por tipo, corregirla y borrar una observación", async ({ app, screen }) => {
  await app.open("/?withProfile&withMemory");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi progreso").click({ timeout: 30_000 });
  const me = screen.getByRole("region", "Lo que Eureka sabe de vos");
  await expect(me.getByRole("list", "Confusiones")).toContainText("Recta secante");
  await expect(me.getByRole("list", "Ideas que entendiste")).toContainText("La derivada es la pendiente de la recta tangente");
  await expect(me.getByRole("list", "Le cuesta")).toContainText(/se contradice con otra/i);
  await expect(me.getByRole("list", "Pendiente")).toContainText(/para repasar/i);

  // The student settles the contradiction: it is theirs now, and verified.
  await me.getByRole("list", "Le cuesta").getByRole("button", "Corregir: Regla de la cadena").click();
  const form = me.getByRole("form", "Corregir: Regla de la cadena");
  await form.getByLabel("Qué es").selectOption("Ya lo domina");
  await form.getByLabel("Detalle").fill("ya la saco sin ayuda");
  await form.getByRole("button", "Guardar").click();
  await expect(me.getByRole("list", "Le cuesta")).toHaveCount(0);
  await expect(me.getByRole("list", "Ya lo domina")).toContainText(/lo corregiste vos/i);
  await expect(me.getByRole("list", "Ya lo domina")).toContainText("ya la saco sin ayuda");

  await me.getByRole("button", "Borrar: Recta secante").click();
  await expect(me.getByRole("list", "Confusiones")).toHaveCount(0);
});

test("AC-200 exportar la memoria para Obsidian", async ({ app, screen }) => {
  await app.open("/?withProfile&withMemory");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi progreso").click({ timeout: 30_000 });
  const me = screen.getByRole("region", "Lo que Eureka sabe de vos");
  await me.getByRole("button", "Exportar para Obsidian").click();
  await expect(me.getByRole("status")).toContainText("Eureka - lo que sabe de vos");
  await expect(me.getByRole("status")).toContainText("Obsidian");
});
