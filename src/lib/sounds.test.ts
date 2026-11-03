import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SOUND, ding, loadSound, saveSound, soft, tick, tickSecond } from "./sounds";

describe("tickSecond (AC-97)", () => {
  it("counts the last ten seconds down and nothing before or after", () => {
    expect(tickSecond(60_000)).toBeNull();
    expect(tickSecond(10_001)).toBeNull();
    expect(tickSecond(10_000)).toBe(10);
    expect(tickSecond(9_400)).toBe(10);
    expect(tickSecond(1_000)).toBe(1);
    expect(tickSecond(1)).toBe(1);
    expect(tickSecond(0)).toBeNull();
    expect(tickSecond(-5)).toBeNull();
    expect(tickSecond(Number.NaN)).toBeNull();
    expect(tickSecond(3_000, 2)).toBeNull();
  });
});

describe("sound settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to on, remembers the choice and repairs a broken value", () => {
    expect(loadSound()).toEqual(DEFAULT_SOUND);
    saveSound({ enabled: false, tickTock: true });
    expect(loadSound()).toEqual({ enabled: false, tickTock: true });
    localStorage.setItem("la.sound", JSON.stringify({ enabled: "yes", tickTock: 3 }));
    expect(loadSound()).toEqual(DEFAULT_SOUND);
    localStorage.setItem("la.sound", "{no json");
    expect(loadSound()).toEqual(DEFAULT_SOUND);
  });

  it("never throws where there is no audio (tests, old browsers)", () => {
    expect(() => {
      tick(true);
      tick(false);
      ding();
      soft();
    }).not.toThrow();
  });
});
