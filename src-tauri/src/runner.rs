//! Code console (AC-53, AC-171): runs the learner's Python, JavaScript,
//! TypeScript, Rust, C, C++, Java, C#, Go or SQL with the toolchains installed
//! on this PC (SQL runs on the SQLite built into Eureka). Only on an explicit
//! "Run" from the UI — no agent tool can execute code. Each run gets its own
//! folder under the data dir (deleted afterwards), a time limit for compiling
//! and another for running, capped output and no console window.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

pub const RUN_TIMEOUT: Duration = Duration::from_secs(10);
pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(90);
pub const MAX_OUTPUT: usize = 64 * 1024;
pub const MAX_CODE: usize = 200 * 1024;
pub const MAX_STDIN: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Python,
    Javascript,
    Typescript,
    Rust,
    C,
    Cpp,
    Java,
    Csharp,
    Go,
    Sql,
}

impl Lang {
    pub const ALL: [Lang; 10] = [Lang::Python, Lang::Javascript, Lang::Typescript, Lang::Rust, Lang::C, Lang::Cpp, Lang::Java, Lang::Csharp, Lang::Go, Lang::Sql];

    /// The id the screens and the agent's tools use (the serde name).
    pub fn id(self) -> &'static str {
        match self {
            Lang::Python => "python",
            Lang::Javascript => "javascript",
            Lang::Typescript => "typescript",
            Lang::Rust => "rust",
            Lang::C => "c",
            Lang::Cpp => "cpp",
            Lang::Java => "java",
            Lang::Csharp => "csharp",
            Lang::Go => "go",
            Lang::Sql => "sql",
        }
    }

    /// How people write it: what the models and the decks read.
    pub fn label(self) -> &'static str {
        match self {
            Lang::Python => "Python",
            Lang::Javascript => "JavaScript",
            Lang::Typescript => "TypeScript",
            Lang::Rust => "Rust",
            Lang::C => "C",
            Lang::Cpp => "C++",
            Lang::Java => "Java",
            Lang::Csharp => "C#",
            Lang::Go => "Go",
            Lang::Sql => "SQL",
        }
    }

    pub fn from_id(id: &str) -> Option<Lang> {
        Self::ALL.into_iter().find(|l| l.id() == id)
    }

    /// Every id, for the agent tools' schemas and checks.
    pub fn ids() -> Vec<&'static str> {
        Self::ALL.iter().map(|l| l.id()).collect()
    }

    pub fn file(self) -> &'static str {
        match self {
            Lang::Python => "main.py",
            Lang::Javascript => "main.js",
            Lang::Typescript => "main.ts",
            Lang::Rust => "main.rs",
            Lang::C => "main.c",
            Lang::Cpp => "main.cpp",
            Lang::Java => "Main.java",
            Lang::Csharp => "Program.cs",
            Lang::Go => "main.go",
            Lang::Sql => "main.sql",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Runtime {
    pub lang: Lang,
    /// The program that runs it ("py -3", "node", "gcc", a dotnet path…), if found.
    pub program: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    /// Compiled languages: the code didn't compile (stderr has the compiler's errors).
    pub compile_error: bool,
    pub duration_ms: u64,
}

pub(crate) fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    // Go: never reach the network for a toolchain or a module.
    c.env("GOTOOLCHAIN", "local").env("GOPROXY", "off").env("GOFLAGS", "-mod=mod");
    // .NET: no banner, no telemetry, no first-run setup, no build servers left behind.
    c.env("DOTNET_NOLOGO", "1").env("DOTNET_CLI_TELEMETRY_OPTOUT", "1").env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1").env("MSBUILDDISABLENODEREUSE", "1").env("DOTNET_CLI_UI_LANGUAGE", "es");
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flashing for each run.
        c.creation_flags(0x0800_0000);
    }
    c
}

/// The first non-empty line `program args…` prints, if it runs and succeeds.
/// (On Windows, `python` may be the Microsoft Store stub, which fails this.)
async fn first_line(program: &str, args: &[&str]) -> Option<String> {
    let out = tokio::time::timeout(Duration::from_secs(8), command(program).args(args).output()).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    let text = if out.stdout.is_empty() { out.stderr } else { out.stdout };
    String::from_utf8_lossy(&text).lines().map(str::trim).find(|l| !l.is_empty()).map(String::from)
}

async fn version_of(program: &str, args: &[&str]) -> Option<String> {
    first_line(program, &[args, &["--version"]].concat()).await
}

/// The first of `candidates` that answers `--version`.
async fn first_of(candidates: &[&str]) -> (Option<String>, Option<String>) {
    for p in candidates {
        if let Some(v) = version_of(p, &[]).await {
            return (Some(p.to_string()), Some(v));
        }
    }
    (None, None)
}

/// Python candidates in order: the launcher, then the usual names.
const PYTHONS: [(&str, &[&str]); 3] = [("py", &["-3"]), ("python", &[]), ("python3", &[])];

