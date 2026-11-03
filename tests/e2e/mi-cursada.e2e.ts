// features/mi-cursada.feature — AC-99 … AC-103 (web, scripted backend).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import type { Screen } from "e2e";

const nav = (screen: Screen) => screen.getByRole("navigation", "Navegación");
const ymd = (daysAhead: number) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function openCursada(app: import("e2e").App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await nav(screen).getByRole("button", "Mi cursada").click({ timeout: 30_000 });
  await expect(screen.getByRole("heading", "Mi cursada")).toBeVisible();
}

test("AC-99 armar la cursada a mano: período, materia con sus horarios, y la semana se dibuja sola", async ({ app, screen }) => {
  await openCursada(app, screen);
  await expect(screen.getByRole("region", "Armá tu cursada")).toContainText("Contáselo al asistente");

  await screen.getByRole("button", "Cargarlo a mano").click();
  await screen.getByLabel("Nombre del período").fill("2.º cuatrimestre 2026");
  await screen.getByRole("button", "Guardar período").click();
  await expect(screen.getByLabel("Período")).toBeVisible();

  await screen.getByRole("button", "Agregar materia").click();
  await screen.getByLabel("Nombre de la materia").fill("Análisis I");
  await screen.getByLabel("Profesor o profesora").fill("Pérez");
  await screen.getByLabel("Aula habitual").fill("Aula 3");
  await screen.getByRole("button", "+ Agregar horario").click();
  await screen.getByLabel("Día 1").selectOption("Lunes");
  await screen.getByLabel("Desde 1").fill("10:00");
  await screen.getByLabel("Hasta 1").fill("12:00");
  // A class that ends before it starts is refused next to the field.
  await screen.getByLabel("Hasta 1").fill("09:00");
  await screen.getByRole("button", "Guardar materia").click();
  await expect(screen.getByRole("alert")).toContainText("El horario 1 tiene que terminar después de empezar");
  await screen.getByLabel("Hasta 1").fill("12:00");
  await screen.getByRole("button", "+ Agregar horario").click();
  await screen.getByLabel("Día 2").selectOption("Miércoles");
  await screen.getByLabel("Desde 2").fill("10:00");
  await screen.getByLabel("Hasta 2").fill("12:00");
  await screen.getByRole("button", "Guardar materia").click();

  const grid = screen.getByRole("group", "Horario semanal");
  await expect(grid.getByRole("button", "Análisis I, Lunes de 10:00 a 12:00, Aula 3")).toBeVisible();
  await expect(grid.getByRole("button", "Análisis I, Miércoles de 10:00 a 12:00, Aula 3")).toBeVisible();
  await expect(screen.getByRole("region", "Materias")).toContainText("Prof. Pérez");
  await expect(screen.getByText("4 h de clase por semana", { exact: false })).toBeVisible();
});

test("AC-100 las fechas que importan: se cargan, se cuentan los días, se marcan hechas y se borran", async ({ app, screen }) => {
  await openCursada(app, screen);
  await screen.getByRole("button", "Cargarlo a mano").click();
  await screen.getByRole("button", "Guardar período").click();
  await screen.getByRole("button", "Agregar materia").click();
  await screen.getByLabel("Nombre de la materia").fill("Física I");
  await screen.getByRole("button", "Guardar materia").click();

  await screen.getByRole("button", "Agregar fecha").click();
  await screen.getByLabel("Tipo de fecha").selectOption("Parcial");
  await screen.getByLabel("Título de la fecha").fill("Primer parcial");
  await screen.getByLabel("Materia de la fecha").selectOption("Física I");
  await screen.getByLabel("Fecha").fill(ymd(3));
  await screen.getByRole("button", "Guardar fecha").click();

  const dates = screen.getByRole("region", "Fechas importantes");
  await expect(dates).toContainText("Primer parcial");
  await expect(dates).toContainText("Física I");
  await expect(dates).toContainText("En 3 días");
  await expect(screen.getByRole("region", "Materias")).toContainText("Próxima: Parcial en 3 días");

  await dates.getByLabel("Marcar como hecho: Primer parcial").click();
  await expect(dates).toContainText("Hechas (1)");
  await expect(dates).not.toContainText("En 3 días");
  await dates.getByText("Hechas (1)").click();
  await dates.getByRole("button", "Borrar Primer parcial").click();
  await dates.getByRole("button", "Confirmar borrar Primer parcial").click();
  await expect(dates).toContainText("Sin fechas todavía");
});

test("AC-101 pegar el horario: lo lee, muestra qué entendió, se guarda recién al confirmar y no se duplica", async ({ app, screen }) => {
  await openCursada(app, screen);
  await screen.getByRole("button", "Pegar mi horario").first().click();
  const panel = screen.getByRole("region", "Pegar mi horario");
  await panel.getByLabel("Horario o fechas para leer").fill("Lunes 10:00 a 12:00 Análisis I");
  await panel.getByRole("button", "Leer mi horario").click();

  const preview = screen.getByRole("region", "Propuesta para Mi cursada");
  await expect(preview).toContainText("2 materias y 2 fechas", { timeout: 10_000 });
  await expect(preview).toContainText("Análisis I");
  await expect(preview).toContainText("Primer parcial");
  await expect(preview).toContainText("Se guarda recién cuando lo confirmás");
  await preview.getByRole("button", "Guardar en Mi cursada").click();
  await expect(preview.getByRole("status")).toContainText("2 materias nuevas, 2 fechas nuevas");
  await preview.getByRole("button", "Abrir Mi cursada").click();
  await expect(screen.getByRole("group", "Horario semanal").getByRole("button", /Física I, Martes/)).toBeVisible();

  // The same again: updated, not repeated.
  await screen.getByRole("button", "Pegar mi horario").click();
  const again = screen.getByRole("region", "Pegar mi horario");
  await again.getByLabel("Horario o fechas para leer").fill("Lunes 10:00 a 12:00 Análisis I");
  await again.getByRole("button", "Leer mi horario").click();
  const second = screen.getByRole("region", "Propuesta para Mi cursada");
  await second.getByRole("button", "Guardar en Mi cursada").click({ timeout: 10_000 });
  await expect(second.getByRole("status")).toContainText("2 materias actualizadas, 2 fechas que ya estaban");
});

