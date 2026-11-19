// AC-207: on Windows the title bar is Eureka's own (tauri-plugin-frame injects a 32 px
// strip to drag the window and the three window buttons). This marks <html> so the layout
// leaves room for it, and names the buttons in Spanish (the plugin names them in English,
// and renames maximize/restore every time the window changes size).
const LABELS: Record<string, string> = {
  "Minimize window": "Minimizar",
  "Maximize window": "Maximizar",
  "Restore window": "Restaurar",
  "Close window": "Cerrar",
  "Window controls": "Controles de la ventana",
};

export function translateFrame(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-tauri-frame-tb], [data-tauri-frame-tb] button")) {
    const label = el.getAttribute("aria-label");
    if (label && LABELS[label]) {
      el.setAttribute("aria-label", LABELS[label]);
      // Only the buttons get a tooltip: on the bar itself it would follow the mouse everywhere up there.
      if (el.tagName === "BUTTON") el.title = LABELS[label];
    }
  }
}

export function watchTitlebar() {
  const apply = () => {
    const has = !!document.querySelector("[data-tauri-frame-tb]");
    document.documentElement.classList.toggle("has-frame", has);
    if (has) translateFrame();
  };
  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
}
