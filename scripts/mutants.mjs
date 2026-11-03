// Runs cargo-mutants with its scratch copies OUTSIDE the system temp dir:
// each job copies the crate and builds it (GBs), which filled C:.
// LA_TMP overrides the location (default D:/dev-cache/tmp).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const tmp = process.env.LA_TMP ?? "D:/dev-cache/tmp";
mkdirSync(tmp, { recursive: true });
const r = spawnSync("cargo", ["mutants", ...process.argv.slice(2)], {
  cwd: new URL("../src-tauri/", import.meta.url),
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp },
});
process.exit(r.status ?? 1);
