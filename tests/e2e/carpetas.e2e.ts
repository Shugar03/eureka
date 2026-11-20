// features/carpetas.feature — AC-219..AC-221 (web, scripted backend; the demo has no real disk).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-219..AC-221 compartir una carpeta, ver el plan, aplicarlo y deshacerlo", async ({ app, screen }) => {
  await app.open("/");
  // AC-219: share it from the message box; the teacher is told in the message.
  await screen.getByRole("button", "Compartir una carpeta").click();
  await expect(screen.getByLabel("Mensaje")).toHaveValue("Te compartí la carpeta «Apuntes».");
  await screen.getByLabel("Mensaje").fill("Te compartí la carpeta «Apuntes». Ordená mis apuntes, porfa");
  await screen.getByRole("button", "Enviar").click();

  // AC-220: the plan comes as a card; nothing changes until «Aplicar».
  const card = screen.getByRole("region", "Cambios en «Apuntes»");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText("Miró la carpeta «Apuntes» (6 archivos)")).toBeVisible();
  await expect(card).toContainText("2 carpetas nuevas, 5 movidos o renombrados, 1 a la papelera, 1 documentos nuevos");
  await card.getByRole("button", "Ver los 9 cambios").click();
  await expect(card.getByRole("group", "Mover o renombrar")).toContainText("Física/TP 1 - Cinemática.pdf");
  await card.getByRole("button", "Aplicar").click();
  await expect(card).toContainText(/Hecho/i);
  await card.getByRole("button", "Deshacer").click();
  await expect(card).toContainText("La carpeta quedó como estaba.");

  // AC-219: Ajustes → Carpetas lists it, with its permission.
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Carpetas").click();
  const shared = screen.getByRole("list", "Carpetas compartidas");
  await expect(shared).toContainText("Apuntes");
  await shared.getByLabel("Permiso de Apuntes").selectOption("Solo leer");
  await expect(shared.getByLabel("Permiso de Apuntes")).toHaveValue("read");
});
