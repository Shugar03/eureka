// features/aprender.feature — AC-01 … AC-07, AC-13
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { answer, finishProbe, pending, phase, planNode, startSession } from "./helpers";

test("AC-01 empezar una sesión arranca en Medir con una pregunta de diagnóstico", async ({ app, screen }) => {
  await startSession(app, screen);

  await expect(phase(screen, "Medir")).toHaveAttribute("aria-current", "step");
  await expect(pending(screen)).toHaveAttribute("data-purpose", "probe");
  await expect(pending(screen)).toContainText(/diagnóstico/i);
  await expect(screen.getByText("Quiero entender qué es una derivada")).toBeVisible();
});

test("AC-02 una respuesta necesita texto y confianza", async ({ app, screen }) => {
  await startSession(app, screen);
  const q = pending(screen);

  await q.getByRole("textbox", "Tu respuesta").fill("sube 2 por cada 1");
  await expect(q.getByRole("button", "Responder")).toBeDisabled();

  await q.getByRole("radio", /^Confianza 4:/).click();
  await expect(q.getByRole("button", "Responder")).toBeEnabled();
});

test("AC-02 AC-03 responder el diagnóstico registra hallazgos", async ({ app, screen }) => {
  await startSession(app, screen);

  await answer(screen, { text: "por cada paso a la derecha sube 2", confidence: 4, thinking: "lo vi en el colegio" });

  const answered = screen.getByTestId("answer").first();
  await expect(answered).toContainText("por cada paso a la derecha sube 2");
  await expect(answered).toContainText("Confianza 4/5");
  await expect(answered).toContainText("lo vi en el colegio");
  await expect(screen.getByTestId("findings")).toContainText("Pendiente");
  await expect(screen.getByTestId("findings")).toContainText("sólido");
});

test("AC-04 al terminar el diagnóstico aparece el plan como árbol", async ({ app, screen }) => {
  await startSession(app, screen);
  await finishProbe(screen);

  await expect(phase(screen, "Enseñar")).toHaveAttribute("aria-current", "step");
  await expect(planNode(screen, "pendiente")).toHaveAttribute("data-status", "known");
  await expect(planNode(screen, "pendiente")).toContainText("ya lo sabés");
  await expect(planNode(screen, "derivada")).toContainText("La derivada");
  await expect(planNode(screen, "derivada")).toHaveAttribute("data-status", "pending");
  await expect(planNode(screen, "limite")).toHaveAttribute("data-status", "current");
});

test("AC-05 AC-06 AC-07 enseñanza completa con una reparación", async ({ app, screen }) => {
  await startSession(app, screen);
  await finishProbe(screen);

  // Predict → explanation → check.
  await expect(pending(screen)).toHaveAttribute("data-purpose", "predict");
  await answer(screen, { text: "se ve como una recta", confidence: 3 });
  await expect(pending(screen)).toHaveAttribute("data-purpose", "check", { timeout: 10_000 });
  await expect(planNode(screen, "limite")).toHaveAttribute("data-status", "understood");

  // Wrong answer → the node goes to repair and the agent asks again.
  await answer(screen, { option: "En una curva", confidence: 2 });
  await expect(planNode(screen, "tangente")).toHaveAttribute("data-status", "repair", { timeout: 10_000 });
  await expect(pending(screen)).toContainText("un solo punto");

  await answer(screen, { option: "Tangente", confidence: 4 });
  await expect(pending(screen)).toContainText("Última:", { timeout: 10_000 });
  await answer(screen, { option: "6", confidence: 5 });

  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });
  for (const id of ["limite", "tangente", "derivada"]) {
    await expect(planNode(screen, id)).toHaveAttribute("data-status", "understood");
  }
  await expect(screen.getByText("Juntando todo:", { exact: false })).toBeVisible();
});

test("AC-13 hacer una pregunta libre al terminar", async ({ app, screen }) => {
  await startSession(app, screen);
  await finishProbe(screen);
  await answer(screen, { text: "una recta", confidence: 3 });
  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(phase(screen, "Listo")).toHaveAttribute("aria-current", "step", { timeout: 10_000 });

  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");

  await expect(screen.getByText("¿y para qué sirve?")).toBeVisible();
  await expect(screen.getByText("Buena pregunta.", { exact: false })).toBeVisible({ timeout: 10_000 });
});
