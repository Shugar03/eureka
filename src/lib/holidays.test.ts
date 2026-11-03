import { describe, expect, it } from "vitest";
import { argentinaHolidays, easter, holidaysBetween, moved } from "./holidays";

describe("Argentina's national holidays (AC-145)", () => {
  it("finds Easter", () => {
    expect([2024, 2025, 2026, 2027].map(easter)).toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28"]);
  });

  it("moves the trasladables to a Monday", () => {
    expect(moved("2026-06-17")).toBe("2026-06-15"); // Wednesday → Monday before
    expect(moved("2026-11-20")).toBe("2026-11-23"); // Friday → Monday after
    expect(moved("2021-06-17")).toBe("2021-06-21"); // Thursday → Monday after
    expect(moved("2026-10-12")).toBe("2026-10-12"); // already Monday
    expect(moved("2027-11-20")).toBe("2027-11-20"); // Saturday stays
  });

  it("gives 2026 as published", () => {
    expect(argentinaHolidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01",
      "2026-02-16",
      "2026-02-17",
      "2026-03-24",
      "2026-04-02",
      "2026-04-03",
      "2026-05-01",
      "2026-05-25",
      "2026-06-15",
      "2026-06-20",
      "2026-07-09",
      "2026-08-17",
      "2026-10-12",
      "2026-11-23",
      "2026-12-08",
      "2026-12-25",
    ]);
  });

  it("lists the ones in a term, across years", () => {
    expect(holidaysBetween("2026-11-01", "2027-01-01").map((h) => h.name)).toEqual(["Día de la Soberanía Nacional", "Inmaculada Concepción de María", "Navidad", "Año Nuevo"]);
  });
});
