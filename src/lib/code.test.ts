import { describe, expect, it } from "vitest";
import { errorLines, failed, LANG_IDS, LANGS, runSummary, testsOffset, withTests } from "./code";
import { tsCheck } from "./tsCheck";
import { buildTranscript } from "./transcript";
import { scriptedRun } from "../e2e/codeScript";
import type { RunResult, Session } from "../types";

const run = (over: Partial<RunResult>): RunResult => ({ stdout: "", stderr: "", exit_code: 0, timed_out: false, compile_error: false, duration_ms: 420, ...over });

describe("code console helpers (AC-53)", () => {
  it("finds the lines each toolchain points at", () => {
    expect(errorLines("python", 'Traceback:\n  File "C:\\runs\\x\\main.py", line 3, in <module>\n  File "main.py", line 3\nZeroDivisionError')).toEqual([3]);
    expect(errorLines("rust", "error[E0308]: mismatched types\n --> main.rs:2:18\nerror: x\n --> main.rs:7:1")).toEqual([2, 7]);
    expect(errorLines("javascript", "file:///C:/runs/x/main.js:4\n    throw new Error()")).toEqual([4]);
    expect(errorLines("typescript", "main.ts:9:5 - error")).toEqual([9]);
    expect(errorLines("python", "")).toEqual([]);
  });

  it("summarizes a run", () => {
    expect(runSummary(run({}))).toEqual({ tone: "ok", text: "Terminó bien · 0,42 s" });
    expect(runSummary(run({ exit_code: 1, duration_ms: 1500 }))).toEqual({ tone: "bad", text: "Terminó con error (código 1) · 1,5 s" });
    expect(runSummary(run({ timed_out: true, exit_code: null })).tone).toBe("warn");
    expect(runSummary(run({ compile_error: true, exit_code: 1 })).text).toBe("No compila");
    expect([failed(run({})), failed(run({ exit_code: 2 })), failed(run({ timed_out: true }))]).toEqual([false, true, true]);
  });
});

describe("TypeScript type check in the browser", () => {
  it("reports type errors with line and column, and accepts valid code", async () => {
    const bad = await tsCheck('const n: number = "a";\nconsole.log(n.toFixed(2));\nconst s: string = 1;');
    expect(bad.map((d) => [d.line, d.column])).toEqual([
      [1, 7],
      [3, 7],
    ]);
    expect(bad[0].message).toMatch(/not assignable to type 'number'/);
    expect(await tsCheck("const xs = [1, 2, 3].map((x) => x * 2);\nconsole.log(xs.includes(4));")).toEqual([]);
  }, 60_000);
});

describe("show_code in the transcript", () => {
  it("becomes a code item; unknown languages are skipped", () => {
    const call = (id: string, args: unknown) => ({ id, type: "function", function: { name: "show_code", arguments: JSON.stringify(args) } });
    const s: Session = {
      id: "s",
      title: "t",
      goal: "g",
      phase: "teach",
      created_at: "",
      updated_at: "",
      findings: [],
      plan: [],
      pending_question: null,
      messages: [{ role: "assistant", tool_calls: [call("a", { title: "Hola", language: "rust", code: "fn main(){}", task: "Ejecutalo" }), call("b", { title: "X", language: "cobol", code: "x" })] }],
    };
    expect(buildTranscript(s)).toEqual([{ kind: "code", key: "a", title: "Hola", lang: "rust", code: "fn main(){}", task: "Ejecutalo" }]);
  });
});

describe("the new languages (AC-171)", () => {
  it("finds the lines gcc, javac, dotnet, go and SQLite point at", () => {
    expect(errorLines("c", "main.c: In function 'main':\nmain.c:2:11: error: expected expression before ';' token")).toEqual([2]);
    expect(errorLines("cpp", "main.cpp:4:3: error: 'x' was not declared")).toEqual([4]);
    expect(errorLines("java", "Main.java:3: error: ';' expected\nerror: compilation failed")).toEqual([3]);
    expect(errorLines("java", 'Exception in thread "main" java.lang.ArithmeticException: / by zero\n\tat Main.main(Main.java:5)')).toEqual([5]);
    expect(errorLines("csharp", "D:\\runs\\x\\Program.cs(7,13): error CS1525: Término de expresión no válido")).toEqual([7]);
    expect(errorLines("go", "# command-line-arguments\n./main.go:6:7: syntax error")).toEqual([6]);
    expect(errorLines("sql", "Error en la línea 3: no such column: y")).toEqual([3]);
  });

  it("joins an exercise's tests like the backend, and knows how far they push the lines", () => {
    expect(withTests("java", "class Sol {}", "public class Main {}\n")).toBe("public class Main {}\n\nclass Sol {}\n");
    expect(withTests("c", "int f(void);\n", "int main(void) {}")).toBe("int f(void);\n\nint main(void) {}\n");
    expect(testsOffset("java", "public class Main {\n}")).toBe(4);
    expect(testsOffset("csharp", "if (x) throw new Exception();")).toBe(3);
    expect(testsOffset("c", "int main(void) {}")).toBe(0);
    expect(testsOffset("java", undefined)).toBe(0);
  });

  it("has a runnable starter for each of the ten languages", () => {
    expect(LANG_IDS).toEqual(["python", "javascript", "typescript", "rust", "c", "cpp", "java", "csharp", "go", "sql"]);
    for (const l of LANGS) expect(l.starter.trim().length, l.id).toBeGreaterThan(20);
    expect(LANGS.find((l) => l.id === "java")!.starter).toContain("public class Main");
  });
});

describe("scripted interpreter (browser mock)", () => {
  it("prints literals, echoes input, fails, times out and fails to compile", () => {
    expect(scriptedRun("python", 'n = input("?")\nprint("hola")', "Ana").stdout).toBe("Ana\nhola\n");
    const err = scriptedRun("python", 'print("antes")\nx = 1/0', "");
    expect([err.exit_code, err.stdout, errorLines("python", err.stderr)]).toEqual([1, "antes\n", [2]]);
    expect(scriptedRun("javascript", "while (true) {}", "").timed_out).toBe(true);
    const rs = scriptedRun("rust", 'fn main() {\n    let x: i32 = "no";\n}', "");
    expect([rs.compile_error, errorLines("rust", rs.stderr)]).toEqual([true, [2]]);
  });
});
