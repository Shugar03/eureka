// features/pomodoro.feature — AC-49 (web, scripted backend, ?fastPomodoro: 1 min = 1 s).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-49 pomodoro: foco, descanso automático y minutos anotados por tema", async ({ app, screen }) => {
  await app.open("/?fastPomodoro");
  const nav = screen.getByRole("navigation", "Navegación");
  const pomo = screen.getByRole("region", "Pomodoro");
  // First load of a cold dev server can take a while.
  await expect(screen.getByRole("region", "Tiempo de estudio")).toContainText("Usá el pomodoro", { timeout: 30_000 });

  await pomo.getByRole("button", "Ajustes del pomodoro").click();
  await pomo.getByLabel("Foco (min)").fill("3");
  await pomo.getByLabel("Descanso (min)").fill("2");
  await expect(screen.getByTestId("pomo-time")).toHaveText("0:03");

  // Study something: the block is logged under it.
  await nav.getByRole("button", "Tarjetas").click();
  await screen.getByLabel("Nombre del mazo").fill("Python");
  await screen.getByRole("button", "Crear mazo").click();
  await expect(pomo).toContainText("Estudiando: Python");

  await pomo.getByRole("button", "Iniciar foco").click();
  await expect(pomo.getByRole("button", "Pausar")).toBeVisible();
  await expect(pomo.getByRole("status")).toContainText("¡Bloque de foco terminado! Anoté 3 min. Descanso de 2 min.", { timeout: 10_000 });
  await expect(pomo).toContainText("Descanso · 1/4");
  await expect(pomo.getByRole("status")).toContainText("Terminó el descanso", { timeout: 10_000 });
  await expect(pomo.getByRole("button", "Iniciar foco")).toBeVisible();
  await expect(pomo).toContainText("Foco · 1/4");

  await nav.getByRole("button", "Nueva sesión").click();
  const stats = screen.getByRole("region", "Tiempo de estudio");
  await expect(screen.getByTestId("study-today")).toHaveText("Hoy: 3 min · 7 días: 3 min");
  await expect(stats.getByRole("list", "Por tema")).toContainText("Python");

  // Pause keeps the time; skip and reset.
  await pomo.getByRole("button", "Saltar al descanso").click();
  await expect(pomo).toContainText("Descanso");
  await pomo.getByRole("button", "Reiniciar pomodoro").click();
  await expect(pomo).toContainText("Foco · 0/4");
});
