// AC-210: «Mi progreso» speaks to you, draws each session as a path and picks what to do today.
import { describe, expect, it } from "vitest";
import { coach, evidence, looseTopics, sameTopic, todayPlan, unitOf } from "./progress";
import { progressModel, progressSessions } from "../e2e/progressDemo";

describe("evidence, said to you (AC-210)", () => {
  it("separates where it came from and the date from what it says", () => {
    expect(evidence("le costó en «Gradientes en ML» (11/11)")).toEqual({ tag: "Sesión", text: "Te costó en «Gradientes en ML»", when: "11/11" });
    expect(evidence("confusión: no sabía hacia dónde mover w")).toEqual({ tag: "Confusión", text: "No sabía hacia dónde mover w", when: null });
    expect(evidence("práctica: acertaste 2 de 3").tag).toBe("Práctica");
    expect(evidence("simulacro de Parcial: 2 de 6")).toMatchObject({ tag: "Simulacro", text: "2 de 6 en Parcial" });
    expect(evidence("algo que no conozco")).toEqual({ tag: null, text: "Algo que no conozco", when: null });
  });
});

describe("paths (AC-210)", () => {
  const m = progressModel();
  const [ml, an, lim] = progressSessions().map((s) => unitOf(s, m));

  it("turns a session's plan into a path and marks the next step", () => {
    expect(ml.nodes.map((n) => n.look)).toEqual(["ok", "ok", "prac", "bad", "todo", "todo"]);
    expect(ml.nodes.find((n) => n.now)?.title).toBe("Por qué se resta el gradiente");
    expect(ml.nodes[3].note).toMatch(/^Te cuesta: no sabía/);
    expect(ml.ready).toBe(2);
  });

  it("an idea the model says is hard shows as hard even if the plan didn't get there", () => {
    expect(an.nodes.find((n) => n.title === "Regla de la cadena")?.look).toBe("bad");
    expect(an.exam).toEqual({ name: "Parcial de Análisis I", days: 4 });
  });

  it("a finished session has no next step", () => {
    expect(lim.done).toBe(true);
    expect(lim.nodes.some((n) => n.now)).toBe(false);
  });

  it("topics a path already shows are not repeated below", () => {
    const loose = looseTopics(m, [ml, an, lim]).map((t) => t.name);
    expect(loose).toContain("Integrales por partes");
    expect(loose).not.toContain("Regla de la cadena");
    expect(loose.some((n) => n.startsWith("No pudo explicar por qué se resta"))).toBe(false);
  });

  it("same topic as the backend: most of the shorter name's words", () => {
    expect(sameTopic("Por qué se resta el gradiente", "Por qué se resta el gradiente en la regla de actualización")).toBe(true);
    expect(sameTopic("Límites", "Integrales por partes")).toBe(false);
  });
});

describe("the coach (AC-210)", () => {
  const m = progressModel();
  const units = progressSessions().map((s) => unitOf(s, m));
  const today = new Date().toISOString().slice(0, 10);

  it("reads the week back, names what keeps coming back and the exam that is near", () => {
    const c = coach({ name: "Ana", m, streak: 5, activeToday: false, studied7: 5, studiedEver: true, today });
    expect(c.title).toBe("Vas bien, Ana.");
    expect(c.text.join(" ")).toMatch(/estudiaste 5 días y dominaste \*\*Función de error cuadrático\*\*/);
    expect(c.text.join(" ")).toMatch(/Lo que más se repite es \*\*Por qué se resta el gradiente/);
    expect(c.text.join(" ")).toMatch(/\*\*Parcial de Análisis I\*\* en 4 días/);
  });

  it("never blames: no streak is «volvamos de a poco», and a first visit says what will show up", () => {
    expect(coach({ name: "", m, streak: 0, activeToday: false, studied7: 0, studiedEver: true, today }).title).toBe("Volvamos de a poco.");
    const empty = { ...m, topics: [], upcoming: [] };
    const first = coach({ name: "Ana", m: empty, streak: 0, activeToday: false, studied7: 0, studiedEver: false, today });
    expect(first.title).toBe("Hola, Ana.");
    expect(first.text[0]).toMatch(/Cuando termines una sesión/);
  });

  it("today: the hardest thing, the cards before the exam, and what was left halfway", () => {
    const plan = todayPlan(m, units);
    expect(plan.map((p) => p.title)).toEqual(["Repasar por qué se resta el gradiente en la regla de actualización", "12 tarjetas para hoy", "Retomar tasa de aprendizaje (η)"]);
    expect(plan[1].why).toBe("Parcial de Análisis I en 4 días");
    expect(plan[2].action).toEqual({ kind: "session", id: "pg-ml" });
  });
});
