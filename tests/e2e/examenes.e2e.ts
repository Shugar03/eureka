// features/examenes.feature — AC-32 … AC-36, NF-15 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { pending, pick } from "./helpers.ts";
import { SAMPLE_GUIDE } from "../../src/e2e/examScript.ts";

const NAME = "AWS Certified Cloud Practitioner";
const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

async function createExam(app: App, screen: Screen, guide = SAMPLE_GUIDE, path = "/") {
  await app.open(path);
  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByLabel("Nombre del examen").fill(NAME);
  await screen.getByLabel("Guía oficial del examen").fill(guide);
  await screen.getByRole("button", "Armar ruta de estudio").click();
}

test("AC-32 la guía oficial se convierte en dominios con peso y temas", async ({ app, screen }) => {
  await createExam(app, screen);
  await expect(screen.getByRole("heading", NAME)).toBeVisible({ timeout: 10_000 });
  const path = screen.getByRole("region", "Ruta de estudio");
  const domains = path.getByRole("article");
  await expect(domains).toHaveCount(4);
  await expect(domains.first()).toContainText("Tecnología y servicios de la nube");
  await expect(domains.first()).toContainText("34%");
  await expect(domains.last()).toContainText("Facturación, precios y soporte");
  const security = path.getByRole("article", "Seguridad y cumplimiento");
  await expect(security).toContainText("Gestión de identidades con IAM");
  await security.getByText("Objetivos (2)").last().click();
  await expect(security).toContainText("Principio de menor privilegio");
  await expect(screen.getByTestId("readiness")).toHaveText("0%");
});

test("AC-33 AC-34 estudiar un tema abre una sesión vinculada y se retoma", async ({ app, screen }) => {
  await createExam(app, screen);
  const topic = "Gestión de identidades con IAM";
  await screen.getByRole("button", `Estudiar ${topic}`).click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("heading", topic)).toBeVisible();

  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByRole("button", new RegExp(`^${NAME}`)).click();
  await expect(screen.getByRole("article", "Seguridad y cumplimiento")).toContainText("En curso");
  await screen.getByRole("button", `Continuar ${topic}`).click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
  await expect(nav(screen).getByRole("button", topic)).toHaveCount(1);
});

test("AC-35 AC-36 simulacro corregido sin modelo, con el dominio más flojo", async ({ app, screen }) => {
  await createExam(app, screen);
  await screen.getByRole("radio", "10 preguntas").click();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("group", /^Pregunta \d+$/)).toHaveCount(10);

  // Right everywhere except "Seguridad y cumplimiento" (3 of the 10 by weight).
  for (let i = 1; i <= 10; i++) {
    const q = screen.getByRole("group", `Pregunta ${i}`);
    const security = /Seguridad y cumplimiento/.test((await q.textContent()) ?? "");
    await pick(q, security ? /^Ignorarlo/ : /^Aplicar correctamente/);
  }
  await expect(screen.getByText("10/10 respondidas")).toBeVisible();
  await screen.getByRole("button", "Entregar").click();

  await expect(screen.getByTestId("mock-score")).toHaveText("7/10 · 70%", { timeout: 10_000 });
  const result = screen.getByRole("region", "Resultado");
  await expect(result.getByRole("row", /Seguridad y cumplimiento/)).toContainText("0/3");
  await expect(result.getByRole("row", /Tecnología y servicios/)).toContainText("4/4");
  await expect(screen.getByTestId("recommend")).toContainText("Seguridad y cumplimiento");
  await expect(screen.getByTestId("explanation")).toHaveCount(10);
  await expect(screen.getByTestId("explanation").first()).toContainText("Lo correcto es");
  await expect(screen.getByRole("button", "Entregar")).toHaveCount(0);

  await screen.getByRole("button", `Volver a ${NAME}`).click();
  await expect(screen.getByRole("region", "Simulacros")).toContainText("7/10 (70%)");
  await expect(screen.getByTestId("readiness")).not.toHaveText("0%");

  // The recommendation opens the weakest topic's study session.
  await screen.getByRole("button", "Simulacro 1").click();
  await screen.getByTestId("recommend").getByRole("button", "Modelo de responsabilidad compartida").click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });
});

