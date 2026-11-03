import { beforeEach, describe, expect, it } from "vitest";
import { DATED, dayKey, EMPTY_PREFS, findQuote, loadQuotePrefs, makeMine, pickAnother, QUOTES, quoteOfDay, saveQuotePrefs, splashEnabled, type QuotePrefs } from "./quotes";

const THEMES = new Set(["comienzos", "constancia", "esfuerzo", "calma", "coraje", "error", "curiosidad", "estudio", "humildad", "tiempo", "presente", "libertad", "sentido", "amistad", "descanso", "paciencia", "esperanza"]);
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

describe("el banco de citas (AC-130)", () => {
  it("has one quote for every day of a leap year, February 29 included", () => {
    const days: string[] = [];
    for (let d = new Date(2028, 0, 1); d.getFullYear() === 2028; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
    expect(days).toHaveLength(366);
    expect(DATED.map((q) => q.day)).toEqual(days);
    expect(QUOTES.length).toBeGreaterThanOrEqual(366);
  });

  it("every quote says who and where it comes from, and none repeats", () => {
    const ids = new Set<string>();
    const texts = new Set<string>();
    for (const q of QUOTES) {
      expect(q.id, q.text).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(q.id), `id repetido ${q.id}`).toBe(false);
      ids.add(q.id);
      expect(q.text.trim().length, q.id).toBeGreaterThan(3);
      expect(q.text.length, q.id).toBeLessThanOrEqual(300);
      expect(q.author.trim(), q.id).not.toBe("");
      expect(q.work.trim(), `${q.id} sin obra`).not.toBe("");
      expect(q.themes.length, q.id).toBeGreaterThan(0);
      for (const t of q.themes) expect(THEMES.has(t), `${q.id}: tema ${t}`).toBe(true);
      expect(texts.has(norm(q.text)), `duplicada: ${q.text}`).toBe(false);
      texts.add(norm(q.text));
    }
    expect(new Set(QUOTES.map((q) => q.author)).size).toBeGreaterThanOrEqual(100);
  });

  it("leaves out well-known misattributions", () => {
    const apocryphal = [/se el cambio que quieres/, /locura es hacer lo mismo/, /no estoy de acuerdo con lo que dices/, /se tu mismo los demas puestos/, /no es el mas fuerte ni el mas inteligente/, /dime y lo olvido/, /la simplicidad es la maxima sofisticacion/];
    for (const q of QUOTES) for (const re of apocryphal) expect(norm(q.text), `${q.author}: ${q.text}`).not.toMatch(re);
  });
});

describe("quoteOfDay (AC-130)", () => {
  it("is the same all day and every year on that date, and changes the next day", () => {
    const a = quoteOfDay(new Date(2026, 9, 28, 0, 5));
    expect(quoteOfDay(new Date(2026, 9, 28, 23, 55)).id).toBe(a.id);
    expect(quoteOfDay(new Date(2031, 9, 28, 12)).id).toBe(a.id);
    expect(quoteOfDay(new Date(2026, 9, 29, 12)).id).not.toBe(a.id);
  });

  it("opens the year with a beginning and gives February 29 its own", () => {
    expect(quoteOfDay(new Date(2027, 0, 1)).text).toMatch(/Un viaje de mil leguas/);
    expect(quoteOfDay(new Date(2028, 1, 29)).id).not.toBe(quoteOfDay(new Date(2028, 2, 1)).id);
  });

  it("gives way to the next day's quote when the learner hid it", () => {
    const today = quoteOfDay(new Date(2026, 9, 28));
    const tomorrow = quoteOfDay(new Date(2026, 9, 29));
    expect(quoteOfDay(new Date(2026, 9, 28), [today.id]).id).toBe(tomorrow.id);
    expect(quoteOfDay(new Date(2026, 9, 28), DATED.map((q) => q.id)).id).toBe(today.id);
  });
});

describe("pickAnother (AC-131)", () => {
  const prefs = (p: Partial<QuotePrefs> = {}): QuotePrefs => ({ ...EMPTY_PREFS, ...p });
  let i = 0;
  const rng = () => ((i = (i * 9301 + 49297) % 233280) / 233280);

  it("never repeats until the whole bank has come up, never the one on screen, never a hidden one", () => {
    let p = prefs({ hidden: [QUOTES[0].id] });
    const seen = new Set<string>();
    let current: string | null = QUOTES[1].id;
    for (let n = 0; n < QUOTES.length - 1; n++) {
      const { quote, seen: s } = pickAnother(p, current, rng);
      expect(seen.has(quote.id), `repetida antes de tiempo: ${quote.id}`).toBe(false);
      expect(quote.id).not.toBe(QUOTES[0].id);
      expect(quote.id).not.toBe(current);
      seen.add(quote.id);
      p = { ...p, seen: s };
      current = quote.id;
    }
    // A new round starts when everything was shown.
    const next = pickAnother(p, current, rng);
    expect(next.seen).toHaveLength(1);
  });

  it("mixes in the learner's own quotes", () => {
    const mine = makeMine("  Paso a paso, Sofi.  ", " mi abuela ", () => 0.5)!;
    const p = prefs({ mine: [mine], seen: QUOTES.map((q) => q.id) });
    expect(pickAnother(p, null, rng).quote).toMatchObject({ text: "Paso a paso, Sofi.", author: "mi abuela", mine: true });
    expect(findQuote(mine.id, [mine])?.mine).toBe(true);
    expect(makeMine("   ", "x")).toBeNull();
  });
});

describe("what the learner keeps (AC-132)", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and repairs what it cannot trust", () => {
    const p: QuotePrefs = { favorites: ["a", "a", "b"], hidden: ["c"], mine: [{ id: "mine-1", text: " hola ", author: "yo" }], seen: [], splash: false };
    expect(saveQuotePrefs(p)).toBe(true);
    expect(loadQuotePrefs()).toEqual({ favorites: ["a", "b"], hidden: ["c"], mine: [{ id: "mine-1", text: "hola", author: "yo" }], seen: [], splash: false });
    localStorage.setItem("la.quotes", JSON.stringify({ favorites: [1, "x"], mine: [{ id: 3 }, { id: "m", text: "  " }], splash: "sí" }));
    expect(loadQuotePrefs()).toEqual({ ...EMPTY_PREFS, favorites: ["x"] });
    localStorage.setItem("la.quotes", "{roto");
    expect(loadQuotePrefs()).toEqual(EMPTY_PREFS);
  });
});

describe("splashEnabled (AC-133)", () => {
  it("follows the learner's choice; ?splash forces it on; by default off only in automated runs", () => {
    expect(splashEnabled({ ...EMPTY_PREFS, splash: true }, "")).toBe(true);
    expect(splashEnabled({ ...EMPTY_PREFS, splash: false }, "")).toBe(false);
    expect(splashEnabled({ ...EMPTY_PREFS, splash: false }, "?splash")).toBe(true);
    // Vitest is an automated run.
    expect(splashEnabled(EMPTY_PREFS, "")).toBe(false);
  });
});
