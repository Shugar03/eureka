// Interactive demo in an isolated frame (AC-28, NF-14):
// - sandbox="allow-scripts" WITHOUT allow-same-origin: opaque origin, no access
//   to the app, its storage or Tauri IPC; no top navigation, popups or forms;
// - a CSP injected as the first <meta> blocks every network request.
//
// Two views of the same demo: a compact card in the chat (DemoFrame) and a docked
// panel on the right (DemoPane) that replaces the plan while it is open.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export const DEMO_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

/**
 * Runs inside the demo (the CSP allows inline scripts) and only reports how big the content
 * really is, with postMessage: no network, no access to the app. The panel uses it to fit the
 * whole demo in the window instead of scrolling.
 */
const MEASURE_SCRIPT =
  "<script>(function(){function m(){var b=0,r=0,a=document.body?document.body.getElementsByTagName('*'):[];" +
  "for(var i=0;i<a.length;i++){var q=a[i].getBoundingClientRect();if(q.width||q.height){b=Math.max(b,q.bottom+window.scrollY);r=Math.max(r,q.right+window.scrollX)}}" +
  "parent.postMessage({eureka:'demo-size',h:Math.ceil(b),w:Math.ceil(r),iw:window.innerWidth},'*')}" +
  "var t;function s(){clearTimeout(t);t=setTimeout(m,60)}" +
  "addEventListener('load',s);addEventListener('resize',s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)})()</script>";