test("NF-15 una guía sin dominios reconocibles no crea un examen", async ({ app, screen }) => {
  await createExam(app, screen, "Esto es un texto cualquiera, sin dominios ni temas.");
  await expect(screen.getByRole("alert")).toContainText("No se encontraron dominios", { timeout: 10_000 });
  await expect(screen.getByRole("region", "Exámenes")).toHaveCount(0);
});

test("AC-37 importar la guía desde un PDF", async ({ app, screen, browser }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Exámenes").click();
  await browser.locator('input[type="file"]').setInputFiles("tests/fixtures/guia-examen.pdf");
  const guide = screen.getByLabel("Guía oficial del examen");
  await expect(guide).toHaveValue(/Dominio 2: Innovación con datos e IA \(40%\)/, { timeout: 15_000 });
  await expect(guide).toHaveValue(/• Valor de los datos\n– Data warehouse y data lake/);
  await expect(screen.getByRole("status")).toContainText("Guía cargada de guia-examen.pdf");
  await expect(screen.getByLabel("Nombre del examen")).toHaveValue("guia-examen");

  await screen.getByLabel("Nombre del examen").fill("Google Cloud Digital Leader");
  await screen.getByRole("button", "Armar ruta de estudio").click();
  const path = screen.getByRole("region", "Ruta de estudio");
  await expect(path.getByRole("article")).toHaveCount(3, { timeout: 10_000 });
  await expect(path.getByRole("article").first()).toContainText("Innovación con datos e IA");
  await expect(path.getByRole("article", "Innovación con datos e IA")).toContainText("Objetivos (1)");
});

test("AC-38 buscar la guía oficial en la web por el nombre del examen", async ({ app, screen }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Exámenes").click();
  await expect(screen.getByRole("button", "Buscar la guía en la web")).toBeDisabled();
  await screen.getByLabel("Nombre del examen").fill(NAME);
  await screen.getByRole("button", "Buscar la guía en la web").click();
  await expect(screen.getByLabel("Guía oficial del examen")).toHaveValue(/Dominio 2: Seguridad y cumplimiento \(30%\)/, { timeout: 10_000 });
  const sources = screen.getByRole("list", "Fuentes de la guía");
  await expect(sources.getByRole("link", "Guía oficial del examen")).toHaveAttribute("href", "https://certificaciones.example/guia-oficial.pdf");
  await expect(sources.getByRole("link")).toHaveCount(1);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await expect(screen.getByRole("region", "Ruta de estudio").getByRole("article")).toHaveCount(4, { timeout: 10_000 });
});

test("AC-38 sin búsqueda configurada lo explica y no toca la guía", async ({ app, screen }) => {
  await app.open("/?noSearch");
  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByLabel("Guía oficial del examen").fill("mi borrador");
  await screen.getByLabel("Nombre del examen").fill(NAME);
  await screen.getByRole("button", "Buscar la guía en la web").click();
  await expect(screen.getByRole("alert")).toContainText("Ajustes → Búsqueda web");
  await expect(screen.getByLabel("Guía oficial del examen")).toHaveValue("mi borrador");
});

/** Answers every question right except those of one domain (to fail on purpose). */
async function answerAll(screen: Screen, failDomain: RegExp | null = null) {
  for (let i = 1; i <= 10; i++) {
    const q = screen.getByRole("group", `Pregunta ${i}`);
    const fail = failDomain?.test((await q.textContent()) ?? "") ?? false;
    await pick(q, fail ? /^Ignorarlo/ : /^Aplicar correctamente/);
  }
}

