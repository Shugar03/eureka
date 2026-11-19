import { describe, expect, it } from "vitest";
import { translateFrame, watchTitlebar } from "./titlebar";

describe("Eureka's own title bar (AC-207)", () => {
  it("names the window buttons in Spanish and makes room for the strip", async () => {
    watchTitlebar();
    expect(document.documentElement.classList.contains("has-frame")).toBe(false);
    const tb = document.createElement("div");
    tb.setAttribute("data-tauri-frame-tb", "");
    tb.setAttribute("aria-label", "Window controls");
    for (const label of ["Minimize window", "Maximize window", "Close window"]) {
      const b = document.createElement("button");
      b.setAttribute("aria-label", label);
      tb.append(b);
    }
    document.body.prepend(tb);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.classList.contains("has-frame")).toBe(true);
    expect([...tb.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Minimizar", "Maximizar", "Cerrar"]);
    expect(tb.getAttribute("aria-label")).toBe("Controles de la ventana");
    // The bar itself has no tooltip: it would follow the mouse all along the top.
    expect(tb.title).toBe("");
    expect(tb.querySelectorAll("button")[0].title).toBe("Minimizar");
    // The plugin renames maximize when the window is maximized.
    tb.querySelectorAll("button")[1].setAttribute("aria-label", "Restore window");
    await new Promise((r) => setTimeout(r, 0));
    expect(tb.querySelectorAll("button")[1].getAttribute("aria-label")).toBe("Restaurar");
    tb.remove();
    translateFrame();
  });
});
