import { describe, expect, it } from "vitest";
import { classScript, deckScript, durationText, quietPart } from "./listen";

describe("listening (AC-148)", () => {
  it("says durations the way people do", () => {
    expect([12, 60, 754, 3600, 3900].map(durationText)).toEqual(["12 s", "1 min", "13 min", "1 h 00 min", "1 h 05 min"]);
  });

  it("reads a class: key ideas first, then the notes, then what to review", () => {
    const s = classScript("Análisis · teórica", { summary: "### Límites\n- Un límite…", key_points: ["Un límite es a qué se acerca f", "La derivada es un límite"], questions: ["La definición formal"], dates: [] });
    expect(s.indexOf("Las ideas clave. 1. Un límite es a qué se acerca f … 2. La derivada es un límite")).toBeGreaterThan(s.indexOf("Repaso de Análisis · teórica."));
    expect(s.indexOf("Los apuntes.")).toBeGreaterThan(s.indexOf("Las ideas clave."));
    expect(s.endsWith("Para repasar. La definición formal")).toBe(true);
    expect(classScript("T", { summary: "x", key_points: [], questions: [], dates: [] })).not.toContain("ideas clave");
  });

  it("reads a deck as a quiz with a pause before each answer, up to a limit", () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ front: `¿Puerto ${i}?`, back: `${i}` }));
    const s = deckScript("Puertos", cards);
    expect(s.startsWith("Repaso de Puertos: 20 tarjetas.")).toBe(true);
    expect(s).toContain("Tarjeta 1. ¿Puerto 0? … … … Respuesta: 0");
    expect(s).not.toContain("Tarjeta 21.");
    expect(deckScript("Uno", [{ front: "a", back: "b" }])).toContain("1 tarjeta.");
    expect(deckScript("Vacío", [])).toBe("");
  });

  it("silence in a part is not an error worth stopping a class", () => {
    expect(quietPart("La grabación es muy corta. Hablá un poco más.")).toBe(true);
    expect(quietPart("No se entendió nada en la grabación.")).toBe(true);
    expect(quietPart("el proveedor respondió 401")).toBe(false);
  });
});