test("AC-39 simulacro con tiempo: reloj, marcar y entrega automática", async ({ app, screen }) => {
  await createExam(app, screen, SAMPLE_GUIDE, "/?shortTime");
  await screen.getByRole("radio", "Con tiempo").click();
  await expect(screen.getByLabel("Minutos del simulacro")).toHaveValue("15");
  await screen.getByLabel("Minutos del simulacro").fill("3");
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByTestId("timer")).toHaveText(/^0:0\d$/, { timeout: 10_000 });

  await screen.getByRole("group", "Pregunta 1").getByRole("radio", /^Aplicar correctamente/).check();
  await screen.getByRole("group", "Pregunta 2").getByRole("button", "Marcar para revisar").click();
  const nav2 = screen.getByRole("navigation", "Preguntas");
  await expect(nav2.getByRole("button", "Ir a la pregunta 1, respondida")).toBeVisible();
  await expect(nav2.getByRole("button", "Ir a la pregunta 2, marcada")).toBeVisible();
  await expect(screen.getByText("1/10 respondidas · 1 marcadas")).toBeVisible();

  // 3 "minutes" are 9 seconds with ?shortTime: the clock hands it in.
  await expect(screen.getByRole("region", "Resultado")).toContainText("Se terminó el tiempo", { timeout: 20_000 });
  await expect(screen.getByTestId("mock-score")).toHaveText("1/10 · 10%");
  await expect(screen.getByTestId("elapsed")).toContainText("de 0:09");
  await expect(screen.getByTestId("timer")).toHaveCount(0);
});

test("AC-39 las respuestas sin entregar se conservan al salir y volver", async ({ app, screen }) => {
  await createExam(app, screen);
  await screen.getByRole("button", "Nuevo simulacro").click();
  await screen.getByRole("group", "Pregunta 3").getByRole("radio", /^Aplicar correctamente/).check();
  await expect(screen.getByTestId("timer")).toHaveCount(0);
  await screen.getByRole("button", `Volver a ${NAME}`).click();
  await screen.getByRole("button", "Simulacro 1").click();
  await expect(screen.getByRole("group", "Pregunta 3").getByRole("radio", /^Aplicar correctamente/)).toBeChecked();
  await expect(screen.getByText("1/10 respondidas")).toBeVisible();
});

test("AC-40 repaso de falladas hasta acertarlas dos veces seguidas", async ({ app, screen }) => {
  await createExam(app, screen);
  const review = screen.getByRole("region", "Repaso de falladas");
  await expect(review.getByRole("button", "Repasar")).toBeDisabled();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await answerAll(screen, /Seguridad y cumplimiento/);
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("elapsed")).toContainText("quedaron en el repaso", { timeout: 10_000 });
  await screen.getByRole("button", `Volver a ${NAME}`).click();
  await expect(review).toContainText("3 preguntas");

  const answerReview = async (right: boolean) => {
    await pick(screen.getByRole("group", "Pregunta de repaso"), right ? /^Aplicar correctamente/ : /^(Ignorarlo|Delegarlo)/);
    await screen.getByRole("button", "Responder").click();
  };

  // Round 1: all right once → none leaves yet.
  await review.getByRole("button", "Repasar").click();
  for (let i = 1; i <= 3; i++) {
    await expect(screen.getByTestId("review-progress")).toHaveText(`Pregunta ${i} de 3`);
    await answerReview(true);
    await expect(screen.getByTestId("review-feedback")).toContainText("Una más y sale del repaso", { timeout: 10_000 });
    await screen.getByRole("button", i < 3 ? "Siguiente" : "Terminar").click();
  }
  await expect(screen.getByTestId("review-summary")).toHaveText("Acertaste 3 de 3. Quedan 3 para repasar.");
  await screen.getByRole("button", "Volver al examen").click();

  // Round 2: two right (they leave), one wrong (starts over).
  await review.getByRole("button", "Repasar").click();
  await answerReview(true);
  await expect(screen.getByTestId("review-feedback")).toContainText("Dos aciertos seguidos: sale del repaso", { timeout: 10_000 });
  await screen.getByRole("button", "Siguiente").click();
  await answerReview(true);
  await screen.getByRole("button", "Siguiente").click();
  await answerReview(false);
  await expect(screen.getByTestId("review-feedback")).toContainText("Vuelve a empezar", { timeout: 10_000 });
  await expect(screen.getByTestId("review-feedback").getByRole("button", "Estudiar este tema")).toBeVisible();
  await screen.getByRole("button", "Terminar").click();
  await expect(screen.getByTestId("review-summary")).toHaveText("Acertaste 2 de 3. Quedan 1 para repasar.");
  await screen.getByRole("button", "Volver al examen").click();
  await expect(review).toContainText("1 pregunta de tus simulacros");
});

