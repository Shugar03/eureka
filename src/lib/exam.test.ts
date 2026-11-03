import { describe, expect, it } from "vitest";
import {
  byWeight,
  clearDraft,
  clock,
  daysUntil,
  failedTopicIds,
  isRight,
  localDate,
  readyVerdict,
  scoreHistory,
  domainReadiness,
  examReadiness,
  latestResult,
  loadDraft,
  remainingSecs,
  reviewQueue,
  saveDraft,
  suggestedMinutes,
  topicLabel,
  topicState,
  urgency,
  weakestDomain,
} from "./exam";
import { allocate, normalizeWeights, parseGuide, parseQuestionsInput, SAMPLE_GUIDE, scriptedQuestions } from "../e2e/examScript";
import type { Exam, MockResult, SessionSummary } from "../types";

const summary = (id: string, phase: SessionSummary["phase"], done = 0, total = 0): SessionSummary => ({
  id,
  title: id,
  goal: id,
  phase,
  updated_at: "",
  plan_total: total,
  plan_done: done,
});

const topic = (id: string, session_id: string | null = null) => ({ id, title: id, objectives: [], session_id, exercises_passed: 0 });

function exam(): Exam {
  return {
    id: "e",
    name: "AWS",
    created_at: "",
    updated_at: "",
    domains: [
      { id: "d1", name: "Conceptos", weight: 25, topics: [topic("d1t1", "s-done"), topic("d1t2", "s-mid")] },
      { id: "d2", name: "Seguridad", weight: 75, topics: [topic("d2t1"), topic("d2t2", "gone")] },
    ],
    mocks: [],
    review: [],
    goal: { passing_pct: null, exam_date: null, hours_per_week: null },
    cheat_sheet: null,
    kind: "certification",
    schedule: [],
    lang: null,
  };
}

const sessions = new Map([
  ["s-done", summary("s-done", "done")],
  ["s-mid", summary("s-mid", "teach", 1, 3)],
]);

const result = (by: [string, number, number][]): MockResult => ({
  answers: [],
  correct: by.reduce((s, b) => s + b[1], 0),
  total: by.reduce((s, b) => s + b[2], 0),
  by_domain: by.map(([domain_id, correct, total]) => ({ domain_id, correct, total })),
  at: "",
  elapsed_secs: 0,
});

