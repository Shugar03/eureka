import { beforeEach, describe, expect, it } from "vitest";
import { colorName, contrast, DEFAULT_WORKSPACE, deriveAccent, dominantColors, effectiveAccent, greeting, hexToRgb, loadWorkspace, PRESETS, saveWorkspace, sceneSvg, sceneUrl, suggestedAccents, wallpaperUrl, type Workspace } from "./workspace";

/** RGBA pixels: `n` of each colour. */
const px = (...groups: [string, number][]) =>
  groups.flatMap(([hex, n]) => {
    const [r, g, b] = hexToRgb(hex);
    return Array.from({ length: n }, () => [r, g, b, 255]).flat();
  });

describe("dominantColors (AC-79)", () => {
  it("ranks hue families by how much colour they carry and names them", () => {
    const sw = dominantColors(px(["#d94a3a", 700], ["#3a6fd9", 300]));
    expect(sw.map((s) => s.name)).toEqual(["rojo", "azul"]);
    expect(sw[0].share).toBeGreaterThan(0.6);
  });

  it("ignores greys, near-black, near-white and transparent pixels", () => {
    expect(dominantColors(px(["#808080", 100], ["#050505", 100], ["#fafafa", 100]))).toEqual([]);
    expect(dominantColors([200, 40, 40, 0, 200, 40, 40, 0])).toEqual([]);
    expect(dominantColors(px(["#808080", 500], ["#4fa35a", 50])).map((s) => s.name)).toEqual(["verde"]);
  });

  it("softens what it suggests so it reads as calm", () => {
    const [hex] = dominantColors(px(["#ff0000", 100])).map((s) => s.hex);
    const [, s] = (() => {
      const [r, g, b] = hexToRgb(hex);
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      return [0, (max - min) / (1 - Math.abs(max + min - 1))];
    })();
    expect(s).toBeLessThanOrEqual(0.7);
  });
});

describe("deriveAccent (AC-79)", () => {
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ffffff", "#000000", "#808080", "#e0675a", "#8fa6d6"];
  for (const tone of ["dark", "light"] as const) {
    it(`keeps text readable for any colour (${tone})`, () => {
      for (const c of colors) {
        const v = deriveAccent(c, tone);
        expect(contrast(v["--accent"], v["--accent-text"]), `texto sobre ${c}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v["--accent-ink"], tone === "dark" ? "#1e2532" : "#faf4ec"), `acento como texto, ${c}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("falls back to the default for a broken value, and keeps the hue", () => {
    expect(deriveAccent("rojo", "dark")["--accent"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorName(deriveAccent("#d94a3a", "light")["--accent"])).toBe("rojo");
  });
});

describe("colorName", () => {
  it("says the colour in Spanish", () => {
    expect(["#d94a3a", "#e8a35e", "#e8d35e", "#5fa36b", "#4fb5a8", "#4f9bb5", "#4a6fd9", "#8a5fd0", "#d06aa8"].map(colorName)).toEqual(["rojo", "naranja", "amarillo", "verde", "turquesa", "celeste", "azul", "violeta", "rosa"]);
    expect(colorName("#888888")).toBe("gris");
  });
});

describe("wallpapers (AC-78)", () => {
  it("draws every built-in scene as a deterministic, valid SVG", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["amanecer", "noche", "bosque", "atardecer", "oceano", "lavanda"]);
    for (const p of PRESETS) {
      const a = sceneSvg(p.id);
      expect(a).toBe(sceneSvg(p.id));
      expect(a.startsWith("<svg") && a.endsWith("</svg>")).toBe(true);
      expect(new DOMParser().parseFromString(a, "image/svg+xml").querySelector("parsererror")).toBeNull();
      expect(p.accents.length).toBeGreaterThanOrEqual(3);
    }
    expect(sceneUrl("noche")).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);
  });

  it("picks the wallpaper by choice, and follows the theme when automatic", () => {
    const w = (wallpaper: Workspace["wallpaper"]): Workspace => ({ ...DEFAULT_WORKSPACE, wallpaper });
    expect(wallpaperUrl(w({ kind: "auto" }), "light")).toBe(sceneUrl("amanecer"));
    expect(wallpaperUrl(w({ kind: "auto" }), "dark")).toBe(sceneUrl("noche"));
    expect(wallpaperUrl(w({ kind: "preset", id: "bosque" }), "dark")).toBe(sceneUrl("bosque"));
    expect(wallpaperUrl(w({ kind: "custom", url: "data:image/jpeg;base64,AA" }), "dark")).toBe("data:image/jpeg;base64,AA");
    expect(wallpaperUrl(w({ kind: "none" }), "dark")).toBeNull();
  });
});

describe("the accent in force (AC-79, AC-80)", () => {
  it("follows the wallpaper until the learner picks one", () => {
    const sunset: Workspace = { ...DEFAULT_WORKSPACE, wallpaper: { kind: "preset", id: "atardecer" } };
    expect(suggestedAccents(sunset, "light")[0]).toBe("#e0675a");
    expect(effectiveAccent(sunset, "light")).toBe("#e0675a");
    expect(effectiveAccent({ ...sunset, accent: "#3366cc" }, "light")).toBe("#3366cc");
  });

  it("uses the palette read from a custom image, and a default with nothing to suggest", () => {
    const mine: Workspace = { ...DEFAULT_WORKSPACE, wallpaper: { kind: "custom", url: "data:image/jpeg;base64,AA" }, palette: ["#4f9bb5", "#d94a3a"] };
    expect(effectiveAccent(mine, "dark")).toBe("#4f9bb5");
    expect(effectiveAccent({ ...DEFAULT_WORKSPACE, wallpaper: { kind: "none" } }, "dark")).toBe("#a89ccf");
  });
});

describe("storage (AC-81)", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips, and repairs what it can't trust", () => {
    const w: Workspace = { name: "Sebastián", wallpaper: { kind: "preset", id: "lavanda" }, accent: "#AABBCC", palette: [] };
    expect(saveWorkspace(w)).toBe(true);
    expect(loadWorkspace()).toEqual({ ...w, accent: "#aabbcc" });

    localStorage.setItem("la.workspace", JSON.stringify({ name: 42, wallpaper: { kind: "preset", id: "no-existe" }, accent: "rojo", palette: ["x", "#112233"] }));
    expect(loadWorkspace()).toEqual({ name: "", wallpaper: { kind: "auto" }, accent: null, palette: ["#112233"] });
    localStorage.setItem("la.workspace", "{no json");
    expect(loadWorkspace()).toEqual(DEFAULT_WORKSPACE);
    localStorage.setItem("la.workspace", JSON.stringify({ wallpaper: { kind: "custom", url: "https://evil.example/x.png" } }));
    expect(loadWorkspace().wallpaper).toEqual({ kind: "auto" });
  });
});

describe("greeting", () => {
  it("greets by the hour, with the name when there is one", () => {
    expect(greeting("", new Date(2026, 9, 28, 8))).toBe("Buenos días");
    expect(greeting(" Ana ", new Date(2026, 9, 28, 15))).toBe("Buenas tardes, Ana");
    expect(greeting("Ana", new Date(2026, 9, 28, 23))).toBe("Buenas noches, Ana");
    expect(greeting("", new Date(2026, 9, 28, 3))).toBe("Buenas noches");
  });
});
