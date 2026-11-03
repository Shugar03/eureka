// features/bienvenida.feature — AC-92 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

const nav = (screen: import("e2e").Screen) => screen.getByRole("navigation", "Navegación");

test("AC-92 la bienvenida pide lo básico por pasos, saluda por el nombre y no vuelve a aparecer", async ({ app, screen }) => {
  await app.open("/?onboarding");
  const dialog = screen.getByRole("dialog", "Bienvenida");
  await expect(dialog).toContainText("Paso 1 de 5", { timeout: 30_000 });
  await expect(dialog).toContainText("se comparten con el modelo de IA");

  await dialog.getByLabel("Tu nombre").fill("Emanuel");
  await dialog.getByLabel("Tu apellido").fill("Paz");
  await dialog.getByRole("button", "Siguiente").click();
  await dialog.getByLabel("Dónde estudiás").fill("UTN");
  await dialog.getByLabel("Qué estudiás").fill("Ingeniería en Sistemas");
  await dialog.getByLabel("Tu edad").fill("21");
  await dialog.getByRole("button", "Siguiente").click();
  await dialog.getByRole("radio", /^Elle/).click();
  await dialog.getByRole("button", "Siguiente").click();
  await dialog.getByRole("radio", "Claro").click();
  await dialog.getByRole("radio", "Dunas de lavanda").click();
  await dialog.getByRole("button", "Siguiente").click();
  await expect(dialog.getByTestId("hello")).toHaveText(/^Buen(os días|as tardes|as noches), Emanuel$/);
  await dialog.getByRole("button", "Empezar").click();

  await expect(screen.getByRole("dialog", "Bienvenida")).toHaveCount(0);
  await expect(screen.getByText(/^Buen(os días|as tardes|as noches), Emanuel$/)).toBeVisible();
  await expect(nav(screen).getByRole("button", "Emanuel Personalizar")).toBeVisible();

  // The care step was left as suggested: the reminders are on, with the suggested minutes.
  await nav(screen).getByRole("button", "Ajustes").click();
  await expect(screen.getByLabel("Avisarme que me pare")).toBeChecked();
  await expect(screen.getByLabel("Minutos para pararme")).toHaveValue("25");
  await expect(screen.getByLabel("Avisarme que tome agua")).toBeChecked();
  await expect(screen.getByLabel("Minutos para tomar agua")).toHaveValue("60");

  // It remembers, so the welcome does not come back.
  await app.open("/?onboarding");
  await expect(screen.getByText(/^Buen(os días|as tardes|as noches), Emanuel$/)).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole("dialog", "Bienvenida")).toHaveCount(0);
});

test("AC-92 se puede omitir todo, y volver a verla desde Mi espacio", async ({ app, screen }) => {
  await app.open("/?onboarding");
  await screen.getByRole("dialog", "Bienvenida").getByRole("button", "Omitir todo").click({ timeout: 30_000 });
  await expect(screen.getByRole("dialog", "Bienvenida")).toHaveCount(0);
  await expect(screen.getByText(/^Buen(os días|as tardes|as noches)$/)).toBeVisible();

  await nav(screen).getByRole("button", "Mi espacio Personalizar").click();
  await screen.getByLabel("Tu nombre").fill("Jessica");
  await screen.getByRole("radio", /^Ella/).click();
  await screen.getByRole("button", "Volver a ver la bienvenida").click();
  const dialog = screen.getByRole("dialog", "Bienvenida");
  await expect(dialog.getByLabel("Tu nombre")).toHaveValue("Jessica");
});
