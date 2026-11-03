// The browser demo's Mi cursada: the same rules as src-tauri/src/academic.rs
// (merge by name, never duplicate a date), kept small. Pure, so it can be tested.
import type { AcademicData, ClassSlot, Course, DateItem, ImportReport, Proposal } from "../types";

export const emptyAcademic = (): AcademicData => ({ terms: [], courses: [], dates: [], active_term: null });

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

let seq = 0;
const id = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

const sameSlot = (a: ClassSlot, b: ClassSlot) => a.weekday === b.weekday && a.start === b.start && a.end === b.end;

export function mergeSlots(a: ClassSlot[], b: ClassSlot[]): ClassSlot[] {
  const out: ClassSlot[] = [];
  for (const s of [...a, ...b]) if (!out.some((o) => sameSlot(o, s))) out.push(s);
  return out.sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start));
}

const slotOf = (s: Partial<ClassSlot>): ClassSlot => ({ weekday: s.weekday ?? 1, start: s.start ?? "", end: s.end ?? "", room: s.room ?? "", kind: s.kind ?? "teoria" });

/** Applies a confirmed proposal to `d` (mutates it), like AcademicStore::import. */
export function applyImport(d: AcademicData, p: Proposal): ImportReport {
  const report: ImportReport = { term: "", courses_added: 0, courses_updated: 0, dates_added: 0, dates_skipped: 0 };
  let termId: string;
  if (p.term) {
    const found = d.terms.find((t) => key(t.name) === key(p.term!.name));
    if (found) termId = found.id;
    else {
      termId = id();
      d.terms.push({ id: termId, name: p.term.name.trim(), kind: (p.term.kind as never) ?? "otro", start: p.term.start ?? null, end: p.term.end ?? null });
    }
    d.active_term = termId;
  } else if (d.active_term && d.terms.some((t) => t.id === d.active_term)) termId = d.active_term;
  else {
    termId = id();
    d.terms.push({ id: termId, name: "Período actual", kind: "otro", start: null, end: null });
    d.active_term = termId;
  }
  report.term = d.terms.find((t) => t.id === termId)!.name;

  for (const c of p.courses ?? []) {
    const slots = (c.slots ?? []).map(slotOf);
    const found = d.courses.find((x) => x.term_id === termId && key(x.name) === key(c.name));
    if (found) {
      found.code = c.code || found.code;
      found.professor = c.professor || found.professor;
      found.room = c.room || found.room;
      found.notes = c.notes || found.notes;
      found.slots = mergeSlots(found.slots, slots);
      report.courses_updated++;
    } else {
      const course: Course = { id: id(), term_id: termId, name: c.name.trim(), code: c.code ?? "", professor: c.professor ?? "", room: c.room ?? "", notes: c.notes ?? "", color: d.courses.filter((x) => x.term_id === termId).length % 8, slots: mergeSlots([], slots) };
      d.courses.push(course);
      report.courses_added++;
    }
  }

  for (const x of p.dates ?? []) {
    const course = x.course ? d.courses.find((c) => c.term_id === termId && key(c.name) === key(x.course!)) : undefined;
    const kind = (key(x.kind) === "trabajo practico" ? "tp" : key(x.kind)) as DateItem["kind"];
    const dup = d.dates.some((e) => e.term_id === termId && e.course_id === (course?.id ?? null) && e.kind === kind && key(e.title) === key(x.title) && e.date === x.date);
    if (dup) {
      report.dates_skipped++;
      continue;
    }
    d.dates.push({ id: id(), term_id: termId, course_id: course?.id ?? null, kind, title: x.title.trim(), date: x.date, time: x.time ?? null, notes: x.notes ?? "", done: false, grade: null });
    report.dates_added++;
  }
  return report;
}