/// The .NET SDK: DOTNET_ROOT first (an SDK installed outside Program Files),
/// then `dotnet` on the PATH, which may be a host with no SDK at all.
async fn dotnet() -> (Option<String>, Option<String>) {
    let mut candidates: Vec<String> = std::env::var_os("DOTNET_ROOT").map(|r| PathBuf::from(r).join("dotnet.exe").to_string_lossy().into_owned()).into_iter().collect();
    candidates.push("dotnet".into());
    for c in candidates {
        let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(8), command(&c).arg("--list-sdks").output()).await else { continue };
        // "10.0.403 [D:\dev-tools\dotnet\sdk]": the newest is last.
        let sdks = String::from_utf8_lossy(&out.stdout).into_owned();
        if let Some(v) = sdks.lines().filter_map(|l| l.split_whitespace().next()).filter(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit())).last() {
            return (Some(c), Some(v.to_string()));
        }
    }
    (None, None)
}

pub async fn detect() -> Vec<Runtime> {
    // A phone has no compilers or interpreters to find: only the bundled SQLite runs.
    #[cfg(mobile)]
    return Lang::ALL.map(|lang| if lang == Lang::Sql { sqlite() } else { Runtime { lang, program: None, version: None } }).to_vec();
    #[cfg(desktop)]
    detect_installed().await
}

fn sqlite() -> Runtime {
    Runtime { lang: Lang::Sql, program: Some("sqlite".into()), version: Some(format!("SQLite {} (incluido en Eureka)", rusqlite::version())) }
}

#[cfg(desktop)]
async fn detect_installed() -> Vec<Runtime> {
    let mut python = (None, None);
    for (p, args) in PYTHONS {
        if let Some(v) = version_of(p, args).await {
            python = (Some(if args.is_empty() { p.to_string() } else { format!("{p} {}", args.join(" ")) }), Some(v));
            break;
        }
    }
    let node = version_of("node", &[]).await;
    let rustc = version_of("rustc", &[]).await;
    let c = first_of(&["gcc", "clang"]).await;
    let cpp = first_of(&["g++", "clang++"]).await;
    // Java needs the JDK: running a source file compiles it with javac's compiler.
    let java = match first_line("javac", &["-version"]).await {
        Some(_) => version_of("java", &[]).await,
        None => None,
    };
    let go = first_line("go", &["version"]).await;
    let (dotnet, sdk) = dotnet().await;
    vec![
        Runtime { lang: Lang::Python, program: python.0, version: python.1 },
        Runtime { lang: Lang::Javascript, program: node.as_ref().map(|_| "node".into()), version: node.clone() },
        Runtime { lang: Lang::Typescript, program: node.as_ref().map(|_| "node".into()), version: node.map(|v| format!("{v} (tipos quitados por Node)")) },
        Runtime { lang: Lang::Rust, program: rustc.as_ref().map(|_| "rustc".into()), version: rustc },
        Runtime { lang: Lang::C, program: c.0, version: c.1 },
        Runtime { lang: Lang::Cpp, program: cpp.0, version: cpp.1 },
        Runtime { lang: Lang::Java, program: java.as_ref().map(|_| "java".into()), version: java },
        Runtime { lang: Lang::Csharp, program: dotnet, version: sdk.map(|v| format!(".NET SDK {v}")) },
        Runtime { lang: Lang::Go, program: go.as_ref().map(|_| "go".into()), version: go },
        sqlite(),
    ]
}

/// Reads at most MAX_OUTPUT bytes, then stops (a runaway print loop then
/// blocks on a full pipe until the time limit kills it).
async fn read_capped<R: tokio::io::AsyncRead + Unpin>(r: Option<R>) -> String {
    let Some(r) = r else { return String::new() };
    let mut buf = Vec::new();
    let _ = r.take(MAX_OUTPUT as u64 + 1).read_to_end(&mut buf).await;
    let cut = buf.len() > MAX_OUTPUT;
    buf.truncate(MAX_OUTPUT);
    let mut s = String::from_utf8_lossy(&buf).into_owned();
    if cut {
        s.push_str("\n[…salida recortada]");
    }
    s
}

/// Runs a prepared command with stdin and a time limit.
pub(crate) async fn exec(mut cmd: Command, dir: &Path, stdin: &str, limit: Duration) -> Result<(String, String, Option<i32>, bool)> {
    let mut child = cmd.current_dir(dir).spawn().map_err(|e| anyhow!("no se pudo ejecutar: {e}"))?;
    if let Some(mut input) = child.stdin.take() {
        let data = stdin.as_bytes().to_vec();
        tokio::spawn(async move {
            let _ = input.write_all(&data).await;
        });
    }
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let readers = async { tokio::join!(read_capped(out), read_capped(err)) };
    let finished = tokio::time::timeout(limit, async {
        let (o, e) = readers.await;
        let status = child.wait().await;
        (o, e, status)
    })
    .await;
    match finished {
        Ok((o, e, status)) => Ok((o, e, status.ok().and_then(|s| s.code()), false)),
        Err(_) => {
            let _ = child.kill().await;
            Ok((String::new(), String::new(), None, true))
        }
    }
}

