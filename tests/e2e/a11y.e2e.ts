// features/calidad.feature — accessibility: axe-core (WCAG 2.0/2.1 A + AA)
// on every screen, in both themes. Any violation fails with its rule id and
// the offending selectors.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Screen } from "e2e";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { answer, pending, pick, startSession } from "./helpers.ts";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

type Violation = { id: string; impact: string | null; help: string; targets: string[] };
type Browser = { evaluate: <T, A>(fn: (arg: A) => T | Promise<T>, arg: A) => Promise<T> };

async function audit(browser: Browser, where: string) {
  const violations = await browser.evaluate(async (src: string) => {
    if (!(window as unknown as { axe?: unknown }).axe) new Function(src)();
    // Audit the settled screen, not a frame of an entrance animation.
    const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 1000))]);
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  }, AXE);
  expect(violations as Violation[], `violaciones de accesibilidad en ${where}`).toEqual([]);
}

async function setTheme(screen: Screen, theme: "Tema oscuro" | "Tema claro") {
  await screen.getByRole("radio", theme).click();
  await expect(screen.getByRole("radio", theme)).toHaveAttribute("aria-checked", "true");
}

for (const theme of ["Tema oscuro", "Tema claro"] as const) {
  test(`a11y inicio y ajustes (${theme})`, async ({ app, screen, browser }) => {
    await app.open("/?unconfigured");
    await setTheme(screen, theme);
    await audit(browser, `inicio sin configurar, ${theme}`);

    await screen.getByRole("button", "Prefiero configurarlo a mano en Ajustes").click();
    await audit(browser, `ajustes › conexión, ${theme}`);
    await screen.getByRole("tab", "Avanzado").click();
    await audit(browser, `ajustes › avanzado, ${theme}`);
    await screen.getByRole("tab", "Accesibilidad").click();
    await audit(browser, `ajustes › accesibilidad, ${theme}`);
    await screen.getByRole("checkbox", /Modo avanzado/).check();
    await screen.getByRole("tab", "Prompts").click();
    await audit(browser, `ajustes › prompts, ${theme}`);

    await screen.getByRole("button", "Buscar o ejecutar").click();
    await expect(screen.getByRole("dialog", "Paleta de comandos")).toBeVisible();
    await audit(browser, `paleta de comandos, ${theme}`);
  });

  test(`a11y sesión en cada fase (${theme})`, async ({ app, screen, browser }) => {
    await app.open("/");
    await setThemeInSettings(screen, theme);
    await startSession(app, screen);
    await audit(browser, `pregunta abierta pendiente, ${theme}`);

    await answer(screen, { text: "sube 2", confidence: 4, thinking: "creo" });
    await expect(pending(screen)).toContainText("Crece sin límite", { timeout: 10_000 });
    await audit(browser, `pregunta con opciones y diagnóstico, ${theme}`);

    await answer(screen, { option: "A 0", confidence: 3 });
    await expect(pending(screen)).toHaveAttribute("data-purpose", "predict", { timeout: 10_000 });
    await audit(browser, `enseñar con árbol del plan, ${theme}`);

    await screen.getByRole("button", "Volver a Sesiones").click();
    await audit(browser, `inicio con sesiones, ${theme}`);
  });
}

for (const theme of ["Tema oscuro", "Tema claro"] as const) {
  test(`a11y panel de hoy con racha, clases y notas (${theme})`, async ({ app, screen, browser }) => {
    await app.open("/?panel&streak");
    await setThemeInSettings(screen, theme);
    await expect(screen.getByRole("region", "Tu día")).toContainText("7,5", { timeout: 30_000 });
    await audit(browser, `panel de hoy, ${theme}`);
    await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi cursada").click();
    await expect(screen.getByRole("region", "Feriados y días sin clases")).toBeVisible();
    await audit(browser, `mi cursada con días sin clases, ${theme}`);
    // AC-146..148: a recorded class with its notes (silent fake microphone, short parts).
    await browser.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      };
      (window as unknown as { __eurekaSegmentMs: number }).__eurekaSegmentMs = 1500;
    }, null);
    await screen.getByRole("navigation", "Navegación").getByRole("button", "Clases").click();
    await screen.getByRole("button", "Empezar a grabar").click();
    await expect(screen.getByTestId("class-progress")).toContainText("2 partes", { timeout: 20_000 });
    await audit(browser, `clase en curso, ${theme}`);
    await screen.getByRole("button", "Terminar la clase").click();
    await screen.getByRole("button", "Armar apuntes").click({ timeout: 20_000 });
    await expect(screen.getByTestId("class-notes")).toBeVisible({ timeout: 15_000 });
    await audit(browser, `apuntes de la clase, ${theme}`);
  });
}

