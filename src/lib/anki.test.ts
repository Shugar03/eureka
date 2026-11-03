import { describe, expect, it } from "vitest";
import { htmlToText, parseAnkiText, toAnkiText } from "./anki";
import type { Deck } from "../types";

describe("Anki plain-text import/export (AC-60)", () => {
  it("reads Anki's export with headers, HTML and metadata columns", () => {
    const text = [
      "#separator:tab",
      "#html:true",
      "#notetype column:1",
      "#deck column:2",
      "Básico\tAWS\t¿Puerto de <b>HTTPS</b>?\t443",
      'Básico\tAWS\t"Con ""comillas"" y\ttab"\tsí',
      "Básico\tAWS\tUna línea<br>y otra\tA&amp;B&nbsp;C",
      "Básico\tAWS\tsin dorso\t",
      "",
    ].join("\n");
    const { cards, skipped } = parseAnkiText(text);
    expect(cards).toEqual([
      ["¿Puerto de HTTPS?", "443"],
      ['Con "comillas" y\ttab', "sí"],
      ["Una línea\ny otra", "A&B C"],
    ]);
    expect(skipped).toBe(1);
  });

  it("reads simple files too (semicolons, no HTML, BOM)", () => {
    expect(parseAnkiText("﻿#separator:semicolon\n#html:false\nhola;hello\n<b>no</b>;tag").cards).toEqual([
      ["hola", "hello"],
      ["<b>no</b>", "tag"],
    ]);
    expect(parseAnkiText("a\tb\nc\td").cards).toHaveLength(2);
    expect(htmlToText("<div>x</div><div>y</div>")).toBe("x\ny");
  });

  it("exports a deck that reads back the same", () => {
    const deck: Deck = {
      id: "d",
      name: "n",
      source: { kind: "manual" },
      created_at: "",
      updated_at: "",
      cards: [
        { id: "1", front: "¿2 < 3?", back: "Sí\n& siempre", ease: 2.5, interval: 0, reps: 0, lapses: 0, due: "", reviewed: null },
        { id: "2", front: 'tab\t"x"', back: "y", ease: 2.5, interval: 0, reps: 0, lapses: 0, due: "", reviewed: null },
      ],
    };
    const text = toAnkiText(deck);
    expect(text.split("\n")[0]).toBe("#separator:tab");
    expect(text).toContain("¿2 &lt; 3?\tSí<br>&amp; siempre");
    expect(parseAnkiText(text).cards).toEqual([
      ["¿2 < 3?", "Sí\n& siempre"],
      ['tab\t"x"', "y"],
    ]);
  });
});
