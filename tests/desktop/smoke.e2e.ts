// Real app + fake provider: the first diagnostic question arrives through the
// real Rust agent loop (HTTP, SSE parsing, tool calls, IPC Channel).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { fakeProvider } from "./launch.ts";

test("D-01 la app real arranca y el agente en Rust hace la primera pregunta", async ({ app, screen }) => {
  await fakeProvider.reset();
  await app.open("/");
  await expect(screen.getByRole("heading", "¿Qué querés entender?")).toBeVisible({ timeout: 15_000 });

  await screen.getByLabel("Mensaje").fill("qué es una derivada");
  await screen.getByRole("button", "Enviar").click();

  await expect(screen.getByTestId("question-pending")).toContainText("pendiente 2", { timeout: 15_000 });
  await expect(screen.getByText("¡Buenísimo objetivo!", { exact: false })).toBeVisible();

  const reqs = await fakeProvider.requests();
  // AC-89: the chat turn hands over to learning (begin_learning), then Medir asks.
  expect(reqs.length).toBe(2);
  expect(reqs.every((r) => r.model === "demo/profesor")).toBe(true);
});
