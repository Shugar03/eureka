// Mi cursada, career plan (malla), recorded classes, activity and study log mock handlers.
import type { AcademicData, BreakInput, CareerProposal, CareerSubject, CareerSubjectInput, CareerView, ClassRecord, CourseInput, DateInput, Proposal, StudyEntry, TermInput } from "../../types";
import { applyImport } from "../academicMock";
import { timetableProposal } from "../teacherScript";
import { DELAY, MOCK_ACADEMIC_KEY, UNHANDLED, clone, dayFromNow, nid, sleep, store, touch } from "./state";

export const SAMPLE_CURRICULUM_TEXT = "Ingeniería en Sistemas de Información — UTN FRBA\n1.º año\nAnálisis Matemático I (AM1)\nÁlgebra y Geometría Analítica (AGA)\n2.º año\nAnálisis Matemático II — correlativas: AM1, AGA\n3.º año\nProbabilidad y Estadística — correlativas: Análisis Matemático II";
const SAMPLE_CAREER: CareerProposal = {
  name: "Ingeniería en Sistemas de Información",
  institution: "UTN FRBA",
  subjects: [
    { name: "Análisis Matemático I", code: "AM1", year: 1, term: 1 },
    { name: "Álgebra y Geometría Analítica", code: "AGA", year: 1, term: 2 },
    { name: "Análisis Matemático II", code: "AM2", year: 2, para_cursar: ["AM1", "AGA"], para_rendir: ["AM1"] },
    { name: "Probabilidad y Estadística", year: 3, para_cursar: ["Análisis Matemático II"], para_rendir: ["Análisis Matemático II"] },
  ],
};

let career: CareerSubject[] | null = null;
let careerHead = { name: "", institution: "" };
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function cursadaKeys(): string[] {
  const a = store.academic;
  return a.courses.filter((c) => c.term_id === a.active_term).flatMap((c) => [norm(c.name), norm(c.code ?? "")]).filter(Boolean);
}

function careerView(cursada: string[]): CareerView | null {
  if (!career) return null;
  const all = career;
  const byId = new Map(all.map((s) => [s.id, s]));
  const regular = (id: string) => ["regular", "aprobada"].includes(byId.get(id)?.status ?? "aprobada");
  const passed = (id: string) => (byId.get(id)?.status ?? "aprobada") === "aprobada";
  const grades = all.filter((s) => s.status === "aprobada" && s.grade != null).map((s) => s.grade!);
  const failed = all.flatMap((s) => s.failed);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return {
    ...careerHead,
    subjects: all.map((s) => ({
      ...s,
      can_take: s.status === "pendiente" && s.para_cursar.every(regular),
      can_sit_final: s.status === "regular" && s.para_rendir.every(passed),
      missing: (s.status === "pendiente" ? s.para_cursar.filter((id) => !regular(id)) : s.status === "aprobada" ? [] : s.para_rendir.filter((id) => !passed(id))).map((id) => byId.get(id)!.name),
      in_cursada: cursada.includes(norm(s.name)) || (!!s.code && cursada.includes(norm(s.code))),
    })),
    approved: all.filter((s) => s.status === "aprobada").length,
    total: all.length,
    average: mean(grades),
    average_with_failed: failed.length ? mean([...grades, ...failed]) : null,
  };
}

function classOf(id: string): ClassRecord {
  const c = store.classes.get(id);
  if (!c) throw "Esa clase ya no existe.";
  return c;
}

/** AC-150: each linked route takes its course's next parcial, recuperatorio or final. */
function syncRoutes() {
  const today = dayFromNow(0);
  for (const c of store.academic.courses) {
    const e = c.exam_id ? store.exams.get(c.exam_id) : undefined;
    if (!e) continue;
    const next = store.academic.dates
      .filter((x) => x.course_id === c.id && !x.done && x.date >= today && ["parcial", "recuperatorio", "final"].includes(x.kind))
      .map((x) => x.date)
      .sort()[0];
    e.goal = { ...e.goal, exam_date: next ?? null };
  }
}

function academicDone(): AcademicData {
  syncRoutes();
  try {
    localStorage.setItem(MOCK_ACADEMIC_KEY, JSON.stringify(store.academic));
  } catch {
    /* private mode */
  }
  return clone(store.academic);
}

