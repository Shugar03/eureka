// features/ajustes.feature — AC-09, AC-10, AC-11, AC-12
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-10 sin configuración el inicio pide la clave y deja ir a Ajustes", async ({ app, screen }) => {
  await app.open("/?unconfigured");

  await expect(screen.getByRole("region", "Conectar con una clave")).toBeVisible({ timeout: 30_000 });
  await screen.getByRole("button", "Prefiero configurarlo a mano en Ajustes").click();
  await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
});

test("AC-09 guardar una API key nunca la vuelve a mostrar", async ({ app, screen }) => {
  await app.open("/?unconfigured");
  await screen.getByRole("button", "Prefiero configurarlo a mano en Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();

  const key = screen.getByLabel("API key de OpenRouter");
  await key.fill("sk-or-test-123");
  await screen.getByRole("button", "Guardar").click();

  await expect(screen.getByText("Guardado.")).toBeVisible();
  // e2e forbids reading secure fields (POLICY_DENIED), so check what the
  // learner sees instead: the key is stored (it can be removed) and the
  // field only offers a masked placeholder.
  await expect(screen.getByRole("button", "Quitar key")).toBeVisible();
  await expect(screen.getByText("sk-or-test-123")).toBeHidden();
});

test("AC-09 elegir servicio, clave y modelo en un solo lugar", async ({ app, screen }) => {
  await app.open("/?unconfigured");
  await screen.getByRole("button", "Prefiero configurarlo a mano en Ajustes").click();
  await expect(screen.getByRole("tab", "Conexión")).toHaveAttribute("aria-selected", "true");
  await screen.getByLabel("Servicio").selectOption("OpenRouter");
  await screen.getByLabel("Clave de acceso").fill("sk-or-test-123");
  await screen.getByLabel("Modelo").fill("demo/profesor");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();
  await expect(screen.getByTestId("connection-state")).toContainText("Conectado: OpenRouter · demo/profesor");
  await screen.getByRole("button", "Ver modelos disponibles").click();
  await expect(screen.getByText("3 modelos disponibles", { exact: false })).toBeVisible();

  await screen.getByRole("button", "Volver").click();
  await expect(screen.getByRole("heading", "¿Qué querés entender?")).toBeVisible();
  await expect(screen.getByRole("region", "Conectar con una clave")).toBeHidden();
});

test("AC-12 editar y restaurar un prompt", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("checkbox", /Modo avanzado/).check();
  await screen.getByRole("tab", "Prompts").click();
  await screen.getByRole("button", "Fase Enseñar").click();

  const editor = screen.getByLabel("Contenido del prompt");
  await expect(editor).toHaveValue(/Fase: ENSEÑAR/);
  await editor.fill("# Fase: ENSEÑAR\n\nEnseñá con analogías de cocina.");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado. Se usa desde el próximo mensaje.")).toBeVisible();

  await screen.getByRole("button", "Restaurar original").click();
  await expect(screen.getByText("Restaurado al original.")).toBeVisible();
  await expect(editor).toHaveValue(/El ciclo de cada nodo/);
});

test("AC-11 un error del proveedor se muestra con salida a Ajustes", async ({ app, screen }) => {
  await app.open("/?fail");
  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByRole("alert")).toContainText("Falta la API key", { timeout: 10_000 });
  await screen.getByRole("button", "Abrir ajustes").click();
  await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
});

test("NF-21 el tamaño de contexto del profesor se guarda", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  const ctx = screen.getByLabel("Contexto de Profesor (miles de tokens)");
  await expect(ctx).toHaveValue("");
  await ctx.fill("200");
  await screen.getByRole("button", "Guardar").first().click();
  await expect(screen.getByText("Guardado.")).toBeVisible();
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  await expect(screen.getByLabel("Contexto de Profesor (miles de tokens)")).toHaveValue("200");
});
