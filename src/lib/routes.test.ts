// AC-214..AC-217: what the route card and screens compute.
import { describe, expect, it } from "vitest";
import { currentClass, duration, endDate, nextAfter, proposalSize, weeksFor } from "./routes";
import { createRoute, mockRouteProposal, routeView } from "../e2e/routeMock";
import type { Session } from "../types";

describe("routes (AC-214..AC-217)", () => {
  it("counts what is to take: known classes are skipped", () => {
    const p = mockRouteProposal("Machine Learning");
    expect(proposalSize(p)).toEqual({ classes: 7, minutes: 470, known: 1 });
  });

  it("the end date follows the pace in whole weeks", () => {
    const from = new Date(2026, 10, 18);
    expect(weeksFor(470, 4)).toBe(2);
    expect(endDate(470, 4, from).toDateString()).toBe(new Date(2026, 11, 2).toDateString());
    expect(weeksFor(470, 2)).toBe(4);
    expect(weeksFor(10, 8)).toBe(1);
  });

  it("durations read the way people say them", () => {
    expect(duration(45)).toBe("45 min");
    expect(duration(60)).toBe("1 h");
    expect(duration(80)).toBe("1 h 20");
    expect(duration(1140)).toBe("~19 h");
  });

  it("the next class skips what is known and what is done", () => {
    const sessions = new Map<string, Session>();
    const r = createRoute(mockRouteProposal("Machine Learning"));
    r.units[0].classes[1].session_id = "s1";
    sessions.set("s1", { phase: "done", updated_at: "2026-11-18T10:00:00Z" } as Session);
    const v = routeView(r, (id) => sessions.get(id));
    expect(currentClass(v)?.cls.title).toBe("Probabilidad");
    expect(currentClass(v)?.cls.number).toBe(2);
    expect(nextAfter(v, "c2")?.title).toBe("Probabilidad");
    expect(nextAfter(v, "c8")).toBeNull();
    expect([v.done, v.total]).toEqual([1, 7]);
  });
});
