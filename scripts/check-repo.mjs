// Repo hygiene checks, run by CI (.github/workflows/ci.yml) and locally with `npm run check:repo`.
//
//   node scripts/check-repo.mjs [--base <git ref>]
//
// Blocking (exit 1):
//   - forbidden name: an old project name must never appear in the repo;
//   - secrets: no tracked auth.json / .env / *.key / *.pem, and no strings shaped like real API keys;
//   - AC traceability: every AC-n defined in docs/spec.md has a row (or a mention) in its
//     traceability section and shows up in at least one test or .feature file. Known legacy
//     gaps live in scripts/ac-allowlist.json; only new gaps fail;
//   - relative links in tracked Markdown files point to files that exist (exact case, as on Linux).
// Warnings only:
//   - an allowlisted AC that is now covered (so the allowlist shrinks);
//   - docs staleness: with --base, a diff touching src/ or src-tauri/src/ but no docs/,
//     features/ or CHANGELOG.md.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function git(args, { allowExit = [] } = {}) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowExit.includes(r.status)) throw new Error(`git ${args.join(" ")} falló (${r.status}): ${r.stderr}`);
  return { status: r.status, out: r.stdout };
}
const tracked = git(["ls-files", "-z"]).out.split("\0").filter(Boolean);
const read = (f) => {
  try {
    return fs.readFileSync(path.join(ROOT, f), "utf8");
  } catch {
    return null; // listed but deleted in the working tree
  }
};

// ── Forbidden name ─────────────────────────────────────────────────────────
// Built at runtime so this file never contains it.
const FORBIDDEN = Buffer.from("TGVhcm5IYXJuZXNz", "base64").toString("utf8");
{
  const { status, out } = git(["grep", "-n", "-I", "-i", "-F", FORBIDDEN], { allowExit: [1] });
  for (const f of tracked) if (f.toLowerCase().includes(FORBIDDEN.toLowerCase())) errors.push(`Nombre prohibido en la ruta: ${f}`);
  if (status === 0) errors.push(`Aparece un nombre prohibido (ver docs de contribución) en:\n${out.trim().split("\n").map((l) => `    ${l.slice(0, 160)}`).join("\n")}`);
}

// ── Secrets ────────────────────────────────────────────────────────────────
{
  const secretFile = /(^|\/)(auth\.json|\.env(\.(?!example$|sample$)[^/]+)?|[^/]*\.key|[^/]*\.pem|\.update-token)$/i;
  for (const f of tracked) if (secretFile.test(f)) errors.push(`Archivo de secretos versionado: ${f}`);
  // Real keys are long; the fake ones in tests (sk-0123…, 32 chars) stay below the bar.
  const keyShapes = [
    "sk-[A-Za-z0-9_-]{40,}", // OpenAI, OpenRouter (sk-or-v1-…), Anthropic (sk-ant-…), DeepSeek
    "AKIA[0-9A-Z]{16}",
    "gh[pousr]_[A-Za-z0-9]{36}",
    "github_pat_[A-Za-z0-9_]{40,}",
    "AIza[0-9A-Za-z_-]{35}",
    "BEGIN [A-Z ]*PRIVATE KEY",
  ];
  const { status, out } = git(["grep", "-n", "-I", "-E", keyShapes.join("|")], { allowExit: [1] });
  if (status === 0) errors.push(`Algo con forma de API key o clave privada:\n${out.trim().split("\n").map((l) => `    ${l.slice(0, 120)}…`).join("\n")}`);
}

