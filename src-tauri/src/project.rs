//! Multi-file projects (AC-64, AC-172): a small Cargo crate, a Python
//! package, Node modules, a Go module, Java classes, a C# console project, C
//! or C++ sources, or SQL scripts, run or tested with the language's own tools
//! (`cargo test`, `python -m unittest`, `node --test`, `go test`) or, where the
//! language has none built in, a test program by convention (`Tests` in Java
//! and C#, `test*.c`/`test*.cpp` in C and C++, `test*.sql` in SQL). Same
//! rules as the console: only on the learner's click, a fresh folder per run
//! that is deleted afterwards, time limits and capped output.

use crate::runner::{self, Lang, RunResult, Runtime};
use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

pub const MAX_FILES: usize = 25;
pub const MAX_TOTAL: usize = 400 * 1024;
pub const PROJECT_TIMEOUT: Duration = Duration::from_secs(120);
pub const PROJECT_TOOL: &str = "set_code_project";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub lang: Lang,
    pub files: Vec<ProjectFile>,
    /// What to do (for projects proposed by the teacher).
    #[serde(default)]
    pub statement: String,
    #[serde(default)]
    pub hints: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub lang: Lang,
    pub files: usize,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Run,
    Test,
}

/// Relative paths with normal parts only (`src/lib.rs`), no `..`, no drive
/// letters, no hidden files; at most 3 levels.
pub fn safe_path(p: &str) -> bool {
    let path = Path::new(p);
    !p.is_empty()
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').count() <= 3
        && path.components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')))
}

pub fn validate_files(files: &[ProjectFile]) -> Result<()> {
    if files.is_empty() {
        bail!("El proyecto no tiene archivos.");
    }
    if files.len() > MAX_FILES {
        bail!("Como mucho {MAX_FILES} archivos por proyecto.");
    }
    if files.iter().map(|f| f.content.len()).sum::<usize>() > MAX_TOTAL {
        bail!("El proyecto es demasiado grande.");
    }
    let mut seen = std::collections::HashSet::new();
    for f in files {
        if !safe_path(&f.path) {
            bail!("Nombre de archivo inválido: {}", f.path);
        }
        if !seen.insert(f.path.to_lowercase()) {
            bail!("Archivo repetido: {}", f.path);
        }
    }
    Ok(())
}

/// The entry file each language needs to run.
pub fn entry(lang: Lang) -> &'static str {
    match lang {
        Lang::Python => "main.py",
        Lang::Javascript => "main.js",
        Lang::Typescript => "main.ts",
        Lang::Rust => "Cargo.toml",
        Lang::C => "main.c",
        Lang::Cpp => "main.cpp",
        Lang::Java => "Main.java",
        Lang::Csharp => "Program.cs",
        Lang::Go => "main.go",
        Lang::Sql => "main.sql",
    }
}

/// C, C++ and SQL: the files that are tests by their name (`test_lista.c`, `tests.sql`).
fn is_test(path: &str) -> bool {
    path.rsplit('/').next().is_some_and(|name| name.to_lowercase().starts_with("test"))
}

/// The sources a C or C++ build compiles: the program without its tests, or
/// the tests without `main.c`.
pub fn c_sources(lang: Lang, files: &[ProjectFile], mode: Mode) -> Vec<String> {
    let ext = if lang == Lang::C { ".c" } else { ".cpp" };
    files
        .iter()
        .map(|f| f.path.as_str())
        .filter(|p| p.ends_with(ext))
        .filter(|p| match mode {
            Mode::Run => !is_test(p),
            Mode::Test => *p != entry(lang),
        })
        .map(String::from)
        .collect()
}

/// SQL: the scripts in name order (`main.sql` first), the tests last and only when testing.
pub fn sql_script(files: &[ProjectFile], mode: Mode) -> String {
    let mut scripts: Vec<&ProjectFile> = files.iter().filter(|f| f.path.ends_with(".sql") && (mode == Mode::Test || !is_test(&f.path))).collect();
    scripts.sort_by_key(|f| (is_test(&f.path), f.path != "main.sql", f.path.clone()));
    scripts.iter().map(|f| f.content.trim_end()).collect::<Vec<_>>().join("\n\n")
}

