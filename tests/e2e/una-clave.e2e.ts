// features/una-clave.feature — AC-158, AC-159 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-158 AC-159 pegar la clave en el inicio deja todo andando", async ({ app, screen }) => {
  await app.open("/?unconfigured&noSpeech");
  const setup = screen.getByRole("region", "Conectar con una clave");
  await expect(setup.getByRole("heading", "Pegá tu clave y listo")).toBeVisible({ timeout: 30_000 });
  await expect(setup.getByRole("button", "Conectar")).toBeDisabled();
  await setup.getByLabel("Tu clave de acceso").fill("  oc_prueba1234567890 ");
  await setup.getByRole("button", "Conectar").click();
  await expect(setup.getByTestId("quick-setup-done")).toHaveText("OpenCode Go · deepseek-v4.1-flash para todo.", { timeout: 10_000 });
  await expect(setup).toContainText("uso un valor seguro (64 mil tokens)");
  await expect(setup).toContainText("elegí la Voz «En esta PC»");
  await setup.getByLabel("Cambiar de modelo").selectOption("glm-5.3");

  await screen.getByRole("navigation", "Navegación").getByRole("button", "Ajustes").click();
  await expect(screen.getByTestId("connection-state")).toHaveText("Conectado: OpenCode Go · glm-5.3");
});

test("AC-158 una clave que puede ser de dos servicios: se elige, no se prueba en ambos", async ({ app, screen }) => {
  await app.open("/?unconfigured");
  const setup = screen.getByRole("region", "Conectar con una clave");
  await setup.getByLabel("Tu clave de acceso").fill("sk-0123456789abcdef0123456789abcdef");
  await setup.getByRole("button", "Conectar").click();
  await expect(setup.getByRole("group")).toContainText("puede ser de más de un servicio", { timeout: 10_000 });
  await setup.getByRole("radio", "DeepSeek").click();
  await setup.getByRole("button", "Conectar con DeepSeek").click();
  await expect(setup.getByTestId("quick-setup-done")).toContainText("DeepSeek", { timeout: 10_000 });
});

test("AC-158 una clave que no anda lo dice en palabras simples", async ({ app, screen }) => {
  await app.open("/?unconfigured");
  const setup = screen.getByRole("region", "Conectar con una clave");
  await setup.getByLabel("Tu clave de acceso").fill("oc_mal1234567890");
  await setup.getByRole("button", "Conectar").click();
  await expect(setup.getByRole("alert")).toContainText("La clave no funcionó con ese servicio", { timeout: 10_000 });
});