pub(crate) fn split_program(p: &str) -> (String, Vec<String>) {
    let mut parts = p.split_whitespace().map(String::from);
    (parts.next().unwrap_or_default(), parts.collect())
}

// ── Exercises (AC-55) ──────────────────────────────────────────────────────

pub const EXERCISE_TOOL: &str = "set_code_exercise";

/// A practice exercise: the learner edits `starter`; `tests` are joined to
/// their code (see `with_tests`) when they press "Probar" and fail the run if
/// something is wrong.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodeExercise {
    pub lang: Lang,
    pub title: String,
    pub statement: String,
    pub starter: String,
    pub tests: String,
    pub hints: Vec<String>,
    pub solution: String,
}

pub fn exercise_tool() -> Value {
    json!({ "type": "function", "function": {
        "name": EXERCISE_TOOL,
        "description": "Entrega el ejercicio de programación.",
        "parameters": { "type": "object", "properties": {
            "title": { "type": "string" },
            "statement": { "type": "string" },
            "starter": { "type": "string" },
            "tests": { "type": "string" },
            "hints": { "type": "array", "items": { "type": "string" } },
            "solution": { "type": "string" }
        }, "required": ["title", "statement", "starter", "tests", "hints", "solution"] }
    }})
}

pub fn exercise_input(lang: Lang, topic: &str, level: &str) -> String {
    format!("Lenguaje: {}\nTema: {}\nNivel: {}\n", lang.label(), topic.trim(), level.trim())
}

/// The learner's code with the exercise's tests, in the order the language
/// needs: Java runs the first class (the tests' `Main`), and C# top-level
/// statements (the tests) must come before the types; the rest put the tests
/// after the code (C, C++ and Go tests bring the `main`).
pub fn with_tests(lang: Lang, code: &str, tests: &str) -> String {
    match lang {
        Lang::Java | Lang::Csharp => format!("{}\n\n{}\n", tests.trim_end(), code.trim_end()),
        _ => format!("{}\n\n{}\n", code.trim_end(), tests.trim_end()),
    }
}

pub fn validate_exercise(raw: &str, lang: Lang) -> Result<CodeExercise> {
    #[derive(Deserialize)]
    struct Raw {
        title: String,
        statement: String,
        starter: String,
        tests: String,
        #[serde(default)]
        hints: Vec<String>,
        #[serde(default)]
        solution: String,
    }
    let r: Raw = serde_json::from_str(raw).context("el autor de ejercicios devolvió datos inválidos")?;
    let (title, statement, starter, tests) = (r.title.trim(), r.statement.trim(), r.starter.trim_end(), r.tests.trim());
    if title.is_empty() || statement.is_empty() || starter.trim().is_empty() || tests.is_empty() {
        return Err(anyhow!("El ejercicio llegó incompleto. Probá de nuevo."));
    }
    if [starter, tests, r.solution.as_str()].iter().any(|s| s.len() > MAX_CODE / 4) {
        return Err(anyhow!("El ejercicio es demasiado largo."));
    }
    Ok(CodeExercise {
        lang,
        title: title.to_string(),
        statement: statement.to_string(),
        starter: format!("{starter}\n"),
        tests: tests.to_string(),
        hints: r.hints.into_iter().map(|h| h.trim().to_string()).filter(|h| !h.is_empty()).take(3).collect(),
        solution: r.solution.trim_end().to_string(),
    })
}

/// What the teacher reads to explain a run (AC-54): the code with line
/// numbers, and the output, both capped.
pub fn explain_input(lang: Lang, code: &str, output: &str, ask: &str) -> String {
    let numbered: String = code.lines().take(400).enumerate().map(|(i, l)| format!("{:>3} | {l}\n", i + 1)).collect();
    let out: String = output.chars().take(6000).collect();
    let ask = if ask.trim().is_empty() { "¿Qué significa este error y cómo lo arreglo?" } else { ask.trim() };
    format!("Lenguaje: {}\n\n## Código ({})\n```\n{numbered}```\n\n## Salida al ejecutarlo\n```\n{out}\n```\n\n## Pregunta del aprendiz\n{ask}\n", lang.label(), lang.file())
}

/// AC-58: what the reviewer reads: the code with line numbers and what the
/// learner wants to improve (optional).
pub fn review_input(lang: Lang, code: &str, focus: &str) -> String {
    let numbered: String = code.lines().take(600).enumerate().map(|(i, l)| format!("{:>3} | {l}\n", i + 1)).collect();
    let focus = if focus.trim().is_empty() { "Revisión general." } else { focus.trim() };
    format!("Lenguaje: {}\n\n## Código\n```\n{numbered}```\n\n## Qué quiere mejorar el aprendiz\n{focus}\n", lang.label())
}