test("AC-101 un texto sin horario no inventa nada", async ({ app, screen }) => {
  await openCursada(app, screen);
  await screen.getByRole("button", "Pegar mi horario").first().click();
  await screen.getByLabel("Horario o fechas para leer").fill("hola cómo estás");
  await screen.getByRole("button", "Leer mi horario").click();
  await expect(screen.getByRole("alert")).toContainText("No encontré horarios ni fechas", { timeout: 10_000 });
  await expect(screen.getByRole("region", "Propuesta para Mi cursada")).toHaveCount(0);
});

test("AC-151 el horario desde una foto: se transcribe bloque por bloque y se revisa antes de leerlo", async ({ app, screen, browser }) => {
  await openCursada(app, screen);
  await screen.getByRole("button", "Pegar mi horario").first().click();
  const panel = screen.getByRole("region", "Pegar mi horario");
  await browser.locator('input[aria-label="Leer el horario desde una foto o un PDF"]').setInputFiles("tests/fixtures/foto-guia.png");
  await expect(panel.getByRole("status")).toContainText("Leí foto-guia.png con el modelo", { timeout: 10_000 });
  await expect(panel.getByLabel("Horario o fechas para leer")).toHaveValue(/Lunes 10:00 a 12:00 · Análisis I/);
  await panel.getByRole("button", "Leer mi horario").click();
  await expect(screen.getByRole("region", "Propuesta para Mi cursada")).toContainText("Análisis I", { timeout: 10_000 });
});

test("AC-101 contárselo al asistente en el chat: arma una propuesta que se guarda al confirmar", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByLabel("Mensaje").fill("este es mi horario: lunes de 10 a 12 Análisis con Pérez");
  await screen.getByRole("button", "Enviar").click();

  const card = screen.getByRole("region", "Propuesta para Mi cursada");
  await expect(card).toContainText("2 materias y 2 fechas", { timeout: 30_000 });
  await expect(card).toContainText("Se guarda recién cuando lo confirmás");
  // Nothing is saved until the tap.
  await nav(screen).getByRole("button", "Mi cursada").click();
  await expect(screen.getByRole("region", "Armá tu cursada")).toBeVisible();
  await nav(screen).getByRole("button", /este es mi horario/).click();

  await screen.getByRole("region", "Propuesta para Mi cursada").getByRole("button", "Guardar en Mi cursada").click();
  await screen.getByRole("button", "Abrir Mi cursada").click();
  await expect(screen.getByRole("group", "Horario semanal").getByRole("button", /Análisis I, Lunes/)).toBeVisible();
});

test("AC-103 la Agenda muestra las clases y fechas de Mi cursada", async ({ app, screen }) => {
  await openCursada(app, screen);
  await screen.getByRole("button", "Pegar mi horario").first().click();
  await screen.getByLabel("Horario o fechas para leer").fill("Lunes 10:00 a 12:00 Análisis I");
  await screen.getByRole("button", "Leer mi horario").click();
  await screen.getByRole("region", "Propuesta para Mi cursada").getByRole("button", "Guardar en Mi cursada").click({ timeout: 10_000 });

  await nav(screen).getByRole("button", "Agenda").click();
  const week = screen.getByRole("region", "Semana");
  await expect(week.getByRole("group", "Lunes")).toContainText("Análisis I");
  await expect(week.getByRole("group", "Martes")).toContainText("Física I");
  await expect(screen.getByTestId("week-hours")).toContainText("7 h de clase");
  const dates = screen.getByRole("region", "Próximas fechas");
  await expect(dates).toContainText("TP 1: informe · Física I");
  await expect(dates).toContainText("Primer parcial · Análisis I");
  await dates.getByRole("button", /Primer parcial/).click();
  await expect(screen.getByRole("heading", "Mi cursada")).toBeVisible();
});

test("AC-103 un aviso antes de la clase que cargaste en Mi cursada", async ({ app, screen }) => {
  const soon = new Date(Date.now() + 5 * 60_000);
  test.skip(soon.getDate() !== new Date().getDate(), "cerca de medianoche la clase cae mañana");
  await openCursada(app, screen, "?fastReminders");
  await screen.getByRole("button", "Cargarlo a mano").click();
  await screen.getByRole("button", "Guardar período").click();
  await screen.getByRole("button", "Agregar materia").click();
  await screen.getByLabel("Nombre de la materia").fill("Química Orgánica");
  await screen.getByLabel("Aula habitual").fill("Aula 7");
  await screen.getByRole("button", "+ Agregar horario").click();
  await screen.getByLabel("Día 1").selectOption(DAYS[soon.getDay()][0].toUpperCase() + DAYS[soon.getDay()].slice(1));
  await screen.getByLabel("Desde 1").fill(hhmm(soon));
  await screen.getByLabel("Hasta 1").fill(hhmm(new Date(soon.getTime() + 60_000)) > hhmm(soon) ? hhmm(new Date(soon.getTime() + 60_000)) : "23:59");
  await screen.getByRole("button", "Guardar materia").click();
  await expect(screen.getByText("Clase de Química Orgánica")).toBeVisible({ timeout: 20_000 });
  await expect(screen.getByText(/(En \d+ min|Empieza ahora) \(.*\) · Aula 7/)).toBeVisible();
});
