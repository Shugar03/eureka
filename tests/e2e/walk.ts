// Seeded random walks (model-based testing with fast-check), shared by the
// web suite (tests/e2e/caminos.e2e.ts) and the real-app suite
// (tests/desktop/caminos.e2e.ts). Each seed generates a sequence of learner
// actions; after EVERY action the app must satisfy the domain invariants
// below. A failure names its seed and step, so it reproduces exactly:
//   $env:WALK_SEEDS="1234"; npx e2e run tests/e2e/caminos.e2e.ts --headed
import { expect } from "e2e";
import type { Screen } from "e2e";
import fc from "fast-check";
import { GOAL, pending } from "./helpers.ts";

type Action =
  | { kind: "answer"; option: number; confidence: number; thinking: boolean }
  | { kind: "free"; text: string }
  | { kind: "reopen" }
  | { kind: "theme"; which: "Tema oscuro" | "Tema claro" | "Tema sistema" }
  | { kind: "palette" }
  | { kind: "settings" };

const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("answer" as const), option: fc.nat(2), confidence: fc.integer({ min: 1, max: 5 }), thinking: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("free" as const), text: fc.constantFrom("no entiendo", "¿por qué?", "dame otro ejemplo ñandú →") }) },
  { weight: 1, arbitrary: fc.constant({ kind: "reopen" as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("theme" as const), which: fc.constantFrom("Tema oscuro" as const, "Tema claro" as const, "Tema sistema" as const) }) },
  { weight: 1, arbitrary: fc.constant({ kind: "palette" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "settings" as const }) },
);

export const seeds = (fallback: string) => (process.env.WALK_SEEDS ?? fallback).split(",").map(Number);
export const STEPS = Number(process.env.WALK_STEPS ?? 18);

/** Domain invariants, read straight from the DOM. */
async function checkInvariants(browser: { evaluate: <T>(fn: () => T) => Promise<T> }, screen: Screen, where: string) {
  const s = await browser.evaluate(() => {
    const q = (sel: string) => [...document.querySelectorAll(sel)];
    const plan = q("[data-testid^='plan-']").filter((n) => n.getAttribute("data-status"));
    return {
      pending: q("[data-testid='question-pending']").length,
      currentPhases: q("ol[aria-label='Fases'] li[aria-current='step']").length,
      currentNodes: plan.filter((n) => n.getAttribute("data-status") === "current").length,
      statuses: plan.map((n) => n.getAttribute("data-status")),
      findings: q("[data-testid='findings'] li").map((li) => li.textContent ?? ""),
      alerts: q("[role='alert']").map((a) => a.textContent ?? ""),
      composerHint: document.querySelector("textarea[aria-label='Mensaje']")?.getAttribute("placeholder")?.includes("pregunta de arriba") ?? false,
      replacement: (document.body.textContent ?? "").includes("�"),
      theme: document.documentElement.dataset.theme,
      shellScroll: document.querySelector(".main")?.scrollTop ?? 0,
      headerTop: document.querySelector(".chat-head")?.getBoundingClientRect().top ?? 0,
    };
  });
  const ctx = `[${where}] ${JSON.stringify(s)}`;
  expect(s.pending, `a lo sumo una pregunta pendiente ${ctx}`).toBeLessThanOrEqual(1);
  expect(s.currentPhases, `exactamente una fase actual ${ctx}`).toBe(1);
  expect(s.currentNodes, `a lo sumo un nodo "ahora" ${ctx}`).toBeLessThanOrEqual(1);
  for (const st of s.statuses) expect(["known", "pending", "current", "understood", "repair"]).toContain(st);
  expect(new Set(s.findings).size, `hallazgos sin duplicados ${ctx}`).toBe(s.findings.length);
  expect(s.alerts, `sin errores ${ctx}`).toEqual([]);
  expect(s.composerHint, `el composer refleja la pregunta pendiente ${ctx}`).toBe(s.pending === 1);
  expect(s.replacement, `sin caracteres corruptos ${ctx}`).toBe(false);
  expect(["dark", "light", "system"]).toContain(s.theme);
  expect(s.shellScroll, `el shell no se desplaza ${ctx}`).toBe(0);
  expect(s.headerTop, `el encabezado sigue en pantalla ${ctx}`).toBeGreaterThanOrEqual(0);
  await expect(screen.getByRole("list", "Fases")).toBeVisible();
}

