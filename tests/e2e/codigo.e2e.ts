// features/codigo.feature — AC-53 … AC-55 (web, scripted interpreter; the real
// toolchains are covered by runner.rs tests).
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { goTo } from "./helpers.ts";
import type { App, Screen } from "e2e";

async function openConsole(app: App, screen: Screen, query = "") {
  await app.open(`/${query}`);
  await goTo(screen, "Código");
  await expect(screen.getByTestId("runtime")).toHaveText("Python 3.14.7", { timeout: 20_000 });
}

const editor = (screen: Screen) => screen.getByLabel("Código");
const run = (screen: Screen) => screen.getByRole("button", "Ejecutar").click();

test("AC-53 ejecutar código: salida, errores con su línea, entrada y tiempo límite", async ({ app, screen }) => {
  await openConsole(app, screen);
  await editor(screen).fill('print("hola mundo")');
  await run(screen);
  const out = screen.getByRole("region", "Salida");
  await expect(screen.getByTestId("run-status")).toHaveText(/^Terminó bien/);
  await expect(out).toContainText("hola mundo");

  await editor(screen).fill('print("antes")\nx = 1/0');
  await run(screen);
  await expect(screen.getByTestId("run-status")).toHaveText(/^Terminó con error \(código 1\)/);
  await expect(out).toContainText("ZeroDivisionError");
  await expect(out).toContainText("El error apunta a la línea 2");

  await editor(screen).fill('n = input()\nprint("listo")');
  await screen.getByText("Entrada (stdin)").click();
  await screen.getByLabel("Entrada del programa").fill("Ana");
  await run(screen);
  await expect(out).toContainText("Ana");
  await expect(out).toContainText("listo");

  await editor(screen).fill("while True:\n    pass");
  await run(screen);
  await expect(screen.getByTestId("run-status")).toContainText("Se cortó por tiempo");
});

test("AC-53 Rust que no compila, TypeScript con errores de tipos y lenguaje no instalado", async ({ app, screen }) => {
  await openConsole(app, screen);
  const lang = screen.getByRole("radiogroup", "Lenguaje");
  await lang.getByRole("radio", "Rust").click();
  await expect(screen.getByTestId("runtime")).toHaveText("rustc 1.98.0");
  await editor(screen).fill('fn main() {\n    let x: i32 = "no";\n}');
  await run(screen);
  await expect(screen.getByTestId("run-status")).toHaveText("No compila");
  await expect(screen.getByRole("region", "Salida")).toContainText("E0308");

  await lang.getByRole("radio", "TypeScript").click();
  await editor(screen).fill('const n: number = "a";\nconsole.log("x");');
  await run(screen);
  const diags = screen.getByRole("region", "Errores de tipos");
  await expect(diags).toContainText("Errores de tipos (1)", { timeout: 60_000 });
  await expect(diags).toContainText("línea 1:7");

  await openConsole(app, screen, "?noRust");
  await screen.getByRole("radiogroup", "Lenguaje").getByRole("radio", "Rust").click();
  await expect(screen.getByTestId("runtime")).toHaveText("Rust no está instalado");
  await expect(screen.getByRole("button", "Ejecutar")).toBeDisabled();
});

test("AC-171 diez lenguajes: C++, Java y Go con su compilador, SQL incluido y C# sin instalar", async ({ app, screen }) => {
  await openConsole(app, screen);
  const lang = screen.getByRole("radiogroup", "Lenguaje");
  await expect(lang.getByRole("radio")).toHaveCount(10);
  await lang.getByRole("radio", "C++").click();
  await expect(screen.getByTestId("runtime")).toContainText("g++.exe");
  await expect(editor(screen)).toContainText("std::sort");
  await lang.getByRole("radio", "Java").click();
  await expect(screen.getByTestId("runtime")).toHaveText("java 19.0.2 2023-01-17");
  await expect(editor(screen)).toContainText("public class Main");
  await lang.getByRole("radio", "Go").click();
  await expect(editor(screen)).toContainText("package main");
  await lang.getByRole("radio", "SQL").click();
  await expect(screen.getByTestId("runtime")).toHaveText("SQLite 3.51.0 (incluido en Eureka)");
  await run(screen);
  await expect(screen.getByTestId("run-status")).toHaveText(/^Terminó bien/);

  await openConsole(app, screen, "?noDotnet");
  await screen.getByRole("radiogroup", "Lenguaje").getByRole("radio", "C#").click();
  await expect(screen.getByTestId("runtime")).toHaveText("C# no está instalado");
  await expect(screen.getByRole("button", "Ejecutar")).toBeDisabled();
});

test("AC-54 explicar este error con el profesor", async ({ app, screen }) => {
  await openConsole(app, screen);
  await editor(screen).fill("x = 1/0");
  await run(screen);
  await screen.getByRole("button", "Explicar este error").click();
  await expect(screen.getByTestId("code-answer")).toContainText("dividiste por cero", { timeout: 10_000 });
});

test("AC-55 ejercicio con pruebas ocultas, pistas y solución", async ({ app, screen }) => {
  await openConsole(app, screen);
  await screen.getByLabel("Tema del ejercicio").fill("listas");
  await screen.getByRole("button", "Nuevo ejercicio").click();
  const ex = screen.getByRole("region", "Ejercicio");
  await expect(ex.getByRole("heading", "Pares (listas)")).toBeVisible({ timeout: 10_000 });

  await screen.getByRole("button", "Probar").click();
  await expect(screen.getByTestId("test-verdict")).toContainText("alguna prueba falló");
  await ex.getByRole("button", "Pedir pista (0/3)").click();
  await expect(ex).toContainText("¿Cómo sabés si un número es par?");
  await ex.getByRole("button", "Ver solución").click();
  await expect(ex.getByLabel("Solución")).toContainText("x % 2 == 0");

  await editor(screen).fill("def pares(xs):\n    return [x for x in xs if x % 2 == 0]");
  await screen.getByRole("button", "Probar").click();
  await expect(screen.getByTestId("test-verdict")).toHaveText("¡Pasó todas las pruebas!");
});

