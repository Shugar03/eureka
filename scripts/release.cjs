// Publishes a new Eureka version that installed copies update to by themselves.
//
//   node scripts/release.cjs [patch|minor|major|1.2.3] ["Qué trae esta versión"]
//
// 1. Bumps the version (package.json, Cargo.toml, tauri.conf.json), commits and tags it.
// 2. Builds the signed installer (NSIS) with the update source built in.
// 3. Creates the GitHub release with the installer and latest.json, which the app reads.
//
// Needs, outside the repo: %USERPROFILE%\.tauri\eureka.key, the signing key
// (tauri signer generate), and `gh` logged in with write access to the repo.
// The releases are public: the app needs no credential to read them.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = "Shugar03/eureka";
const ROOT = path.resolve(__dirname, "..");
const SECRETS = path.join(os.homedir(), ".tauri");
const KEY = path.join(SECRETS, "eureka.key");
// Its own target dir: a long release build doesn't lock the one tests use (and C: is nearly full).
const TARGET = process.env.EUREKA_RELEASE_TARGET || "D:/dev-cache/eureka-release-target";

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  // Only npx needs a shell on Windows (it is a .cmd); with one, an argument with
  // spaces ("Eureka 0.2.0") would be split in two.
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit", shell: process.platform === "win32" && cmd === "npx", encoding: "utf8", env: opts.env ?? process.env });
  if (r.status !== 0) die(`falló: ${cmd} ${args.join(" ")}`);
  return (r.stdout ?? "").trim();
}

function nextVersion(current, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [a, b, c] = current.split(".").map(Number);
  if (how === "major") return `${a + 1}.0.0`;
  if (how === "minor") return `${a}.${b + 1}.0`;
  if (how === "patch") return `${a}.${b}.${c + 1}`;
  die(`no entiendo «${how}»: usá patch, minor, major o un número como 1.2.3`);
}

function replaceIn(file, from, to) {
  const p = path.join(ROOT, file);
  const s = fs.readFileSync(p, "utf8");
  if (!from.test(s)) die(`no encontré la versión en ${file}`);
  fs.writeFileSync(p, s.replace(from, to));
}

// ── Checks before touching anything ───────────────────────────────────────
if (!fs.existsSync(KEY)) die(`falta la clave de firma: ${KEY}`);
if (run("git", ["status", "--porcelain"], { capture: true })) die("hay cambios sin commitear: commiteá o guardalos antes de publicar");

const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const current = conf.version;
const version = nextVersion(current, process.argv[2] || "patch");
const notes = process.argv[3] || `Eureka ${version}`;
console.log(`\nPublicando Eureka ${current} → ${version}\n`);

// ── 1. Version, commit and tag ────────────────────────────────────────────
replaceIn("package.json", /"version": "[^"]+"/, `"version": "${version}"`);
replaceIn("src-tauri/tauri.conf.json", /"version": "[^"]+"/, `"version": "${version}"`);
replaceIn("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
// Cargo.lock follows Cargo.toml.
run("cargo", ["update", "--manifest-path", "src-tauri/Cargo.toml", "-p", "eureka", "--offline"]);

// ── 2. Signed installer, with the update source built in ──────────────────
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(KEY, "utf8").trim(),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  EUREKA_UPDATE_REPO: REPO,
  CARGO_TARGET_DIR: TARGET,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "6",
  TEMP: "D:/dev-cache/tmp",
  TMP: "D:/dev-cache/tmp",
};
run("npx", ["tauri", "build"], { env });

const nsis = path.join(TARGET, "release/bundle/nsis");
const installer = fs.readdirSync(nsis).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
if (!installer) die(`no encontré el instalador de la ${version} en ${nsis}`);
const signature = fs.readFileSync(path.join(nsis, `${installer}.sig`), "utf8").trim();

// Only now, with the installer built, is the version committed.
run("git", ["add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
run("git", ["commit", "-m", `Eureka ${version}`]);
run("git", ["tag", `v${version}`]);
run("git", ["push", "origin", "HEAD", `v${version}`]);

// ── 3. Release: the installer first (its download url goes in latest.json) ──
run("gh", ["release", "create", `v${version}`, path.join(nsis, installer), "--repo", REPO, "--title", `Eureka ${version}`, "--notes", notes]);
const url = run("gh", ["api", `repos/${REPO}/releases/tags/v${version}`, "--jq", `.assets[] | select(.name == "${installer}") | .browser_download_url`], { capture: true });
if (!url) die("el release no tiene el instalador");

const manifest = path.join(os.tmpdir(), "latest.json");
fs.writeFileSync(manifest, JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": { signature, url } } }, null, 2));
run("gh", ["release", "upload", `v${version}`, manifest, "--repo", REPO, "--clobber"]);
fs.rmSync(manifest, { force: true });

console.log(`\n✓ Eureka ${version} publicada. Las copias instaladas la ven la próxima vez que se abren.`);
console.log(`  Instalador: ${path.join(nsis, installer)}`);