export async function handleAcademic(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    // AC-146, AC-147: recorded classes.
    case "class_list":
      return [...store.classes.values()]
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .map((c) => ({ id: c.id, title: c.title, course_id: c.course_id, day: c.day, seconds: c.seconds, parts: c.parts, has_notes: !!c.notes }));
    case "class_get":
      return clone(classOf(args.id as string));
    case "class_start": {
      const c: ClassRecord = { id: nid(), title: String(args.title ?? "").trim() || "Clase", course_id: (args.courseId as string | null) || null, day: String(args.day), started_at: new Date().toISOString(), seconds: 0, parts: 0, transcript: "", notes: null };
      store.classes.set(c.id, c);
      return clone(c);
    }
    case "class_append": {
      const c = classOf(args.id as string);
      const text = String(args.text ?? "").trim();
      if (text) c.transcript = c.transcript ? `${c.transcript} ${text}` : text;
      c.parts += 1;
      c.seconds += Number(args.seconds) || 0;
      if (text) touch("class");
      return clone(c);
    }
    case "class_rename": {
      const c = classOf(args.id as string);
      if (!String(args.title).trim()) throw "Poné un nombre a la clase.";
      c.title = String(args.title).trim();
      return clone(c);
    }
    case "class_delete":
      store.classes.delete(args.id as string);
      return null;
    case "class_notes": {
      const c = classOf(args.id as string);
      if (c.transcript.trim().length < 80) throw "Todavía hay muy poco transcripto para armar apuntes.";
      await sleep(DELAY * 10);
      c.notes = {
        summary: "### La derivada\n- La **derivada** en un punto es la pendiente de la recta tangente a la curva en ese punto.\n- Para $f(x) = x^2$, la pendiente en $x = 3$ es $6$.",
        key_points: ["La derivada es la pendiente de la recta tangente", "La tangente sale de acercar dos puntos de una secante"],
        questions: ["La definición con límites quedó para la próxima clase"],
        dates: [{ title: "Primer parcial", date: dayFromNow(14), kind: "parcial" }, { title: "TP de derivadas", date: "", kind: "tp" }],
      };
      return clone(c);
    }
    case "activity_days": {
      const since = String(args.since);
      const days = new Map<string, { kinds: Set<string>; minutes: number }>();
      const add = (day: string, kind: string, minutes = 0) => {
        if (day < since) return;
        const e = days.get(day) ?? { kinds: new Set<string>(), minutes: 0 };
        e.kinds.add(kind);
        e.minutes += minutes;
        days.set(day, e);
      };
      for (const [day, kinds] of store.activity) for (const k of kinds) add(day, k);
      for (const e of store.study) add(e.day, "focus", e.minutes);
      const order = ["chat", "focus", "cards", "practice", "exam", "class"];
      return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, e]) => ({ day, kinds: order.filter((k) => e.kinds.has(k)), minutes: Math.round(e.minutes) }));
    }
    case "log_study": {
      const e = args.entry as Omit<StudyEntry, "at">;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day) || !(e.minutes > 0 && e.minutes <= 600)) throw "registro de estudio inválido";
      const entry = { at: new Date().toISOString(), day: e.day, minutes: e.minutes, context: e.context ?? null };
      store.study.push(entry);
      return clone(entry);
    }
    case "study_log":
      return clone(store.study.filter((e) => e.day >= String(args.since)));
    case "academic_state":
      return clone(store.academic);
    case "academic_save_term": {
      const i = args.input as TermInput;
      if (!i.name.trim()) throw "Poné un nombre al período (por ejemplo «2.º cuatrimestre 2026»).";
      const found = i.id ? store.academic.terms.find((t) => t.id === i.id) : undefined;
      if (found) Object.assign(found, { name: i.name.trim(), kind: i.kind, start: i.start ?? null, end: i.end ?? null });
      else {
        const t = { id: nid(), name: i.name.trim(), kind: i.kind, start: i.start ?? null, end: i.end ?? null };
        store.academic.terms.push(t);
        store.academic.active_term = t.id;
      }
      return academicDone();
    }
    case "academic_delete_term": {
      const a = store.academic;
      a.terms = a.terms.filter((t) => t.id !== args.id);
      a.courses = a.courses.filter((c) => c.term_id !== args.id);
      a.dates = a.dates.filter((d) => d.term_id !== args.id);
      if (a.active_term === args.id) a.active_term = a.terms[a.terms.length - 1]?.id ?? null;
      return academicDone();
    }
    case "academic_set_active":
      store.academic.active_term = args.id as string;
      return academicDone();
    case "academic_save_course": {
      const i = args.input as CourseInput;
      if (!i.name.trim()) throw "Poné el nombre de la materia.";
      const found = i.id ? store.academic.courses.find((c) => c.id === i.id) : undefined;
      const fields = { name: i.name.trim(), code: i.code ?? "", professor: i.professor ?? "", room: i.room ?? "", notes: i.notes ?? "", slots: i.slots };
      if (found) Object.assign(found, fields, i.color != null ? { color: i.color } : {});
      else store.academic.courses.push({ id: nid(), term_id: i.term_id, color: i.color ?? store.academic.courses.filter((c) => c.term_id === i.term_id).length % 8, ...fields });
      return academicDone();
    }
    case "academic_delete_course": {
      const a = store.academic;
      a.courses = a.courses.filter((c) => c.id !== args.id);
      a.dates.forEach((d) => d.course_id === args.id && (d.course_id = null));
      return academicDone();
    }
    case "academic_save_date": {
      const i = args.input as DateInput;
      if (!i.title.trim()) throw "Poné un título (por ejemplo «Primer parcial»).";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw "Elegí una fecha válida.";
      const found = i.id ? store.academic.dates.find((d) => d.id === i.id) : undefined;
      const fields = { term_id: i.term_id, course_id: i.course_id ?? null, kind: i.kind, title: i.title.trim(), date: i.date, time: i.time ?? null, notes: i.notes ?? "", done: i.done ?? false, grade: i.grade ?? null };
      if (found) Object.assign(found, fields);
      else store.academic.dates.push({ id: nid(), ...fields });
      return academicDone();
    }
    case "academic_link_route": {
      const c = store.academic.courses.find((x) => x.id === args.courseId);
      if (!c) throw "Esa materia ya no existe.";
      c.exam_id = (args.examId as string | null) || null;
      return academicDone();
    }
    case "academic_add_breaks": {
      const t = store.academic.terms.find((x) => x.id === args.termId);
      if (!t) throw "Ese período ya no existe.";
      const breaks = t.breaks ?? [];
      for (const i of args.items as BreakInput[]) {
        const end = i.end?.trim() || i.start;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw "Los días sin clases van con fecha AAAA-MM-DD.";
        if (end < i.start) throw "El «hasta» es anterior al «desde».";
        if (breaks.some((b) => b.start === i.start && b.end === end)) continue;
        breaks.push({ id: nid(), start: i.start, end, name: i.name.trim() || "Sin clases" });
      }
      t.breaks = breaks.sort((a, b) => a.start.localeCompare(b.start));
      return academicDone();
    }
    case "academic_delete_break": {
      const t = store.academic.terms.find((x) => x.id === args.termId);
      if (t) t.breaks = (t.breaks ?? []).filter((b) => b.id !== args.id);
      return academicDone();
    }
    case "academic_delete_date":
      store.academic.dates = store.academic.dates.filter((d) => d.id !== args.id);
      return academicDone();
    case "academic_import": {
      const report = applyImport(store.academic, args.proposal as Proposal);
      return { data: academicDone(), report };
    }
    case "academic_parse": {
      const text = String(args.text ?? "").trim();
      if (!text) throw "Pegá tu horario o tus fechas.";
      await sleep(DELAY * 8);
      if (!/an[aá]lisis|f[ií]sica|lunes|martes|parcial|\d{1,2}:\d{2}/i.test(text)) throw "No encontré horarios ni fechas en ese texto. Probá pegarlo tal cual te lo pasaron.";
      return timetableProposal();
    }
    // ── AC-155…157: la malla ──
    case "career_get":
      return careerView(cursadaKeys());
    case "career_parse": {
      const text = String(args.text ?? "").trim();
      if (!text) throw "Pegá el plan de estudios de tu carrera.";
      await sleep(DELAY * 8);
      if (!/an[aá]lisis|[aá]lgebra|a[nñ]o/i.test(text)) throw "No encontré materias en ese texto. Probá pegar el plan tal cual lo publica tu facultad.";
      return clone(SAMPLE_CAREER);
    }
    case "career_save_plan": {
      const p = args.proposal as CareerProposal;
      const ids = p.subjects.map(() => nid());
      const ref = (r: string) => p.subjects.findIndex((s) => s.code === r || norm(s.name) === norm(r));
      const old = career ?? [];
      careerHead = { name: p.name, institution: p.institution ?? "" };
      career = p.subjects.map((s, i) => {
        const prev = old.find((o) => norm(o.name) === norm(s.name) || (!!s.code && o.code === s.code));
        return { id: ids[i], name: s.name, code: s.code ?? "", year: s.year, term: s.term ?? null, para_cursar: (s.para_cursar ?? []).map((r) => ids[ref(r)]), para_rendir: (s.para_rendir ?? []).map((r) => ids[ref(r)]), status: prev?.status ?? "pendiente", grade: prev?.grade ?? null, failed: prev?.failed ?? [] };
      });
      return careerView(cursadaKeys());
    }
    case "career_save_subject": {
      if (!career) throw "Todavía no cargaste tu carrera.";
      const i = args.input as CareerSubjectInput;
      if (!i.name.trim()) throw "Poné el nombre de la materia.";
      if (i.grade != null && (i.grade < 0 || i.grade > 10)) throw "La nota tiene que estar entre 0 y 10.";
      if (career.some((s) => s.id !== i.id && norm(s.name) === norm(i.name))) throw `Ya hay una materia «${i.name.trim()}».`;
      const s: CareerSubject = { ...i, id: i.id ?? nid(), name: i.name.trim(), grade: i.status === "aprobada" ? i.grade : null };
      career = i.id ? career.map((x) => (x.id === i.id ? s : x)) : [...career, s];
      return careerView(cursadaKeys());
    }
    case "career_delete_subject": {
      if (!career) throw "Todavía no cargaste tu carrera.";
      const id = args.id as string;
      career = career.filter((s) => s.id !== id).map((s) => ({ ...s, para_cursar: s.para_cursar.filter((r) => r !== id), para_rendir: s.para_rendir.filter((r) => r !== id) }));
      return careerView(cursadaKeys());
    }
    case "career_delete":
      career = null;
      return null;
    default:
      return UNHANDLED;
  }
}
