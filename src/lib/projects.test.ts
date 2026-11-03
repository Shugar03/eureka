import { describe, expect, it } from "vitest";
import { ENTRY, langOfPath, safePath, template } from "./projects";
import type { Lang } from "../types";

describe("project templates (AC-64)", () => {
  it("every template has its entry file, tests and safe paths", () => {
    for (const lang of ["python", "javascript", "typescript", "rust", "c", "cpp", "java", "csharp", "go", "sql"] as Lang[]) {
      const files = template(lang, "Notas del Curso");
      expect(files.map((f) => f.path)).toContain(ENTRY[lang]);
      expect(files.every((f) => safePath(f.path))).toBe(true);
      expect(files.some((f) => /test/i.test(f.path + f.content)), lang).toBe(true);
    }
    expect(template("rust", "Notas del Curso")[0].content).toContain('name = "notas_del_curso"');
    expect(template("rust", "¡¡")[0].content).toContain('name = "proyecto"');
  });

  it("picks the editor language by extension and rejects unsafe paths", () => {
    expect(["a.py", "src/lib.rs", "x.ts", "package.json", "Cargo.toml"].map((p) => langOfPath(p, "rust"))).toEqual(["python", "rust", "typescript", "javascript", "rust"]);
    for (const bad of ["", "../x", String.raw`a\b`, "C:/x", ".env", "a/b/c/d.py", "a//b"]) expect(safePath(bad), bad).toBe(false);
    expect(safePath("src/modelo.rs")).toBe(true);
    // AC-172: a header follows the project's language.
    expect(["lista.h", "lista.c", "Main.java", "Tests.cs", "x_test.go", "tests.sql"].map((p) => langOfPath(p, "cpp"))).toEqual(["cpp", "cpp", "java", "csharp", "go", "sql"]);
    expect(langOfPath("lista.h", "c")).toBe("c");
  });
});
