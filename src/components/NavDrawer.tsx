import { useEffect, useRef, type ReactNode } from "react";
import logo from "../../assets/brand/eureka-mark.svg";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * On a phone (≤900 px, see App.css) the sidebar is a drawer: a top bar opens it,
 * the backdrop or Esc closes it, and focus stays inside while it is open.
 * On a wide window the bar is hidden and the drawer is just the sidebar.
 */
export function NavDrawer({ open, onOpen, onClose, onSearch, children }: { open: boolean; onOpen: () => void; onClose: () => void; onSearch: () => void; children: ReactNode }) {
  const drawer = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);

  // Widening the window past the phone layout closes it: there the sidebar is always shown.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia("(min-width: 901px)");
    const onChange = () => wide.matches && onClose();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    drawer.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && drawer.current) {
        const all = [...drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!all.length) return;
        const [first, last] = [all[0], all[all.length - 1]];
        const inside = drawer.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to the menu button, unless something else (the palette) took focus.
      const at = document.activeElement;
      if (!at || at === document.body || drawer.current?.contains(at)) menu.current?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      <header className="topbar">
        <button ref={menu} type="button" className="icon-btn" aria-label="Abrir menú" aria-expanded={open} aria-controls="nav-drawer" onClick={onOpen}>
          <Icon name="menu" size={20} />
        </button>
        <span className="topbar-brand">
          <img src={logo} alt="" width={22} height={22} />
          Eureka
        </span>
        <button type="button" className="icon-btn" aria-label="Buscar o ejecutar" onClick={onSearch}>
          <Icon name="search" size={18} />
        </button>
      </header>
      <div
        ref={drawer}
        id="nav-drawer"
        className={`sb-drawer ${open ? "is-open" : ""}`}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Menú" : undefined}
      >
        {children}
      </div>
      {open && <div className="sb-drawer-backdrop" data-testid="drawer-backdrop" aria-hidden onClick={onClose} />}
    </>
  );
}