/// The command line for a mode (program, args), for the languages that run
/// in one step (the compiled ones are in `run_compiled`).
pub fn command_line(lang: Lang, mode: Mode, program: &str) -> (String, Vec<String>) {
    let (prog, mut args) = runner::split_program(program);
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match (lang, mode) {
        (Lang::Python, Mode::Run) => args.extend(a(&["-u", "-X", "utf8", "main.py"])),
        (Lang::Python, Mode::Test) => args.extend(a(&["-X", "utf8", "-m", "unittest", "discover", "-v"])),
        (Lang::Javascript, Mode::Run) => args.push("main.js".into()),
        (Lang::Javascript, Mode::Test) => args.push("--test".into()),
        (Lang::Typescript, Mode::Run) => args.extend(a(&["--experimental-strip-types", "--no-warnings", "main.ts"])),
        (Lang::Typescript, Mode::Test) => args.extend(a(&["--experimental-strip-types", "--no-warnings", "--test"])),
        (Lang::Rust, Mode::Run) => return ("cargo".into(), a(&["run", "-q", "--offline"])),
        (Lang::Rust, Mode::Test) => return ("cargo".into(), a(&["test", "-q", "--offline"])),
        (Lang::Go, Mode::Test) => args.extend(a(&["test", "./..."])),
        (Lang::Go, Mode::Run) | (Lang::C | Lang::Cpp | Lang::Java | Lang::Csharp | Lang::Sql, _) => unreachable!("compiled in run_compiled"),
    }
    (prog, args)
}

pub async fn run(runtimes: &[Runtime], runs_dir: &Path, lang: Lang, files: &[ProjectFile], mode: Mode, stdin: &str) -> Result<RunResult> {
    validate_files(files)?;
    if !files.iter().any(|f| f.path == entry(lang)) {
        bail!("Falta {} en el proyecto.", entry(lang));
    }
    let started = Instant::now();
    if lang == Lang::Sql {
        let r = crate::sql::run(&sql_script(files, mode), runner::RUN_TIMEOUT).await?;
        return Ok(RunResult { duration_ms: started.elapsed().as_millis() as u64, ..r });
    }
    let program = runner::program_for(runtimes, lang)?;
    let dir: PathBuf = runs_dir.join(uuid::Uuid::new_v4().simple().to_string());
    for f in files {
        let target = dir.join(&f.path);
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(target, &f.content).await?;
    }
    let result = match (lang, mode) {
        (Lang::C | Lang::Cpp | Lang::Java | Lang::Csharp, _) | (Lang::Go, Mode::Run) => run_compiled(runtimes, &dir, &program, lang, files, mode, stdin).await,
        _ => {
            if lang == Lang::Go {
                ensure_go_mod(&dir, files).await?;
            }
            let (prog, args) = command_line(lang, mode, &program);
            let mut cmd = runner::command(&prog);
            cmd.args(&args).env("PYTHONIOENCODING", "utf-8").env("CARGO_TARGET_DIR", dir.join("target")).env("CARGO_TERM_COLOR", "never");
            let limit = if matches!(lang, Lang::Rust | Lang::Go) { PROJECT_TIMEOUT } else { runner::RUN_TIMEOUT * 2 };
            runner::exec(cmd, &dir, stdin, limit).await.map(|(o, e, code, t)| {
                // cargo prints "could not compile"; go test, "[build failed]".
                let compile_error = (lang == Lang::Rust && e.contains("could not compile")) || (lang == Lang::Go && format!("{o}{e}").contains("[build failed]"));
                (o, e, code, t, compile_error)
            })
        }
    };
    let _ = tokio::fs::remove_dir_all(&dir).await;
    let (stdout, stderr, exit_code, timed_out, compile_error) = result?;
    Ok(RunResult { stdout, stderr, exit_code, timed_out, compile_error, duration_ms: started.elapsed().as_millis() as u64 })
}