export function withCsp(html: string, measure = false): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}">${measure ? MEASURE_SCRIPT : ""}`;
  // Before anything else, so no earlier tag can load before the policy applies.
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`) : `${meta}${html}`;
}

/** AC-175: a bright demo can be shown with inverted colors; the choice is remembered on this device. */
const INVERT_KEY = "la.demoInvert";
function savedInvert(): boolean {
  try {
    return localStorage.getItem(INVERT_KEY) === "1";
  } catch {
    return false;
  }
}

function useInvert(): [boolean, () => void] {
  // A CSS filter on the frame itself: the demo's content and its sandbox stay untouched.
  const [inverted, setInverted] = useState(savedInvert);
  const toggle = () =>
    setInverted((v) => {
      try {
        localStorage.setItem(INVERT_KEY, v ? "0" : "1");
      } catch {
        /* the choice just isn't remembered */
      }
      return !v;
    });
  return [inverted, toggle];
}

const FIT_KEY = "la.demoFit";
function savedFit(): boolean {
  try {
    return localStorage.getItem(FIT_KEY) !== "0";
  } catch {
    return true;
  }
}

const WIDTH_KEY = "la.demoPaneW";
export const PANE_MIN = 360;
export const PANE_MAX = 960;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The width of the docked panel, remembered on this device. */
export function usePaneWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const n = Number(localStorage.getItem(WIDTH_KEY));
      return n ? clamp(n, PANE_MIN, PANE_MAX) : 520;
    } catch {
      return 520;
    }
  });
  const set = useCallback((w: number) => {
    const next = clamp(Math.round(w), PANE_MIN, PANE_MAX);
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* not remembered */
    }
  }, []);
  return [width, set];
}

/** The demo in the chat: live, small, with a way to open it in the panel. */
export function DemoFrame({ title, html, opened = false, onOpen, onClose }: { title: string; html: string; opened?: boolean; onOpen?: () => void; onClose?: () => void }) {
  const [inverted, toggleInvert] = useInvert();
  return (
    <figure className={`visual ${opened ? "is-opened" : ""}`} aria-label={`Demo: ${title}`} data-testid="demo">
      <figcaption className="visual-title">
        <span>{title}</span>
        <span className="row">
          {!opened && (
            <button type="button" className="btn ghost small" aria-pressed={inverted} onClick={toggleInvert} title="Para una demo muy clara con el tema oscuro (o al revés)">
              Invertir colores
            </button>
          )}
          {opened ? (
            <button type="button" className="btn ghost small" onClick={onClose}>
              Cerrar panel
            </button>
          ) : (
            onOpen && (
              <button type="button" className="btn ghost small" onClick={onOpen}>
                Abrir en el panel
              </button>
            )
          )}
        </span>
      </figcaption>
      {opened ? (
        <p className="muted small demo-opened">Esta demo está abierta en el panel de la derecha.</p>
      ) : (
        <iframe className={`demo-frame ${inverted ? "is-inverted" : ""}`} title={title} sandbox="allow-scripts" srcDoc={withCsp(html)} referrerPolicy="no-referrer" />
      )}
    </figure>
  );
}

const LOGICAL_MIN = 480;
const LOGICAL_MAX = 1280;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
/** The stage's padding (App.css .pane-stage): the demo is fitted to what is inside it. */
const STAGE_PAD = 10;

/**
 * The docked panel. In "Ajustar" mode the demo is laid out at a comfortable width and then scaled
 * as a whole so every part of it (illustration, controls, text) is visible without scrolling, as large
 * as the window allows. "100 %" shows it at real size with its own scroll.
 */
export function DemoPane({ title, html, width, onWidth, onClose }: { title: string; html: string; width: number; onWidth: (w: number) => void; onClose: () => void }) {
  const [inverted, toggleInvert] = useInvert();
  const [fit, setFit] = useState(savedFit);
  const [maximized, setMaximized] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  // The size the demo reported at the current layout width; null until its report arrives.
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const measuredRef = useRef(measured);
  measuredRef.current = measured;
  // The width the demo is laid out at. It starts at the stage's width and, when the window is wider than
  // the demo is tall, narrows step by step: a narrower layout is taller but scales up, so it fills more.
  const [layoutW, setLayoutW] = useState(0);
  const search = useRef<{ best: { lw: number; z: number; m: { w: number; h: number } } | null; done: boolean }>({ best: null, done: false });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const read = () => setView({ w: el.clientWidth - 2 * STAGE_PAD, h: el.clientHeight - 2 * STAGE_PAD });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maximized]);

  // A new window, or another demo, starts the search over.
  useEffect(() => {
    if (!view.w) return;
    search.current = { best: null, done: false };
    setMeasured(null);
    setLayoutW(clamp(view.w, LOGICAL_MIN, LOGICAL_MAX));
  }, [view.w, view.h, html, fit]);

  // If a demo never reports its size, show it anyway at real size after a moment instead of staying blank.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    setGaveUp(false);
    const timer = window.setTimeout(() => setGaveUp(true), 1500);
    return () => window.clearTimeout(timer);
  }, [layoutW, html, fit]);

  useEffect(() => {
    if (!fit || !layoutW) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || measuredRef.current) return;
      const d = e.data as { eureka?: string; h?: number; w?: number; iw?: number } | null;
      if (!d || d.eureka !== "demo-size" || !d.h || !d.w) return;
      // Only a report made at the width we asked for; one still in flight from the previous layout is stale.
      if (Math.abs((d.iw ?? 0) - layoutW) > 3) return;
      const m = { w: d.w, h: d.h };
      const z = clamp(Math.min(view.w / Math.max(layoutW, m.w), view.h / m.h), ZOOM_MIN, ZOOM_MAX);
      const s = search.current;
      if (s.done) return;
      if (s.best && z <= s.best.z * 1.03) {
        // Narrowing stopped paying off: go back to the best width and stay there.
        s.done = true;
        setLayoutW(s.best.lw);
        setMeasured(s.best.m);
        return;
      }
      s.best = { lw: layoutW, z, m };
      const heightSlack = view.h / m.h > view.w / Math.max(layoutW, m.w) * 1.1;
      const next = Math.round(layoutW * 0.85);
      if (heightSlack && z < ZOOM_MAX && next >= LOGICAL_MIN) {
        setLayoutW(next);
        setMeasured(null);
        return;
      }
      s.done = true;
      setMeasured(m);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [fit, layoutW, view.w, view.h]);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMaximized(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  const toggleFit = () =>
    setFit((v) => {
      try {
        localStorage.setItem(FIT_KEY, v ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !v;
    });

  // Zoom so the whole content fits both ways; the layout box is what the demo thinks its window is.
  const contentW = Math.max(layoutW, measured?.w ?? 0);
  const zoom = fit && measured && view.w && view.h ? clamp(Math.min(view.w / contentW, view.h / measured.h), ZOOM_MIN, ZOOM_MAX) : 1;
  const logicalH = fit ? Math.max(view.h / zoom, measured?.h ?? 0) : 0;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onWidth(clamp(startW + (startX - ev.clientX), PANE_MIN, Math.min(PANE_MAX, window.innerWidth * 0.7)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const gripKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") onWidth(width + 24);
    else if (e.key === "ArrowRight") onWidth(width - 24);
  };

  const cls = `demo-frame ${inverted ? "is-inverted" : ""}`;
  return (
    <aside className={`demo-pane ${maximized ? "is-max" : ""}`} aria-label={`Demo: ${title}`} data-testid="demo-pane">
      {!maximized && (
        <div className="pane-grip" role="separator" aria-orientation="vertical" aria-label="Cambiar el ancho del panel" aria-valuenow={width} aria-valuemin={PANE_MIN} aria-valuemax={PANE_MAX} tabIndex={0} onPointerDown={startDrag} onKeyDown={gripKey} />
      )}
      <header className="pane-head">
        <span className="pane-title" title={title}>
          {title}
        </span>
        <span className="row">
          <button type="button" className="btn ghost small" aria-pressed={fit} onClick={toggleFit} title="Muestra la demo completa sin scroll, lo más grande posible">
            Ajustar
          </button>
          <button type="button" className="btn ghost small" aria-pressed={inverted} onClick={toggleInvert} title="Para una demo muy clara con el tema oscuro (o al revés)">
            Invertir colores
          </button>
          <button type="button" className="btn ghost small" aria-pressed={maximized} onClick={() => setMaximized((m) => !m)}>
            {maximized ? "Restaurar (Esc)" : "Maximizar"}
          </button>
          {!maximized && (
            <button type="button" className="btn ghost small" onClick={onClose}>
              Cerrar panel
            </button>
          )}
        </span>
      </header>
      <div className="pane-stage" ref={stage}>
        {fit ? (
          <div className="pane-fit" data-testid="demo-fit" data-fitted={measured ? "true" : "false"} data-zoom={zoom.toFixed(2)} style={{ width: contentW * zoom, height: logicalH * zoom, opacity: measured || gaveUp ? 1 : 0 }}>
            <iframe ref={frame} className={cls} title={title} sandbox="allow-scripts" srcDoc={withCsp(html, true)} referrerPolicy="no-referrer" style={{ width: contentW, height: logicalH || view.h, transform: `scale(${zoom})` }} />
          </div>
        ) : (
          <iframe ref={frame} className={`${cls} is-real`} title={title} sandbox="allow-scripts" srcDoc={withCsp(html)} referrerPolicy="no-referrer" />
        )}
      </div>
    </aside>
  );
}