test("a11y estado de error", async ({ app, screen, browser }) => {
  await app.open("/?fail");
  await screen.getByLabel("Mensaje").fill("x");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "error del proveedor");
});

test("a11y grafo, práctica y visuales (Fases 2-4)", async ({ app, screen, browser }) => {
  await startSession(app, screen);
  await answer(screen, { text: "sube 2", confidence: 4 });
  await answer(screen, { option: "A 0", confidence: 3 });
  await answer(screen, { text: "una recta", confidence: 3 });
  await expect(screen.getByRole("figure", "Diagrama: De la secante a la tangente")).toContainText("Tangente", { timeout: 10_000 });
  await audit(browser, "diagrama y demo en la conversación");

  await answer(screen, { option: "En la tangente", confidence: 4 });
  await answer(screen, { option: "6", confidence: 5 });
  await expect(screen.getByTestId("graph-banner")).toContainText("Guardado", { timeout: 10_000 });
  await screen.getByRole("textbox", "Mensaje").fill("¿y para qué sirve?");
  await screen.getByRole("textbox", "Mensaje").press("Enter");
  await expect(screen.getByRole("region", "Investigación")).toContainText("velocidad", { timeout: 10_000 });
  await audit(browser, "aviso del grafo e investigación con fuentes");

  const nav = screen.getByRole("navigation", "Navegación");
  await nav.getByRole("button", "Grafo").click();
  await screen.getByTestId("graph-node").first().click();
  await audit(browser, "grafo con detalle");
  await screen.getByRole("button", "Importar notas").click();
  await audit(browser, "importar notas");

  await nav.getByRole("button", "Práctica").click();
  await audit(browser, "nueva práctica");
  await screen.getByRole("checkbox").first().check();
  await screen.getByRole("button", /^Generar/).click();
  await expect(screen.getByTestId("problem-progress")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("region", "Pistas").getByRole("button", /Pedir pista/).click();
  await audit(browser, "problema con pista");
  await answer(screen, { text: "6", confidence: 4 });
  await expect(screen.getByTestId("verdict")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "corrección");
});

test("a11y exámenes: ruta de estudio y simulacro (Fase 5)", async ({ app, screen, browser }) => {
  const { SAMPLE_GUIDE } = await import("../../src/e2e/examScript.ts");
  await app.open("/");
  await screen.getByRole("navigation", "Navegación").getByRole("button", "Exámenes").click();
  await audit(browser, "nuevo examen");
  await screen.getByLabel("Nombre del examen").fill("AWS Certified Cloud Practitioner");
  await screen.getByLabel("Guía oficial del examen").fill(SAMPLE_GUIDE);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await expect(screen.getByRole("region", "Ruta de estudio")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "ruta de estudio");
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByRole("group", "Pregunta 1")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("group", "Pregunta 1").getByRole("radio").first().check();
  await audit(browser, "simulacro en curso");
  await screen.getByRole("button", "Entregar").click();
  await expect(screen.getByTestId("mock-score")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "resultado del simulacro");

  await screen.getByRole("button", "Volver a AWS Certified Cloud Practitioner").click();
  await screen.getByRole("region", "Repaso de falladas").getByRole("button", "Repasar").click();
  await audit(browser, "repaso de falladas");
  await pick(screen.getByRole("group", "Pregunta de repaso"), /^Aplicar correctamente/);
  await screen.getByRole("button", "Responder").click();
  await expect(screen.getByTestId("review-feedback")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "devolución del repaso");

  await screen.getByRole("button", "Volver a AWS Certified Cloud Practitioner").click();
  await screen.getByRole("radio", "Con tiempo").click();
  await screen.getByRole("button", "Nuevo simulacro").click();
  await expect(screen.getByTestId("timer")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("group", "Pregunta 2").getByRole("button", "Marcar para revisar").click();
  await audit(browser, "simulacro con tiempo y preguntas marcadas");
});

test("a11y herramientas de estudio y programación (Fases 6-7)", async ({ app, screen, browser }) => {
  const nav = screen.getByRole("navigation", "Navegación");
  await app.open("/");
  await expect(screen.getByRole("region", "Tiempo de estudio")).toBeVisible({ timeout: 30_000 });
  await screen.getByRole("region", "Pomodoro").getByRole("button", "Ajustes del pomodoro").click();
  await audit(browser, "inicio con tiempo de estudio y pomodoro abierto");

  await nav.getByRole("button", "Tarjetas").click();
  await screen.getByLabel("Nombre del mazo").fill("Repaso");
  await screen.getByRole("radio", "De mis apuntes").click();
  await screen.getByLabel("Apuntes").fill("- S3: objetos\n- EC2: cómputo");
  await audit(browser, "nuevo mazo");
  await screen.getByRole("button", "Generar mazo").click();
  await expect(screen.getByRole("region", "Tarjetas del mazo")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "mazo");
  await screen.getByRole("button", /^Estudiar/).click();
  await screen.getByRole("button", "Mostrar respuesta").click();
  await audit(browser, "estudiar tarjeta");

  await nav.getByRole("button", "Exámenes").click();
  await screen.getByRole("radio", "Materia").click();
  await screen.getByLabel("Nombre del examen").fill("Física I");
  await screen.getByLabel("Guía oficial del examen").fill("Unidad 1: Cinemática\n- Movimiento rectilíneo\nUnidad 2: Dinámica\n- Leyes de Newton");
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await expect(screen.getByRole("region", "Horario")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("region", "Horario").getByRole("button", "Agregar").click();
  await screen.getByRole("region", "Meta").getByLabel("Fecha del examen").fill("2099-03-01");
  await screen.getByRole("region", "Meta").getByRole("button", "Guardar meta").click();
  await expect(screen.getByTestId("plan-today")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "materia con plan y horario");

  await nav.getByRole("button", "Agenda").click();
  await expect(screen.getByRole("region", "Semana")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "agenda");

  await nav.getByRole("button", "Código").click();
  await expect(screen.getByTestId("runtime")).toHaveText("Python 3.14.7", { timeout: 20_000 });
  await screen.getByLabel("Código").fill("x = 1/0");
  await screen.getByRole("button", "Ejecutar").click();
  await expect(screen.getByRole("region", "Salida")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "consola con error");
});

test("acompañamiento: aviso, charla con líneas de ayuda, diario, herramientas y bloqueo", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/");
    await setThemeInSettings(screen, theme);
    const go = () => screen.getByRole("navigation", "Navegación").getByRole("button", "Acompañamiento").click();
    await go();
    await expect(screen.getByRole("region", "Antes de empezar")).toBeVisible();
    await audit(browser, `acompañamiento › aviso, ${theme}`);
    await screen.getByRole("button", "Entendido, seguir").click();
    await audit(browser, `acompañamiento › charla vacía, ${theme}`);

    await screen.getByRole("textbox", "Mensaje").fill("a veces pienso en quitarme la vida");
    await screen.getByRole("button", "Enviar").click();
    await expect(screen.getByRole("region", "Líneas de ayuda")).toBeVisible();
    await audit(browser, `acompañamiento › líneas de ayuda, ${theme}`);

    await screen.getByRole("tab", "Diario").click();
    await screen.getByRole("radio", "Bien").click();
    await screen.getByRole("button", "Guardar check-in").click();
    await expect(screen.getByRole("region", "Hoy")).toBeVisible();
    await audit(browser, `acompañamiento › diario, ${theme}`);

    await screen.getByRole("tab", "Herramientas").click();
    await audit(browser, `acompañamiento › herramientas, ${theme}`);

    await screen.getByRole("tab", "Diario").click();
    await screen.getByLabel("PIN nuevo").fill("4321");
    await screen.getByRole("button", "Poner PIN").click();
    await screen.getByRole("button", "Bloquear ahora").click();
    await expect(screen.getByRole("region", "Diario bloqueado")).toBeVisible();
    await audit(browser, `acompañamiento › bloqueado, ${theme}`);
  }
});

test("acompañamiento v2: lo que noté, rueda de emociones y registro de pensamientos", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/?companionSeed");
    await setThemeInSettings(screen, theme);
    await screen.getByRole("navigation", "Navegación").getByRole("button", "Acompañamiento").click();
    await screen.getByRole("tab", "Diario").click();
    await expect(screen.getByRole("region", "Lo que noté")).toContainText("Los domingos suelen costarte más");
    await audit(browser, `acompañamiento › lo que noté, ${theme}`);
    await screen.getByRole("button", "Me suena: Los domingos suelen costarte más").click();
    await screen.getByRole("button", /No encuentro la palabra/).click();
    await screen.getByRole("radio", "Miedo").click();
    await screen.getByRole("button", "nervioso").click();
    await audit(browser, `acompañamiento › check-in con rueda y confirmado, ${theme}`);

    await screen.getByRole("tab", "Herramientas").click();
    await screen.getByRole("region", "Rueda de emociones").getByRole("radio", "Calma").click();
    await screen.getByRole("region", "Rueda de emociones").getByRole("button", "aliviado").click();
    await audit(browser, `acompañamiento › herramientas, ${theme}`);
    await screen.getByRole("button", "Empezar un registro").click();
    await screen.getByRole("textbox", "Qué pasó").fill("Un día largo");
    await audit(browser, `acompañamiento › registro, paso 1, ${theme}`);
    await screen.getByRole("button", "Siguiente").click();
    await screen.getByRole("textbox", "Qué pensaste").fill("No llego");
    await screen.getByRole("button", "Siguiente").click();
    await screen.getByRole("region", "Registro de pensamientos").getByRole("radio", "Agobio").click();
    await audit(browser, `acompañamiento › registro, paso 3, ${theme}`);
  }
});

