// Launches the REAL desktop app (src-tauri/target/debug/eureka.exe)
// for one e2e attempt and returns its WebView2 CDP endpoint.
//
// e2e's web engine needs a fresh browser per attempt (docs: reference/web
// "Recovering a CDP transport"), so every call:
//   - kills the previous instance,
//   - seeds a fresh data dir pointing at the fake provider,
//   - starts the exe with its own WebView2 profile and debugging port,
//   - waits for /json/version and returns webSocketDebuggerUrl.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const FAKE_URL = `http://127.0.0.1:${process.env.FAKE_PORT ?? 4010}`;
const EXE = resolve(import.meta.dirname, "../../src-tauri/target/debug/eureka.exe");

let current: ChildProcess | null = null;
let currentEndpoint: string | null = null;
let currentDataDir: string | null = null;
let attempt = 0;

/** The running instance's LA_DATA_DIR, to check what the app wrote to disk. */
export function dataDir(): string {
  if (!currentDataDir) throw new Error("la app no está corriendo");
  return currentDataDir;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function killApp() {
  if (current && current.exitCode === null) {
    // /T also stops the WebView2 child processes.
    spawn("taskkill", ["/PID", String(current.pid), "/T", "/F"], { stdio: "ignore" });
  }
  current = null;
}
process.on("exit", killApp);

/** The data a fresh install would have after configuring the fake provider. */
function seed(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      providers: [{ id: "fake", label: "Proveedor falso", base_url: `${FAKE_URL}/v1` }],
      roles: { teacher: { provider_id: "fake", model: "demo/profesor" }, prober: { provider_id: "", model: "" } },
      search: { base_url: FAKE_URL },
      // Past the first-run welcome (AC-89), as a person who already set it up.
      identity: { first_name: "", onboarded: true },
    }),
  );
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ fake: "sk-fake-e2e", search: "sk-search-e2e" }));
}

export async function launchDesktop(signal: AbortSignal): Promise<string> {
  if (!existsSync(EXE)) throw new Error(`No existe ${EXE}. Compilá antes: npx tauri build --debug --no-bundle`);
  killApp();
  await sleep(400);
  attempt += 1;
  const port = 9300 + (attempt % 500);
  // Inside the project (.e2e is gitignored), not the system temp dir on C:.
  const root = resolve(import.meta.dirname, "../../.e2e/desktop-runs", `${process.pid}-${attempt}`);
  seed(join(root, "data"));
  currentDataDir = join(root, "data");

  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      LA_DATA_DIR: join(root, "data"),
      WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
  });
  current = child;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !signal.aborted) {
    if (child.exitCode !== null) throw new Error(`la app terminó con código ${child.exitCode}`);
    try {
      // The debugging port opens before Tauri registers its custom protocol;
      // a navigation then is refused. Wait until the app's own page loaded.
      const tabs = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[];
      if (tabs.some((t) => t.url.startsWith("http://tauri.localhost"))) {
        const v = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
        currentEndpoint = v.webSocketDebuggerUrl;
        return currentEndpoint;
      }
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  killApp();
  throw new Error(`WebView2 no abrió el puerto de depuración ${port}`);
}

/** Same instance after a CDP disconnect. Its presence also makes the engine
 *  "persistent": it drives the app's OWN tab instead of opening a new
 *  context, whose tabs would not be served by Tauri's custom protocol. */
export async function reconnectDesktop(): Promise<string> {
  if (!currentEndpoint) throw new Error("no hay una instancia de la app para reconectar");
  return currentEndpoint;
}

/** Fake provider control (see tests/fake-provider/server.ts). */
export const fakeProvider = {
  reset: () => fetch(`${FAKE_URL}/__reset`, { method: "POST" }),
  mode: (mode: "normal" | "fail-http" | "fail-sse" | "slow" | "runaway", once = false) =>
    fetch(`${FAKE_URL}/__control`, { method: "POST", body: JSON.stringify({ mode, once }) }),
  requests: async () => (await (await fetch(`${FAKE_URL}/__requests`)).json()) as { model: string; messages: { role: string; content?: string }[] }[],
};
