import { describe, expect, it } from "vitest";
import { improvedText, pickVoice, seconds, speakingTask } from "./language";

describe("language practice helpers (AC-65)", () => {
  it("cycles speaking tasks per level", () => {
    expect(speakingTask("B2", 0)).toMatch(/working from home/);
    expect(speakingTask("B2", 3)).toBe(speakingTask("B2", 0));
    expect(speakingTask("B2", -1)).toBe(speakingTask("B2", 2));
    expect(speakingTask("Z9", 0)).toBe(speakingTask("B1", 0));
  });

  it("picks a voice for the language, natural ones first", () => {
    const voices = [
      { lang: "es-AR", name: "Microsoft Elena" },
      { lang: "en-US", name: "Microsoft Zira" },
      { lang: "en-GB", name: "Microsoft Sonia Online (Natural)" },
    ];
    expect(pickVoice(voices, "en")?.name).toBe("Microsoft Sonia Online (Natural)");
    expect(pickVoice(voices, "es")?.name).toBe("Microsoft Elena");
    expect(pickVoice(voices, "fr")).toBeNull();
  });

  it("extracts the improved answer from the feedback", () => {
    const md = "1. **Nivel**: B1\n\n7. **Versión mejorada**\n> I usually *go* to the park\n> and play football.\n\nFin";
    expect(improvedText(md)).toBe("I usually go to the park and play football.");
    expect(improvedText("sin bloque")).toBe("");
    expect([seconds(7), seconds(75)]).toEqual(["0:07", "1:15"]);
  });
});