test("a11y bienvenida, charla libre y botones del asistente", async ({ app, screen, browser }) => {
  await app.open("/?onboarding");
  const dialog = screen.getByRole("dialog", "Bienvenida");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  for (const step of ["nombre", "sobre vos", "trato", "espacio"]) {
    await audit(browser, `bienvenida › ${step}`);
    await dialog.getByRole("button", "Siguiente").click();
  }
  await audit(browser, "bienvenida › cuidarte");
  await dialog.getByRole("button", "Empezar").click();

  await audit(browser, "inicio como chat");
  await screen.getByLabel("Mensaje").fill("ayudame con un pomodoro");
  await screen.getByRole("button", "Enviar").click();
  await expect(screen.getByRole("group", "Empezar un pomodoro de 25 min")).toBeVisible({ timeout: 10_000 });
  await audit(browser, "charla libre con botones del asistente");
});

test("citas: bienvenida, tarjeta del inicio y sección en Mi espacio", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/?splash");
    const splash = screen.getByRole("dialog", "Cita del día");
    await expect(splash).toBeVisible({ timeout: 30_000 });
    await audit(browser, `citas › bienvenida, ${theme === "Tema oscuro" ? "tema guardado" : "antes de cambiar"}`);
    await splash.getByRole("button", "Entrar").click();
    await setThemeInSettings(screen, theme);
    await screen.getByRole("figure", "Cita").getByRole("button", /favoritas?$/).click();
    await audit(browser, `citas › tarjeta del inicio, ${theme}`);
    await screen.getByRole("navigation", "Navegación").getByRole("button", /Personalizar/).click();
    await expect(screen.getByRole("region", "Citas")).toBeVisible();
    await audit(browser, `citas › Mi espacio, ${theme}`);
  }
});

