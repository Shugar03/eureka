import { describe, expect, it } from "vitest";
import { addDays } from "./cards";
import { streak } from "./streak";

// 2026-10-29 is a Thursday; its week runs from Monday 26 to Sunday 1.
const TODAY = "2026-10-29";
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("kind streak (AC-141)", () => {
  it("starts at zero with an inviting word, never a reproach", () => {
    const s = streak([], TODAY);
    expect(s).toMatchObject({ current: 0, best: 0, activeToday: false });
    expect(s.message).toBe("Hoy puede ser el día uno.");
    expect(s.week.map((d) => d.letter).join("")).toBe("LMMJVSD");
    expect(s.week.slice(0, 3).every((d) => d.state === "idle")).toBe(true);
    expect(s.week[3].state).toBe("today");
    expect(s.week.slice(4).every((d) => d.state === "future")).toBe(true);
  });

  it("one rest day per week keeps it alive", () => {
    const s = streak(["2026-10-26", "2026-10-27", TODAY], TODAY);
    expect(s.current).toBe(3);
    expect(s.restUsed).toBe(true);
    expect(s.week.map((d) => d.state).slice(0, 4)).toEqual(["done", "done", "rest", "done"]);
    expect(s.message).toBe("3 días con estudio. Hoy ya sumaste.");
  });

  it("today still to come doesn't break it, and offers the rest day", () => {
    const s = streak(range("2026-10-26", "2026-10-28"), TODAY);
    expect(s).toMatchObject({ current: 3, activeToday: false, restUsed: false });
    expect(s.message).toContain("día libre");
  });

  it("rest days in different weeks don't add up against it", () => {
    const days = range("2026-10-12", TODAY).filter((d) => d !== "2026-10-18" && d !== "2026-10-19");
    expect(streak(days, TODAY).current).toBe(16);
  });

  it("a second missed day in the same week starts again, and says 'volviste'", () => {
    // Monday 19 to Friday 23 studied, the weekend off (two days of that week),
    // then nothing until today.
    const s = streak([...range("2026-10-19", "2026-10-23"), TODAY], TODAY);
    expect(s.current).toBe(1);
    expect(s.best).toBe(5);
    expect(s.message).toBe("Volviste. Lo que aprendiste sigue ahí.");
    expect(s.week.map((d) => d.state).slice(0, 3)).toEqual(["rest", "gap", "gap"]);
  });

  it("the best streak is remembered", () => {
    const s = streak([...range("2026-09-01", "2026-09-20"), "2026-10-27"], TODAY);
    expect(s.best).toBe(20);
    expect(s.current).toBe(1);
  });

  it("no message ever says the streak was lost", () => {
    const cases = [[], [TODAY], ["2026-10-01"], range("2026-10-01", "2026-10-28"), [...range("2026-10-19", "2026-10-23"), TODAY]];
    for (const c of cases) expect(streak(c, TODAY).message).not.toMatch(/perd|fall|romp/i);
  });
});
