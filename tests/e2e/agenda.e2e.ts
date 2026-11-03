// features/agenda.feature — AC-50 … AC-52 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { App, Screen } from "e2e";
import { readFile } from "node:fs/promises";
import { pending } from "./helpers.ts";

const SUBJECT = "Análisis Matemático II";
const PROGRAM = "Unidad 1: Límites y continuidad\n- Límite de una función\n- Continuidad\nUnidad 2: Derivadas\n- Regla de la cadena\n- Derivadas parciales";
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");

/** Local calendar day + n, as YYYY-MM-DD (like the app). */
function localDay(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayName = () => WEEKDAYS[(new Date().getDay() + 6) % 7];

async function createSubject(app: App, screen: Screen) {
  await app.open("/");
  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByRole("radio", "Materia").click();
  await expect(screen.getByRole("heading", "Cursar una materia")).toBeVisible();
  await screen.getByLabel("Nombre del examen").fill(SUBJECT);
  await screen.getByLabel("Guía oficial del examen").fill(PROGRAM);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  await expect(screen.getByRole("heading", SUBJECT)).toBeVisible({ timeout: 10_000 });
}

test("AC-50 AC-51 materia con su programa y su horario de clases en la agenda", async ({ app, screen }) => {
  await createSubject(app, screen);
  await expect(screen.getByRole("region", "Ruta de estudio").getByRole("article")).toHaveCount(2);

  const horario = screen.getByRole("region", "Horario");
  await horario.getByLabel("Tipo de horario").selectOption("Clase");
  await horario.getByLabel("Día").selectOption("Martes");
  await horario.getByLabel("Desde").fill("18:00");
  await horario.getByLabel("Hasta").fill("20:00");
  await horario.getByLabel("Lugar").fill("Aula 5");
  await horario.getByRole("button", "Agregar").click();
  await expect(horario.getByRole("list", "Horarios")).toContainText("Martes 18:00–20:00");
  await expect(horario.getByRole("list", "Horarios")).toContainText("Aula 5");

  await horario.getByLabel("Desde").fill("20:00");
  await horario.getByLabel("Hasta").fill("19:00");
  await horario.getByRole("button", "Agregar").click();
  await expect(horario.getByRole("alert")).toContainText("después de la de inicio");

  // A study block today, to see it under "Hoy".
  await horario.getByLabel("Tipo de horario").selectOption("Estudio");
  await horario.getByLabel("Día").selectOption(todayName());
  await horario.getByLabel("Desde").fill("07:00");
  await horario.getByLabel("Hasta").fill("08:30");
  await horario.getByRole("button", "Agregar").click();
  await expect(horario.getByRole("listitem")).toHaveCount(2);

  await nav(screen).getByRole("button", "Exámenes").click();
  await expect(screen.getByRole("region", "Exámenes")).toContainText("Materia · 2 unidades");

  await nav(screen).getByRole("button", "Agenda").click();
  await expect(screen.getByRole("region", "Hoy")).toContainText("07:00–08:30");
  await expect(screen.getByRole("region", "Hoy")).toContainText(SUBJECT);
  await expect(screen.getByRole("group", "Martes")).toContainText(SUBJECT);
  await expect(screen.getByTestId("week-hours")).toHaveText("2 h de clase · 1,5 h de estudio planificado");
  await screen.getByRole("group", "Martes").getByRole("button", /Análisis/).first().click();
  await expect(screen.getByRole("heading", SUBJECT)).toBeVisible();
});

test("AC-52 plan con fecha: qué estudiar hoy, semanas y horas", async ({ app, screen }) => {
  await createSubject(app, screen);
  const plan = screen.getByRole("region", "Plan de estudio");
  await expect(plan).toContainText("Cargá la fecha del parcial o final");

  const goal = screen.getByRole("region", "Meta");
  await goal.getByLabel("Fecha del examen").fill(localDay(20));
  await goal.getByLabel("Horas de estudio por semana").fill("6");
  await goal.getByRole("button", "Guardar meta").click();

  await expect(screen.getByTestId("plan-today")).toContainText("Hoy: estudiá", { timeout: 10_000 });
  await expect(screen.getByTestId("plan-hours")).toHaveText(/^Esta semana: 0 min de 6 h/);
  await expect(plan.getByRole("listitem").last()).toContainText("Simulacros con tiempo, repaso y hoja de repaso");
  await expect(plan.getByRole("listitem").first()).toContainText("Esta semana");

  await screen.getByTestId("plan-today").getByRole("button", "Estudiar").click();
  await expect(pending(screen)).toBeVisible({ timeout: 10_000 });

  await nav(screen).getByRole("button", "Agenda").click();
  await expect(screen.getByRole("region", "Próximas fechas")).toContainText("En 20 días");
  await expect(screen.getByRole("region", "Próximas fechas")).toContainText(SUBJECT);
});

test("AC-51 agenda vacía explica qué cargar", async ({ app, screen }) => {
  await app.open("/");
  await nav(screen).getByRole("button", "Agenda").click();
  await expect(screen.getByRole("heading", "Tu semana está vacía")).toBeVisible({ timeout: 20_000 });
});

test("AC-59 exportar la agenda a un calendario (.ics)", async ({ app, screen, browser }) => {
  await createSubject(app, screen);
  const horario = screen.getByRole("region", "Horario");
  await horario.getByLabel("Día").selectOption("Jueves");
  await horario.getByLabel("Desde").fill("18:00");
  await horario.getByLabel("Hasta").fill("20:00");
  await horario.getByRole("button", "Agregar").click();
  await screen.getByRole("region", "Meta").getByLabel("Fecha del examen").fill(localDay(30));
  await screen.getByRole("region", "Meta").getByRole("button", "Guardar meta").click();

  await nav(screen).getByRole("button", "Agenda").click();
  const file = await browser.waitForDownload(() => screen.getByRole("button", "Exportar a calendario (.ics)").click());
  const ics = await readFile(file.absolutePath, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=" + localDay(30).replace(/-/g, "") + "T235959");
  expect(ics).toContain(`SUMMARY:Clase: ${SUBJECT}`);
  expect(ics).toContain(`SUMMARY:Parcial/final: ${SUBJECT}`);
  await expect(screen.getByRole("status").filter({ hasText: "eureka-agenda.ics" })).toBeVisible();
});

test("AC-62 recordatorio antes de una clase y ajustes de recordatorios", async ({ app, screen }) => {
  const soon = new Date(Date.now() + 5 * 60_000);
  test.skip(soon.getDate() !== new Date().getDate(), "cerca de medianoche la clase cae mañana");
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await app.open("/?fastReminders");
  await nav(screen).getByRole("button", "Ajustes").click({ timeout: 30_000 });
  await screen.getByRole("tab", "Avanzado").click();
  const rem = screen.getByRole("region", "Recordatorios");
  await expect(rem.getByLabel("Minutos antes de cada clase")).toHaveValue("15");
  await rem.getByLabel("Minutos antes de cada clase").fill("10");

  await nav(screen).getByRole("button", "Exámenes").click();
  await screen.getByRole("radio", "Materia").click();
  await screen.getByLabel("Nombre del examen").fill(SUBJECT);
  await screen.getByLabel("Guía oficial del examen").fill(PROGRAM);
  await screen.getByRole("button", "Armar ruta de estudio").click();
  const horario = screen.getByRole("region", "Horario");
  await horario.getByLabel("Día").selectOption(todayName());
  await horario.getByLabel("Desde").fill(hhmm(soon));
  await horario.getByLabel("Hasta").fill(hhmm(new Date(soon.getTime() + 60_000)) > hhmm(soon) ? hhmm(new Date(soon.getTime() + 60_000)) : "23:59");
  await horario.getByLabel("Lugar").fill("Aula 5");
  await horario.getByRole("button", "Agregar").click();

  const toasts = screen.getByRole("region", "Recordatorios").filter({ hasText: "Clase de" });
  await expect(toasts).toContainText(`Clase de ${SUBJECT}`, { timeout: 10_000 });
  await expect(toasts).toContainText(/En [45] min/);
  await expect(toasts).toContainText("Aula 5");
  await toasts.getByRole("button", `Cerrar recordatorio: Clase de ${SUBJECT}`).click();
  await expect(screen.getByText(`Clase de ${SUBJECT}`)).toHaveCount(0);
});