test("a11y compartir mazos y la malla de la carrera (AC-152…157)", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/?openedDeck");
    await setThemeInSettings(screen, theme);
    await expect(screen.getByRole("region", "Mazo para importar")).toBeVisible({ timeout: 30_000 });
    await audit(browser, `mazo compartido para importar, ${theme}`);
    await screen.getByRole("button", "Importar 2 tarjetas").click();
    await expect(screen.getByRole("group", "Compartir y exportar")).toBeVisible();
    await screen.getByRole("button", "Compartir").click();
    await expect(screen.getByRole("status").filter({ hasText: "Listo para mandar" })).toBeVisible();
    await audit(browser, `mazo compartido, ${theme}`);

    await screen.getByRole("navigation", "Navegación").getByRole("button", "Mi cursada").click();
    await screen.getByRole("tab", "Mi carrera").click();
    // The scripted backend starts empty on every page load.
    await screen.getByRole("button", "Cargar mi plan de estudios").click();
    await screen.getByLabel("Plan de estudios para leer").fill("1.º año Análisis Matemático I, Álgebra");
    await screen.getByRole("button", "Leer el plan").click();
    await expect(screen.getByRole("region", "Lo que entendí del plan")).toBeVisible({ timeout: 10_000 });
    await audit(browser, `plan de estudios para confirmar, ${theme}`);
    await screen.getByRole("button", "Guardar mi carrera").click();
    await screen.getByLabel("Estado de Álgebra y Geometría Analítica").selectOption("Regular");
    await screen.getByRole("button", "Editar Análisis Matemático I").click();
    await expect(screen.getByRole("group", "Editar Análisis Matemático I")).toBeVisible();
    await audit(browser, `mi carrera con una materia en edición, ${theme}`);
  }
});