test("AC-41 preguntas de respuesta múltiple: elegí 2, todo o nada", async ({ app, screen }) => {
  await createExam(app, screen);
  await screen.getByRole("button", "Nuevo simulacro").click();
  const q5 = screen.getByRole("group", "Pregunta 5");
  await expect(q5).toContainText("Elegí 2 · 0/2", { timeout: 10_000 });
  const right = q5.getByRole("checkbox", /^Aplicar correctamente/);
  await expect(right).toHaveCount(2);
  await right.first().check();
  await q5.getByRole("checkbox", /^Ignorarlo/).check();
  await expect(q5).toContainText("Elegí 2 · 2/2");
  await expect(q5.getByRole("checkbox", /^Delegarlo/)).toBeDisabled(); // no more than 2
  await q5.getByRole("checkbox", /^Ignorarlo/).uncheck();
  await right.last().check();
  // Question 10 (also "Elegí 2"): only half right → wrong.
  await screen.getByRole("group", "Pregunta 10").getByRole("checkbox", /^Aplicar correctamente/).first().check();
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toHaveText("1/10 · 10%", { timeout: 10_000 });
  await expect(screen.getByRole("group", "Pregunta 5").getByTestId("explanation")).toContainText("Correcta.");
  await expect(screen.getByRole("group", "Pregunta 10").getByTestId("explanation")).toContainText("Incorrecta.");
});

test("AC-42 meta: nota para aprobar, fecha, evolución y ¿estoy listo?", async ({ app, screen }) => {
  await createExam(app, screen);
  const goal = screen.getByRole("region", "Meta");
  await expect(goal).toContainText("Hacé un simulacro para ver tu evolución");
  await goal.getByLabel("Nota para aprobar").fill("150");
  await goal.getByRole("button", "Guardar meta").click();
  await expect(goal.getByRole("alert")).toContainText("entre 1 y 100");

  await goal.getByLabel("Nota para aprobar").fill("70");
  await goal.getByLabel("Fecha del examen").fill("2099-01-15");
  await goal.getByLabel("Horas de estudio por semana").fill("6");
  await goal.getByRole("button", "Guardar meta").click();
  await expect(screen.getByTestId("countdown")).toHaveText(/^Faltan \d+ días$/);

  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await answerAll(screen, /Seguridad y cumplimiento/);
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toHaveText("7/10 · 70%", { timeout: 10_000 });
  await screen.getByRole("button", `Volver a ${NAME}`).click();

  await expect(screen.getByTestId("ready")).toContainText("¿Estoy listo? Cerca.");
  await expect(screen.getByTestId("ready")).toContainText("Promediás 70%");
  await expect(screen.getByTestId("ready")).toContainText("Dominios por debajo de la nota: Seguridad y cumplimiento");
  const trend = screen.getByRole("figure", "Evolución de tus simulacros");
  await expect(trend).toContainText("Aprobación 70%");
  await trend.getByText("Ver como tabla").click();
  await expect(trend.getByRole("row", /^1 70%/)).toContainText("Sí");
  await expect(goal.getByLabel("Nota para aprobar")).toHaveValue("70");
});

