import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, loadTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to dark", () => {
    expect(loadTheme()).toBe("dark");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem("la.theme", "neon");
    expect(loadTheme()).toBe("dark");
  });

  it("applies to <html> and persists", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(loadTheme()).toBe("light");
    applyTheme("system");
    expect(loadTheme()).toBe("system");
  });
});
