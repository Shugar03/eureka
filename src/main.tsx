import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PomodoroProvider } from "./components/pomodoro/PomodoroContext";
import { applyTheme, loadTheme } from "./lib/theme";
import { DemoBadge } from "./components/DemoBadge";

// Before the first paint, so there is no light flash.
applyTheme(loadTheme());

function render(demo = false) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <PomodoroProvider>
        <App />
        {demo && <DemoBadge />}
      </PomodoroProvider>
    </React.StrictMode>,
  );
}

// `vite --mode e2e`: run in a plain browser against the scripted fake backend.
if (import.meta.env.MODE === "e2e") {
  import("./e2e/mockBackend").then((m) => {
    m.install();
    render(true);
  });
} else {
  render();
}
