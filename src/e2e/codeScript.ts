// A tiny scripted "interpreter" for the browser mock (the real app runs the
// learner's toolchains). Enough to drive the console UI deterministically:
//   print("…") / console.log("…") / println!("…") print their string literal,
//   input() / readline lines echo stdin, `1/0` or `throw` fail, an endless
//   `while True` / `while (true)` / `loop {}` times out, a Rust `let x: i32 = "`
//   does not compile, and `return []` in a "pares" exercise fails its tests.
import type { Lang, RunResult } from "../types";

export function scriptedRun(lang: Lang, code: string, stdin: string): RunResult {
  const res = (stdout: string, stderr = "", exit_code: number | null = 0, extra: Partial<RunResult> = {}): RunResult => ({
    stdout,
    stderr,
    exit_code,
    timed_out: false,
    compile_error: false,
    duration_ms: 42,
    ...extra,
  });
  if (/while\s*\(?\s*(true|True)\s*\)?\s*[:{]|loop\s*\{\s*\}/.test(code)) return res("", "", null, { timed_out: true, duration_ms: 10_000 });
  if (lang === "rust" && /let \w+: i32 = "/.test(code)) {
    const line = code.split("\n").findIndex((l) => /let \w+: i32 = "/.test(l)) + 1;
    return res("", `error[E0308]: mismatched types\n --> main.rs:${line}:18\n  |\n  = expected \`i32\`, found \`&str\``, 1, { compile_error: true });
  }
  if (/return \[\]/.test(code) && /assert/.test(code)) return res("", 'Traceback (most recent call last):\n  File "main.py", line 5, in <module>\nAssertionError: pares', 1);

  const inputs = stdin.split("\n");
  const out: string[] = [];
  const lines = code.split("\n");
  for (const [i, l] of lines.entries()) {
    if (/1\s*\/\s*0|throw /.test(l)) {
      const err =
        lang === "python"
          ? `Traceback (most recent call last):\n  File "main.py", line ${i + 1}, in <module>\nZeroDivisionError: division by zero`
          : `main.${lang === "typescript" ? "ts" : "js"}:${i + 1}\nError: falló`;
      return res(out.join("\n") + (out.length ? "\n" : ""), err, 1);
    }
    const name = /(\w+)\s*=\s*input\(/.exec(l);
    if (name) out.push(inputs.shift() ?? "");
    const lit = /(?:print|console\.log|println!)\(\s*(?:f?["'`])(.*?)["'`]/.exec(l);
    if (lit) out.push(lit[1]);
  }
  return res(out.join("\n") + (out.length ? "\n" : ""));
}

export function scriptedExercise(lang: Lang, topic: string) {
  return {
    lang,
    title: `Pares (${topic.trim()})`,
    statement: "Escribí `pares(xs)` que devuelva **solo los números pares** de la lista, en el mismo orden.\n\nEjemplo: `pares([1, 2, 3, 4])` → `[2, 4]`.",
    starter: "def pares(xs):\n    return []\n",
    tests: "assert pares([1, 2, 4]) == [2, 4], 'pares'\nprint('OK')",
    hints: ["¿Cómo sabés si un número es par?", "El resto de dividir por 2…", "`x % 2 == 0`"],
    solution: "def pares(xs):\n    return [x for x in xs if x % 2 == 0]",
  };
}
