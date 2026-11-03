// AC-95: "Lo que noté" — patterns in what the person wrote down, computed on
// this machine from the journal. Descriptive, never causal or clinical: each
// one is a guess the person confirms or rejects, and nothing is shown until
// there is enough to say anything.
import type { JournalEntry } from "../types";

export type InsightTheme = "mood" | "time" | "emotion" | "help" | "thought";

export interface Insight {
  /** Stable, so the person's answer sticks (letters, digits, - and _). */
  key: string;
  theme: InsightTheme;
  title: string;
  detail: string;
}

/** Fewer entries than this and nothing is said. */
export const MIN_MOODS = 8;
const TREND_MIN = 3;
const TREND_GAP = 0.5;
const GROUP_GAP = 0.7;
const MAX_INSIGHTS = 6;

const WEEKDAYS = ["los domingos", "los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados"];
const DAYPARTS = [
  { id: "manana", label: "por la mañana", from: 5, to: 12 },
  { id: "tarde", label: "por la tarde", from: 12, to: 19 },
  { id: "noche", label: "por la noche", from: 19, to: 29 },
];

const num = (n: number) => n.toFixed(1).replace(".", ",");
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

function count<T extends string>(items: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function computeInsights(entries: JournalEntry[], now: Date = new Date()): Insight[] {
  const out: Insight[] = [];
  const rated = entries.filter((e) => e.mood !== null).map((e) => ({ mood: e.mood as number, at: new Date(e.at), emotions: e.emotions }));

  if (rated.length >= MIN_MOODS) {
    const overall = avg(rated.map((r) => r.mood));

    // 1. This week against the one before.
    const age = (d: Date) => Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
    const recent = rated.filter((r) => age(r.at) >= 0 && age(r.at) <= 6).map((r) => r.mood);
    const before = rated.filter((r) => age(r.at) >= 7 && age(r.at) <= 13).map((r) => r.mood);
    if (recent.length >= TREND_MIN && before.length >= TREND_MIN) {
      const gap = avg(recent) - avg(before);
      if (Math.abs(gap) >= TREND_GAP) {
        out.push({
          key: gap > 0 ? "trend-up" : "trend-down",
          theme: "mood",
          title: gap > 0 ? "Esta semana te anotaste un poco mejor" : "Esta semana te anotaste un poco más abajo",
          detail: `En los últimos 7 días tu ánimo anotado promedió ${num(avg(recent))}, contra ${num(avg(before))} la semana anterior (de 1 a 5).`,
        });
      }
    }

    // 2. Weekdays that stand out.
    const byDay = new Map<number, number[]>();
    for (const r of rated) byDay.set(r.at.getDay(), [...(byDay.get(r.at.getDay()) ?? []), r.mood]);
    const days = [...byDay].filter(([, v]) => v.length >= 2).map(([d, v]) => ({ d, a: avg(v), n: v.length }));
    const low = days.filter((x) => overall - x.a >= GROUP_GAP).sort((a, b) => a.a - b.a)[0];
    const high = days.filter((x) => x.a - overall >= GROUP_GAP).sort((a, b) => b.a - a.a)[0];
    if (low) out.push({ key: `weekday-low-${low.d}`, theme: "time", title: `${cap(WEEKDAYS[low.d])} suelen costarte más`, detail: `Lo que anotaste esos días promedia ${num(low.a)}, contra ${num(overall)} en general (${low.n} anotaciones).` });
    if (high) out.push({ key: `weekday-high-${high.d}`, theme: "time", title: `${cap(WEEKDAYS[high.d])} suelen ir mejor`, detail: `Lo que anotaste esos días promedia ${num(high.a)}, contra ${num(overall)} en general (${high.n} anotaciones).` });

    // 3. Moments of the day.
    const part = (d: Date) => {
      const h = d.getHours() < 5 ? d.getHours() + 24 : d.getHours();
      return DAYPARTS.find((p) => h >= p.from && h < p.to)!;
    };
    const byPart = new Map<string, { label: string; v: number[] }>();
    for (const r of rated) {
      const p = part(r.at);
      byPart.set(p.id, { label: p.label, v: [...(byPart.get(p.id)?.v ?? []), r.mood] });
    }
    const dip = [...byPart].filter(([, g]) => g.v.length >= 3 && overall - avg(g.v) >= GROUP_GAP).sort((a, b) => avg(a[1].v) - avg(b[1].v))[0];
    if (dip) out.push({ key: `daypart-low-${dip[0]}`, theme: "time", title: `Tu ánimo anotado suele bajar ${dip[1].label}`, detail: `Promedia ${num(avg(dip[1].v))} ${dip[1].label}, contra ${num(overall)} en general (${dip[1].v.length} anotaciones).` });

    // 4. Emotions that come with the hard moments.
    const hard = count(rated.filter((r) => r.mood <= 2).flatMap((r) => r.emotions)).find(([, n]) => n >= 3);
    if (hard) out.push({ key: `emotion-hard-${slug(hard[0])}`, theme: "emotion", title: `«${cap(hard[0])}» aparece cuando te anotás mal`, detail: `La nombraste ${hard[1]} veces en momentos en que tu ánimo estaba en 1 o 2.` });
  }

  // 5. The emotion named most (does not need moods).
  const top = count(entries.flatMap((e) => e.emotions)).find(([, n]) => n >= 4);
  if (top) out.push({ key: `emotion-top-${slug(top[0])}`, theme: "emotion", title: `La emoción que más anotaste: ${top[0]}`, detail: `La nombraste ${top[1]} veces en tu diario.` });

  // 6. What helps, in the person's own words.
  const helped = count(entries.flatMap((e) => e.helped.map((h) => h.trim().toLowerCase()).filter(Boolean))).find(([, n]) => n >= 2);
  if (helped) out.push({ key: `helped-${slug(helped[0])}`, theme: "help", title: `Te ayuda: ${helped[0]}`, detail: `Lo anotaste ${helped[1]} veces como algo que te ayudó. Está bueno tenerlo a mano.` });

  // 7. Looking at a thought again.
  const rec = entries.flatMap((e) => (e.record && e.record.after !== null && e.record.after !== undefined ? [e.record.before - e.record.after] : []));
  if (rec.length >= 2 && avg(rec) >= 10) out.push({ key: "thought-relief", theme: "thought", title: "Mirar un pensamiento de nuevo te alivia", detail: `En ${rec.length} registros de pensamientos, la intensidad bajó ${Math.round(avg(rec))} puntos en promedio después de pensarlo otra vez.` });

  return out.slice(0, MAX_INSIGHTS);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How many more anotaciones until the first patterns can show up. */
export const missingForInsights = (entries: JournalEntry[]) => Math.max(0, MIN_MOODS - entries.filter((e) => e.mood !== null).length);
