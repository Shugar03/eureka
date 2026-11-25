// Practice, exams, learning routes, flashcards and shared decks mock IPC handlers.
import type { CardSource, Deck, Exam, ExamSummary, Grade, Lang, LearnerInput, PracticeSet, PracticeSummary } from "../../types";
import { review as reviewCard } from "../../lib/cards";
import { langLabel } from "../../lib/code";
import { isRight } from "../../lib/exam";
import { scriptedCards } from "../cardsScript";
import { allocate, GUIDE_HITS, normalizeWeights, parseGuide, scriptedExplain, scriptedFoundGuide, scriptedQuestions } from "../examScript";
import { fold } from "../graphFold";
import { scriptedGrade, scriptedProblems } from "../practiceScript";
import { createRoute, routeView } from "../routeMock";
import { DELAY, UNHANDLED, addToNamedDeck, clone, disputeOne, flags, newCard, newSession, nid, shortTime, sleep, store, touch } from "./state";

const SHARED_SAMPLE = { name: "Repaso de Biología", cards: [["¿Qué hace la mitocondria?", "Produce la energía de la célula (ATP)."], ["¿Qué es un ribosoma?", "El orgánulo que sintetiza proteínas."]] as [string, string][], skipped: 1 };
const textOf = (raw: unknown) => new TextDecoder().decode(raw as Uint8Array);

function practiceSummary(s: PracticeSet): PracticeSummary {
  return {
    id: s.id,
    title: s.title,
    updated_at: s.updated_at,
    total: Math.max(s.planned ?? 0, s.problems.length),
    done: s.problems.filter((p) => p.attempts.length).length,
    correct: s.problems.filter((p) => p.attempts[p.attempts.length - 1]?.verdict === "correct").length,
  };
}

function practiceSet(id: string): PracticeSet {
  const s = store.practice.get(id);
  if (!s) throw "práctica no encontrada";
  return s;
}

function exam(id: string): Exam {
  const e = store.exams.get(id);
  if (!e) throw "examen no encontrado";
  return e;
}

function examSummary(e: Exam): ExamSummary {
  const topics = e.domains.flatMap((d) => d.topics);
  const last = [...e.mocks].reverse().find((m) => m.result)?.result;
  return {
    id: e.id,
    name: e.name,
    updated_at: e.updated_at,
    domains: e.domains.length,
    topics: topics.length,
    started: topics.filter((t) => t.session_id).length,
    last_score: last ? Math.round((1000 * last.correct) / last.total) / 10 : null,
    to_review: e.review.length,
    kind: e.kind,
    exam_date: e.goal.exam_date,
    schedule: e.schedule,
  };
}

/** Mirror of exam::grade: reported questions count for nothing. */
function mockGrade(e: Exam, questions: Exam["mocks"][number]["questions"], answers: number[][]) {
  const counted = questions.map((_, i) => i).filter((i) => !questions[i].reported);
  const right = (i: number) => isRight(questions[i].answer, answers[i] ?? []);
  return {
    answers,
    correct: counted.filter(right).length,
    total: counted.length,
    by_domain: e.domains
      .map((d) => {
        const idx = counted.filter((i) => questions[i].domain_id === d.id);
        return { domain_id: d.id, correct: idx.filter(right).length, total: idx.length };
      })
      .filter((s) => s.total),
    at: new Date().toISOString(),
    elapsed_secs: 0,
  };
}

function deck(id: string): Deck {
  const d = store.decks.get(id);
  if (!d) throw "mazo no encontrado";
  return d;
}