/// A Go project without its `go.mod` gets one (a module with no dependencies).
async fn ensure_go_mod(dir: &Path, files: &[ProjectFile]) -> Result<()> {
    if !files.iter().any(|f| f.path == "go.mod") {
        tokio::fs::write(dir.join("go.mod"), "module proyecto\n\ngo 1.21\n").await?;
    }
    Ok(())
}

/// Build first (its own time limit, errors marked as such), then run the program or the tests.
async fn run_compiled(runtimes: &[Runtime], dir: &Path, program: &str, lang: Lang, files: &[ProjectFile], mode: Mode, stdin: &str) -> Result<(String, String, Option<i32>, bool, bool)> {
    let exe = |name: &str| runner::command(&dir.join(name).to_string_lossy());
    match lang {
        Lang::C | Lang::Cpp => {
            let sources = c_sources(lang, files, mode);
            if sources.is_empty() {
                bail!("No hay archivos {} para compilar.", if lang == Lang::C { ".c" } else { ".cpp" });
            }
            let mut cc = runner::command(program);
            cc.args([if lang == Lang::C { "-std=c17" } else { "-std=c++20" }, "-Wall", "-O0", "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-I", ".", "-o", "app.exe"]).args(&sources);
            if lang == Lang::C {
                cc.arg("-lm");
            }
            runner::compile_then_run(dir, cc, exe("app.exe"), stdin, false).await
        }
        Lang::Go => {
            ensure_go_mod(dir, files).await?;
            let mut build = runner::command(program);
            build.args(["build", "-o", "app.exe", "."]);
            runner::compile_then_run(dir, build, exe("app.exe"), stdin, false).await
        }
        Lang::Java => {
            let sources: Vec<&str> = files.iter().map(|f| f.path.as_str()).filter(|p| p.ends_with(".java")).collect();
            let mut javac = runner::command("javac");
            javac.args(["-encoding", "UTF-8", "-d", "out"]).args(&sources);
            let main = if mode == Mode::Test { "Tests" } else { "Main" };
            if mode == Mode::Test && !files.iter().any(|f| f.path.ends_with("Tests.java")) {
                bail!("Para probar, el proyecto necesita Tests.java (una clase Tests con su main).");
            }
            let mut java = runner::command(program);
            java.args(["-ea", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-cp", "out", main]);
            runner::compile_then_run(dir, javac, java, stdin, false).await
        }
        Lang::Csharp => {
            if !files.iter().any(|f| f.path.ends_with(".csproj")) {
                tokio::fs::write(dir.join("main.csproj"), runner::csproj(&runner::target_framework(runtimes))).await?;
            }
            tokio::fs::write(dir.join(runner::CSHARP_UTF8.0), runner::CSHARP_UTF8.1).await?;
            if mode == Mode::Test && !files.iter().any(|f| f.path.ends_with("Tests.cs")) {
                bail!("Para probar, el proyecto necesita Tests.cs (una clase Tests con su static void Main).");
            }
            let startup = if mode == Mode::Test { "Tests" } else { "Program" };
            let mut build = runner::command(program);
            build.args(["build", "-o", "out", "-nologo", "-v", "q", "-clp:NoSummary", "-p:UseSharedCompilation=false", "-nodeReuse:false", &format!("-p:StartupObject={startup}")]);
            runner::compile_then_run(dir, build, runner::dotnet_program(dir, "out/main.exe", program), stdin, true).await
        }
        _ => unreachable!("one-step languages run in `run`"),
    }
}

// ── Projects proposed by the teacher (TDD) ────────────────────────────────

pub fn project_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": PROJECT_TOOL,
        "description": "Entrega el mini proyecto.",
        "parameters": { "type": "object", "properties": {
            "title": { "type": "string" },
            "statement": { "type": "string", "description": "Consigna en Markdown: qué construir y cómo saber que está listo." },
            "files": { "type": "array", "items": { "type": "object", "properties": {
                "path": { "type": "string" }, "content": { "type": "string" }
            }, "required": ["path", "content"] } },
            "hints": { "type": "array", "items": { "type": "string" } }
        }, "required": ["title", "statement", "files", "hints"] }
    }})
}

