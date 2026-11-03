// Android: Eureka in a phone held upright (390×844). The sidebar is a drawer
// opened from the top bar, and no screen is wider than the phone.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Screen } from "e2e";
import { finishProbe } from "./helpers.ts";

type Browser = {
  evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T>;
  setViewport: (size: { width: number; height: number }) => Promise<void>;
};

const PHONE = { width: 390, height: 844 };

/** The page does not scroll sideways, and nothing on it runs past the right
 *  edge (each screen scrolls inside its own box, which the page width can't
 *  see). Code, tab strips and the graph canvas may scroll sideways in place. */
async function fitsWidth(browser: Browser, where: string) {
  const wide = await browser.evaluate(() => {
    const W = window.innerWidth;
    const scrollers = "pre, .cm-editor, .tabs, .react-flow, .neuron-graph, .md table, .katex-display";
    const out: string[] = [];
    if (document.documentElement.scrollWidth > W) out.push(`página ${document.documentElement.scrollWidth}px`);
    for (const el of document.querySelectorAll(".shell *")) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= W + 1) continue;
      let p: Element | null = el;
      let scrolls = false;
      while ((p = p.parentElement)) if (p.matches(scrollers) && getComputedStyle(p).overflowX !== "visible") scrolls = true;
      if (!scrolls) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} hasta ${Math.round(r.right)}px`);
    }
    return out.slice(0, 8);
  }, null);
  expect(wide, `scroll horizontal en ${where}`).toEqual([]);
}

async function goTo(screen: Screen, item: string) {
  await screen.getByRole("button", "Abrir menú").click();
  const menu = screen.getByRole("dialog", "Menú");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", item).click();
  // Choosing a screen closes the drawer.
  await expect(screen.getByRole("button", "Abrir menú")).toHaveAttribute("aria-expanded", "false");
  await expect(screen.getByRole("dialog", "Menú")).toBeHidden();
}

test("teléfono: el menú lleva a cada pantalla sin scroll horizontal", async ({ app, screen, browser }) => {
  const b = browser as unknown as Browser;
  await b.setViewport(PHONE);
  await app.open("/");
  await expect(screen.getByRole("heading", "¿Qué querés entender?")).toBeVisible({ timeout: 30_000 });
  // On a phone the sidebar is closed: no "Ajustes" until the menu opens.
  await expect(screen.getByRole("button", "Ajustes")).toBeHidden();
  await fitsWidth(b, "Inicio");

  await goTo(screen, "Tarjetas");
  await expect(screen.getByRole("heading", "Tarjetas")).toBeVisible();
  await fitsWidth(b, "Tarjetas");

  await goTo(screen, "Exámenes");
  await expect(screen.getByRole("heading", "Exámenes y materias")).toBeVisible();
  await fitsWidth(b, "Exámenes");

  await goTo(screen, "Agenda");
  await expect(screen.getByRole("heading", "Agenda")).toBeVisible();
  await fitsWidth(b, "Agenda");

  await goTo(screen, "Mi cursada");
  await expect(screen.getByRole("heading", "Mi cursada")).toBeVisible();
  await fitsWidth(b, "Mi cursada");

  await goTo(screen, "Ajustes");
  await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
  await expect(screen.getByRole("tab", "Conexión")).toHaveAttribute("aria-selected", "true");
  await expect(screen.getByLabel("Servicio")).toBeVisible();
  await fitsWidth(b, "Ajustes › Conexión");
  for (const tab of ["Mi espacio", "Accesibilidad", "Avanzado"]) {
    await screen.getByRole("tab", tab).click();
    await expect(screen.getByRole("tab", tab)).toHaveAttribute("aria-selected", "true");
    await fitsWidth(b, `Ajustes › ${tab}`);
  }
});

test("teléfono: Esc cierra el menú; la lupa abre la búsqueda", async ({ app, screen, browser }) => {
  await (browser as unknown as Browser).setViewport(PHONE);
  await app.open("/");
  await screen.getByRole("button", "Abrir menú").click();
  const menu = screen.getByRole("dialog", "Menú");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", "Nueva sesión").press("Escape");
  await expect(screen.getByRole("dialog", "Menú")).toBeHidden();
  await expect(screen.getByRole("button", "Abrir menú")).toBeFocused();

  await screen.getByRole("button", "Buscar o ejecutar").click();
  await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeVisible();
  await screen.getByLabel("Buscar comando").press("Escape");
  await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeHidden();
});

test("teléfono: chatear desde el inicio", async ({ app, screen, browser }) => {
  const b = browser as unknown as Browser;
  await b.setViewport(PHONE);
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("Quiero entender qué es una derivada");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByTestId("question-pending")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("button", "Enviar")).toBeVisible();
  await fitsWidth(b, "Sesión (chat)");
  // With the plan drawn and teaching started, the side panel goes below the chat.
  await finishProbe(screen);
  await expect(screen.getByTestId("plan-tree")).toBeVisible();
  await fitsWidth(b, "Sesión (enseñando)");
});

test("teléfono: con datos, Mi cursada y un mazo tampoco se pasan del ancho", async ({ app, screen, browser }) => {
  const b = browser as unknown as Browser;
  await b.setViewport(PHONE);
  await app.open("/");
  await expect(screen.getByRole("heading", "¿Qué querés entender?")).toBeVisible({ timeout: 30_000 });

  await goTo(screen, "Mi cursada");
  await screen.getByRole("button", "Cargarlo a mano").click();
  await screen.getByLabel("Nombre del período").fill("2.º cuatrimestre 2026");
  await screen.getByRole("button", "Guardar período").click();
  await expect(screen.getByLabel("Período")).toBeVisible();
  await screen.getByRole("button", "Agregar materia").click();
  await screen.getByLabel("Nombre de la materia").fill("Análisis I");
  await screen.getByRole("button", "+ Agregar horario").click();
  await screen.getByLabel("Día 1").selectOption("Lunes");
  await screen.getByLabel("Desde 1").fill("10:00");
  await screen.getByLabel("Hasta 1").fill("12:00");
  await fitsWidth(b, "Mi cursada (cargando una materia)");
  await screen.getByRole("button", "Guardar materia").click();
  await expect(screen.getByRole("group", "Horario semanal").getByRole("button", /^Análisis I, Lunes/)).toBeVisible();
  await fitsWidth(b, "Mi cursada (con horario)");

  await goTo(screen, "Tarjetas");
  await screen.getByLabel("Nombre del mazo").fill("Puertos");
  await screen.getByRole("button", "Crear mazo").click();
  await expect(screen.getByRole("heading", "Puertos")).toBeVisible();
  await screen.getByLabel("Frente").fill("¿Puerto de HTTPS?");
  await screen.getByLabel("Dorso").fill("443");
  await screen.getByRole("button", "Agregar tarjeta").click();
  await expect(screen.getByRole("heading", "1 para hoy")).toBeVisible();
  await fitsWidth(b, "Tarjetas (un mazo)");

  await goTo(screen, "Acompañamiento");
  await fitsWidth(b, "Acompañamiento");
});