test("a11y una sola clave y propuestas editables del chat (AC-158…165)", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/?unconfigured");
    await setThemeInSettings(screen, theme);
    const setup = screen.getByRole("region", "Conectar con una clave");
    await setup.getByLabel("Tu clave de acceso").fill("sk-0123456789abcdef0123456789abcdef");
    await setup.getByRole("button", "Conectar").click();
    await expect(setup.getByRole("group")).toBeVisible({ timeout: 10_000 });
    await audit(browser, `clave de dos servicios, ${theme}`);
    await setup.getByRole("button", "Conectar con DeepSeek").click();
    await expect(setup.getByTestId("quick-setup-done")).toBeVisible({ timeout: 10_000 });
    await audit(browser, `clave conectada, ${theme}`);

    await screen.getByLabel("Mensaje").fill("haceme tarjetas de verbos irregulares");
    await screen.getByRole("button", "Enviar").click();
    await expect(screen.getByRole("region", "Mazo «Verbos irregulares»")).toBeVisible({ timeout: 30_000 });
    await audit(browser, `mazo propuesto, ${theme}`);
    await screen.getByRole("navigation", "Navegación").getByRole("button", "Nueva sesión").click();
    await screen.getByLabel("Mensaje").fill("quiero rendir una certificación");
    await screen.getByRole("button", "Enviar").click();
    await screen.getByRole("button", "Corregir").click({ timeout: 30_000 });
    await audit(browser, `examen propuesto en corrección, ${theme}`);
  }
});

test("a11y mis propios problemas y el grafo por profundidad (AC-170, AC-173)", async ({ app, screen, browser }) => {
  for (const theme of ["Tema oscuro", "Tema claro"] as const) {
    await app.open("/");
    await setThemeInSettings(screen, theme);
    await screen.getByRole("navigation", "Navegación").getByRole("button", "Práctica").click();
    const card = screen.getByRole("region", "Practicar mis problemas");
    await card.getByRole("button", "Traer mis problemas").click();
    await card.getByLabel("Tus ejercicios").fill("1) Un auto va a 20 m/s durante 3 s. ¿Cuánto recorre? Rta: 60 m\n2) ¿Y en $t = 5$ s?");
    await audit(browser, `traer mis problemas, ${theme}`);
    await card.getByRole("button", "Leer los ejercicios").click();
    await expect(card.getByRole("list", "Ejercicios leídos").getByRole("checkbox")).toHaveCount(2, { timeout: 10_000 });
    await audit(browser, `ejercicios leídos para revisar, ${theme}`);
  }
});