pub fn validate(code: &str, stdin: &str) -> Result<()> {
    if code.trim().is_empty() {
        return Err(anyhow!("Escribí algo de código para ejecutar."));
    }
    if code.len() > MAX_CODE || stdin.len() > MAX_STDIN {
        return Err(anyhow!("El código o la entrada son demasiado largos."));
    }
    Ok(())
}

/// How to get the toolchain on Windows (checked winget ids).
pub fn install_hint(lang: Lang) -> &'static str {
    match lang {
        Lang::Python => "No encontré Python instalado. Instalalo desde python.org (marcá «Add to PATH») y volvé a abrir la app.",
        Lang::Javascript | Lang::Typescript => "No encontré Node.js instalado. Instalalo desde nodejs.org y volvé a abrir la app.",
        Lang::Rust => "No encontré Rust instalado. Instalalo con rustup (rustup.rs) y volvé a abrir la app.",
        Lang::C | Lang::Cpp => "No encontré un compilador de C y C++ (gcc o clang). En Windows, el más simple es GCC portable: `winget install BrechtSanders.WinLibs.POSIX.UCRT`. Después cerrá y volvé a abrir la app.",
        Lang::Java => "No encontré Java con su compilador (el JDK, con javac). Instalalo con `winget install Microsoft.OpenJDK.21` y volvé a abrir la app.",
        Lang::Csharp => "No encontré el SDK de .NET (para C#). Instalalo con `winget install Microsoft.DotNet.SDK.10` (o en otra carpeta, con DOTNET_ROOT apuntando a ella) y volvé a abrir la app.",
        Lang::Go => "No encontré Go instalado. Instalalo con `winget install GoLang.Go` y volvé a abrir la app.",
        Lang::Sql => "SQL viene incluido en Eureka.",
    }
}

/// The program that runs `lang`, or how to install it.
pub fn program_for(runtimes: &[Runtime], lang: Lang) -> Result<String> {
    runtimes.iter().find(|r| r.lang == lang).and_then(|r| r.program.clone()).ok_or_else(|| anyhow!(install_hint(lang)))
}

/// `net10.0` from ".NET SDK 10.0.403": the framework the installed SDK targets
/// without downloading anything.
pub(crate) fn target_framework(runtimes: &[Runtime]) -> String {
    let major = runtimes
        .iter()
        .find(|r| r.lang == Lang::Csharp)
        .and_then(|r| r.version.as_deref())
        .and_then(|v| v.split_whitespace().last())
        .and_then(|v| v.split('.').next())
        .and_then(|m| m.parse::<u32>().ok())
        .unwrap_or(8);
    format!("net{major}.0")
}

/// A console project for one or more `.cs` files, named `main`.
pub(crate) fn csproj(framework: &str) -> String {
    format!(
        "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>{framework}</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>disable</Nullable>\n    <AssemblyName>main</AssemblyName>\n    <InvariantGlobalization>true</InvariantGlobalization>\n    <SatelliteResourceLanguages>es</SatelliteResourceLanguages>\n  </PropertyGroup>\n</Project>\n"
    )
}

/// Added to every C# build: a piped Console on Windows writes in the old OEM
/// code page (accents come out broken) unless told to use UTF-8.
pub(crate) const CSHARP_UTF8: (&str, &str) = (
    "EurekaConsola.cs",
    "static class EurekaConsola\n{\n    [System.Runtime.CompilerServices.ModuleInitializer]\n    internal static void Utf8()\n    {\n        try { System.Console.OutputEncoding = new System.Text.UTF8Encoding(false); System.Console.InputEncoding = new System.Text.UTF8Encoding(false); } catch { }\n    }\n}\n",
);

/// Runs `code` in a fresh folder under `runs_dir`, which is deleted afterwards.
pub async fn run(runtimes: &[Runtime], runs_dir: &Path, lang: Lang, code: &str, stdin: &str) -> Result<RunResult> {
    validate(code, stdin)?;
    let started = Instant::now();
    if lang == Lang::Sql {
        let r = crate::sql::run(code, RUN_TIMEOUT).await?;
        return Ok(RunResult { duration_ms: started.elapsed().as_millis() as u64, ..r });
    }
    let rt = program_for(runtimes, lang)?;
    let dir: PathBuf = runs_dir.join(uuid::Uuid::new_v4().simple().to_string());
    tokio::fs::create_dir_all(&dir).await?;
    tokio::fs::write(dir.join(lang.file()), code).await?;
    if lang == Lang::Csharp {
        tokio::fs::write(dir.join("main.csproj"), csproj(&target_framework(runtimes))).await?;
        tokio::fs::write(dir.join(CSHARP_UTF8.0), CSHARP_UTF8.1).await?;
    }
    let result = run_in(&dir, &rt, lang, stdin).await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    let (stdout, stderr, exit_code, timed_out, compile_error) = result?;
    Ok(RunResult { stdout, stderr, exit_code, timed_out, compile_error, duration_ms: started.elapsed().as_millis() as u64 })
}

