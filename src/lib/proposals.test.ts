import { describe, expect, it } from "vitest";
import { matchIdeas, parseCodeProposal, parseDeckProposal, parseOwnProposal, parsePracticeProposal } from "./proposals";

describe("proposals", () => {
  it("AC-161: a deck needs a name and cards with both sides", () => {
    expect(parseDeckProposal(JSON.stringify({ name: " Verbos ", cards: [{ front: "to go", back: "went" }] }))).toEqual({ name: "Verbos", cards: [{ front: "to go", back: "went" }] });
    expect(parseDeckProposal(JSON.stringify({ name: "V", cards: [] }))).toBeNull();
    expect(parseDeckProposal(JSON.stringify({ name: "V", cards: [{ front: "a", back: "" }] }))).toBeNull();
    expect(parseDeckProposal("no json")).toBeNull();
  });

  it("AC-162 AC-163: practice and code proposals are checked like the backend", () => {
    expect(parsePracticeProposal(JSON.stringify({ ideas: ["derivadas", " "], count: 5 }))).toEqual({ ideas: ["derivadas"], count: 5 });
    expect(parsePracticeProposal(JSON.stringify({ ideas: ["x"], count: 50 }))).toBeNull();
    expect(parseCodeProposal(JSON.stringify({ language: "python", topic: "listas", level: "básico" }))).toEqual({ language: "python", topic: "listas", level: "básico" });
    expect(parseCodeProposal(JSON.stringify({ language: "cobol", topic: "x" }))).toBeNull();
  });

  it("AC-162: the agent's ideas find the graph's nodes by their words", () => {
    const nodes = [
      { id: "a", text: "La derivada es la pendiente de la recta tangente" },
      { id: "b", text: "La integral acumula el área bajo la curva" },
      { id: "c", text: "Derivada de una suma: la suma de las derivadas" },
    ];
    expect(matchIdeas(nodes, ["derivadas"]).map((n) => n.id)).toEqual(["c", "a"]);
    expect(matchIdeas(nodes, ["pendiente tangente"]).map((n) => n.id)).toEqual(["a"]);
    expect(matchIdeas(nodes, ["química"])).toEqual([]);
  });
});

describe("AC-174 own problems from the chat", () => {
  it("needs the text or a library document, never neither", () => {
    expect(parseOwnProposal(JSON.stringify({ title: " Guía 3 ", text: " 1) ¿2+2? " }))).toEqual({ title: "Guía 3", text: "1) ¿2+2?", book: "" });
    expect(parseOwnProposal(JSON.stringify({ book: "Guía de Física" }))).toEqual({ title: "", text: "", book: "Guía de Física" });
    expect(parseOwnProposal(JSON.stringify({ title: "x" }))).toBeNull();
    expect(parseOwnProposal("{roto")).toBeNull();
  });
});