pub fn project_input(lang: Lang, topic: &str, level: &str) -> String {
    format!("Lenguaje: {}\nTema: {}\nNivel: {}\nArchivo de entrada obligatorio: {}\n", lang.label(), topic.trim(), level.trim(), entry(lang))
}

pub fn validate_project(raw: &str, lang: Lang) -> Result<Project> {
    #[derive(Deserialize)]
    struct Raw {
        title: String,
        statement: String,
        files: Vec<ProjectFile>,
        #[serde(default)]
        hints: Vec<String>,
    }
    let r: Raw = serde_json::from_str(raw).context("el autor de proyectos devolvió datos inválidos")?;
    let files: Vec<ProjectFile> = r.files.into_iter().map(|f| ProjectFile { path: f.path.trim().trim_start_matches("./").to_string(), content: f.content }).collect();
    validate_files(&files)?;
    if r.title.trim().is_empty() || !files.iter().any(|f| f.path == entry(lang)) {
        return Err(anyhow!("El proyecto llegó incompleto (falta {}). Probá de nuevo.", entry(lang)));
    }
    Ok(Project {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name: r.title.trim().chars().take(80).collect(),
        lang,
        files,
        statement: r.statement.trim().to_string(),
        hints: r.hints.into_iter().map(|h| h.trim().to_string()).filter(|h| !h.is_empty()).take(3).collect(),
        updated_at: Utc::now(),
    })
}

// ── Store ──────────────────────────────────────────────────────────────────

pub struct ProjectStore {
    dir: PathBuf,
}

impl ProjectStore {
    pub fn new(data_dir: &Path) -> Self {
        Self { dir: data_dir.join("projects") }
    }

    fn path(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn load(&self, id: &str) -> Result<Project> {
        Ok(serde_json::from_str(&std::fs::read_to_string(self.path(id)).context("proyecto no encontrado")?)?)
    }

    pub fn save(&self, p: &mut Project) -> Result<()> {
        if p.name.trim().is_empty() {
            bail!("Poné un nombre al proyecto.");
        }
        validate_files(&p.files)?;
        p.updated_at = Utc::now();
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.path(&p.id).with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(p)?)?;
        std::fs::rename(tmp, self.path(&p.id))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        std::fs::remove_file(self.path(id))?;
        Ok(())
    }

