// AC-78..81: the learner's own space. A wallpaper, an accent colour (taken
// from the wallpaper or picked by hand) and a name. Everything is kept on this
// machine (localStorage) and applied as CSS variables on <html>.
import type { Theme } from "./theme";

export type Tone = "light" | "dark";

export type WallpaperChoice = { kind: "auto" } | { kind: "preset"; id: string } | { kind: "custom"; url: string } | { kind: "none" };

export interface Workspace {
  name: string;
  wallpaper: WallpaperChoice;
  /** Accent picked by hand (#rrggbb); null follows the wallpaper. */
  accent: string | null;
  /** Colours the wallpaper suggests, most present first (custom images only; presets carry theirs). */
  palette: string[];
}

export const DEFAULT_WORKSPACE: Workspace = { name: "", wallpaper: { kind: "auto" }, accent: null, palette: [] };

const KEY = "la.workspace";
const HEX = /^#[0-9a-f]{6}$/i;

export function loadWorkspace(): Workspace {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return DEFAULT_WORKSPACE;
    const w = v.wallpaper;
    const wallpaper: WallpaperChoice =
      w?.kind === "preset" && typeof w.id === "string" && PRESETS.some((p) => p.id === w.id)
        ? { kind: "preset", id: w.id }
        : w?.kind === "custom" && typeof w.url === "string" && w.url.startsWith("data:image/")
          ? { kind: "custom", url: w.url }
          : w?.kind === "none"
            ? { kind: "none" }
            : { kind: "auto" };
    return {
      name: typeof v.name === "string" ? v.name.slice(0, 40) : "",
      wallpaper,
      accent: typeof v.accent === "string" && HEX.test(v.accent) ? v.accent.toLowerCase() : null,
      palette: Array.isArray(v.palette) ? v.palette.filter((c: unknown): c is string => typeof c === "string" && HEX.test(c)).slice(0, 5) : [],
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

/** False when storage refuses (private window, quota): the space still applies for this run. */
export function saveWorkspace(w: Workspace): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}

// ── Colour maths ──────────────────────────────────────────────────────────

export type Rgb = [number, number, number];
export type Hsl = [number, number, number]; // h 0–360, s and l 0–1

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const hslHex = (h: Hsl) => rgbToHex(hslToRgb(h));

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const HUE_NAMES: [string, number][] = [
  ["rojo", 0],
  ["naranja", 30],
  ["amarillo", 55],
  ["verde", 110],
  ["turquesa", 170],
  ["celeste", 200],
  ["azul", 225],
  ["violeta", 275],
  ["rosa", 325],
];

/** A colour's name in Spanish ("rojo", "azul"…), for labels. */
export function colorName(hex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (s < 0.12) return l > 0.6 ? "gris claro" : "gris";
  let best = HUE_NAMES[0];
  let gap = 360;
  for (const n of HUE_NAMES) {
    const d = Math.min(Math.abs(h - n[1]), 360 - Math.abs(h - n[1]));
    if (d < gap) [best, gap] = [n, d];
  }
  return best[0];
}

// ── Accent ────────────────────────────────────────────────────────────────

/** Where text sits: the frosted panel's colour, approximately, per theme. */
const PANEL: Record<Tone, string> = { dark: "#1e2532", light: "#faf4ec" };
export const DEFAULT_ACCENT: Record<Tone, string> = { dark: "#a89ccf", light: "#c98562" };

/**
 * The CSS variables for an accent. Calm on purpose: saturation capped, and
 * every pairing is checked — text on the accent fill, and the accent as text
 * on the panel, both ≥ 4.5:1.
 */
export function deriveAccent(hex: string, tone: Tone): Record<string, string> {
  let [h, s, l] = rgbToHsl(hexToRgb(HEX.test(hex) ? hex : DEFAULT_ACCENT[tone]));
  s = Math.min(Math.max(s, 0.18), 0.62);
  l = Math.min(Math.max(l, 0.34), 0.68);
  // Fill: white text if it reads, else dark text; darken until one does.
  const DARK_TEXT = "#14161a";
  let fill = hslHex([h, s, l]);
  let text = "#ffffff";
  for (let i = 0; i < 20; i++) {
    fill = hslHex([h, s, l]);
    if (contrast(fill, "#ffffff") >= 4.5) break;
    if (contrast(fill, DARK_TEXT) >= 4.5) {
      text = DARK_TEXT;
      break;
    }
    l -= 0.02;
  }
  // Ink: the accent as text on the panel.
  let ink: Hsl = [h, s, l];
  for (let i = 0; i < 30 && contrast(hslHex(ink), PANEL[tone]) < 4.6; i++) ink = [h, s, Math.min(0.92, Math.max(0.08, ink[2] + (tone === "dark" ? 0.025 : -0.025)))];
  const [r, g, b] = hexToRgb(fill);
  return {
    "--accent": fill,
    "--accent-text": text,
    "--accent-hover": hslHex([h, s, Math.min(0.9, Math.max(0.1, l + (text === "#ffffff" ? -0.05 : 0.05)))]),
    "--accent-ink": hslHex(ink),
    "--accent-soft": `rgba(${r}, ${g}, ${b}, ${tone === "dark" ? 0.2 : 0.14})`,
    "--accent-ring": `rgba(${r}, ${g}, ${b}, 0.55)`,
  };
}

// ── Colours of an image ───────────────────────────────────────────────────

export interface Swatch {
  hex: string;
  name: string;
  /** Share of the image's colourful pixels (0–1). */
  share: number;
}

/**
 * The predominant colours of RGBA pixels: greys, near-black and near-white are
 * ignored; the rest is grouped in 12 hue families and ranked by how much
 * colour they carry. Each swatch is the family's average, softened.
 */
export function dominantColors(pixels: ArrayLike<number>, max = 4): Swatch[] {
  const fam = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    const [h, s, l] = rgbToHsl([pixels[i], pixels[i + 1], pixels[i + 2]]);
    if (s < 0.16 || l < 0.12 || l > 0.93) continue;
    const w = s * (1 - Math.abs(2 * l - 1));
    const f = fam[Math.floor(((h + 15) % 360) / 30)];
    f.w += w;
    f.r += pixels[i] * w;
    f.g += pixels[i + 1] * w;
    f.b += pixels[i + 2] * w;
    total += w;
  }
  if (total === 0) return [];
  return fam
    .filter((f) => f.w / total >= 0.05)
    .sort((a, b) => b.w - a.w)
    .slice(0, max)
    .map((f) => {
      const [h, s, l] = rgbToHsl([f.r / f.w, f.g / f.w, f.b / f.w]);
      const hex = hslHex([h, Math.min(Math.max(s, 0.3), 0.65), Math.min(Math.max(l, 0.4), 0.62)]);
      return { hex, name: colorName(hex), share: f.w / total };
    });
}

