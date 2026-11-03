import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { launchDesktop, reconnectDesktop } from "./tests/desktop/launch.ts";

// Desktop e2e: drives the REAL Tauri app (Rust backend + WebView2) over CDP,
// against the fake OpenAI-compatible provider. Nothing is mocked inside the
// app: the agent loop, SSE parsing, tools, persistence and IPC all run for
// real. Needs the debug build (npx tauri build --debug --no-bundle).
export default {
  tests: ["tests/desktop/**/*.e2e.ts"],
  // One app window at a time (each attempt launches its own instance).
  workers: 1,
  targets: [
    {
      name: "desktop",
      engine: web({
        connect: { cdpEndpoint: launchDesktop, reconnectEndpoint: reconnectDesktop },
        reducedMotion: "reduce",
        // Attached over CDP, WebView2 doesn't flag itself as automated, so the
        // app would greet the run with the quote of the day (AC-133). Say it is.
        initScripts: [() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => true })],
      }),
      app: {
        // Tauri on Windows serves the bundled UI from this origin.
        url: "http://tauri.localhost",
        readyUrl: "http://127.0.0.1:4010/health",
        command: { executable: "node", args: ["tests/fake-provider/server.ts"], reuseExisting: true },
      },
    },
  ],
} satisfies E2EConfig;