    pub fn list(&self) -> Vec<ProjectSummary> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<ProjectSummary> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Project>(&raw).ok())
            .map(|p| ProjectSummary { id: p.id, name: p.name, lang: p.lang, files: p.files.len(), updated_at: p.updated_at })
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, content: &str) -> ProjectFile {
        ProjectFile { path: path.into(), content: content.into() }
    }

    #[test]
    fn paths_stay_inside_the_project() {
        for ok in ["main.py", "src/lib.rs", "tests/a/b.rs", "Cargo.toml"] {
            assert!(safe_path(ok), "{ok}");
        }
        for bad in ["", "../x", "src/../../x", "/etc/x", "C:/x", "a\\b", ".env", "src/.hidden", "a/b/c/d.rs"] {
            assert!(!safe_path(bad), "{bad}");
        }
        assert!(validate_files(&[f("main.py", ""), f("MAIN.py", "")]).unwrap_err().to_string().contains("repetido"));
        assert!(validate_files(&[]).is_err());
        assert!(validate_files(&(0..26).map(|i| f(&format!("f{i}.py"), "")).collect::<Vec<_>>()).is_err());
    }

    #[test]
    fn each_language_uses_its_own_tools() {
        assert_eq!(command_line(Lang::Python, Mode::Test, "py -3"), ("py".into(), ["-3", "-X", "utf8", "-m", "unittest", "discover", "-v"].map(String::from).to_vec()));
        assert_eq!(command_line(Lang::Typescript, Mode::Test, "node").1, ["--experimental-strip-types", "--no-warnings", "--test"]);
        assert_eq!(command_line(Lang::Rust, Mode::Test, "rustc"), ("cargo".into(), vec!["test".into(), "-q".into(), "--offline".into()]));
        assert_eq!(command_line(Lang::Javascript, Mode::Run, "node").1, ["main.js"]);
        assert_eq!(command_line(Lang::Go, Mode::Test, "go").1, ["test", "./..."]);
    }

    #[test]
    fn c_and_sql_tests_are_found_by_their_name() {
        let files = [f("main.c", ""), f("lista.c", ""), f("lista.h", ""), f("test_lista.c", ""), f("notas.txt", "")];
        assert_eq!(c_sources(Lang::C, &files, Mode::Run), ["main.c", "lista.c"]);
        assert_eq!(c_sources(Lang::C, &files, Mode::Test), ["lista.c", "test_lista.c"]);
        let sql = [f("tests.sql", "SELECT 3;"), f("datos.sql", "SELECT 2;"), f("main.sql", "SELECT 1;")];
        assert_eq!(sql_script(&sql, Mode::Run), "SELECT 1;\n\nSELECT 2;");
        assert_eq!(sql_script(&sql, Mode::Test), "SELECT 1;\n\nSELECT 2;\n\nSELECT 3;");
        for l in Lang::ALL {
            assert!(!entry(l).is_empty());
        }
    }

    #[test]
    fn proposed_projects_are_validated() {
        let raw = json!({ "title": "Calculadora", "statement": "Hacé pasar los tests.", "files": [{ "path": "./main.py", "content": "print(1)" }, { "path": "test_calc.py", "content": "" }], "hints": ["a", " "] }).to_string();
        let p = validate_project(&raw, Lang::Python).unwrap();
        assert_eq!((p.name.as_str(), p.files[0].path.as_str(), p.hints.len()), ("Calculadora", "main.py", 1));
        let no_entry = json!({ "title": "X", "statement": "s", "files": [{ "path": "calc.py", "content": "" }], "hints": [] }).to_string();
        assert!(validate_project(&no_entry, Lang::Python).unwrap_err().to_string().contains("main.py"));
        let evil = json!({ "title": "X", "statement": "s", "files": [{ "path": "../../x.py", "content": "" }], "hints": [] }).to_string();
        assert!(validate_project(&evil, Lang::Python).is_err());
    }

    fn runs_dir() -> PathBuf {
        std::env::temp_dir().join(format!("la-proj-{}", uuid::Uuid::new_v4().simple()))
    }

    #[tokio::test]
    async fn a_python_package_runs_and_its_tests_fail_then_pass() {
        let rts = runner::detect().await;
        if runner::program_for(&rts, Lang::Python).is_err() {
            return;
        }
        let calc_bad = "def suma(a, b):\n    return a - b\n";
        let test = "import unittest\nfrom calc import suma\n\nclass T(unittest.TestCase):\n    def test_suma(self):\n        self.assertEqual(suma(2, 3), 5)\n";
        let files = |calc: &str| vec![f("main.py", "from calc import suma\nprint(suma(2, 3))"), f("calc.py", calc), f("test_calc.py", test)];
        let dir = runs_dir();
        let r = run(&rts, &dir, Lang::Python, &files(calc_bad), Mode::Run, "").await.unwrap();
        assert_eq!(r.stdout.trim(), "-1");
        let r = run(&rts, &dir, Lang::Python, &files(calc_bad), Mode::Test, "").await.unwrap();
        assert_eq!(r.exit_code, Some(1));
        assert!(r.stderr.contains("FAIL: test_suma"), "{}", r.stderr);
        let r = run(&rts, &dir, Lang::Python, &files("def suma(a, b):\n    return a + b\n"), Mode::Test, "").await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
        assert!(r.stderr.contains("OK"));
    }

    #[tokio::test]
    async fn node_test_runner_finds_test_files() {
        let rts = runner::detect().await;
        if runner::program_for(&rts, Lang::Typescript).is_err() {
            return;
        }
        let files = vec![
            f("main.ts", "import { doble } from \"./calc.ts\";\nconsole.log(doble(21));"),
            f("calc.ts", "export const doble = (n: number): number => n * 2;\n"),
            f("calc.test.ts", "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { doble } from \"./calc.ts\";\ntest(\"doble\", () => assert.equal(doble(2), 4));\n"),
        ];
        let dir = runs_dir();
        let r = run(&rts, &dir, Lang::Typescript, &files, Mode::Run, "").await.unwrap();
        assert_eq!(r.stdout.trim(), "42", "{}", r.stderr);
        let r = run(&rts, &dir, Lang::Typescript, &files, Mode::Test, "").await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}{}", r.stdout, r.stderr);
        assert!(r.stdout.contains("pass 1"), "{}", r.stdout);
    }

    /// AC-172: each project runs, then its tests fail with the bug and pass with the fix.
    async fn check_project(lang: Lang, files: impl Fn(&str) -> Vec<ProjectFile>, bug: &str, fix: &str, prints: &str) {
        let rts = runner::detect().await;
        if runner::program_for(&rts, lang).is_err() {
            eprintln!("{} no está instalado en esta PC: se saltea", lang.label());
            return;
        }
        let dir = runs_dir();
        let r = run(&rts, &dir, lang, &files(fix), Mode::Run, "").await.unwrap();
        assert!(r.exit_code == Some(0) && r.stdout.contains(prints), "{} run: {}{}", lang.label(), r.stdout, r.stderr);
        let r = run(&rts, &dir, lang, &files(bug), Mode::Test, "").await.unwrap();
        assert!(r.exit_code != Some(0) && !r.compile_error, "{} test with the bug: {}{}", lang.label(), r.stdout, r.stderr);
        let r = run(&rts, &dir, lang, &files(fix), Mode::Test, "").await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{} test with the fix: {}{}", lang.label(), r.stdout, r.stderr);
        assert!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) == 0, "run folders are deleted");
    }

    #[tokio::test]
    async fn a_go_module_runs_and_tests() {
        check_project(
            Lang::Go,
            |body| vec![f("main.go", "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(Suma(2, 3)) }\n"), f("calc.go", &format!("package main\n\nfunc Suma(a, b int) int {{ {body} }}\n")), f("calc_test.go", "package main\n\nimport \"testing\"\n\nfunc TestSuma(t *testing.T) {\n\tif Suma(2, 3) != 5 {\n\t\tt.Fatal(\"Suma(2, 3) debería dar 5\")\n\t}\n}\n")],
            "return a - b",
            "return a + b",
            "5",
        )
        .await;
    }

    #[tokio::test]
    async fn java_classes_run_and_tests() {
        check_project(
            Lang::Java,
            |body| vec![f("Main.java", "public class Main { public static void main(String[] a) { System.out.println(Calc.suma(2, 3)); } }\n"), f("Calc.java", &format!("public class Calc {{ static int suma(int a, int b) {{ {body} }} }}\n")), f("Tests.java", "public class Tests { public static void main(String[] a) { if (Calc.suma(2, 3) != 5) throw new AssertionError(\"suma(2, 3) debería dar 5\"); System.out.println(\"OK\"); } }\n")],
            "return a - b;",
            "return a + b;",
            "5",
        )
        .await;
    }

    #[tokio::test]
    async fn c_sources_build_and_tests() {
        check_project(
            Lang::C,
            |body| vec![f("main.c", "#include <stdio.h>\n#include \"calc.h\"\nint main(void) { printf(\"%d\\n\", suma(2, 3)); return 0; }\n"), f("calc.h", "int suma(int a, int b);\n"), f("calc.c", &format!("#include \"calc.h\"\nint suma(int a, int b) {{ {body} }}\n")), f("test_calc.c", "#include <assert.h>\n#include \"calc.h\"\nint main(void) { assert(suma(2, 3) == 5); return 0; }\n")],
            "return a - b;",
            "return a + b;",
            "5",
        )
        .await;
    }

    #[tokio::test]
    async fn cpp_sources_build_and_tests() {
        check_project(
            Lang::Cpp,
            |body| vec![f("main.cpp", "#include <iostream>\n#include \"calc.h\"\nint main() { std::cout << suma(2, 3) << \"\\n\"; }\n"), f("calc.h", "int suma(int a, int b);\n"), f("calc.cpp", &format!("#include \"calc.h\"\nint suma(int a, int b) {{ {body} }}\n")), f("test_calc.cpp", "#include <cassert>\n#include \"calc.h\"\nint main() { assert(suma(2, 3) == 5); }\n")],
            "return a - b;",
            "return a + b;",
            "5",
        )
        .await;
    }

    #[tokio::test]
    async fn a_csharp_project_builds_and_tests() {
        check_project(
            Lang::Csharp,
            |body| vec![f("Program.cs", "class Program { static void Main() { System.Console.WriteLine(Calc.Suma(2, 3)); } }\n"), f("Calc.cs", &format!("static class Calc {{ public static int Suma(int a, int b) {{ {body} }} }}\n")), f("Tests.cs", "class Tests { static void Main() { if (Calc.Suma(2, 3) != 5) throw new System.Exception(\"Suma(2, 3) debería dar 5\"); System.Console.WriteLine(\"OK\"); } }\n")],
            "return a - b;",
            "return a + b;",
            "5",
        )
        .await;
    }

    #[tokio::test]
    async fn sql_scripts_run_and_tests() {
        check_project(
            Lang::Sql,
            |filter| vec![f("main.sql", "CREATE TABLE notas (alumno TEXT, nota INTEGER);\nINSERT INTO notas VALUES ('Ana', 9), ('Luis', 3);\n"), f("consulta.sql", &format!("CREATE VIEW aprobados AS SELECT alumno FROM notas WHERE {filter};\nSELECT * FROM aprobados;\n")), f("tests.sql", "SELECT assert((SELECT count(*) FROM aprobados) = 1, 'aprueba solo Ana');\n")],
            "nota >= 0",
            "nota >= 4",
            "Ana",
        )
        .await;
    }

    #[tokio::test]
    async fn a_cargo_crate_builds_and_tests() {
        let rts = runner::detect().await;
        if runner::program_for(&rts, Lang::Rust).is_err() {
            return;
        }
        let files = vec![
            f("Cargo.toml", "[package]\nname = \"calc\"\nversion = \"0.1.0\"\nedition = \"2021\"\n"),
            f("src/lib.rs", "pub fn suma(a: i32, b: i32) -> i32 { a + b }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn suma() { assert_eq!(super::suma(2, 3), 5); }\n}\n"),
            f("src/main.rs", "fn main() { println!(\"{}\", calc::suma(2, 3)); }\n"),
        ];
        let dir = runs_dir();
        let r = run(&rts, &dir, Lang::Rust, &files, Mode::Run, "").await.unwrap();
        assert_eq!(r.stdout.trim(), "5", "{}", r.stderr);
        let r = run(&rts, &dir, Lang::Rust, &files, Mode::Test, "").await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
        let broken = vec![files[0].clone(), f("src/main.rs", "fn main() { let x: i32 = \"no\"; }\n")];
        let r = run(&rts, &dir, Lang::Rust, &broken, Mode::Run, "").await.unwrap();
        assert!(r.compile_error, "{}", r.stderr);
        assert!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) == 0, "run folders are deleted");
    }
}