/** Draws the image small and reads its colours. Resolves [] if the browser can't. */
export function swatchesFromUrl(url: string): Promise<Swatch[]> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve([]);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 96;
        c.height = 54;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(dominantColors(ctx.getImageData(0, 0, c.width, c.height).data));
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

const MAX_EDGE = 1920;
const MAX_BYTES = 2_500_000;

/** A picked image → a JPEG data URL, scaled to the screen so it fits in storage. */
export async function readWallpaper(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Elegí una imagen (JPG, PNG o WebP).");
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("No pude leer esa imagen."));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Esa imagen no se pudo abrir."));
    i.src = src;
  });
  const k = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.85, 0.72, 0.6, 0.45]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length <= MAX_BYTES) return url;
  }
  throw new Error("La imagen es demasiado pesada. Probá con una más chica.");
}

// ── Built-in wallpapers ───────────────────────────────────────────────────
// Landscapes drawn in code: no files to ship, always sharp, and calm.

interface Scene {
  id: string;
  label: string;
  tone: Tone;
  sky: [string, string, string];
  glow: { x: number; y: number; r: number; color: string; opacity: number };
  orb?: { x: number; y: number; r: number; color: string };
  /** Back to front. */
  ridges: { base: number; amp: number; color: string; seed: number }[];
  water: [string, string];
  /** Where the sky ends, 0–1 of the height. */
  horizon: number;
  /** Suggested accents, most fitting first. */
  accents: string[];
}

