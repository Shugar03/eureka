import { describe, expect, it } from "vitest";
import { wrap } from "./NeuronGraph";

describe("neuron labels (AC-176)", () => {
  it("keep the whole idea, in lines of about 30 characters", () => {
    const text = "La aceleración es el cambio de velocidad en el tiempo";
    const lines = wrap(text);
    expect(lines.join(" ")).toBe(text);
    expect(lines.every((l) => l.length <= 30)).toBe(true);
    expect(wrap("corta")).toEqual(["corta"]);
    expect(wrap("  dos   palabras ")).toEqual(["dos palabras"]);
  });
});
