// features/visuales.feature on the REAL app: diagram + sandboxed demo in
// WebView2, and research through Rust (search API + researcher model).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { answer, finishProbe, pending, phase, startSession } from "../e2e/helpers.ts";
import { fakeProvider } from "./launch.ts";

test("D-16 diagrama, demo aislada e investigación en la app real", async ({ app, screen, browser }) => {
  await fakeProvider.reset();
  await startSession(app, screen);
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await expect(pending(screen)).toHaveAttribute("data-purpose", "check", { timeout: 15_000 });

  await expect(screen.getByRole("figure", "Diagrama: De la secante a la tangente")).toContainText("Tangente: 1 punto", { timeout: 15_000 });
  const demo = browser.frameLocator("iframe[title='Acercá los puntos']");
  await demo.locator("#h").fill("0.05");
  await expect(demo.locator("#m")).toHaveText("2.05");
  await expect(demo.locator("body")).toHaveAttribute("data-net", "bloqueada", { timeout: 10_000 });

  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 15_000 });
  await fakeProvider.reset();
  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");

  const card = screen.getByRole("region", "Investigación");
  await expect(card.getByRole("link", "Velocidad instantánea")).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByText("lo mandé a investigar", { exact: false })).toBeVisible({ timeout: 15_000 });

  // Rust called the search API with the stored key, then the researcher with a forced tool.
  const reqs = (await fakeProvider.requests()) as unknown as { search?: { query: string; api_key: string }; tool_choice?: { function: { name: string } } }[];
  const search = reqs.find((r) => r.search)!.search!;
  expect(search.api_key).toBe("sk-search-e2e");
  expect(search.query).toContain("¿y para qué sirve?");
  expect(reqs.some((r) => r.tool_choice?.function.name === "submit_research")).toBe(true);
});
