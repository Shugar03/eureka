// features/bordes.feature — edge cases.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { answer, pending, startSession } from "./helpers.ts";

const palette = (screen: import("e2e").Screen) => screen.getByRole("dialog", "Paleta de comandos");

test("AC-01 no se puede enviar un mensaje vacío", async ({ app, screen }) => {
  await app.open("/");
  const start = screen.getByRole("button", "Enviar");
  await expect(start).toBeDisabled();
  await screen.getByLabel("Mensaje").fill("    ");
  await expect(start).toBeDisabled();
  await screen.getByLabel("Mensaje").fill("algo");
  await expect(start).toBeEnabled();
});

test("AC-15 Ctrl K abre la paleta y Enter ejecuta", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").press("Control+K");
  await expect(palette(screen)).toBeVisible();
  await screen.getByLabel("Buscar comando").fill("ajustes");
  await screen.getByLabel("Buscar comando").press("Enter");
  await expect(palette(screen)).toBeHidden();
  await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
});

test("AC-15 AC-14 la paleta se navega con flechas", async ({ app, screen, browser }) => {
  await app.open("/");
  await screen.getByRole("button", "Buscar o ejecutar… Ctrl K").click();
  await screen.getByLabel("Buscar comando").fill("tema");
  await expect(palette(screen).getByRole("option")).toHaveCount(3);
  await expect(palette(screen).getByRole("option", "Tema: oscuro")).toHaveAttribute("aria-selected", "true");
  await screen.getByLabel("Buscar comando").press("ArrowDown");
  await expect(palette(screen).getByRole("option", "Tema: claro")).toHaveAttribute("aria-selected", "true");
  await screen.getByLabel("Buscar comando").press("Enter");
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "light");
});

test("AC-15 la paleta se cierra con Escape o clic afuera y avisa sin resultados", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Buscar o ejecutar… Ctrl K").click();
  await screen.getByLabel("Buscar comando").fill("zzzz-no-existe");
  await expect(palette(screen)).toContainText("Sin resultados");
  await screen.getByLabel("Buscar comando").press("Escape");
  await expect(palette(screen)).toBeHidden();

  await screen.getByRole("button", "Buscar o ejecutar… Ctrl K").click();
  await expect(palette(screen)).toBeVisible();
  await screen.getByTestId("cmd-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(palette(screen)).toBeHidden();
});

test("AC-15 la paleta abre sesiones por nombre", async ({ app, screen }) => {
  await startSession(app, screen, "tema paleta");
  await screen.getByRole("button", "Nueva sesión").click();
  await screen.getByRole("button", "Buscar o ejecutar… Ctrl K").click();
  await screen.getByLabel("Buscar comando").fill("paleta");
  await screen.getByLabel("Buscar comando").press("Enter");
  await expect(screen.getByRole("heading", "tema paleta")).toBeVisible();
  await expect(pending(screen)).toBeVisible();
});

test("AC-16 dos sesiones son independientes", async ({ app, screen }) => {
  await startSession(app, screen);
  await answer(screen, { text: "sube 2", confidence: 4 });
  await expect(screen.getByTestId("findings")).toContainText("Pendiente");

  await screen.getByRole("button", "Nueva sesión").click();
  await screen.getByLabel("Mensaje").fill("quiero entender otro tema");
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toContainText("pendiente 2", { timeout: 10_000 });
  await expect(screen.getByText("Todavía no hay hallazgos.")).toBeVisible();

  const nav = screen.getByRole("navigation", "Navegación");
  await nav.getByRole("button", "qué es una derivada").click();
  await expect(screen.getByTestId("findings")).toContainText("Pendiente");
  await expect(nav.getByRole("button", "qué es una derivada")).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", "otro tema")).not.toHaveAttribute("aria-current", "page");
});

test("AC-02 cambiar de opción antes de responder", async ({ app, screen }) => {
  await startSession(app, screen);
  await answer(screen, { text: "sube 2", confidence: 4 });
  const q = pending(screen);
  await expect(q).toContainText("Crece sin límite", { timeout: 10_000 });
  await q.getByRole("radio", "A 1").click();
  await q.getByRole("radio", "A 0").click();
  await expect(q.getByRole("radio", "A 0")).toHaveAttribute("aria-checked", "true");
  await expect(q.getByRole("radio", "A 1")).toHaveAttribute("aria-checked", "false");
  await expect(q.getByRole("button", "Responder")).toBeDisabled(); // still no confidence
});

test("AC-13 Shift+Enter agrega una línea y Enter envía", async ({ app, screen }) => {
  await app.open("/?fail");
  await screen.getByLabel("Mensaje").fill("x");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("alert")).toBeVisible({ timeout: 10_000 });

  const box = screen.getByRole("textbox", "Mensaje");
  await box.fill("línea uno");
  await box.press("Shift+Enter");
  await box.pressSequentially("línea dos");
  // Still in the box (getByText would also match the box's own echoed text).
  await expect(box).toHaveValue("línea uno\nlínea dos");

  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(screen.getByText("línea uno\nlínea dos")).toBeVisible();
});

test("AC-09 agregar y quitar un proveedor personalizado", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  await screen.getByRole("button", "+ Agregar proveedor").click();
  await screen.getByLabel("Nombre").last().fill("Mi servidor");
  await screen.getByLabel("URL base").last().fill("https://llm.ejemplo.test/v1");
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();

  await screen.getByRole("button", "Volver").click();
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  await expect(screen.getByLabel("Nombre").last()).toHaveValue("Mi servidor");
  await expect(screen.getByLabel("Proveedor de Profesor")).toContainText("Mi servidor");

  await screen.getByRole("button", "Eliminar Mi servidor").click();
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();
  await expect(screen.getByRole("button", "Eliminar Mi servidor")).toHaveCount(0);
});

test("AC-09 AC-10 quitar la key del profesor vuelve a pedir configuración", async ({ app, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("region", "Conectar con una clave")).toBeHidden();
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Avanzado").click();
  await screen.getByRole("button", "Quitar key").click();
  await screen.getByRole("button", "Guardar").click();
  await expect(screen.getByText("Guardado.")).toBeVisible();
  await expect(screen.getByRole("button", "Quitar key")).toHaveCount(0);

  await screen.getByRole("button", "Volver").click();
  await expect(screen.getByRole("region", "Conectar con una clave")).toBeVisible();
});

test("AC-12 guardar un prompt sin cambios está deshabilitado", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("checkbox", /Modo avanzado/).check();
  await screen.getByRole("tab", "Prompts").click();
  await screen.getByRole("button", "Fase Medir").click();
  await expect(screen.getByLabel("Contenido del prompt")).toHaveValue(/Fase: MEDIR/);
  await expect(screen.getByRole("button", "Guardar")).toBeDisabled();
  await expect(screen.getByRole("button", "Restaurar original")).toHaveCount(0);
});

test("AC-107 borrar una sesión se puede cancelar", async ({ app, screen }) => {
  await startSession(app, screen, "no me borres");
  await screen.getByRole("button", "Volver a Sesiones").click();
  const row = screen.getByRole("region", "Sesiones").getByRole("listitem").filter({ hasText: "no me borres" });
  await row.getByRole("button", "Borrar no me borres").click();
  await expect(row.getByRole("group", "Confirmar borrar no me borres")).toContainText("sigue en tu memoria");
  await row.getByRole("button", "Cancelar").click();
  await expect(row.getByRole("group", "Confirmar borrar no me borres")).toHaveCount(0);
  await expect(row).toHaveCount(1);
});
