// AC-202: «Novedades» read by section and change, never as one block of text.
import { describe, expect, it } from "vitest";
import { boldParts, noteItem, parseNotes, sectionKind, withoutCriteria } from "./releaseNotes";

describe("release notes (AC-202)", () => {
  it("reads the sections and the name of each change", () => {
    const s = parseNotes("### Nuevo\n- **Rutas de aprendizaje:** un curso de varias clases.\n\n### Corregido\n- **Hablar más de un minuto ya funciona:** se corta en los silencios.\n- Ya no aparece el cartel.");
    expect(s.map((x) => x.title)).toEqual(["Nuevo", "Corregido"]);
    expect(s[0].items[0]).toEqual({ head: "Rutas de aprendizaje", body: "un curso de varias clases." });
    expect(s[1].items[1]).toEqual({ head: null, body: "Ya no aparece el cartel." });
    expect(s.map((x) => sectionKind(x.title))).toEqual(["new", "fixed"]);
  });

  it("the old one-line notes (0.9.0) are split into their changes too", () => {
    const s = parseNotes("El profesor contesta mucho más rápido: ya no se queda pensando. · Podés releer mientras escribe: si subís, no te tira para abajo. · Ya no aparece el cartel «Controles de la ventana» al pasar el mouse.");
    expect(s).toHaveLength(1);
    expect(s[0].items.map((i) => i.head)).toEqual(["El profesor contesta mucho más rápido", "Podés releer mientras escribe", null]);
  });

  it("a bold part that is not closed by a colon is not a title", () => {
    expect(noteItem("**Acompañamiento tiene micrófono**, y el clip se ve más limpio.")).toEqual({ head: null, body: "**Acompañamiento tiene micrófono**, y el clip se ve más limpio." });
    expect(boldParts("cada sesión es un **camino de ideas** al estilo")).toEqual([{ bold: false, text: "cada sesión es un " }, { bold: true, text: "camino de ideas" }, { bold: false, text: " al estilo" }]);
  });

  it("a long sentence with a colon later on is not taken for a title", () => {
    expect(noteItem("Con la voz en esta PC, una grabación larga se corta sola en los silencios y se transcribe entera: listo.").head).toBeNull();
    expect(parseNotes("")).toEqual([]);
  });
  it("does not show the acceptance criteria references to whoever uses the app", () => {
    const s = parseNotes("### Nuevo\n- **Carpetas de trabajo:** cada plan se puede **deshacer** (AC-219..AC-222).\n- **Conectado:** lo dice y te pide pegarla de nuevo (AC-218).");
    expect(s[0].items.map((i) => i.body)).toEqual(["cada plan se puede **deshacer**.", "lo dice y te pide pegarla de nuevo."]);
    expect(withoutCriteria("rutas (AC-214, AC-217) y más (AC-1 y AC-2)")).toBe("rutas y más");
  });
});
