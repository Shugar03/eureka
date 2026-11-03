import { describe, expect, it } from "vitest";
import { computeInsights, MIN_MOODS, missingForInsights } from "./insights";
import { WHEEL } from "./companion";
import type { JournalEntry, ThoughtRecord } from "../types";

// Wednesday 28 Oct 2026, 15:00.
const NOW = new Date(2026, 9, 28, 15);
let n = 0;
const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 28 - daysAgo, hour).toISOString();
const e = (daysAgo: number, mood: number | null, extra: Partial<JournalEntry> = {}, hour = 12): JournalEntry => ({
  id: `e${n++}`,
  at: at(daysAgo, hour),
  kind: "checkin",
  title: "Check-in",
  text: "",
  mood,
  emotions: [],
  helped: [],
  ...extra,
});
const keys = (list: JournalEntry[]) => computeInsights(list, NOW).map((i) => i.key);

describe("computeInsights (AC-95)", () => {
  it("says nothing until there is enough to say anything", () => {
    expect(computeInsights([], NOW)).toEqual([]);
    const few = Array.from({ length: MIN_MOODS - 1 }, (_, i) => e(i, 2));
    expect(computeInsights(few, NOW)).toEqual([]);
    expect(missingForInsights(few)).toBe(1);
    expect(missingForInsights([...few, e(9, 3), e(10, null)])).toBe(0);
  });

  it("notices a week that went lower than the one before, with the numbers", () => {
    const list = [e(0, 2), e(1, 2), e(2, 1), e(3, 2), e(8, 4), e(9, 4), e(10, 5), e(11, 4)];
    const down = computeInsights(list, NOW).find((i) => i.key === "trend-down")!;
    expect(down.title).toMatch(/más abajo/);
    expect(down.detail).toContain("1,8");
    expect(down.detail).toContain("4,3");
    expect(keys([e(0, 5), e(1, 4), e(2, 5), e(3, 4), e(8, 2), e(9, 2), e(10, 3), e(11, 2)])).toContain("trend-up");
    // A small change is not a trend.
    expect(keys([e(0, 3), e(1, 3), e(2, 4), e(3, 3), e(8, 3), e(9, 3), e(10, 4), e(11, 3)])).not.toContain("trend-up");
  });

  it("notices a weekday that stands out, tied to that weekday", () => {
    // Sundays (28 Oct 2026 is a Wednesday → 3 days ago is Sunday 25th, 10 days ago the 18th).
    const list = [e(3, 1), e(10, 1), e(17, 2), e(0, 4), e(1, 4), e(2, 4), e(4, 4), e(5, 5), e(6, 4), e(7, 4)];
    const i = computeInsights(list, NOW).find((x) => x.key === "weekday-low-0")!;
    expect(i.title).toBe("Los domingos suelen costarte más");
    expect(i.detail).toMatch(/\(3 anotaciones\)/);
  });

  it("notices the part of the day that dips, but not from one or two entries", () => {
    const nights = [e(0, 1, {}, 22), e(1, 2, {}, 23), e(2, 1, {}, 21)];
    const days = [4, 4, 5, 4, 4, 5, 4, 4].map((m, i) => e(i, m, {}, 10));
    expect(keys([...days, ...nights])).toContain("daypart-low-noche");
    expect(keys([...days, nights[0], nights[1]])).not.toContain("daypart-low-noche");
  });

  it("names the emotion that comes with hard moments, and the one named most", () => {
    const hard = [e(0, 1, { emotions: ["ansiedad"] }), e(1, 2, { emotions: ["ansiedad"] }), e(2, 1, { emotions: ["ansiedad", "cansancio"] })];
    const ok = [4, 4, 5, 4, 4].map((m, i) => e(i + 3, m, { emotions: ["calma"] }));
    const k = keys([...hard, ...ok]);
    expect(k).toContain("emotion-hard-ansiedad");
    expect(keys([e(0, null, { emotions: ["calma"] }), e(1, null, { emotions: ["calma"] }), e(2, null, { emotions: ["calma"] }), e(3, null, { emotions: ["calma"] })])).toEqual(["emotion-top-calma"]);
  });

  it("remembers what helps, in the person's words, once it repeats", () => {
    expect(keys([e(0, null, { helped: ["Salir a caminar"] })])).toEqual([]);
    const list = [e(0, null, { helped: ["Salir a caminar"] }), e(1, null, { helped: ["salir a caminar", "música"] })];
    const i = computeInsights(list, NOW)[0];
    expect(i.key).toBe("helped-salir-a-caminar");
    expect(i.title).toBe("Te ayuda: salir a caminar");
  });

  it("notices that looking at a thought again lowers it, only with 2+ records", () => {
    const rec = (before: number, after: number | null): JournalEntry =>
      e(1, null, { kind: "thought", record: { situation: "s", thought: "t", before, after, for_it: "", against: "", alternative: "" } satisfies ThoughtRecord });
    expect(keys([rec(80, 40)])).toEqual([]);
    const i = computeInsights([rec(80, 40), rec(70, 50), rec(60, null)], NOW).find((x) => x.key === "thought-relief")!;
    expect(i.detail).toContain("30 puntos");
    expect(keys([rec(50, 48), rec(60, 55)])).toEqual([]);
  });

  it("keeps keys valid for the backend (letters, digits, - and _, up to 60)", () => {
    const list = [e(0, null, { helped: ["¡Ñandú, año nuevo!"] }), e(1, null, { helped: ["¡Ñandú, año nuevo!"] })];
    const [i] = computeInsights(list, NOW);
    expect(i.key).toMatch(/^[A-Za-z0-9_-]{1,60}$/);
  });

  it("shows at most six, never claiming a cause", () => {
    const all = computeInsights(
      [
        ...[3, 10, 17].map((d) => e(d, 1, { emotions: ["ansiedad"], helped: ["caminar"] }, 22)),
        ...[0, 1, 2, 4, 5, 6, 7].map((d) => e(d, 4, { emotions: ["calma"], helped: ["caminar"] }, 10)),
      ],
      NOW,
    );
    expect(all.length).toBeLessThanOrEqual(6);
    for (const i of all) expect(`${i.title} ${i.detail}`).not.toMatch(/porque|causa|debido a|depresi|ansiedad generalizada|trastorno/i);
  });
});

describe("emotion wheel (AC-94)", () => {
  it("has six families with distinct, lowercase, non-empty words", () => {
    expect(WHEEL.map((w) => w.core)).toEqual(["Alegría", "Calma", "Tristeza", "Enojo", "Miedo", "Agobio"]);
    const words = WHEEL.flatMap((w) => w.words);
    expect(new Set(words).size).toBe(words.length);
    expect(words.every((w) => w === w.toLowerCase() && w.length > 1)).toBe(true);
  });
});
