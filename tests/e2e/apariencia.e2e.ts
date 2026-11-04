// features/apariencia.feature — AC-14
import { test } from "@e2e-dev/web";
import type { Screen } from "e2e";
import { expect } from "e2e";

// The theme lives in Ajustes → Mi espacio (the sidebar no longer carries it).
async function openTheme(screen: Screen) {
  await screen.getByRole("button", "Ajustes").click();
  await screen.getByRole("tab", "Mi espacio").click();
}

test("AC-14 arranca en oscuro aunque el sistema esté en claro", async ({ app, screen, browser }) => {
  await browser.emulateMedia({ colorScheme: "light" });
  await app.open("/");

  await expect(browser.locator("html")).toHaveAttribute("data-theme", "dark");
  await openTheme(screen);
  await expect(screen.getByRole("radio", "Tema oscuro")).toHaveAttribute("aria-checked", "true");
});

test("AC-14 el tema elegido se recuerda al recargar", async ({ app, screen, browser }) => {
  await app.open("/");

  await openTheme(screen);
  await screen.getByRole("radio", "Tema claro").click();
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "light");

  await app.open("/");
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "light");
  await openTheme(screen);
  await expect(screen.getByRole("radio", "Tema claro")).toHaveAttribute("aria-checked", "true");

  await screen.getByRole("radio", "Tema oscuro").click();
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "dark");
});