type Outcome = (String, String, Option<i32>, bool, bool);

/// Compiles (with its own, longer time limit), then runs `exe` with stdin.
/// `merged`: the compiler writes its errors to stdout (dotnet build).
pub(crate) async fn compile_then_run(dir: &Path, compile: Command, exe: Command, stdin: &str, merged: bool) -> Result<Outcome> {
    let (out, err, code, timed_out) = exec(compile, dir, "", COMPILE_TIMEOUT).await?;
    if timed_out || code != Some(0) {
        let errors = if timed_out { "La compilación tardó demasiado.".to_string() } else if merged { format!("{out}{err}") } else { err };
        return Ok((String::new(), errors, code, timed_out, true));
    }
    let (o, e, code, t) = exec(exe, dir, stdin, RUN_TIMEOUT).await?;
    Ok((o, e, code, t, false))
}

/// A C# program built by the SDK at `dotnet` (a path): it must find that
/// same runtime, not the one in Program Files (which may be older or absent).
pub(crate) fn dotnet_program(dir: &Path, name: &str, dotnet: &str) -> Command {
    let mut c = binary(dir, name);
    if let Some(root) = Path::new(dotnet).parent().filter(|p| !p.as_os_str().is_empty()) {
        c.env("DOTNET_ROOT", root);
    }
    c
}

/// The binary a compile step left in `dir`.
fn binary(dir: &Path, name: &str) -> Command {
    command(&dir.join(name).to_string_lossy())
}