export async function handleStudy(cmd: string, args: Record<string, unknown>, raw: unknown): Promise<unknown> {
  switch (cmd) {
    case "list_practice":
      return [...store.practice.values()].map(practiceSummary).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    case "get_practice":
      return clone(practiceSet(args.id as string));
    case "create_practice": {
      const ids = args.nodeIds as string[];
      const targets = fold(store.ledger).nodes.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, text: n.text }));
      if (!targets.length) throw "Elegí al menos una idea del grafo.";
      await sleep(DELAY * 10);
      const now = new Date().toISOString();
      const s: PracticeSet = {
        id: nid(),
        title: targets.length > 1 ? `${targets[0].text.slice(0, 60)} (+${targets.length - 1})` : targets[0].text.slice(0, 60),
        created_at: now,
        updated_at: now,
        targets,
        // AC-167: only the first one now; next_problem writes the rest, one by one.
        problems: scriptedProblems(targets.map((t) => t.id), Number(args.count)).slice(0, 1).map((p) => ({ ...p, id: "q1", hints_shown: 0, level: 1, attempts: [] })),
        planned: Number(args.count),
      };
      store.practice.set(s.id, s);
      return clone(s);
    }
    case "reveal_hint": {
      const s = practiceSet(args.setId as string);
      const p = s.problems.find((x) => x.id === args.problemId)!;
      p.hints_shown = Math.min(p.hints_shown + 1, p.hints.length);
      s.updated_at = new Date().toISOString();
      return clone(s);
    }
    case "read_own_problems": {
      // AC-173: one problem per numbered line; «Rta: …» on it is the guide's answer.
      // AC-174: a library document named by the chat stands for a scripted guide.
      const book = String(args.book ?? "").trim();
      const text = book && !String(args.text ?? "").trim() ? "1) Un móvil recorre 120 km en 2 h. ¿Cuál es su rapidez media? Rta: 60 km/h\n2) ¿Cuánto tarda en recorrer 300 km a esa rapidez?" : String(args.text ?? "");
      if (!text.trim()) throw "Pegá tus ejercicios o elegí un archivo.";
      await sleep(DELAY * 10);
      const problems = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+[).]/.test(l))
        .map((l) => {
          const [statement, answer] = l.split(/\s*Rta:\s*/i);
          return { statement, solution: answer ?? "Resuelto por Eureka: 42", given: !!answer, hints: ["Mirá los datos que te dan."], ideas: [] as string[] };
        });
      if (!problems.length) throw "no encontré ningún ejercicio con su enunciado";
      return problems;
    }
    case "create_own_practice": {
      const kept = (args.problems as { statement: string; solution: string; given: boolean; hints: string[] }[]).filter((p) => p.statement.trim());
      if (!kept.length) throw "Dejá al menos un ejercicio con su enunciado.";
      const now = new Date().toISOString();
      const s: PracticeSet = {
        id: nid(),
        title: String(args.title ?? "").trim() || `Mis problemas (${kept.length})`,
        created_at: now,
        updated_at: now,
        targets: [],
        problems: kept.map((p, i) => ({ id: `q${i + 1}`, statement: p.statement, targets: [], hints: p.hints, solution: p.solution, hints_shown: 0, solution_by_model: !p.given, attempts: [] })),
        planned: null,
        own: true,
      };
      store.practice.set(s.id, s);
      return clone(s);
    }
    case "next_problem": {
      const s = practiceSet(args.setId as string);
      const have = Number(args.have);
      const planned = s.planned ?? s.problems.length;
      if (s.problems.length !== have || have >= planned) return clone(s);
      await sleep(DELAY * 5);
      if (s.problems.length !== have) return clone(s);
      const next = scriptedProblems(s.targets.map((t) => t.id), planned)[have];
      const last = [...s.problems].reverse().find((p) => p.attempts.length)?.attempts.slice(-1)[0];
      const prev = s.problems[have - 1]?.level || 1;
      const level = !last ? prev : last.verdict === "correct" && last.hints_used <= 1 ? Math.min(prev + 1, s.targets.length > 1 ? 4 : 2) : last.verdict === "incorrect" ? Math.max(prev - 1, 1) : prev;
      s.problems.push({ ...next, id: `q${have + 1}`, hints_shown: 0, level, attempts: [] });
      s.updated_at = new Date().toISOString();
      return clone(s);
    }
    case "practice_nudge": {
      // AC-168: the scripted hint starts from what they wrote; "listo" in it means it is already solved.
      const s = practiceSet(args.setId as string);
      const p = s.problems.find((x) => x.id === args.problemId)!;
      const draft = String(args.draft ?? "").trim();
      if (!draft) throw "Escribí lo que venís pensando y te doy un empujón desde ahí.";
      p.nudges ??= [];
      if (p.nudges.length >= 3) throw "Ya te di 3 empujones en este problema: probá con lo que tenés o mirá la solución.";
      await sleep(DELAY * 5);
      if (/listo|ya está/i.test(draft)) return { set: clone(s), hint: "Lo que pensaste ya lo resuelve: mandalo como respuesta.", solved: true };
      const hint = `Vas bien con «${draft.split("\n")[0].slice(0, 40)}». Mirá qué pasa justo en el punto que te piden.`;
      p.nudges.push(hint);
      s.updated_at = new Date().toISOString();
      return { set: clone(s), hint, solved: false };
    }
    case "answer_problem": {
      const s = practiceSet(args.setId as string);
      const p = s.problems.find((x) => x.id === args.problemId)!;
      const input = args.input as LearnerInput;
      touch("practice");
      if (!input.text.trim()) throw "Escribí una respuesta.";
      await sleep(DELAY * 10);
      if (flags.failGrade) {
        flags.failGrade = false;
        throw "el proveedor respondió 503: fake: corrector no disponible";
      }
      // AC-173: asked to look again at a reference Eureka wrote, the scripted grader admits the slip.
      const g = p.solution_by_model && /Creo que mi respuesta está bien/.test(input.thinking ?? "")
        ? { verdict: "correct" as const, feedback: "Revisé la referencia: tenía un error y tu razonamiento está bien." }
        : scriptedGrade(input.text, p.solution);
      p.attempts.push({ answer: input.text.trim(), confidence: input.confidence ?? null, thinking: input.thinking ?? "", hints_used: p.hints_shown + (p.nudges?.length ?? 0), ...g, at: new Date().toISOString() });
      s.updated_at = new Date().toISOString();
      return clone(s);
    }
    case "delete_practice":
      store.practice.delete(args.id as string);
      return null;
    case "list_exams":
      return [...store.exams.values()].map(examSummary).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    case "get_exam":
      return clone(exam(args.id as string));
    case "create_exam": {
      const name = String(args.name ?? "").trim();
      const guide = String(args.guide ?? "").trim();
      if (!name || !guide) throw "Poné el nombre del examen y pegá su guía oficial.";
      await sleep(DELAY * 10);
      const rawGuide = parseGuide(guide).filter((d) => d.topics.length);
      if (!rawGuide.length) throw "No se encontraron dominios con temas en la guía. Pegá el temario oficial del examen.";
      const weights = normalizeWeights(rawGuide.map((d) => d.weight));
      const now = new Date().toISOString();
      const e: Exam = {
        id: nid(),
        name,
        created_at: now,
        updated_at: now,
        domains: rawGuide.map((d, i) => ({
          id: `d${i + 1}`,
          name: d.name,
          weight: weights[i],
          topics: d.topics.map((t, j) => ({ id: `d${i + 1}t${j + 1}`, title: t.title, objectives: t.objectives, session_id: null, exercises_passed: 0 })),
        })),
        mocks: [],
        review: [],
        goal: { passing_pct: null, exam_date: null, hours_per_week: null },
        cheat_sheet: null,
        kind: args.kind === "subject" ? "subject" : "certification",
        schedule: [],
        lang: null,
      };
      store.exams.set(e.id, e);
      return clone(e);
    }
    case "find_exam_guide": {
      const name = String(args.name ?? "").trim();
      if (!name) throw "Escribí el nombre del examen.";
      if (!store.keys.has("search")) throw "La búsqueda web no está configurada (Ajustes → Búsqueda web).";
      await sleep(DELAY * 10);
      const found = scriptedFoundGuide(name);
      return { guide: found.guide, sources: found.used.map((n) => ({ title: GUIDE_HITS[n - 1].title, url: GUIDE_HITS[n - 1].url })) };
    }
    case "delete_exam":
      store.exams.delete(args.id as string);
      return null;
    // AC-214..AC-217: learning routes.
    case "route_create": {
      const r = createRoute(args.proposal as never);
      store.routes.set(r.id, r);
      return routeView(r, (id) => store.sessions.get(id));
    }
    case "route_list":
      return [...store.routes.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r) => routeView(r, (id) => store.sessions.get(id)));
    case "route_get": {
      const r = store.routes.get(args.id as string);
      if (!r) throw "ruta no encontrada";
      return routeView(r, (id) => store.sessions.get(id));
    }
    case "route_start_class": {
      const r = store.routes.get(args.routeId as string);
      const c = r?.units.flatMap((u) => u.classes).find((x) => x.id === args.classId);
      if (!r || !c) throw "clase no encontrada";
      const existing = c.session_id ? store.sessions.get(c.session_id) : undefined;
      if (existing) return clone(existing);
      const s = newSession(c.title);
      s.route = { route_id: r.id, class_id: c.id };
      c.session_id = s.id;
      r.updated_at = new Date().toISOString();
      return clone(s);
    }
    case "route_delete":
      store.routes.delete(args.id as string);
      return null;
    case "study_topic": {
      const e = exam(args.examId as string);
      const d = e.domains.find((x) => x.topics.some((t) => t.id === args.topicId));
      const t = d?.topics.find((x) => x.id === args.topicId);
      if (!d || !t) throw "tema no encontrado";
      const existing = t.session_id ? store.sessions.get(t.session_id) : undefined;
      if (existing) return clone(existing);
      const s = newSession(t.title);
      s.exam = { exam_id: e.id, exam_name: e.name, domain: d.name, weight: d.weight, topic_id: t.id, objectives: t.objectives, lang: e.lang };
      t.session_id = s.id;
      e.updated_at = new Date().toISOString();
      return clone(s);
    }
    case "create_mock": {
      const e = exam(args.examId as string);
      await sleep(DELAY * 10);
      if (flags.failMock) {
        flags.failMock = false;
        throw "el proveedor respondió 503: fake: autor de simulacros no disponible";
      }
      const minutes = args.minutes == null ? null : Number(args.minutes);
      if (minutes != null && !(minutes >= 1 && minutes <= 600)) throw "El tiempo tiene que estar entre 1 y 600 minutos.";
      // Mirror of exam::focused (Rust).
      const focus = (args.focus ?? null) as { domain_ids: string[]; topic_ids: string[] } | null;
      const scope = !focus || (!focus.domain_ids.length && !focus.topic_ids.length)
        ? e.domains
        : e.domains.flatMap((d) => (focus.domain_ids.includes(d.id) ? [d] : d.topics.some((t) => focus.topic_ids.includes(t.id)) ? [{ ...d, topics: d.topics.filter((t) => focus.topic_ids.includes(t.id)) }] : []));
      if (!scope.length) throw "Elegí al menos un dominio o tema del examen.";
      const per = allocate(Math.min(40, Math.max(1, Number(args.count))), scope.map((d) => d.weight));
      // Mirror of exam::apply_check: a disputed question is dropped, ids renumbered.
      const generated = scriptedQuestions(scope.map((d, i) => ({ domain_id: d.id, topics: d.topics, n: per[i] })));
      const dropped = disputeOne && generated.length > 1 ? 1 : 0;
      const questions = generated.slice(dropped).map((q, i) => ({ ...q, id: `m${i + 1}`, reported: null }));
      const time_limit_secs = minutes == null ? null : minutes * (shortTime ? 3 : 60);
      const label = scope === e.domains ? null : scope.map((d) => d.name).join(", ");
      e.mocks.push({ id: nid(), created_at: new Date().toISOString(), questions, result: null, time_limit_secs, focus: label, dropped });
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "submit_mock": {
      const e = exam(args.examId as string);
      const m = e.mocks.find((x) => x.id === args.mockId);
      if (!m) throw "simulacro no encontrado";
      touch("exam");
      if (m.result) throw "Este simulacro ya fue entregado.";
      const given = args.answers as number[][];
      const answers = m.questions.map((_, i) => [...new Set(given[i] ?? [])].sort((a, b) => a - b));
      const right = (i: number) => isRight(m.questions[i].answer, answers[i]);
      m.result = { ...mockGrade(e, m.questions, answers), elapsed_secs: Math.max(0, Math.round((Date.now() - Date.parse(m.created_at)) / 1000)) };
      // Mirror of AC-57: failed questions also go to "Falladas: <exam>".
      const failedCards = m.questions
        .filter((q, i) => !q.reported && !right(i))
        .map((q) => ({
          front: `${q.stem}\n${q.options.map((o, j) => `- ${String.fromCharCode(65 + j)}) ${o}`).join("\n")}`,
          back: `**${q.answer.map((j) => `${String.fromCharCode(65 + j)}) ${q.options[j]}`).join(" · ")}**\n\n${q.explanation}`,
        }));
      addToNamedDeck(`Falladas: ${e.name}`, { kind: "exam", id: e.id }, failedCards);
      // Mirror of exam::add_to_review (Rust).
      m.questions.forEach((q, i) => {
        if (right(i) || q.reported) return;
        const same = e.review.find((r) => r.question.stem.toLowerCase() === q.stem.toLowerCase());
        if (same) same.streak = 0;
        else e.review.push({ id: nid(), question: clone(q), mock_id: m.id, streak: 0, added_at: new Date().toISOString() });
      });
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "explain_question": {
      const ask = String(args.ask ?? "").trim();
      if (!ask) throw "Escribí tu pregunta.";
      await sleep(DELAY * 10);
      return scriptedExplain(ask);
    }
    case "report_question": {
      const e = exam(args.examId as string);
      const m = e.mocks.find((x) => x.id === args.mockId);
      const q = m?.questions.find((x) => x.id === args.questionId);
      if (!m || !q) throw "pregunta no encontrada";
      q.reported = String(args.reason ?? "").trim() || "sin motivo";
      e.review = e.review.filter((r) => r.question.stem.toLowerCase() !== q.stem.toLowerCase());
      if (m.result) m.result = { ...mockGrade(e, m.questions, m.result.answers), at: m.result.at, elapsed_secs: m.result.elapsed_secs };
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "report_review": {
      const e = exam(args.examId as string);
      const before = e.review.length;
      e.review = e.review.filter((r) => r.id !== args.reviewId);
      if (e.review.length === before) throw "pregunta de repaso no encontrada";
      return clone(e);
    }
    case "create_cheat_sheet": {
      const e = exam(args.examId as string);
      await sleep(DELAY * 10);
      const failing = e.review.slice(0, 3).map((r) => `- Ojo: ${r.question.stem.replace(/\*/g, "")}`).join("\n");
      e.cheat_sheet = {
        markdown: [...e.domains].sort((a, b) => b.weight - a.weight).map((d) => `## ${d.name} (${d.weight}%)\n${d.topics.map((t) => `- **${t.title}**`).join("\n")}`).join("\n\n") + `\n\n## Trampas frecuentes\n${failing || "- Leé dos veces lo que pide la pregunta."}`,
        at: new Date().toISOString(),
      };
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "create_language_path": {
      await sleep(DELAY * 10);
      const lang = args.lang as Lang;
      const label = langLabel(lang);
      const mods: [string, [string, string][]][] = [
        ["Fundamentos", [["Variables y tipos", "Declarar y usar tipos básicos"], ["Control de flujo", "Escribir condicionales y bucles"]]],
        ["Funciones", [["Funciones y parámetros", "Escribir funciones puras"], ["Errores", "Manejar errores sin romper el programa"]]],
        ["Proyecto", [["Mini proyecto", "Armar un programa completo con tests"]]],
      ];
      const now = new Date().toISOString();
      const e: Exam = {
        id: nid(),
        name: `Ruta de ${label}`,
        created_at: now,
        updated_at: now,
        domains: mods.map(([name, topics], i) => ({
          id: `d${i + 1}`,
          name,
          weight: Math.round(1000 / mods.length) / 10,
          topics: topics.map(([title, obj], j) => ({ id: `d${i + 1}t${j + 1}`, title, objectives: [obj], session_id: null, exercises_passed: 0 })),
        })),
        mocks: [],
        review: [],
        goal: { passing_pct: null, exam_date: null, hours_per_week: null },
        cheat_sheet: null,
        kind: "language",
        schedule: [],
        lang,
      };
      store.exams.set(e.id, e);
      return clone(e);
    }
    case "record_exercise": {
      const e = exam(args.examId as string);
      const t = e.domains.flatMap((d) => d.topics).find((x) => x.id === args.topicId);
      if (!t) throw "tema no encontrado";
      t.exercises_passed += 1;
      return clone(e);
    }
    case "set_exam_schedule": {
      const e = exam(args.examId as string);
      const slots = args.slots as Exam["schedule"];
      const ok = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
      for (const s of slots) {
        if (!(s.weekday >= 1 && s.weekday <= 7)) throw "Día inválido.";
        if (!ok(s.start) || !ok(s.end)) throw "Hora inválida: usá el formato HH:MM.";
        if (s.end <= s.start) throw "La hora de fin tiene que ser después de la de inicio.";
      }
      e.schedule = [...slots].map((s) => ({ ...s, place: s.place.trim() })).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "set_exam_goal": {
      const e = exam(args.examId as string);
      const g = args.goal as Exam["goal"];
      if (g.passing_pct != null && !(g.passing_pct >= 1 && g.passing_pct <= 100)) throw "La nota para aprobar tiene que estar entre 1 y 100 %.";
      if (g.hours_per_week != null && !(g.hours_per_week >= 0.5 && g.hours_per_week <= 80)) throw "Las horas por semana tienen que estar entre 0,5 y 80.";
      const date = g.exam_date?.trim() || null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw "La fecha del examen no es válida.";
      e.goal = { passing_pct: g.passing_pct == null ? null : Math.round(g.passing_pct * 10) / 10, exam_date: date, hours_per_week: g.hours_per_week };
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "answer_review": {
      const e = exam(args.examId as string);
      const i = e.review.findIndex((r) => r.id === args.reviewId);
      if (i < 0) throw "pregunta de repaso no encontrada";
      const item = e.review[i];
      item.streak = isRight(item.question.answer, args.choice as number[]) ? item.streak + 1 : 0;
      if (item.streak >= 2) e.review.splice(i, 1);
      e.updated_at = new Date().toISOString();
      return clone(e);
    }
    case "import_cards": {
      const cards = args.cards as [string, string][];
      if (!cards.length) throw "No encontré tarjetas en el archivo.";
      const name = String(args.name ?? "").trim();
      if (!name) throw "Poné un nombre al mazo.";
      const now = new Date().toISOString();
      const d: Deck = { id: nid(), name, source: { kind: "manual" }, created_at: now, updated_at: now, cards: cards.map(([f, b]) => newCard(f, b, String(args.today))) };
      store.decks.set(d.id, d);
      return d.id;
    }
    case "list_decks": {
      const today = String(args.today);
      return [...store.decks.values()]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((d) => ({
          id: d.id,
          name: d.name,
          source: d.source,
          updated_at: d.updated_at,
          total: d.cards.length,
          new: d.cards.filter((c) => !c.reviewed).length,
          due: d.cards.filter((c) => c.reviewed && c.due <= today).length,
        }));
    }
    case "get_deck":
      return clone(deck(args.id as string));
    case "create_deck":
    case "generate_deck": {
      const name = String(args.name ?? "").trim();
      if (!name) throw "Poné un nombre al mazo.";
      const now = new Date().toISOString();
      const d: Deck = { id: nid(), name: name.slice(0, 80), source: { kind: "manual" }, created_at: now, updated_at: now, cards: [] };
      if (cmd === "generate_deck") {
        const src = args.source as CardSource;
        const today = String(args.today);
        await sleep(DELAY * 10);
        let material = "";
        if (src.kind === "exam") {
          const e = exam(src.id);
          material = e.domains.flatMap((x) => x.topics.map((t) => `- ${t.title}: ${t.objectives.join("; ")}`)).join("\n");
          d.source = { kind: "exam", id: src.id };
        } else if (src.kind === "graph") {
          const ideas = fold(store.ledger).nodes.filter((n) => src.node_ids.includes(n.id));
          if (!ideas.length) throw "Elegí al menos una idea del grafo.";
          material = ideas.map((n) => `- ${n.text}`).join("\n");
          d.source = { kind: "graph" };
        } else {
          if (!src.text.trim()) throw "Pegá el texto de tus apuntes.";
          material = src.text;
          d.source = { kind: "notes" };
        }
        d.cards = scriptedCards(material, Number(args.count)).cards.map((c) => newCard(c.front, c.back, today));
        if (!d.cards.length) throw "El generador no devolvió tarjetas válidas.";
      }
      store.decks.set(d.id, d);
      return clone(d);
    }
    case "delete_deck":
      store.decks.delete(args.id as string);
      return null;
    case "save_card": {
      const d = deck(args.deckId as string);
      const front = String(args.front ?? "").trim();
      const back = String(args.back ?? "").trim();
      if (!front || !back) throw "La tarjeta necesita frente y dorso.";
      if (args.cardId) {
        const c = d.cards.find((x) => x.id === args.cardId);
        if (!c) throw "tarjeta no encontrada";
        Object.assign(c, { front, back });
      } else d.cards.push(newCard(front, back, String(args.today)));
      d.updated_at = new Date().toISOString();
      return clone(d);
    }
    case "delete_card": {
      const d = deck(args.deckId as string);
      d.cards = d.cards.filter((c) => c.id !== args.cardId);
      d.updated_at = new Date().toISOString();
      return clone(d);
    }
    case "grade_card": {
      const d = deck(args.deckId as string);
      const i = d.cards.findIndex((c) => c.id === args.cardId);
      if (i < 0) throw "tarjeta no encontrada";
      d.cards[i] = reviewCard(d.cards[i], args.grade as Grade, String(args.today));
      touch("cards");
      d.updated_at = new Date().toISOString();
      return clone(d);
    }
    // ── AC-152…154: Anki .apkg and shared decks (the files go as the raw body) ──
    case "read_apkg": {
      const bytes = raw as Uint8Array;
      await sleep(DELAY * 4);
      if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw "Ese archivo no es un paquete de Anki (.apkg).";
      return { cards: [["Hola", "Hello"], ["La […] produce ATP.", "La mitocondria produce ATP."], ["$2+2$", "4"]], media_only: 2, empty: 0 };
    }
    case "read_shared_deck": {
      let d: { eureka?: string; name?: string; cards?: { front: string; back: string }[] };
      try {
        d = JSON.parse(textOf(raw));
      } catch {
        throw "Ese archivo no es un mazo compartido de Eureka (.eureka).";
      }
      if (d.eureka !== "mazo" || !Array.isArray(d.cards)) throw "Ese archivo no es un mazo compartido de Eureka (.eureka).";
      const cards = d.cards.map((c) => [c.front.trim(), c.back.trim()] as [string, string]).filter(([f, b]) => f && b);
      if (!cards.length) throw "Ese mazo no tiene tarjetas que se puedan usar.";
      return { name: d.name?.trim() || "Mazo compartido", cards, skipped: d.cards.length - cards.length };
    }
    case "opened_deck":
      if (!flags.openedDeck) return null;
      flags.openedDeck = false;
      return clone(SHARED_SAMPLE);
    case "export_apkg":
    case "share_deck": {
      const d = store.decks.get(args.deckId as string);
      if (!d) throw "mazo no encontrado";
      if (!d.cards.length) throw cmd === "share_deck" ? "El mazo no tiene tarjetas para compartir." : "El mazo no tiene tarjetas para exportar.";
      return `C:\\Users\\vos\\Downloads\\${d.name}.${cmd === "share_deck" ? "eureka" : "apkg"}`;
    }
    default:
      return UNHANDLED;
  }
}