/** Generates a mock (whole exam by default) and hands it in failing one domain. */
async function mockFailing(screen: Screen, domain: RegExp) {
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await answerAll(screen, domain);
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("button", `Volver a ${NAME}`).click();
}

test("AC-43 simulacro dirigido: dominios elegidos, el más flojo y lo fallado", async ({ app, screen }) => {
  await createExam(app, screen);
  const scope = screen.getByRole("radiogroup", "Qué abarca");
  await expect(scope.getByRole("radio", "Mi dominio más flojo")).toBeDisabled();
  await expect(scope.getByRole("radio", "Temas de lo que fallé")).toBeDisabled();

  await scope.getByRole("radio", "Elegir dominios").click();
  await expect(screen.getByRole("button", "Nuevo simulacro")).toBeDisabled();
  await screen.getByRole("list", "Dominios del simulacro").getByRole("checkbox", /Facturación/).check();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("group", /^Pregunta \d+$/).filter({ hasText: "Facturación, precios y soporte" })).toHaveCount(10);
  await screen.getByRole("button", `Volver a ${NAME}`).click();
  await expect(screen.getByRole("region", "Simulacros")).toContainText("Dirigido: Facturación, precios y soporte");

  await scope.getByRole("radio", "Todo el examen").click();
  await mockFailing(screen, /Seguridad y cumplimiento/);
  await scope.getByRole("radio", "Mi dominio más flojo (Seguridad y cumplimiento)").click();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("group", /^Pregunta \d+$/).filter({ hasText: "Seguridad y cumplimiento" })).toHaveCount(10);
  await screen.getByRole("button", `Volver a ${NAME}`).click();

  await scope.getByRole("radio", "Temas de lo que fallé").click();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 1")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("group", "Pregunta 1")).toContainText("Seguridad y cumplimiento");
  await screen.getByRole("button", `Volver a ${NAME}`).click();
  // The targeted mocks don't move the trend: only the whole-exam one is plotted.
  await screen.getByRole("figure", "Evolución de tus simulacros").getByText("Ver como tabla").click();
  await expect(screen.getByRole("figure", "Evolución de tus simulacros").getByRole("row")).toHaveCount(2);
});

test("AC-44 hoja de repaso final", async ({ app, screen }) => {
  await createExam(app, screen);
  await mockFailing(screen, /Seguridad y cumplimiento/);
  const card = screen.getByRole("region", "Hoja de repaso");
  await card.getByRole("button", "Generar hoja").click();
  const sheet = screen.getByTestId("cheat-sheet");
  await expect(sheet.getByRole("heading").first()).toHaveText("Tecnología y servicios de la nube (34%)", { timeout: 10_000 });
  await expect(sheet.getByRole("heading", "Trampas frecuentes")).toBeVisible();
  await expect(sheet).toContainText("Ojo:");
  await expect(card.getByRole("button", "Regenerar")).toBeVisible();
  await expect(card.getByRole("button", "Descargar .md")).toBeVisible();
  await expect(card.getByRole("button", "Imprimir o PDF")).toBeVisible();
});

test("AC-45 ¿por qué no la B? le pregunto al profesor sobre una pregunta corregida", async ({ app, screen }) => {
  await createExam(app, screen);
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 10")).toBeVisible({ timeout: 10_000 });
  await answerAll(screen, /Seguridad y cumplimiento/);
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toBeVisible({ timeout: 10_000 });

  const q3 = screen.getByRole("group", "Pregunta 3"); // Seguridad: answered wrong on purpose
  await q3.getByRole("button", "Preguntar al profesor").click();
  const doubt = q3.getByLabel("Tu duda sobre la pregunta");
  await expect(doubt).toHaveValue(/^¿Por qué no la [A-E]\?$/);
  await q3.getByRole("button", /^Preguntar$/).click();
  const thread = q3.getByRole("region", "Duda sobre la pregunta");
  await expect(thread).toContainText("Buena pregunta", { timeout: 10_000 });
  await expect(doubt).toHaveValue("");
  await doubt.fill("¿Y si fuera una sola vez?");
  await doubt.press("Enter");
  await expect(thread).toContainText("«¿Y si fuera una sola vez?»", { timeout: 10_000 });
});

