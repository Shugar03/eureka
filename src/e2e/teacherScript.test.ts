import { describe, expect, it } from "vitest";
import { nextStep, PLAN, type TeacherView } from "./teacherScript";
import type { NodeStatus } from "../types";

const view = (v: Partial<TeacherView> & { statuses?: Record<string, NodeStatus> }): TeacherView => ({
  phase: "probe",
  answered: 0,
  lastAnswer: null,
  afterLearner: true,
  ...v,
  status: (id) => v.statuses?.[id],
});

const names = (s: ReturnType<typeof nextStep>) => s?.calls?.map((c) => c.name) ?? [];

describe("teacherScript", () => {
  it("opens the probe with a question", () => {
    expect(names(nextStep(view({})))).toEqual(["ask_question"]);
  });

  it("records a finding before the second probe question", () => {
    expect(names(nextStep(view({ answered: 1, lastAnswer: "sube 2" })))).toEqual(["record_finding", "ask_question"]);
  });

  it("closes the probe and moves to plan, grading the limit answer", () => {
    const ok = nextStep(view({ answered: 2, lastAnswer: "A 0" }));
    const bad = nextStep(view({ answered: 2, lastAnswer: "A 1" }));
    expect(names(ok)).toEqual(["record_finding", "set_phase"]);
    expect(ok?.calls?.[0].args.level).toBe("partial");
    expect(bad?.calls?.[0].args.level).toBe("missing");
  });

  it("plans a DAG whose foundations are known and goal is last", () => {
    const step = nextStep(view({ phase: "plan" }));
    expect(names(step)).toEqual(["set_plan", "set_phase", "update_node", "ask_question"]);
    expect(PLAN[0].status).toBe("known");
    expect(PLAN[PLAN.length - 1].id).toBe("derivada");
    const ids = new Set(PLAN.map((n) => n.id));
    for (const n of PLAN) for (const d of n.depends_on) expect(ids.has(d)).toBe(true);
  });

  it("repairs a wrong tangent answer before moving on", () => {
    const wrong = nextStep(view({ phase: "teach", statuses: { tangente: "current" }, lastAnswer: "En una curva" }));
    expect(wrong?.calls?.[0].args).toMatchObject({ id: "tangente", status: "repair" });
    const right = nextStep(view({ phase: "teach", statuses: { tangente: "current" }, lastAnswer: "En la tangente" }));
    expect(right?.calls?.[0].args).toMatchObject({ id: "tangente", status: "understood" });
    const repaired = nextStep(view({ phase: "teach", statuses: { tangente: "repair" }, lastAnswer: "Tangente" }));
    expect(repaired?.calls?.[0].args).toMatchObject({ id: "tangente", status: "understood" });
  });

  it("finishes with a summary and the done phase", () => {
    const step = nextStep(view({ phase: "teach", statuses: { tangente: "understood", derivada: "current" } }));
    expect(names(step)).toEqual(["update_node", "set_phase"]);
    expect(step?.text).toContain("Juntando todo");
  });

  it("in done, researches a learner question, answers with it, and never loops on its own", () => {
    const research = nextStep(view({ phase: "done", afterLearner: true, lastAnswer: "¿y para qué sirve?" }));
    expect(names(research)).toEqual(["research"]);
    expect(research?.calls?.[0].args.question).toContain("¿y para qué sirve?");
    expect(nextStep(view({ phase: "done", afterLearner: false, afterResearch: true }))?.text).toContain("Buena pregunta");
    expect(nextStep(view({ phase: "done", afterLearner: false }))).toBeNull();
  });

  it("explains the tangent with a diagram and an interactive demo", () => {
    const step = nextStep(view({ phase: "teach", statuses: { limite: "current" } }));
    expect(names(step)).toEqual(["update_node", "update_node", "show_diagram", "show_demo", "ask_question"]);
  });
});
