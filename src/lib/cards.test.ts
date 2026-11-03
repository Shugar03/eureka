import { describe, expect, it } from "vitest";
import { addDays, dueQueue, intervalLabel, nextInterval, review } from "./cards";
import { scriptedCards } from "../e2e/cardsScript";
import type { Card, Deck } from "../types";

const card = (over: Partial<Card> = {}): Card => ({ id: "c", front: "f", back: "b", ease: 2.5, interval: 0, reps: 0, lapses: 0, due: "2026-10-27", reviewed: null, ...over });

describe("SM-2 schedule (mirror of cards.rs)", () => {
  it("matches the Rust intervals", () => {
    const c = card({ reps: 3, interval: 10 });
    expect((["again", "hard", "good", "easy"] as const).map((g) => nextInterval(c, g))).toEqual([0, 12, 25, 33]);
    expect(nextInterval(card(), "easy")).toBe(4);
    expect(nextInterval(card({ reps: 2, interval: 1, ease: 1.3 }), "good")).toBe(2);
  });

  it("climbs 1, 3, then by ease; again resets and lowers ease", () => {
    let c = review(card(), "good", "2026-10-27");
    expect([c.interval, c.reps, c.due, c.reviewed]).toEqual([1, 1, "2026-10-28", "2026-10-27"]);
    c = review(c, "good", "2026-10-28");
    expect([c.interval, c.due]).toEqual([3, "2026-10-31"]);
    c = review(c, "good", "2026-10-31");
    expect(c.interval).toBe(8);
    c = review(c, "again", "2026-11-08");
    expect([c.interval, c.reps, c.lapses, c.due]).toEqual([0, 0, 1, "2026-11-08"]);
    expect(c.ease).toBeCloseTo(2.3);
    for (let i = 0; i < 20; i++) c = review(c, "again", "2026-11-08");
    expect(c.ease).toBe(1.3);
  });

  it("adds calendar days across months and years", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("today's queue", () => {
  it("puts overdue reviews first, then new cards up to the daily limit", () => {
    const deck: Deck = {
      id: "d",
      name: "n",
      source: { kind: "manual" },
      created_at: "",
      updated_at: "",
      cards: [
        card({ id: "new1" }),
        card({ id: "later", reviewed: "2026-10-20", due: "2026-11-01" }),
        card({ id: "today", reviewed: "2026-10-26", due: "2026-10-27" }),
        card({ id: "overdue", reviewed: "2026-10-01", due: "2026-10-10" }),
        card({ id: "new2" }),
      ],
    };
    expect(dueQueue(deck, "2026-10-27").map((c) => c.id)).toEqual(["overdue", "today", "new1", "new2"]);
    expect(dueQueue(deck, "2026-10-27", 1).map((c) => c.id)).toEqual(["overdue", "today", "new1"]);
  });

  it("labels intervals for the grade buttons", () => {
    expect([0, 1, 3, 30, 45, 200, 400, 800].map(intervalLabel)).toEqual(["hoy", "1 día", "3 días", "1 mes", "1,5 meses", "6,7 meses", "1,1 año", "2,2 años"]);
  });
});

describe("scripted card generator", () => {
  it("makes one card per item line, up to the count", () => {
    const r = scriptedCards("## Temas\n- IAM: Usuarios y roles\n- **Cifrado**\n- S3: clases", 2);
    expect(r.cards).toEqual([
      { front: "¿Qué tenés que recordar de **IAM**?", back: "Usuarios y roles" },
      { front: "¿Qué tenés que recordar de **Cifrado**?", back: "Lo esencial de Cifrado." },
    ]);
  });
});
