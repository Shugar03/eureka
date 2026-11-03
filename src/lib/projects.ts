// AC-64: starter projects per language and helpers for the file list.
import type { Lang, ProjectFile } from "../types";

export const ENTRY: Record<Lang, string> = { python: "main.py", javascript: "main.js", typescript: "main.ts", rust: "Cargo.toml", c: "main.c", cpp: "main.cpp", java: "Main.java", csharp: "Program.cs", go: "main.go", sql: "main.sql" };

/** How each language runs and tests a project (shown on the project screen). */
export const PROJECT_TOOLS: Record<Lang, string> = {
  python: "módulos y unittest",
  javascript: "módulos y node --test",
  typescript: "módulos y node --test",
  rust: "cargo run y cargo test",
  c: "gcc; las pruebas van en archivos test_*.c con su propio main",
  cpp: "g++; las pruebas van en archivos test_*.cpp con su propio main",
  java: "javac; las pruebas van en una clase Tests con su main",
  csharp: "dotnet; las pruebas van en una clase Tests con su static void Main",
  go: "go run y go test (archivos _test.go)",
  sql: "SQLite incluido; las pruebas van en tests.sql con assert(condición, 'mensaje')",
};

export function template(lang: Lang, name: string): ProjectFile[] {
  const crate = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "proyecto";
  switch (lang) {
    case "python":
      return [
        { path: "main.py", content: "from calc import promedio\n\nprint(promedio([7, 8, 9]))\n" },
        { path: "calc.py", content: 'def promedio(notas):\n    """Promedio de una lista no vacía."""\n    return sum(notas) / len(notas)\n' },
        {
          path: "test_calc.py",
          content: "import unittest\nfrom calc import promedio\n\n\nclass TestPromedio(unittest.TestCase):\n    def test_basico(self):\n        self.assertEqual(promedio([7, 8, 9]), 8)\n\n    def test_vacia(self):\n        with self.assertRaises(ValueError):\n            promedio([])\n",
        },
      ];
    case "javascript":
      return [
        { path: "package.json", content: '{\n  "type": "module"\n}\n' },
        { path: "main.js", content: 'import { promedio } from "./calc.js";\n\nconsole.log(promedio([7, 8, 9]));\n' },
        { path: "calc.js", content: "export function promedio(notas) {\n  return notas.reduce((a, b) => a + b, 0) / notas.length;\n}\n" },
        {
          path: "calc.test.js",
          content: 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { promedio } from "./calc.js";\n\ntest("básico", () => assert.equal(promedio([7, 8, 9]), 8));\ntest("vacía", () => assert.throws(() => promedio([])));\n',
        },
      ];
    case "typescript":
      return [
        { path: "main.ts", content: 'import { promedio } from "./calc.ts";\n\nconsole.log(promedio([7, 8, 9]));\n' },
        { path: "calc.ts", content: "export function promedio(notas: number[]): number {\n  return notas.reduce((a, b) => a + b, 0) / notas.length;\n}\n" },
        {
          path: "calc.test.ts",
          content: 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { promedio } from "./calc.ts";\n\ntest("básico", () => assert.equal(promedio([7, 8, 9]), 8));\ntest("vacía", () => assert.throws(() => promedio([])));\n',
        },
      ];
    case "rust":
      return [
        { path: "Cargo.toml", content: `[package]\nname = "${crate}"\nversion = "0.1.0"\nedition = "2021"\n` },
        { path: "src/main.rs", content: `use ${crate}::promedio;\n\nfn main() {\n    println!("{:?}", promedio(&[7.0, 8.0, 9.0]));\n}\n` },
        {
          path: "src/lib.rs",
          content:
            "/// Promedio de las notas; `None` si no hay ninguna.\npub fn promedio(notas: &[f64]) -> Option<f64> {\n    Some(notas.iter().sum::<f64>() / notas.len() as f64)\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn basico() {\n        assert_eq!(promedio(&[7.0, 8.0, 9.0]), Some(8.0));\n    }\n\n    #[test]\n    fn vacia() {\n        assert_eq!(promedio(&[]), None);\n    }\n}\n",
        },
      ];
    case "c":
      return [
        { path: "main.c", content: '#include <stdio.h>\n#include "notas.h"\n\nint main(void) {\n    double notas[] = {7, 8, 9};\n    printf("%.2f\\n", promedio(notas, 3));\n    return 0;\n}\n' },
        { path: "notas.h", content: "/* Promedio de n notas; 0 si no hay ninguna. */\ndouble promedio(const double *notas, int n);\n" },
        { path: "notas.c", content: '#include "notas.h"\n\ndouble promedio(const double *notas, int n) {\n    double suma = 0;\n    for (int i = 0; i < n; i++) suma += notas[i];\n    return suma / n;\n}\n' },
        { path: "test_notas.c", content: '#include <assert.h>\n#include <stdio.h>\n#include "notas.h"\n\nint main(void) {\n    double notas[] = {7, 8, 9};\n    assert(promedio(notas, 3) == 8);\n    assert(promedio(notas, 0) == 0);\n    puts("OK");\n    return 0;\n}\n' },
      ];
    case "cpp":
      return [
        { path: "main.cpp", content: '#include <iostream>\n#include "notas.h"\n\nint main() {\n    std::cout << promedio({7, 8, 9}) << "\\n";\n}\n' },
        { path: "notas.h", content: "#pragma once\n#include <vector>\n\n// Promedio de las notas; 0 si no hay ninguna.\ndouble promedio(const std::vector<double>& notas);\n" },
        { path: "notas.cpp", content: '#include "notas.h"\n#include <numeric>\n\ndouble promedio(const std::vector<double>& notas) {\n    return std::accumulate(notas.begin(), notas.end(), 0.0) / notas.size();\n}\n' },
        { path: "test_notas.cpp", content: '#include <cassert>\n#include <iostream>\n#include "notas.h"\n\nint main() {\n    assert(promedio({7, 8, 9}) == 8);\n    assert(promedio({}) == 0);\n    std::cout << "OK\\n";\n}\n' },
      ];
    case "java":
      return [
        { path: "Main.java", content: "public class Main {\n    public static void main(String[] args) {\n        System.out.println(Notas.promedio(new double[] {7, 8, 9}));\n    }\n}\n" },
        { path: "Notas.java", content: "public class Notas {\n    /** Promedio de las notas; 0 si no hay ninguna. */\n    static double promedio(double[] notas) {\n        double suma = 0;\n        for (double n : notas) suma += n;\n        return suma / notas.length;\n    }\n}\n" },
        {
          path: "Tests.java",
          content: 'public class Tests {\n    static void check(boolean ok, String msg) {\n        if (!ok) throw new AssertionError(msg);\n    }\n\n    public static void main(String[] args) {\n        check(Notas.promedio(new double[] {7, 8, 9}) == 8, "el promedio de 7, 8 y 9 es 8");\n        check(Notas.promedio(new double[] {}) == 0, "sin notas, el promedio es 0");\n        System.out.println("OK");\n    }\n}\n',
        },
      ];
    case "csharp":
      return [
        { path: "Program.cs", content: "class Program\n{\n    static void Main()\n    {\n        Console.WriteLine(Notas.Promedio(new double[] { 7, 8, 9 }));\n    }\n}\n" },
        { path: "Notas.cs", content: "static class Notas\n{\n    /// <summary>Promedio de las notas; 0 si no hay ninguna.</summary>\n    public static double Promedio(double[] notas) => notas.Sum() / notas.Length;\n}\n" },
        {
          path: "Tests.cs",
          content: 'class Tests\n{\n    static void Check(bool ok, string msg)\n    {\n        if (!ok) throw new Exception(msg);\n    }\n\n    static void Main()\n    {\n        Check(Notas.Promedio(new double[] { 7, 8, 9 }) == 8, "el promedio de 7, 8 y 9 es 8");\n        Check(Notas.Promedio(new double[] { }) == 0, "sin notas, el promedio es 0");\n        Console.WriteLine("OK");\n    }\n}\n',
        },
      ];
    case "go":
      return [
        { path: "go.mod", content: `module ${crate}\n\ngo 1.21\n` },
        { path: "main.go", content: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(Promedio([]float64{7, 8, 9}))\n}\n' },
        { path: "notas.go", content: "package main\n\n// Promedio de las notas; 0 si no hay ninguna.\nfunc Promedio(notas []float64) float64 {\n\tsuma := 0.0\n\tfor _, n := range notas {\n\t\tsuma += n\n\t}\n\treturn suma / float64(len(notas))\n}\n" },
        {
          path: "notas_test.go",
          content: 'package main\n\nimport "testing"\n\nfunc TestPromedio(t *testing.T) {\n\tif got := Promedio([]float64{7, 8, 9}); got != 8 {\n\t\tt.Errorf("Promedio(7, 8, 9) = %v; quiero 8", got)\n\t}\n}\n\nfunc TestVacia(t *testing.T) {\n\tif got := Promedio(nil); got != 0 {\n\t\tt.Errorf("Promedio() = %v; quiero 0", got)\n\t}\n}\n',
        },
      ];
    case "sql":
      return [
        { path: "main.sql", content: "CREATE TABLE notas (alumno TEXT, materia TEXT, nota INTEGER);\nINSERT INTO notas VALUES\n  ('Ana', 'Análisis', 9),\n  ('Ana', 'Física', 7),\n  ('Luis', 'Análisis', 3);\n" },
        { path: "consultas.sql", content: "-- Promedio por alumno, de mayor a menor.\nCREATE VIEW promedios AS\n  SELECT alumno, avg(nota) AS promedio FROM notas GROUP BY alumno;\n\nSELECT * FROM promedios ORDER BY promedio DESC;\n" },
        { path: "tests.sql", content: "SELECT assert((SELECT promedio FROM promedios WHERE alumno = 'Ana') = 8, 'el promedio de Ana es 8');\nSELECT assert((SELECT count(*) FROM promedios WHERE promedio < 4) = 0, 'nadie queda con menos de 4');\n" },
      ];
  }
}

/** The editor language for a file (TOML/JSON highlight well enough as JS). */
export function langOfPath(path: string, fallback: Lang): Lang {
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".ts")) return "typescript";
  if (/\.(js|mjs|json)$/.test(path)) return "javascript";
  if (/\.(c|h)$/.test(path)) return fallback === "cpp" ? "cpp" : "c";
  if (/\.(cpp|hpp|cc)$/.test(path)) return "cpp";
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".cs")) return "csharp";
  if (path.endsWith(".go")) return "go";
  if (path.endsWith(".sql")) return "sql";
  return fallback;
}

/** Same rules as project::safe_path (Rust). */
export function safePath(p: string): boolean {
  return !!p && !p.includes("\\") && !p.includes(":") && p.split("/").length <= 3 && p.split("/").every((s) => s && s !== "." && s !== ".." && !s.startsWith("."));
}
