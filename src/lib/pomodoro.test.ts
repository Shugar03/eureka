import { describe, expect, it } from "vitest";
import { initial, mmss, pause, remaining, skip, start, tick, validSettings, DEFAULT_SETTINGS } from "./pomodoro";
import { duration, minutesByContext, minutesByDay, weekday } from "./study";
import type { StudyEntry } from "../types";

const S = DEFAULT_SETTINGS;
const MIN = 60_000;

describe("pomodoro state machine", () => {
  it("runs, pauses and resumes keeping the time left", () => {
    let p = start(initial(S), 0);
    expect(remaining(p, 10 * MIN)).toBe(15 * MIN);
    p = pause(p, 10 * MIN);
    expect([p.running, remaining(p, 99 * MIN)]).toEqual([false, 15 * MIN]);
    p = start(p, 100 * MIN);
    expect(p.endsAt).toBe(115 * MIN);
    expect(start(p, 0)).toBe(p);
  });

  it("a finished focus block starts its break; a finished break waits", () => {
    let p = start(initial(S), 0);
    expect(tick(p, S, 24 * MIN).finished).toBeNull();
    let r = tick(p, S, 25 * MIN + 500);
    expect(r.finished).toBe("focus");
    expect([r.state.phase, r.state.running, r.state.endsAt, r.state.done]).toEqual(["short", true, 30 * MIN, 1]);
    r = tick(r.state, S, 30 * MIN);
    expect(r.finished).toBe("short");
    expect([r.state.phase, r.state.running, r.state.remainingMs]).toEqual(["focus", false, 25 * MIN]);
  });

  it("every 4th block gets the long break, then the cycle restarts", () => {
    let p = start({ ...initial(S), done: 3 }, 0);
    const r = tick(p, S, 25 * MIN);
    expect([r.state.phase, r.state.done, r.state.remainingMs]).toEqual(["long", 0, 15 * MIN]);
    p = skip(initial(S), S);
    expect(p.phase).toBe("short");
    expect(skip({ ...initial(S), done: 3 }, S).phase).toBe("long");
    expect(skip(p, S).phase).toBe("focus");
  });

  it("works in fast mode (1 minute = 1 second) and clamps settings", () => {
    const p = start(initial({ ...S, focus: 2 }, 1000), 0);
    expect(tick(p, { ...S, focus: 2 }, 2000, 1000).finished).toBe("focus");
    expect(validSettings({ focus: 0, short: 999, long: Number.NaN, every: 1 })).toEqual({ focus: 1, short: 60, long: 15, every: 2 });
    expect([mmss(25 * MIN), mmss(61_000), mmss(400)]).toEqual(["25:00", "1:01", "0:01"]);
  });
});

describe("study totals", () => {
  const e = (day: string, minutes: number, title?: string): StudyEntry => ({ at: "", day, minutes, context: title ? { kind: "exam", id: title, title } : null });
  const log = [e("2026-10-27", 25, "AWS"), e("2026-10-27", 25, "Python"), e("2026-10-25", 50, "AWS"), e("2026-10-10", 25)];

  it("adds minutes per local day, last 7 days with zeros", () => {
    const week = minutesByDay(log, "2026-10-27");
    expect(week.map((d) => d.day)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(week.map((d) => d.minutes)).toEqual([0, 0, 0, 0, 50, 0, 50]);
  });

  it("adds minutes per context and formats durations", () => {
    expect(minutesByContext(log)).toEqual([
      { title: "AWS", minutes: 75 },
      { title: "Python", minutes: 25 },
      { title: "Sin tema", minutes: 25 },
    ]);
    expect([duration(0), duration(45), duration(90), duration(120)]).toEqual(["0 min", "45 min", "1 h 30 min", "2 h"]);
    expect(weekday("2026-10-27")).toBe("mar");
  });
});