const SCENES: Scene[] = [
  {
    id: "amanecer",
    label: "Lago al amanecer",
    tone: "light",
    sky: ["#f1d9c8", "#f8e6d6", "#fbf1e6"],
    glow: { x: 0.52, y: 0.5, r: 520, color: "#ffd9b0", opacity: 0.85 },
    orb: { x: 0.52, y: 0.46, r: 34, color: "#fff1dc" },
    ridges: [
      { base: 0.5, amp: 150, color: "#d9bfb4", seed: 1.3 },
      { base: 0.56, amp: 110, color: "#c9aba6", seed: 4.1 },
      { base: 0.62, amp: 70, color: "#b59a9a", seed: 7.7 },
    ],
    water: ["#e9cfc0", "#f6e6d8"],
    horizon: 0.64,
    accents: ["#d98b62", "#b9786f", "#8d9bb8"],
  },
  {
    id: "noche",
    label: "Lago nocturno",
    tone: "dark",
    sky: ["#0e121a", "#1a212e", "#4f4749"],
    glow: { x: 0.74, y: 0.42, r: 480, color: "#e8a36d", opacity: 0.55 },
    orb: { x: 0.74, y: 0.34, r: 26, color: "#f3c391" },
    ridges: [
      { base: 0.52, amp: 160, color: "#2a3140", seed: 2.2 },
      { base: 0.58, amp: 120, color: "#1f2532", seed: 5.4 },
      { base: 0.64, amp: 80, color: "#161b25", seed: 8.8 },
    ],
    water: ["#1f2634", "#0e121a"],
    horizon: 0.66,
    accents: ["#a89ccf", "#e0a070", "#8fa6d6"],
  },
  {
    id: "bosque",
    label: "Bosque entre la niebla",
    tone: "light",
    sky: ["#dfe8dc", "#eaf0e4", "#f4f4ea"],
    glow: { x: 0.3, y: 0.42, r: 560, color: "#fffbe6", opacity: 0.8 },
    orb: { x: 0.3, y: 0.38, r: 30, color: "#fffdf0" },
    ridges: [
      { base: 0.48, amp: 130, color: "#b7c9b4", seed: 0.7 },
      { base: 0.55, amp: 110, color: "#8fa98d", seed: 3.3 },
      { base: 0.63, amp: 90, color: "#6c8a6f", seed: 6.6 },
    ],
    water: ["#cfdccc", "#e6eee0"],
    horizon: 0.68,
    accents: ["#5f8f68", "#c9a35e", "#7d9bb0"],
  },
  {
    id: "atardecer",
    label: "Atardecer",
    tone: "dark",
    sky: ["#2a1530", "#7a2f3d", "#e9895a"],
    glow: { x: 0.5, y: 0.6, r: 620, color: "#ffb36b", opacity: 0.7 },
    orb: { x: 0.5, y: 0.56, r: 44, color: "#ffd9a0" },
    ridges: [
      { base: 0.58, amp: 140, color: "#6a2a3c", seed: 2.9 },
      { base: 0.63, amp: 100, color: "#45213a", seed: 5.9 },
      { base: 0.68, amp: 70, color: "#2a1630", seed: 9.1 },
    ],
    water: ["#7a3040", "#2a1530"],
    horizon: 0.7,
    accents: ["#e0675a", "#e8a35e", "#c26a9a"],
  },
  {
    id: "oceano",
    label: "Océano en calma",
    tone: "light",
    sky: ["#cfe4ee", "#e2f0f4", "#f2f7f5"],
    glow: { x: 0.65, y: 0.5, r: 520, color: "#ffffff", opacity: 0.7 },
    orb: { x: 0.65, y: 0.44, r: 28, color: "#fffef8" },
    ridges: [
      { base: 0.56, amp: 70, color: "#a9c9d3", seed: 1.9 },
      { base: 0.6, amp: 50, color: "#8fb7c4", seed: 4.7 },
    ],
    water: ["#9cc7d4", "#d6eaee"],
    horizon: 0.62,
    accents: ["#4f9bb5", "#6fb3a0", "#7d8fc4"],
  },
  {
    id: "lavanda",
    label: "Dunas de lavanda",
    tone: "dark",
    sky: ["#1a1838", "#3f3a73", "#a58fc0"],
    glow: { x: 0.35, y: 0.5, r: 540, color: "#d9b8f0", opacity: 0.5 },
    orb: { x: 0.35, y: 0.42, r: 30, color: "#f1e2ff" },
    ridges: [
      { base: 0.56, amp: 110, color: "#4c4488", seed: 3.1 },
      { base: 0.62, amp: 90, color: "#38346e", seed: 6.2 },
      { base: 0.69, amp: 60, color: "#221f4a", seed: 9.5 },
    ],
    water: ["#35306a", "#14122c"],
    horizon: 0.72,
    accents: ["#9a86d6", "#d68ab5", "#6f9ad0"],
  },
];

export const PRESETS = SCENES.map(({ id, label, tone, accents }) => ({ id, label, tone, accents }));

const W = 1600;
const H = 900;

