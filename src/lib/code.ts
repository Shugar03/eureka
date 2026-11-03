// Code console helpers (AC-53, AC-171): languages, starter code and the line
// numbers that compilers and interpreters point at in their errors.
import type { Lang, RunResult } from "../types";

export const LANGS: { id: Lang; label: string; starter: string }[] = [
  { id: "python", label: "Python", starter: 'nombre = input("¿Cómo te llamás? ")\nprint(f"Hola, {nombre}!")\n' },
  { id: "javascript", label: "JavaScript", starter: 'const nums = [3, 1, 2];\nconsole.log(nums.sort((a, b) => a - b));\n' },
  {
    id: "typescript",
    label: "TypeScript",
    starter: "interface Punto {\n  x: number;\n  y: number;\n}\n\nconst distancia = (p: Punto): number => Math.hypot(p.x, p.y);\nconsole.log(distancia({ x: 3, y: 4 }));\n",
  },
  { id: "rust", label: "Rust", starter: 'fn main() {\n    let nombres = vec!["Ana", "Luis"];\n    for n in &nombres {\n        println!("Hola, {n}!");\n    }\n}\n' },
  { id: "c", label: "C", starter: '#include <stdio.h>\n\nint main(void) {\n    char nombre[64];\n    printf("¿Cómo te llamás? ");\n    scanf("%63s", nombre);\n    printf("Hola, %s!\\n", nombre);\n    return 0;\n}\n' },
  {
    id: "cpp",
    label: "C++",
    starter: '#include <algorithm>\n#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> nums = {3, 1, 2};\n    std::sort(nums.begin(), nums.end());\n    for (int n : nums) std::cout << n << " ";\n    std::cout << "\\n";\n}\n',
  },
  {
    id: "java",
    label: "Java",
    starter: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.print("¿Cómo te llamás? ");\n        String nombre = in.nextLine();\n        System.out.println("Hola, " + nombre + "!");\n    }\n}\n',
  },
  { id: "csharp", label: "C#", starter: 'Console.Write("¿Cómo te llamás? ");\nvar nombre = Console.ReadLine();\nConsole.WriteLine($"Hola, {nombre}!");\n' },
  { id: "go", label: "Go", starter: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tnombres := []string{"Ana", "Luis"}\n\tfor _, n := range nombres {\n\t\tfmt.Printf("Hola, %s!\\n", n)\n\t}\n}\n' },
  {
    id: "sql",
    label: "SQL",
    starter: "CREATE TABLE alumnos (nombre TEXT, nota INTEGER);\nINSERT INTO alumnos VALUES ('Ana', 9), ('Luis', 6), ('Sol', 8);\n\nSELECT nombre, nota FROM alumnos WHERE nota >= 7 ORDER BY nota DESC;\n",
  },
];

/** Every language id, in the console's order (the agent's proposals are checked against it). */
export const LANG_IDS: Lang[] = LANGS.map((l) => l.id);

export const langLabel = (l: Lang) => LANGS.find((x) => x.id === l)?.label ?? l;

const ERROR_LINE: Record<Lang, RegExp> = {
  python: /File "[^"]*main\.py", line (\d+)/g,
  rust: /--> main\.rs:(\d+):\d+/g,
  javascript: /main\.js:(\d+)(?::\d+)?/g,
  typescript: /main\.ts:(\d+)(?::\d+)?/g,
  c: /main\.c:(\d+):/g,
  cpp: /main\.cpp:(\d+):/g,
  // "Main.java:12: error:" when compiling, "(Main.java:12)" in a stack trace.
  java: /Main\.java:(\d+)/g,
  csharp: /Program\.cs\((\d+),\d+\)/g,
  go: /main\.go:(\d+)/g,
  sql: /Error en la línea (\d+)/g,
};

/** Same order as runner::with_tests (Rust): Java and C# put the tests first. */
export function withTests(lang: Lang, code: string, tests: string): string {
  return lang === "java" || lang === "csharp" ? `${tests.trimEnd()}\n\n${code.trimEnd()}\n` : `${code.trimEnd()}\n\n${tests.trimEnd()}\n`;
}

/** Java and C# exercises run with their tests first (AC-171): how many lines come before the learner's code. */
export function testsOffset(lang: Lang, tests: string | undefined): number {
  return tests && (lang === "java" || lang === "csharp") ? tests.trimEnd().split("\n").length + 2 : 0;
}

/** Lines of the learner's file that an error message points at (1-based, unique). */
export function errorLines(lang: Lang, stderr: string): number[] {
  const re = ERROR_LINE[lang];
  return [...new Set([...stderr.matchAll(re)].map((m) => Number(m[1])))];
}

/** One line for the output header. */
export function runSummary(r: RunResult): { tone: "ok" | "bad" | "warn"; text: string } {
  const secs = `${(r.duration_ms / 1000).toFixed(r.duration_ms < 1000 ? 2 : 1)} s`.replace(".", ",");
  if (r.timed_out) return { tone: "warn", text: "Se cortó por tiempo (10 s): ¿un bucle que no termina o espera entrada?" };
  if (r.compile_error) return { tone: "bad", text: "No compila" };
  if (r.exit_code === 0) return { tone: "ok", text: `Terminó bien · ${secs}` };
  return { tone: "bad", text: `Terminó con error (código ${r.exit_code ?? "?"}) · ${secs}` };
}

/** True when the run failed in a way worth explaining. */
export const failed = (r: RunResult) => r.timed_out || r.compile_error || r.exit_code !== 0;