describe("exam helpers", () => {
  it("derives each topic's state from its study session", () => {
    const [studied, studying] = exam().domains[0].topics;
    const [fresh, missing] = exam().domains[1].topics;
    expect(topicState(studied, sessions)).toEqual({ kind: "studied" });
    expect(topicState(studying, sessions)).toEqual({ kind: "studying", done: 1, total: 3 });
    expect(topicState(fresh, sessions)).toEqual({ kind: "new" });
    expect(topicState(missing, sessions), "a deleted session counts as not started").toEqual({ kind: "new" });
    expect([topicLabel({ kind: "new" }), topicLabel({ kind: "studied" }), topicLabel({ kind: "studying", done: 1, total: 3 }), topicLabel({ kind: "studying", done: 0, total: 0 })]).toEqual([
      "Sin empezar",
      "Estudiado",
      "En curso · 1/3",
      "En curso",
    ]);
  });

  it("orders domains by weight without mutating the exam", () => {
    const e = exam();
    expect(byWeight(e.domains).map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(e.domains[0].id).toBe("d1");
  });

  it("readiness mixes coverage and the latest graded mock, weighted by domain", () => {
    const e = exam();
    expect(domainReadiness(e.domains[0], null, sessions)).toEqual({ coverage: 0.75, mock: null, score: 0.375 });
    expect(examReadiness(e, sessions)).toBeCloseTo((25 * 0.375) / 100);

    e.mocks = [
      { id: "a", created_at: "", questions: [], result: result([["d1", 0, 2]]), time_limit_secs: null, focus: null },
      { id: "b", created_at: "", questions: [], result: result([["d1", 2, 2], ["d2", 1, 4]]), time_limit_secs: null, focus: null },
      { id: "c", created_at: "", questions: [], result: null, time_limit_secs: null, focus: null },
    ];
    const last = latestResult(e)!;
    expect(last.correct).toBe(3);
    expect(domainReadiness(e.domains[1], last, sessions)).toEqual({ coverage: 0, mock: 0.25, score: 0.125 });
    expect(examReadiness(e, sessions)).toBeCloseTo((25 * 0.875 + 75 * 0.125) / 100);
    expect(latestResult(exam())).toBeNull();
  });

  it("recommends the weakest domain, heavier on ties, none when all right", () => {
    const e = exam();
    expect(weakestDomain(e, result([["d1", 1, 2], ["d2", 3, 4]]))?.id).toBe("d1");
    expect(weakestDomain(e, result([["d1", 1, 2], ["d2", 2, 4]]))?.id).toBe("d2");
    expect(weakestDomain(e, result([["d1", 2, 2], ["d2", 4, 4]]))).toBeNull();
    expect(weakestDomain(e, result([["zz", 0, 2]]))).toBeNull();
  });
});

describe("exam script (shared by the mock and the fake provider)", () => {
  it("reads domains, weights, topics and objectives from a guide", () => {
    const ds = parseGuide(SAMPLE_GUIDE);
    expect(ds.map((d) => [d.name, d.weight])).toEqual([
      ["Conceptos de la nube", 24],
      ["Seguridad y cumplimiento", 30],
      ["Tecnología y servicios de la nube", 34],
      ["Facturación, precios y soporte", 12],
    ]);
    expect(ds[1].topics[1]).toEqual({ title: "Gestión de identidades con IAM", objectives: ["Usuarios, grupos y roles", "Principio de menor privilegio"] });
    expect(parseGuide("Un texto cualquiera\n- sin dominios")).toEqual([]);
  });

  it("mirrors the Rust weight and allocation rules", () => {
    expect(normalizeWeights([40, undefined])).toEqual([50, 50]);
    expect(normalizeWeights([1, 3])).toEqual([25, 75]);
    expect(allocate(10, [33.3, 33.3, 33.3])).toEqual([4, 3, 3]);
    expect(allocate(5, [10, 60, 30])).toEqual([0, 3, 2]);
    expect(allocate(10, [24, 30, 34, 12])).toEqual([2, 3, 4, 1]);
  });

  it("parses the Rust questions input and writes one right answer per question", () => {
    const input = "Generá 3 preguntas…\n\n## Distribución por dominio\n\n### d1: Seguridad (40% del examen) → 2 preguntas\n- d1t1: IAM — Roles; Políticas\n- d1t2: Cifrado\n\n### d2: Cómputo (60% del examen) → 1 preguntas\n- d2t1: EC2\n";
    const plan = parseQuestionsInput(input);
    expect(plan).toEqual([
      { domain_id: "d1", n: 2, topics: [{ id: "d1t1", title: "IAM" }, { id: "d1t2", title: "Cifrado" }] },
      { domain_id: "d2", n: 1, topics: [{ id: "d2t1", title: "EC2" }] },
    ]);
    const qs = scriptedQuestions(plan);
    expect(qs.map((q) => [q.domain_id, q.topic_id, q.answer])).toEqual([
      ["d1", "d1t1", [0]],
      ["d1", "d1t2", [1]],
      ["d2", "d2t1", [2]],
    ]);
    for (const q of qs) for (const a of q.answer) expect(q.options[a]).toMatch(/^Aplicar correctamente/);
    const fifth = scriptedQuestions([{ domain_id: "d1", topics: [{ id: "d1t1", title: "IAM" }], n: 5 }])[4];
    expect(fifth.answer, "every 5th question is 'Elegí 2'").toHaveLength(2);
    expect(fifth.options).toHaveLength(5);
  });
});

describe("guide import (PDF text and web search)", () => {
  it("joins pdf.js text items into tidy lines", async () => {
    const { itemsToText } = await import("./pdfText");
    const items = [
      { str: "Dominio 1:  Datos", hasEOL: false },
      { str: " (40%)", hasEOL: true },
      { str: "• Valor de los datos", hasEOL: true },
      { hasEOL: true },
      { hasEOL: true },
      { hasEOL: true },
      { str: "– Data lake ", hasEOL: true },
    ];
    expect(itemsToText(items)).toBe("Dominio 1: Datos (40%)\n• Valor de los datos\n\n– Data lake");
  });

  it("reads PDF-style bullets: • for topics, – for objectives", () => {
    const ds = parseGuide("Guía\nDominio 1: Datos (40%)\n• Valor de los datos\n– Data lake\n– Data warehouse\nDominio 2: IA (60%)\n• IA responsable");
    expect(ds).toEqual([
      { name: "Datos", weight: 40, topics: [{ title: "Valor de los datos", objectives: ["Data lake", "Data warehouse"] }] },
      { name: "IA", weight: 60, topics: [{ title: "IA responsable", objectives: [] }] },
    ]);
  });

  it("the scripted guide finder returns a guide the reader understands", async () => {
    const { scriptedFoundGuide } = await import("../e2e/examScript");
    const g = scriptedFoundGuide("Google Cloud Digital Leader");
    expect(g.guide.startsWith("Google Cloud Digital Leader\n")).toBe(true);
    expect(parseGuide(g.guide)).toHaveLength(4);
    expect(g.used).toEqual([1]);
  });
});

describe("timed mock exams and review (AC-39, AC-40)", () => {
  const mock = (time_limit_secs: number | null) => ({ id: "m", created_at: "2026-10-27T10:00:00.000Z", questions: [], result: null, time_limit_secs, focus: null });
  const at = (iso: string) => Date.parse(iso);

  it("counts down from the moment the questions were shown, never below zero", () => {
    expect(remainingSecs(mock(null), at("2026-10-27T10:05:00Z"))).toBeNull();
    expect(remainingSecs(mock(900), at("2026-10-27T10:00:00Z"))).toBe(900);
    expect(remainingSecs(mock(900), at("2026-10-27T10:05:00.400Z"))).toBe(600);
    expect(remainingSecs(mock(900), at("2026-10-27T10:20:00Z"))).toBe(0);
  });

  it("formats the clock and its urgency", () => {
    expect([clock(0), clock(75), clock(600), clock(3725), clock(-3)]).toEqual(["0:00", "1:15", "10:00", "1:02:05", "0:00"]);
    expect([urgency(301), urgency(300), urgency(61), urgency(60), urgency(0)]).toEqual(["ok", "warn", "warn", "bad", "bad"]);
    expect([suggestedMinutes(10), suggestedMinutes(65)]).toEqual([15, 98]);
  });

  it("keeps unsent answers as a draft per mock exam", () => {
    expect(loadDraft("x", 3)).toEqual([[], [], []]);
    saveDraft("x", [[1], [], [0, 2]]);
    expect(loadDraft("x", 3)).toEqual([[1], [], [0, 2]]);
    expect(loadDraft("x", 4), "a draft of another size is ignored").toEqual([[], [], [], []]);
    localStorage.setItem("la.mock.y", "{roto");
    expect(loadDraft("y", 1)).toEqual([[]]);
    localStorage.setItem("la.mock.z", "[2, null]");
    expect(loadDraft("z", 2), "old single-answer drafts still load").toEqual([[2], []]);
    clearDraft("x");
    expect(loadDraft("x", 3)).toEqual([[], [], []]);
  });

  it("grades all or nothing, in any order", () => {
    expect(isRight([0, 2], [2, 0])).toBe(true);
    expect(isRight([0, 2], [0])).toBe(false);
    expect(isRight([0, 2], [0, 1, 2])).toBe(false);
    expect(isRight([1], [1, 1])).toBe(true);
    expect(isRight([1], [])).toBe(false);
  });

  it("reviews the least mastered and oldest questions first", () => {
    const e = exam();
    const q = { id: "q", domain_id: "d1", topic_id: null, stem: "s", options: ["a", "b"], answer: [0], explanation: "" };
    const item = (id: string, streak: number, added_at: string) => ({ id, question: q, mock_id: "m", streak, added_at });
    e.review = [item("a", 1, "2026-01-01"), item("b", 0, "2026-01-03"), item("c", 0, "2026-01-02")];
    expect(reviewQueue(e).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(e.review[0].id).toBe("a");
  });
});

describe("goal: trend, verdict and exam date (AC-42)", () => {
  const graded = (id: string, by: [string, number, number][]) => ({ id, created_at: "", questions: [], result: result(by), time_limit_secs: null, focus: null });

  it("lists graded mocks as percent, numbered as in the list", () => {
    const e = exam();
    e.mocks = [graded("a", [["d1", 1, 2]]), { id: "b", created_at: "", questions: [], result: null, time_limit_secs: null, focus: null }, graded("c", [["d1", 3, 4]])];
    expect(scoreHistory(e).map((p) => [p.n, p.pct])).toEqual([[1, 50], [3, 75]]);
  });

  it("is ready with margin, close within 10 points, otherwise not yet", () => {
    const e = exam();
    expect(readyVerdict(e, 70)).toEqual({ kind: "unknown" });
    e.mocks = [graded("a", [["d1", 6, 10]]), graded("b", [["d1", 8, 10], ["d2", 6, 10]]), graded("c", [["d1", 9, 10], ["d2", 6, 10]])];
    expect(readyVerdict(e, null)).toEqual({ kind: "unknown" });
    // last 3: 60, 70, 75 → avg 68.3
    const v = readyVerdict(e, 70);
    expect(v.kind).toBe("close");
    expect(v.kind !== "unknown" && v.weak.map((d) => d.id)).toEqual(["d2"]);
    expect(readyVerdict(e, 60).kind).toBe("ready");
    expect(readyVerdict(e, 80).kind).toBe("not");
    expect(readyVerdict(e, 63.3).kind, "68.3 avg ≥ 63.3 + 5").toBe("ready");
    expect(readyVerdict(e, 63.4).kind, "just short of the margin").toBe("close");
  });

  it("counts local calendar days, not UTC ones", () => {
    const lateNight = new Date(2026, 9, 27, 23, 30); // 27 Oct, 23:30 local
    expect(localDate(lateNight)).toBe("2026-10-27");
    expect(daysUntil("2026-10-28", lateNight)).toBe(1);
    expect(daysUntil("2026-10-27", lateNight)).toBe(0);
    expect(daysUntil("2026-12-25", new Date(2026, 9, 27, 0, 5))).toBe(59);
    expect(daysUntil("2026-10-20", lateNight)).toBe(-7);
  });
});

describe("targeted mocks (AC-43)", () => {
  it("leave the trend and the latest result to whole-exam mocks", () => {
    const e = exam();
    const m = (id: string, by: [string, number, number][], focus: string | null) => ({ id, created_at: "", questions: [], result: result(by), time_limit_secs: null, focus });
    e.mocks = [m("a", [["d1", 1, 2]], null), m("b", [["d2", 4, 4]], "Seguridad")];
    expect(scoreHistory(e).map((p) => p.n)).toEqual([1]);
    expect(latestResult(e)?.correct).toBe(1);
  });

  it("collects the topics of the failed questions, once each", () => {
    const e = exam();
    const q = (topic_id: string | null) => ({ id: "q", domain_id: "d1", topic_id, stem: "s", options: ["a", "b"], answer: [0], explanation: "" });
    e.review = ["d1t1", null, "d2t1", "d1t1"].map((t, i) => ({ id: `r${i}`, question: q(t), mock_id: "m", streak: 0, added_at: "" }));
    expect(failedTopicIds(e)).toEqual(["d1t1", "d2t1"]);
  });
});
