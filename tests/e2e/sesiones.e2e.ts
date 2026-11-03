// features/sesiones.feature — AC-08
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { finishProbe, GOAL, pending, startSession } from "./helpers";

const row = (screen: import("e2e").Screen, title: string) =>
  screen.getByRole("listitem").filter({ hasText: title });

test("AC-08 la sesión aparece en el inicio con fase y progreso", async ({ app, screen }) => {
  await startSession(app, screen);
  await finishProbe(screen);

  await screen.getByRole("button", "Volver a Sesiones").click();

  await expect(screen.getByRole("heading", "Sesiones")).toBeVisible();
  await expect(row(screen, GOAL)).toContainText("Enseñar");
  await expect(row(screen, GOAL)).toContainText("0/3 pasos");
});

test("AC-08 reabrir una sesión conserva la pregunta pendiente", async ({ app, screen }) => {
  await startSession(app, screen);
  await expect(pending(screen)).toContainText("pendiente 2");

  await screen.getByRole("button", "Volver a Sesiones").click();
  await row(screen, GOAL).getByRole("button", new RegExp(`^${GOAL}`)).click();

  await expect(pending(screen)).toContainText("pendiente 2");
  await expect(pending(screen).getByRole("button", "Responder")).toBeVisible();
});

test("AC-08 borrar una sesión pide confirmación", async ({ app, screen }) => {
  await startSession(app, screen, "tema a borrar");
  await screen.getByRole("button", "Volver a Sesiones").click();

  await row(screen, "tema a borrar").getByRole("button", "Borrar tema a borrar").click();
  const confirm = row(screen, "tema a borrar").getByRole("group", "Confirmar borrar tema a borrar");
  await expect(confirm).toContainText("Lo que aprendiste en ella sigue en tu memoria");

  await confirm.getByRole("button", "Borrar").click();
  await expect(row(screen, "tema a borrar")).toHaveCount(0);
});

test("AC-107 fijar, renombrar y archivar una sesión", async ({ app, screen }) => {
  await startSession(app, screen, "tema uno");
  await screen.getByRole("button", "Volver a Sesiones").click();

  await row(screen, "tema uno").getByRole("button", "Fijar tema uno").click();
  await expect(row(screen, "tema uno").getByLabel("Fijada")).toBeVisible();

  await row(screen, "tema uno").getByRole("button", "Renombrar tema uno").click();
  const box = screen.getByLabel("Nuevo nombre de tema uno");
  await box.fill("tema renombrado");
  await box.press("Enter");
  await expect(row(screen, "tema renombrado")).toHaveCount(1);

  await row(screen, "tema renombrado").getByRole("button", "Archivar tema renombrado").click();
  await expect(row(screen, "tema renombrado")).toHaveCount(0);
  await expect(screen.getByRole("region", "Sesiones recientes")).not.toContainText("tema renombrado");
  await screen.getByRole("button", "Archivadas (1)").click();
  await expect(row(screen, "tema renombrado")).toHaveCount(1);
});
