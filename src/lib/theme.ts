// UI theme: dark by default; the choice is remembered per machine.
export type Theme = "dark" | "light" | "system";

const KEY = "la.theme";

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Storage unavailable: the theme still applies for this run.
  }
}
