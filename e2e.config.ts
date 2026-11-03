import { existsSync } from "node:fs";
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { openrouter } from "@openrouter/ai-sdk-provider";

// e2e loads no .env by itself; OPENROUTER_API_KEY / E2E_MODEL may live there (gitignored).
const envFile = new URL(".env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Two kinds of tests (see docs/testing.md):
//  - Flow tests (tests/e2e/*.e2e.ts): locators + assertions against the app
//    running in a browser with the SCRIPTED fake backend (`vite --mode e2e`).
//    No model calls, no cost, deterministic.
//  - Agent steps (agentic.e2e.ts) and `npm run explore`: an AI agent drives the
//    UI. They read OPENROUTER_API_KEY; without it, agentic tests are skipped.
//    E2E_MODEL picks the OpenRouter model id.
export default {
  // Desktop (real app) tests have their own config: e2e.desktop.config.ts.
  tests: ["tests/e2e/**/*.e2e.ts"],
  // One worker: runs are headed (`npm run test:e2e`) so you can watch them.
  workers: 1,
  agents: {
    default: {
      model: openrouter(process.env.E2E_MODEL ?? "openai/gpt-6-luna-fast"),
      system:
        "Sos un QA meticuloso probando Eureka, una app para aprender en español. " +
        "Verificá cada resultado y reportá textos confusos, estados inconsistentes o pasos que no avanzan.",
    },
  },
  targets: [
    {
      name: "web",
      // Reduced motion: no animations or smooth scroll mid-assertion.
      engine: web({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" }),
      app: {
        url: "http://localhost:1430",
        // The runner starts the fake-backend dev server; an already running one is reused.
        // node + the vite bin: spawning npm needs a shell on Windows.
        // startupTimeout (ms): a cold cache bundles the editor languages too (well over a minute).
        command: { executable: "node", args: ["node_modules/vite/bin/vite.js", "--mode", "e2e"], reuseExisting: true, startupTimeout: 240_000 },
        // Answers only once vite has bundled its dependencies (1–2 min cold): a page
        // loaded mid-bundling mixes two builds of React and stays blank.
        readyUrl: "http://localhost:1430/node_modules/.vite/deps/react.js",
      },
    },
  ],
} satisfies E2EConfig;