async fn run_in(dir: &Path, program: &str, lang: Lang, stdin: &str) -> Result<Outcome> {
    let (prog, mut args) = split_program(program);
    match lang {
        Lang::Python => {
            // -u: unbuffered (prints show up even on a crash); -X utf8: accents.
            args.extend(["-u", "-X", "utf8", "main.py"].map(String::from));
        }
        Lang::Javascript => args.push("main.js".into()),
        Lang::Typescript => args.extend(["--experimental-strip-types", "--no-warnings", "main.ts"].map(String::from)),
        Lang::Rust => {
            let mut rustc = command(&prog);
            rustc.args(["--edition", "2021", "-C", "opt-level=0", "-o", "main.exe", "main.rs"]).env("RUSTFLAGS", "");
            return compile_then_run(dir, rustc, binary(dir, "main.exe"), stdin, false).await;
        }
        Lang::C | Lang::Cpp => {
            let mut cc = command(&prog);
            let std = if lang == Lang::C { "-std=c17" } else { "-std=c++20" };
            cc.args([std, "-Wall", "-O0", "-finput-charset=UTF-8", "-fexec-charset=UTF-8", "-o", "main.exe", lang.file()]);
            if lang == Lang::C {
                cc.arg("-lm");
            }
            return compile_then_run(dir, cc, binary(dir, "main.exe"), stdin, false).await;
        }
        Lang::Go => {
            let mut build = command(&prog);
            build.args(["build", "-o", "main.exe", "main.go"]);
            return compile_then_run(dir, build, binary(dir, "main.exe"), stdin, false).await;
        }
        Lang::Csharp => {
            // The program is a path (it may have spaces): never split it.
            let mut build = command(program);
            build.args(["build", "-o", "out", "-nologo", "-v", "q", "-clp:NoSummary", "-p:UseSharedCompilation=false", "-nodeReuse:false"]);
            return compile_then_run(dir, build, dotnet_program(dir, "out/main.exe", program), stdin, true).await;
        }
        Lang::Java => {
            // A source file runs directly (javac's compiler, in memory); -ea: `assert` works.
            args.extend(["-ea", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dfile.encoding=UTF-8", "Main.java"].map(String::from));
            let mut cmd = command(&prog);
            cmd.args(&args);
            let (o, e, code, t) = exec(cmd, dir, stdin, RUN_TIMEOUT * 2).await?;
            let compile_error = e.contains("error: compilation failed");
            return Ok((o, e, code, t, compile_error));
        }
        Lang::Sql => unreachable!("SQL runs inside Eureka"),
    }
    let mut cmd = command(&prog);
    cmd.args(&args).env("PYTHONIOENCODING", "utf-8");
    let (o, e, code, t) = exec(cmd, dir, stdin, RUN_TIMEOUT).await?;
    Ok((o, e, code, t, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runs_dir() -> PathBuf {
        std::env::temp_dir().join(format!("la-runs-{}", uuid::Uuid::new_v4().simple()))
    }

    pub(crate) async fn available(lang: Lang) -> Option<Vec<Runtime>> {
        let rts = detect().await;
        rts.iter().any(|r| r.lang == lang && r.program.is_some()).then_some(rts)
    }

    #[test]
    fn every_language_has_one_id_label_and_file() {
        for l in Lang::ALL {
            assert_eq!(Lang::from_id(l.id()), Some(l));
            assert_eq!(serde_json::to_value(l).unwrap(), l.id(), "the serde name is the id");
            assert!(!l.label().is_empty() && !l.file().is_empty() && !install_hint(l).is_empty());
        }
        assert_eq!((Lang::Cpp.label(), Lang::Csharp.label(), Lang::Java.file()), ("C++", "C#", "Main.java"));
        assert_eq!(Lang::from_id("cobol"), None);
    }

    #[test]
    fn tests_go_where_each_language_needs_them() {
        assert_eq!(with_tests(Lang::Python, "def f(): pass\n\n", "assert f() is None"), "def f(): pass\n\nassert f() is None\n");
        assert!(with_tests(Lang::Java, "class Sol {}", "public class Main {}").starts_with("public class Main {}"));
        assert!(with_tests(Lang::Csharp, "static class Sol {}", "Console.WriteLine(1);").starts_with("Console.WriteLine(1);"));
        assert!(with_tests(Lang::Go, "package main", "func main() {}").starts_with("package main"));
        assert!(with_tests(Lang::C, "int f(void);", "int main(void) {}").starts_with("int f"));
    }

    #[test]
    fn the_csharp_project_targets_the_installed_sdk() {
        let rts = |v: &str| vec![Runtime { lang: Lang::Csharp, program: Some("dotnet".into()), version: Some(v.into()) }];
        assert_eq!(target_framework(&rts(".NET SDK 10.0.403")), "net10.0");
        assert_eq!(target_framework(&rts(".NET SDK 9.0.320")), "net9.0");
        assert_eq!(target_framework(&[]), "net8.0");
        assert!(csproj("net10.0").contains("<TargetFramework>net10.0</TargetFramework>"));
    }

    #[test]
    fn explain_input_numbers_lines_and_defaults_the_question() {
        let s = explain_input(Lang::Python, "x = 1\nprint(y)", "NameError: name 'y' is not defined", " ");
        assert!(s.contains("  1 | x = 1\n  2 | print(y)\n"));
        assert!(s.contains("NameError"));
        assert!(s.contains("¿Qué significa este error y cómo lo arreglo?"));
        assert!(explain_input(Lang::Rust, "fn main(){}", "", "¿por qué?").contains("Lenguaje: Rust"));
        assert!(explain_input(Lang::Cpp, "int main(){}", "", "").contains("Lenguaje: C++\n\n## Código (main.cpp)"));
    }

    #[test]
    fn exercises_are_validated() {
        let raw = json!({ "title": " Pares ", "statement": "Devolvé los pares.", "starter": "def pares(xs):\n    pass\n\n\n", "tests": "assert pares([1,2]) == [2]\nprint('OK')", "hints": ["a", " ", "b", "c", "d"], "solution": "def pares(xs):\n    return [x for x in xs if x % 2 == 0]\n" }).to_string();
        let e = validate_exercise(&raw, Lang::Python).unwrap();
        assert_eq!((e.title.as_str(), e.starter.as_str(), e.hints.len()), ("Pares", "def pares(xs):\n    pass\n", 3));
        assert!(validate_exercise(&json!({ "title": "x", "statement": "y", "starter": " ", "tests": "t", "hints": [], "solution": "" }).to_string(), Lang::Python).is_err());
        assert!(validate_exercise("{", Lang::Python).is_err());
        assert_eq!(exercise_input(Lang::Rust, " ownership ", "medio"), "Lenguaje: Rust\nTema: ownership\nNivel: medio\n");
        assert_eq!(exercise_input(Lang::Csharp, "LINQ", "básico"), "Lenguaje: C#\nTema: LINQ\nNivel: básico\n");
    }

    #[tokio::test]
    async fn an_exercise_passes_with_its_solution_and_fails_with_the_starter() {
        let Some(rts) = available(Lang::Python).await else { return };
        let raw = json!({ "title": "Pares", "statement": "s", "starter": "def pares(xs):\n    return []\n", "tests": "assert pares([1, 2, 4]) == [2, 4], 'pares'\nprint('OK')", "hints": [], "solution": "def pares(xs):\n    return [x for x in xs if x % 2 == 0]" }).to_string();
        let e = validate_exercise(&raw, Lang::Python).unwrap();
        let dir = runs_dir();
        let fail = run(&rts, &dir, Lang::Python, &with_tests(Lang::Python, &e.starter, &e.tests), "").await.unwrap();
        assert_eq!(fail.exit_code, Some(1));
        assert!(fail.stderr.contains("AssertionError: pares"));
        let pass = run(&rts, &dir, Lang::Python, &with_tests(Lang::Python, &e.solution, &e.tests), "").await.unwrap();
        assert_eq!((pass.exit_code, pass.stdout.trim()), (Some(0), "OK"));
    }

    #[test]
    fn review_input_numbers_lines_and_defaults_the_focus() {
        let s = review_input(Lang::Rust, "fn main() {\n}", "");
        assert!(s.starts_with("Lenguaje: Rust"));
        assert!(s.contains("  1 | fn main() {\n  2 | }\n"));
        assert!(s.contains("Revisión general."));
        assert!(review_input(Lang::Python, "x", " errores ").ends_with("errores\n"));
    }

    #[test]
    fn rejects_empty_or_huge_code() {
        assert!(validate("  ", "").is_err());
        assert!(validate(&"x".repeat(MAX_CODE + 1), "").is_err());
        assert!(validate("print(1)", &"x".repeat(MAX_STDIN + 1)).is_err());
        assert!(validate("print(1)", "").is_ok());
        assert_eq!(split_program("py -3"), ("py".into(), vec!["-3".into()]));
    }

    #[tokio::test]
    async fn missing_runtime_explains_how_to_install() {
        let none = vec![Runtime { lang: Lang::Rust, program: None, version: None }];
        let err = run(&none, &runs_dir(), Lang::Rust, "fn main(){}", "").await.unwrap_err();
        assert!(err.to_string().contains("rustup"));
        let err = run(&[], &runs_dir(), Lang::Cpp, "int main(){}", "").await.unwrap_err();
        assert!(err.to_string().contains("WinLibs"), "{err}");
    }

    // The tests below use this PC's toolchains and skip the ones not installed.

    #[tokio::test]
    async fn python_reads_stdin_prints_accents_and_reports_errors() {
        let Some(rts) = available(Lang::Python).await else { return };
        let dir = runs_dir();
        let r = run(&rts, &dir, Lang::Python, "n = input()\nprint('Hola,', n, 'ñandú')", "Ana\n").await.unwrap();
        assert_eq!((r.stdout.trim(), r.exit_code, r.timed_out), ("Hola, Ana ñandú", Some(0), false));
        let r = run(&rts, &dir, Lang::Python, "print('antes')\n1/0", "").await.unwrap();
        assert_eq!(r.exit_code, Some(1));
        assert!(r.stdout.contains("antes") && r.stderr.contains("ZeroDivisionError"));
        assert!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) == 0, "run folders are deleted");
    }

    #[tokio::test]
    async fn infinite_loops_are_stopped_by_the_time_limit() {
        let Some(rts) = available(Lang::Javascript).await else { return };
        let started = Instant::now();
        let r = run(&rts, &runs_dir(), Lang::Javascript, "while (true) {}", "").await.unwrap();
        assert!(r.timed_out);
        assert!(started.elapsed() < RUN_TIMEOUT + Duration::from_secs(5));
    }

    #[tokio::test]
    async fn runaway_output_is_capped() {
        let Some(rts) = available(Lang::Javascript).await else { return };
        let r = run(&rts, &runs_dir(), Lang::Javascript, "for (let i = 0; i < 200000; i++) console.log('linea ' + i)", "").await.unwrap();
        assert!(r.stdout.ends_with("[…salida recortada]"));
        assert!(r.stdout.len() <= MAX_OUTPUT + 40);
    }

    #[tokio::test]
    async fn typescript_runs_with_types_stripped() {
        let Some(rts) = available(Lang::Typescript).await else { return };
        let r = run(&rts, &runs_dir(), Lang::Typescript, "const doble = (n: number): number => n * 2;\nconsole.log(doble(21));", "").await.unwrap();
        assert_eq!((r.stdout.trim(), r.exit_code), ("42", Some(0)), "{}", r.stderr);
    }

    #[tokio::test]
    async fn rust_compiles_then_runs_and_shows_compile_errors() {
        let Some(rts) = available(Lang::Rust).await else { return };
        let dir = runs_dir();
        let r = run(&rts, &dir, Lang::Rust, "use std::io::Read;\nfn main() { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); println!(\"eco: {}\", s.trim()); }", "hola").await.unwrap();
        assert_eq!((r.stdout.trim(), r.compile_error), ("eco: hola", false), "{}", r.stderr);
        let r = run(&rts, &dir, Lang::Rust, "fn main() { let x: i32 = \"no\"; }", "").await.unwrap();
        assert!(r.compile_error && r.stderr.contains("E0308"), "{}", r.stderr);
    }

    // AC-171: each new language reads stdin, keeps accents, shows its compile
    // errors with the line, and runs an exercise's tests in the right order.

    async fn check_language(lang: Lang, echo: &str, broken: &str, line: &str, starter: &str, solution: &str, tests: &str) {
        let Some(rts) = available(lang).await else {
            eprintln!("{} no está instalado en esta PC: se saltea", lang.label());
            return;
        };
        let dir = runs_dir();
        let r = run(&rts, &dir, lang, echo, "Ana\n").await.unwrap();
        assert_eq!((r.stdout.trim(), r.exit_code, r.compile_error), ("Hola, Ana ñandú", Some(0), false), "{}: {}", lang.label(), r.stderr);
        let r = run(&rts, &dir, lang, broken, "").await.unwrap();
        assert!(r.compile_error && r.stderr.contains(line), "{}: {}", lang.label(), r.stderr);
        let fail = run(&rts, &dir, lang, &with_tests(lang, starter, tests), "").await.unwrap();
        assert!(fail.exit_code != Some(0) && !fail.compile_error, "{} starter: {}{}", lang.label(), fail.stdout, fail.stderr);
        let pass = run(&rts, &dir, lang, &with_tests(lang, solution, tests), "").await.unwrap();
        assert_eq!(pass.exit_code, Some(0), "{} solution: {}{}", lang.label(), pass.stdout, pass.stderr);
        assert!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) == 0, "run folders are deleted");
    }

    #[tokio::test]
    async fn c_compiles_runs_and_tests() {
        check_language(
            Lang::C,
            "#include <stdio.h>\nint main(void) { char n[32]; scanf(\"%31s\", n); printf(\"Hola, %s ñandú\\n\", n); return 0; }\n",
            "int main(void) {\n  int x = ;\n}\n",
            "main.c:2:",
            "int doble(int n) { return 0; }",
            "int doble(int n) { return n * 2; }",
            "#include <assert.h>\nint main(void) { assert(doble(21) == 42); return 0; }",
        )
        .await;
    }

    #[tokio::test]
    async fn cpp_compiles_runs_and_tests() {
        check_language(
            Lang::Cpp,
            "#include <iostream>\n#include <string>\nint main() { std::string n; std::cin >> n; std::cout << \"Hola, \" << n << \" ñandú\\n\"; }\n",
            "int main() {\n  int x = ;\n}\n",
            "main.cpp:2:",
            "#include <vector>\nint suma(const std::vector<int>& v) { return 0; }",
            "#include <vector>\n#include <numeric>\nint suma(const std::vector<int>& v) { return std::accumulate(v.begin(), v.end(), 0); }",
            "#include <cassert>\nint main() { assert(suma({1, 2, 3}) == 6); }",
        )
        .await;
    }

    #[tokio::test]
    async fn java_runs_from_source_and_tests() {
        check_language(
            Lang::Java,
            "import java.util.Scanner;\npublic class Main { public static void main(String[] a) { String n = new Scanner(System.in).next(); System.out.println(\"Hola, \" + n + \" ñandú\"); } }\n",
            "public class Main {\n  public static void main(String[] a) { int x = ; }\n}\n",
            "Main.java:2:",
            "class Sol { static int doble(int n) { return 0; } }",
            "class Sol { static int doble(int n) { return n * 2; } }",
            "public class Main { public static void main(String[] a) { if (Sol.doble(21) != 42) throw new AssertionError(\"doble(21) debería dar 42\"); System.out.println(\"OK\"); } }",
        )
        .await;
    }

    #[tokio::test]
    async fn go_builds_runs_and_tests() {
        check_language(
            Lang::Go,
            "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tvar n string\n\tfmt.Scan(&n)\n\tfmt.Println(\"Hola, \" + n + \" ñandú\")\n}\n",
            "package main\n\nfunc main() {\n\tx := \n}\n",
            "main.go:",
            "package main\n\nfunc doble(n int) int { return 0 }",
            "package main\n\nfunc doble(n int) int { return n * 2 }",
            "func main() {\n\tif doble(21) != 42 {\n\t\tpanic(\"doble(21) debería dar 42\")\n\t}\n\tprintln(\"OK\")\n}",
        )
        .await;
    }

    #[tokio::test]
    async fn csharp_builds_runs_and_tests() {
        check_language(
            Lang::Csharp,
            "var n = Console.ReadLine();\nConsole.WriteLine($\"Hola, {n} ñandú\");\n",
            "int x = ;\n",
            "Program.cs(1,",
            "static class Sol { public static int Doble(int n) => 0; }",
            "static class Sol { public static int Doble(int n) => n * 2; }",
            "if (Sol.Doble(21) != 42) throw new Exception(\"Doble(21) debería dar 42\");\nConsole.WriteLine(\"OK\");",
        )
        .await;
    }

    #[tokio::test]
    async fn sql_runs_inside_eureka() {
        let rts = detect().await;
        assert!(program_for(&rts, Lang::Sql).is_ok(), "SQL never needs installing");
        let r = run(&rts, &runs_dir(), Lang::Sql, "CREATE TABLE t (nombre TEXT);\nINSERT INTO t VALUES ('ñandú');\nSELECT nombre FROM t;", "").await.unwrap();
        assert_eq!(r.exit_code, Some(0), "{}", r.stderr);
        assert!(r.stdout.contains("ñandú"), "{}", r.stdout);
    }
}
