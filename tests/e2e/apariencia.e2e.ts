// features/apariencia.feature — AC-14
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("AC-14 arranca en oscuro aunque el sistema esté en claro", async ({ app, screen, browser }) => {
  await browser.emulateMedia({ colorScheme: "light" });
  await app.open("/");

  await expect(browser.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(screen.getByRole("radio", "Tema oscuro")).toHaveAttribute("aria-checked", "true");
});

test("AC-14 el tema elegido se recuerda al recargar", async ({ app, screen, browser }) => {
  await app.open("/");

  await screen.getByRole("radio", "Tema claro").click();
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "light");

  await app.open("/");
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(screen.getByRole("radio", "Tema claro")).toHaveAttribute("aria-checked", "true");

  await screen.getByRole("radio", "Tema oscuro").click();
  await expect(browser.locator("html")).toHaveAttribute("data-theme", "dark");
});