let idleTimeout = 10_000;
async function waitIdle(screen: Screen) {
  await expect(screen.getByRole("button", "Detener")).toBeHidden({ timeout: idleTimeout });
}

type Fixtures = { app: { open: (p?: string) => Promise<void> }; screen: Screen; browser: { evaluate: <T>(fn: () => T) => Promise<T> } };

export async function walk(seed: number, { app, screen, browser }: Fixtures, turnTimeout = 10_000) {
  idleTimeout = turnTimeout;
  const [actions] = fc.sample(fc.array(action, { minLength: STEPS, maxLength: STEPS }), { seed, numRuns: 1 });
  console.log(`semilla ${seed}: ${actions.map((a) => a.kind).join(" → ")}`);

  await app.open("/");
  await screen.getByLabel("Mensaje").fill(`Quiero entender ${GOAL}`);
  await screen.getByRole("button", "Enviar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
  await waitIdle(screen);

  for (const [i, a] of actions.entries()) {
    const where = `semilla ${seed}, paso ${i + 1}: ${JSON.stringify(a)}`;
    const hasQuestion = (await pending(screen).count()) === 1;
    switch (a.kind) {
      case "answer": {
        if (!hasQuestion) break;
        const q = pending(screen);
        const n = await q.getByRole("radiogroup", "Opciones").count();
        if (n > 0) {
          const opts = await q.getByRole("radiogroup", "Opciones").getByRole("radio").all();
          await opts[a.option % opts.length].click();
        } else {
          await q.getByRole("textbox", "Tu respuesta").fill(`respuesta ${i}`);
        }
        await q.getByRole("radio", new RegExp(`^Confianza ${a.confidence}:`)).click();
        if (a.thinking) await q.getByRole("textbox", "Pensando en voz alta").fill("pienso que…");
        await q.getByRole("button", "Responder").click();
        await waitIdle(screen);
        break;
      }
      case "free": {
        if (hasQuestion) break;
        await screen.getByRole("textbox", "Mensaje").fill(a.text);
        await screen.getByRole("textbox", "Mensaje").press("Enter");
        await expect(screen.getByText(a.text).first()).toBeVisible();
        await waitIdle(screen);
        break;
      }
      case "reopen": {
        const before = await pending(screen).count();
        await screen.getByRole("button", "Volver a Sesiones").click();
        await screen.getByRole("navigation", "Navegación").getByRole("button", new RegExp(GOAL)).click();
        await expect(screen.getByRole("list", "Fases")).toBeVisible();
        await waitIdle(screen);
        expect(await pending(screen).count(), `reabrir conserva la pregunta (${where})`).toBe(before);
        break;
      }
      case "theme":
        await screen.getByRole("radio", a.which).click();
        await expect(screen.getByRole("radio", a.which)).toHaveAttribute("aria-checked", "true");
        break;
      case "palette":
        await screen.getByRole("button", "Buscar o ejecutar… Ctrl K").click();
        await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeVisible();
        await screen.getByLabel("Buscar comando").press("Escape");
        await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeHidden();
        break;
      case "settings":
        await screen.getByRole("button", "Ajustes").click();
        await expect(screen.getByRole("heading", "Ajustes")).toBeVisible();
        await screen.getByRole("navigation", "Navegación").getByRole("button", new RegExp(GOAL)).click();
        await waitIdle(screen);
        break;
    }
    await checkInvariants(browser, screen, where);
  }
}
