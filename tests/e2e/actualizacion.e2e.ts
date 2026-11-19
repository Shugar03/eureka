// features/actualizacion.feature — AC-202 (web, scripted backend).
// The demo never restarts: after "installing" it stays there, where the real app closes.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-202 la actualización se baja dentro de Eureka, sin ventana de instalador", async ({ app, screen }) => {
  await app.open("/?update");
  const notice = screen.getByRole("status", "Actualización disponible");
  await expect(notice.getByText("Eureka 0.2.0 está lista")).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByText("El profesor contesta mucho más rápido")).toBeVisible();
  await notice.getByRole("button", "Actualizar ahora").click();
  await expect(notice.getByText(/Descargando… [\d,]+ de 34 MB/)).toBeVisible();
  await expect(notice.getByText("Instalando… Eureka se cierra unos segundos y se vuelve a abrir sola.")).toBeVisible({ timeout: 15_000 });
  await expect(notice.getByRole("button", "Más tarde")).toBeHidden();
});

test("AC-202 al abrir la versión nueva muestra sus novedades una vez", async ({ app, screen }) => {
  await app.open("/?whatsNew");
  const dialog = screen.getByRole("dialog", "Novedades de Eureka 0.1.0");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Antes tenías la 0.0.9", { exact: false })).toBeVisible();
  // By section, each change with its name first (not one block of text).
  await expect(dialog.getByRole("region", "Mejorado")).toBeVisible();
  await expect(dialog.getByRole("region", "Corregido").getByText("Hablar más de un minuto ya funciona")).toBeVisible();
  await dialog.getByRole("button", "Listo").click();
  await expect(dialog).toBeHidden();
});