test("AC-46 verificación por un segundo modelo y reporte de preguntas mal hechas", async ({ app, screen }) => {
  await createExam(app, screen, SAMPLE_GUIDE, "/?disputeOne");
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByTestId("checked")).toHaveText(/se descartó 1 pregunta dudosa/, { timeout: 10_000 });
  await expect(screen.getByRole("group", /^Pregunta \d+$/)).toHaveCount(9);
  for (let i = 1; i <= 9; i++) {
    const q = screen.getByRole("group", `Pregunta ${i}`);
    const fail = /Seguridad y cumplimiento/.test((await q.textContent()) ?? "");
    await pick(q, fail ? /^(Ignorarlo|Delegarlo)/ : /^Aplicar correctamente/);
  }
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toHaveText("6/9 · 67%", { timeout: 10_000 });

  const q2 = screen.getByRole("group", "Pregunta 2"); // the first Seguridad one
  await expect(q2).toContainText("Seguridad y cumplimiento");
  await q2.getByRole("button", "Esta pregunta está mal").click();
  await q2.getByLabel("Motivo del reporte").fill("dos opciones son correctas");
  await q2.getByRole("button", "Reportar").click();
  await expect(screen.getByTestId("mock-score")).toHaveText("6/8 · 75%", { timeout: 10_000 });
  await expect(q2.getByTestId("explanation")).toContainText("Reportada: no cuenta (dos opciones son correctas).");
  await expect(q2.getByRole("button", "Esta pregunta está mal")).toHaveCount(0);

  await screen.getByRole("button", `Volver a ${NAME}`).click();
  await expect(screen.getByRole("region", "Repaso de falladas")).toContainText("2 preguntas");
  await screen.getByRole("region", "Repaso de falladas").getByRole("button", "Repasar").click();
  await pick(screen.getByRole("group", "Pregunta de repaso"), /^Aplicar correctamente/);
  await screen.getByRole("button", "Responder").click();
  await screen.getByRole("button", "Esta pregunta está mal").click();
  await screen.getByRole("button", "Reportar").click();
  await screen.getByRole("button", "Siguiente").click();
  await pick(screen.getByRole("group", "Pregunta de repaso"), /^Aplicar correctamente/);
  await screen.getByRole("button", "Responder").click();
  await screen.getByRole("button", "Terminar").click();
  await expect(screen.getByTestId("review-summary")).toContainText("Quedan 1 para repasar.");
});

test("AC-63 leer la guía desde una foto o un PDF escaneado, con visión", async ({ app, screen, browser }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Exámenes").click({ timeout: 30_000 });
  const guide = screen.getByLabel("Guía oficial del examen");
  await browser.locator('input[aria-label="Cargar la guía desde un archivo"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(guide).toHaveValue(/Dominio 2: Seguridad y cumplimiento \(30%\)/, { timeout: 15_000 });
  await expect(screen.getByRole("status")).toContainText("Leí foto-guia.png con el modelo");

  await guide.fill("");
  await browser.locator('input[aria-label="Cargar la guía desde un archivo"]').setInputFiles("tests/fixtures/guia-escaneada.pdf");
  await expect(screen.getByRole("status")).toContainText("Leí guia-escaneada.pdf con el modelo", { timeout: 15_000 });
  await expect(guide).toHaveValue(/Dominio 1: Conceptos de la nube/);

  await nav(screen).getByRole("button", "Tarjetas").click();
  await screen.getByRole("radio", "De mis apuntes").click();
  await browser.locator('input[aria-label="Fotos de apuntes"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(screen.getByLabel("Apuntes")).toHaveValue(/Mitocondria: produce la energía/, { timeout: 15_000 });
});
