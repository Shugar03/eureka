/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // The code editor is loaded lazily: without this, Vite finds its language
  // packages on first use and reloads the whole page (mid-test, with a cold cache).
  optimizeDeps: {
    include: ["@codemirror/lang-python", "@codemirror/lang-javascript", "@codemirror/lang-rust", "@codemirror/lang-cpp", "@codemirror/lang-java", "@codemirror/lang-go", "@codemirror/lang-sql", "@codemirror/legacy-modes/mode/clike"],
  },
  // 2. tauri expects a fixed port, fail if that port is not available.
  //    `--mode e2e` (browser + mocked backend) uses its own port.
  server: {
    port: mode === "e2e" ? 1430 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/fake-provider/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    env: { VITE_E2E_DELAY: "0" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "tests/fake-provider/view.ts"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage/frontend",
    },
  },
}));
