// AC-130..133: the bank of quotes. One for every day of the year (and one for
// February 29), each with its author and work. The bank is a JSON file that
// ships with the app; what the learner does with it (favourites, hidden,
// their own quotes) lives on this machine, in localStorage.
import data from "../data/quotes.json";

export interface Quote {
  id: string;
  /** "MM-DD" in a leap-year calendar; null for the few spare quotes. */
  day: string | null;
  text: string;
  author: string;
  /** Where it comes from: "Meditaciones, V, 1". */
  work: string;
  /** True when the Spanish text is the author's own; false for a free translation. */
  original: boolean;
  themes: string[];
}

/** What the screen shows: a bank quote or one the learner wrote. */
export interface ShownQuote {
  id: string;
  text: string;
  author: string;
  work: string;
  original: boolean;
  mine: boolean;
}

export interface MyQuote {
  id: string;
  text: string;
  author: string;
}

export interface QuotePrefs {
  favorites: string[];
  hidden: string[];
  mine: MyQuote[];
  /** Shown by "Otra cita" since the last full round. */
  seen: string[];
  /** Welcome quote when the app opens; null = the default (on, except in automated runs). */
  splash: boolean | null;
}

export const QUOTES: Quote[] = data as Quote[];
export const DATED: Quote[] = QUOTES.filter((q) => q.day !== null).sort((a, b) => (a.day! < b.day! ? -1 : 1));
const BY_DAY = new Map(DATED.map((q) => [q.day!, q]));

export const MAX_MINE = 100;
const MAX_TEXT = 300;
const MAX_AUTHOR = 80;

const pad = (n: number) => String(n).padStart(2, "0");

/** "MM-DD" of a date, in the learner's own calendar day. */
export const dayKey = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toShown = (q: Quote): ShownQuote => ({ id: q.id, text: q.text, author: q.author, work: q.work, original: q.original, mine: false });
export const mineToShown = (q: MyQuote): ShownQuote => ({ id: q.id, text: q.text, author: q.author, work: "", original: true, mine: true });

/** The quote of the day: the same one all day, and every year on the same date. A hidden one gives way to the next day's. */
export function quoteOfDay(d: Date = new Date(), hidden: string[] = []): ShownQuote {
  const start = DATED.findIndex((q) => q.day === dayKey(d));
  for (let i = 0; i < DATED.length; i++) {
    const q = DATED[(Math.max(start, 0) + i) % DATED.length];
    if (!hidden.includes(q.id)) return toShown(q);
  }
  // Everything hidden: show today's anyway rather than an empty card.
  return toShown(BY_DAY.get(dayKey(d)) ?? DATED[0]);
}

/**
 * "Otra cita": a random one that has not come up yet in this round, never a
 * hidden one and never the one on screen. When the round is complete it starts again.
 */
export function pickAnother(prefs: QuotePrefs, currentId: string | null, rng: () => number = Math.random): { quote: ShownQuote; seen: string[] } {
  const hidden = new Set(prefs.hidden);
  const pool: ShownQuote[] = [...QUOTES.map(toShown), ...prefs.mine.map(mineToShown)].filter((q) => !hidden.has(q.id));
  let seen = new Set(prefs.seen);
  let fresh = pool.filter((q) => !seen.has(q.id) && q.id !== currentId);
  if (fresh.length === 0) {
    seen = new Set();
    fresh = pool.filter((q) => q.id !== currentId);
  }
  const list = fresh.length > 0 ? fresh : pool;
  const quote = list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  return { quote, seen: [...seen, quote.id] };
}

/** Finds a quote by id among the bank and the learner's own. */
export function findQuote(id: string, mine: MyQuote[]): ShownQuote | null {
  const q = QUOTES.find((x) => x.id === id);
  if (q) return toShown(q);
  const m = mine.find((x) => x.id === id);
  return m ? mineToShown(m) : null;
}

// ── What the learner keeps ───────────────────────────────────────────────

const KEY = "la.quotes";
export const EMPTY_PREFS: QuotePrefs = { favorites: [], hidden: [], mine: [], seen: [], splash: null };

const ids = (v: unknown, max = 1000): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 80))].slice(0, max) : []);

export function loadQuotePrefs(): QuotePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return EMPTY_PREFS;
    const mine = Array.isArray(v.mine)
      ? v.mine
          .filter((m: unknown): m is MyQuote => !!m && typeof (m as MyQuote).id === "string" && typeof (m as MyQuote).text === "string")
          .map((m: MyQuote) => ({ id: m.id.slice(0, 60), text: m.text.trim().slice(0, MAX_TEXT), author: typeof m.author === "string" ? m.author.trim().slice(0, MAX_AUTHOR) : "" }))
          .filter((m: MyQuote) => m.text !== "")
          .slice(0, MAX_MINE)
      : [];
    return { favorites: ids(v.favorites), hidden: ids(v.hidden), mine, seen: ids(v.seen, 600), splash: typeof v.splash === "boolean" ? v.splash : null };
  } catch {
    return EMPTY_PREFS;
  }
}

export function saveQuotePrefs(p: QuotePrefs): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** A quote the learner writes. Returns null when there is nothing to keep. */
export function makeMine(text: string, author: string, rng: () => number = Math.random): MyQuote | null {
  const t = text.trim().slice(0, MAX_TEXT);
  if (!t) return null;
  return { id: `mine-${Math.floor(rng() * 1e9).toString(36)}${Date.now().toString(36)}`, text: t, author: author.trim().slice(0, MAX_AUTHOR) };
}

/**
 * Whether the welcome quote shows when the app opens. On by default (it is the
 * point of the bank); off in automated runs so tests are not blocked; `?splash`
 * forces it on, for the tests that are about it.
 */
export function splashEnabled(prefs: QuotePrefs, search: string = typeof location === "undefined" ? "" : location.search): boolean {
  if (new URLSearchParams(search).has("splash")) return true;
  if (prefs.splash !== null) return prefs.splash;
  const automated = (typeof navigator !== "undefined" && navigator.webdriver) || import.meta.env.MODE === "test";
  return !automated;
}
