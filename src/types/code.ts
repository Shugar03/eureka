// Code console and multi-file projects.

export type Lang = "python" | "javascript" | "typescript" | "rust" | "c" | "cpp" | "java" | "csharp" | "go" | "sql";

export interface Runtime {
  lang: Lang;
  /** The program that runs it, or null if not installed. */
  program: string | null;
  version: string | null;
}

/** A practice exercise: its tests are appended to the learner's code on "Probar". */
export interface CodeExercise {
  lang: Lang;
  title: string;
  statement: string;
  starter: string;
  tests: string;
  hints: string[];
  solution: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  /** Rust: it didn't compile (stderr has rustc's errors). */
  compile_error: boolean;
  duration_ms: number;
}

// ── Projects (multi-file) ───────────────────────────────────────────────────

export interface ProjectFile {
  path: string;
  content: string;
}

export interface Project {
  id: string;
  name: string;
  lang: Lang;
  files: ProjectFile[];
  statement: string;
  hints: string[];
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  lang: Lang;
  files: number;
  updated_at: string;
}