function ridgePath(base: number, amp: number, seed: number): string {
  const y0 = base * H;
  const pts: string[] = [];
  for (let x = 0; x <= W; x += 16) {
    const t = x / W;
    const peak = 0.55 * Math.abs(Math.sin(t * 5.2 + seed)) + 0.3 * Math.abs(Math.sin(t * 11.3 + seed * 2.1)) + 0.15 * Math.sin(t * 23 + seed * 3.7);
    pts.push(`${x} ${(y0 - amp * (peak - 0.3)).toFixed(1)}`);
  }
  return `M0 ${H} L${pts.join(" L")} L${W} ${H} Z`;
}

/** The wallpaper as an SVG string (deterministic). */
export function sceneSvg(id: string): string {
  const s = SCENES.find((x) => x.id === id) ?? SCENES[0];
  const hy = s.horizon * H;
  const orb = s.orb;
  const ridges = s.ridges.map((r) => `<path d="${ridgePath(r.base, r.amp, r.seed)}" fill="${r.color}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset=".55" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="${s.glow.color}" stop-opacity="${s.glow.opacity}"/><stop offset="1" stop-color="${s.glow.color}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.water[0]}"/><stop offset="1" stop-color="${s.water[1]}"/></linearGradient>` +
    `<clipPath id="wc"><rect x="0" y="${hy}" width="${W}" height="${H - hy}"/></clipPath>` +
    `<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>` +
    `</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/>` +
    `<circle cx="${s.glow.x * W}" cy="${s.glow.y * H}" r="${s.glow.r}" fill="url(#glow)"/>` +
    (orb ? `<circle cx="${orb.x * W}" cy="${orb.y * H}" r="${orb.r}" fill="${orb.color}"/>` : "") +
    `<g id="ridges">${ridges}</g>` +
    `<rect y="${hy}" width="${W}" height="${H - hy}" fill="url(#water)"/>` +
    `<g clip-path="url(#wc)">` +
    `<use href="#ridges" transform="translate(0 ${2 * hy}) scale(1 -1)" opacity=".28" filter="url(#soft)"/>` +
    (orb ? `<ellipse cx="${orb.x * W}" cy="${hy + 90}" rx="${orb.r * 1.4}" ry="150" fill="${orb.color}" opacity=".22" filter="url(#soft)"/>` : "") +
    `</g>` +
    `</svg>`
  );
}

export function sceneUrl(id: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(sceneSvg(id))}`;
}

// ── Resolving a workspace ─────────────────────────────────────────────────

export function resolveTheme(t: Theme): Tone {
  if (t !== "system") return t;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** The image to show, or null for a plain calm background. */
export function wallpaperUrl(w: Workspace, tone: Tone): string | null {
  switch (w.wallpaper.kind) {
    case "none":
      return null;
    case "custom":
      return w.wallpaper.url;
    case "preset":
      return sceneUrl(w.wallpaper.id);
    default:
      return sceneUrl(tone === "light" ? "amanecer" : "noche");
  }
}

/** The colours the current wallpaper suggests, most fitting first. */
export function suggestedAccents(w: Workspace, tone: Tone): string[] {
  if (w.wallpaper.kind === "preset") {
    const id = w.wallpaper.id;
    return PRESETS.find((p) => p.id === id)?.accents ?? [];
  }
  if (w.wallpaper.kind === "custom") return w.palette;
  if (w.wallpaper.kind === "auto") return PRESETS.find((p) => p.id === (tone === "light" ? "amanecer" : "noche"))!.accents;
  return [];
}

/** The accent in force: the hand-picked one, else the wallpaper's first suggestion, else the default. */
export function effectiveAccent(w: Workspace, tone: Tone): string {
  return w.accent ?? suggestedAccents(w, tone)[0] ?? DEFAULT_ACCENT[tone];
}

/** "Buenos días", "Buenas tardes" or "Buenas noches" — with the name, if any. */
export function greeting(name: string, now: Date = new Date()): string {
  const h = now.getHours();
  const g = h >= 6 && h < 13 ? "Buenos días" : h >= 13 && h < 20 ? "Buenas tardes" : "Buenas noches";
  return name.trim() ? `${g}, ${name.trim()}` : g;
}

/** Writes the workspace onto <html>: accent variables, wallpaper and tone. */
export function applyWorkspace(w: Workspace, tone: Tone) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(deriveAccent(effectiveAccent(w, tone), tone))) root.style.setProperty(k, v);
  const url = wallpaperUrl(w, tone);
  if (url) root.style.setProperty("--wallpaper", `url("${url}")`);
  else root.style.removeProperty("--wallpaper");
  root.dataset.wallpaper = url ? "image" : "none";
  root.dataset.tone = tone;
}