// ── AC traceability ────────────────────────────────────────────────────────
const norm = (n) => `AC-${String(Number(n)).padStart(2, "0")}`;
/** Every AC mentioned in `text`, expanding ranges like «AC-140..AC-143» or «AC-53…55». */
function mentions(text) {
  const found = new Set();
  for (const m of text.matchAll(/AC-(\d+)/g)) found.add(norm(m[1]));
  for (const m of text.matchAll(/AC-(\d+)\s*(?:\.\.\.?|…|–|—)\s*(?:AC-)?(\d+)/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b > a && b - a < 50) for (let k = a; k <= b; k++) found.add(norm(k));
  }
  return found;
}
const ac = { defined: [], missingTrace: [], missingTests: [] };
{
  const spec = read("docs/spec.md").split(/\r?\n/);
  const traceStart = spec.findIndex((l) => /^## \d+\. Trazabilidad/.test(l));
  if (traceStart === -1) errors.push("docs/spec.md no tiene la sección «Trazabilidad»");
  const defined = new Set();
  const traced = new Set();
  spec.forEach((line, i) => {
    for (const m of line.matchAll(/\*\*AC-(\d+)\*\*/g)) defined.add(norm(m[1]));
    // In the traceability section, an AC counts as traced by a table row or any mention that
    // isn't its own definition bullet (later ACs are defined there, under a heading with their range).
    if (i > traceStart && !/^\s*-\s*\*\*AC-\d+\*\*/.test(line)) for (const a of mentions(line)) traced.add(a);
  });

  // Tests and features. Rust tests live inline: count only what follows the first #[cfg(test)],
  // plus whole test-only modules (agent_tests.rs, token_bench.rs).
  const tested = new Set();
  const isTestFile = (f) => /^features\/.*\.feature$/.test(f) || /^tests\//.test(f) || /\.(test|e2e|bench\.test)\.[cm]?[jt]sx?$/.test(f) || /^src-tauri\/src\/.*(_tests|token_bench)\.rs$/.test(f);
  for (const f of tracked) {
    let text;
    if (isTestFile(f)) text = read(f);
    else if (/^src-tauri\/src\/.*\.rs$/.test(f)) {
      const s = read(f);
      const at = s?.indexOf("#[cfg(test)]") ?? -1;
      text = at === -1 ? null : s.slice(at);
    }
    if (text) for (const a of mentions(text)) tested.add(a);
  }

  const allow = JSON.parse(read("scripts/ac-allowlist.json"));
  const sortAc = (a, b) => Number(a.slice(3)) - Number(b.slice(3));
  ac.defined = [...defined].sort(sortAc);
  ac.missingTrace = ac.defined.filter((a) => !traced.has(a));
  ac.missingTests = ac.defined.filter((a) => !tested.has(a));
  for (const [kind, missing, list, what] of [
    ["traceability", ac.missingTrace, allow.traceability, "no tiene fila en la trazabilidad de docs/spec.md"],
    ["tests", ac.missingTests, allow.tests, "no aparece en ninguna prueba ni .feature"],
  ]) {
    for (const a of missing) if (!list.includes(a)) errors.push(`${a} ${what}`);
    for (const a of list) if (!missing.includes(a)) warnings.push(`${a} ya está cubierto (${kind}): sacalo de scripts/ac-allowlist.json`);
  }
}

// ── Relative links in Markdown ─────────────────────────────────────────────
{
  const trackedSet = new Set(tracked);
  const dirs = new Set(tracked.flatMap((f) => f.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
  for (const f of tracked.filter((t) => t.endsWith(".md"))) {
    const text = read(f);
    if (text == null) continue;
    let fenced = false;
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return;
      const noCode = line.replace(/`[^`]*`/g, "");
      for (const m of noCode.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|^\s*\[[^\]]+\]:\s*(\S+)/g)) {
        const target = m[1] ?? m[2];
        if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue; // external, mailto:, in-page anchor
        let rel;
        try {
          rel = decodeURIComponent(target.split("#")[0].split("?")[0]);
        } catch {
          rel = target.split("#")[0];
        }
        if (!rel) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), rel)).replace(/\/$/, "");
        if (!trackedSet.has(resolved) && !dirs.has(resolved) && resolved !== ".") errors.push(`Link roto en ${f}:${i + 1} → ${target}`);
      }
    });
  }
}

// ── Docs staleness (warning) ───────────────────────────────────────────────
{
  const at = process.argv.indexOf("--base");
  const base = at !== -1 ? process.argv[at + 1] : process.env.CHECK_BASE;
  if (base) {
    const r = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) warnings.push(`No pude comparar contra ${base}: no reviso si faltan docs`);
    else {
      const changed = r.stdout.split("\n").filter(Boolean);
      const code = changed.some((c) => c.startsWith("src/") || c.startsWith("src-tauri/src/"));
      const docs = changed.some((c) => c.startsWith("docs/") || c.startsWith("features/") || c === "CHANGELOG.md");
      if (code && !docs) warnings.push("El cambio toca src/ o src-tauri/src/ pero no docs/, features/ ni CHANGELOG.md: ¿falta documentarlo?");
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const gh = !!process.env.GITHUB_ACTIONS;
console.log(`Criterios en docs/spec.md: ${ac.defined.length}. Sin trazabilidad: ${ac.missingTrace.length} (${ac.missingTrace.join(", ") || "—"}). Sin prueba ni escenario: ${ac.missingTests.length} (${ac.missingTests.join(", ") || "—"}).`);
for (const w of warnings) console.log(gh ? `::warning::${w.replace(/\n/g, "%0A")}` : `⚠ ${w}`);
for (const e of errors) console.log(gh ? `::error::${e.replace(/\n/g, "%0A")}` : `✗ ${e}`);
if (errors.length) {
  console.log(`\n${errors.length} problema(s).`);
  process.exit(1);
}
console.log("✓ Repo en orden.");