test("AC-58 revisar mi código como un senior", async ({ app, screen }) => {
  await openConsole(app, screen);
  await editor(screen).fill("xs = []\nfor i in range(10):\n    xs.append(i * 2)\nprint(xs)");
  const review = screen.getByRole("region", "Revisión de código");
  await review.getByLabel("Qué querés mejorar").fill("estilo");
  await review.getByRole("button", "Revisar mi código").click();
  await expect(screen.getByTestId("code-review")).toContainText("Sobre «estilo»", { timeout: 10_000 });
  await expect(screen.getByTestId("code-review")).toContainText("L1 · Idiomático");
});

test("AC-61 ruta de programación: módulos, sesión por tema y ejercicios que cuentan", async ({ app, screen }) => {
  await app.open("/");
  const nav = screen.getByRole("navigation", "Navegación");
  await nav.getByRole("button", "Exámenes").click({ timeout: 30_000 });
  await screen.getByRole("radio", "Lenguaje de programación").click();
  await screen.getByRole("radiogroup", "Lenguaje de la ruta").getByRole("radio", "Rust").click();
  await screen.getByLabel("Nivel de partida").selectOption("medio");
  await screen.getByLabel("Para qué lo querés").fill("herramientas de línea de comandos");
  await screen.getByRole("button", "Armar ruta de programación").click();
  await expect(screen.getByRole("heading", "Ruta de Rust")).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("region", "Ruta de estudio").getByRole("article")).toHaveCount(3);

  await screen.getByRole("button", "Ejercicio de Variables y tipos").click();
  await expect(screen.getByRole("radiogroup", "Lenguaje").getByRole("radio", "Rust")).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByRole("region", "Ejercicio")).toBeVisible({ timeout: 10_000 });
  await screen.getByRole("button", "Probar").click();
  await expect(screen.getByTestId("test-verdict")).toContainText("alguna prueba falló");
  await screen.getByLabel("Código").fill("def pares(xs):\n    return [x for x in xs if x % 2 == 0]");
  await screen.getByRole("button", "Probar").click();
  await expect(screen.getByTestId("test-verdict")).toHaveText("¡Pasó todas las pruebas!");

  await nav.getByRole("button", "Exámenes").click();
  await expect(screen.getByRole("region", "Exámenes")).toContainText("Programación · 3 módulos");
  await screen.getByRole("button", /^Ruta de Rust/).click();
  await expect(screen.getByRole("article", "Fundamentos")).toContainText("1 ejercicio aprobado", { timeout: 10_000 });
  await screen.getByRole("button", "Estudiar Control de flujo").click();
  await expect(screen.getByRole("heading", "Control de flujo")).toBeVisible({ timeout: 10_000 });
});

test("AC-64 proyecto de varios archivos: plantilla, archivos, ejecutar y tests; proyecto guiado", async ({ app, screen }) => {
  await openConsole(app, screen);
  await screen.getByRole("radiogroup", "Modo").getByRole("radio", "Proyecto").click();
  await screen.getByLabel("Nombre del proyecto").fill("Notas");
  await screen.getByRole("button", "Crear desde plantilla").click();
  const files = screen.getByRole("navigation", "Archivos");
  await expect(files.getByRole("button", "main.py")).toBeVisible();
  await expect(files.getByRole("button", "test_calc.py")).toBeVisible();
  await screen.getByLabel("Nuevo archivo").fill("utils.py");
  await screen.getByRole("button", "Agregar archivo").click();
  await expect(files.getByRole("button", "utils.py")).toHaveAttribute("aria-current", "true");
  await screen.getByLabel("Nuevo archivo").fill("../evil.py");
  await screen.getByRole("button", "Agregar archivo").click();
  await expect(screen.getByRole("alert")).toContainText("Nombre de archivo inválido");

  await screen.getByRole("button", "Probar (tests)").click();
  await expect(screen.getByTestId("project-status")).toHaveText("¡Todas las pruebas pasan!", { timeout: 10_000 });
  await screen.getByRole("button", "Volver a proyectos").click();
  await expect(screen.getByRole("region", "Proyectos")).toContainText(/Notas.*4 archivos/);

  await screen.getByLabel("Tema del proyecto guiado").fill("aritmética");
  await screen.getByRole("button", "Proyecto guiado").click();
  await expect(screen.getByRole("region", "Consigna del proyecto")).toContainText("Arreglá", { timeout: 10_000 });
  await screen.getByRole("button", "Probar (tests)").click();
  await expect(screen.getByTestId("project-status")).toContainText("Terminó con error");
  await expect(screen.getByRole("region", "Salida del proyecto")).toContainText("FAIL: test_suma");
  await screen.getByRole("navigation", "Archivos").getByRole("button", "calc.py").click();
  await screen.getByLabel("Código").fill("def suma(a, b):\n    return a + b\n");
  await screen.getByRole("button", "Probar (tests)").click();
  await expect(screen.getByTestId("project-status")).toHaveText("¡Todas las pruebas pasan!", { timeout: 10_000 });
});
