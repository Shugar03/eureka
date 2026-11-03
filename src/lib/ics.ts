// AC-59: the agenda as an iCalendar (.ics) file for Google Calendar, Outlook
// or Apple Calendar. Weekly slots repeat until the exam date (or for 20
// weeks); exam dates are all-day events. Times are "floating" (local).
// AC-144: Mi cursada goes too — the active term's classes until the term ends,
// without the days off (AC-145), and its dates still to come.
import type { AcademicData, DateKind, ExamSummary } from "../types";
import { DATE_KIND_LABEL } from "./academic";
import { addDays } from "./cards";
import { isoWeekday } from "./plan";

/** Dates that deserve a reminder the day before. */
const REMIND: DateKind[] = ["parcial", "recuperatorio", "final", "entrega", "tp"];

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DEFAULT_WEEKS = 20;

/** RFC 5545 text escaping. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds lines longer than 75 characters (continuation lines start with a space). */
export function fold(line: string): string {
  const out: string[] = [];
  for (let s = line; s.length; s = s.slice(out.length === 1 ? 75 : 74)) out.push((out.length ? " " : "") + s.slice(0, out.length ? 74 : 75));
  return out.join("\r\n");
}

const compact = (day: string) => day.replace(/-/g, "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The first date on or after `from` that falls on `weekday` (1 = Monday). */
export function nextWeekday(from: string, weekday: number): string {
  return addDays(from, (weekday - isoWeekday(from) + 7) % 7);
}

const alarm = (text: string) => ["BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", fold(`DESCRIPTION:${icsText(text)}`), "END:VALARM"];

/** AC-144: the active term's classes and dates. */
function academicEvents(data: AcademicData, today: string, dtstamp: string): string[] {
  const term = data.terms.find((t) => t.id === data.active_term);
  if (!term) return [];
  const lines: string[] = [];
  const from = term.start && term.start > today ? term.start : today;
  const until = term.end && term.end >= from ? term.end : addDays(from, DEFAULT_WEEKS * 7);
  const off = (term.breaks ?? []).flatMap((b) => {
    const days: string[] = [];
    for (let d = b.start; d <= b.end; d = addDays(d, 1)) days.push(d);
    return days;
  });
  for (const c of data.courses.filter((x) => x.term_id === term.id)) {
    c.slots.forEach((s, i) => {
      const first = nextWeekday(from, s.weekday);
      if (first > until) return;
      const skipped = off.filter((d) => d >= first && d <= until && isoWeekday(d) === s.weekday).sort();
      const room = s.room || c.room;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${c.id}-${i}@eureka`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${compact(first)}T${s.start.replace(":", "")}00`,
        `DTEND:${compact(first)}T${s.end.replace(":", "")}00`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.weekday - 1]};UNTIL=${compact(until)}T235959`,
        ...(skipped.length ? [fold(`EXDATE:${skipped.map((d) => `${compact(d)}T${s.start.replace(":", "")}00`).join(",")}`)] : []),
        fold(`SUMMARY:${icsText(c.name)}`),
        ...(room ? [fold(`LOCATION:${icsText(room)}`)] : []),
        "END:VEVENT",
      );
    });
  }
  const names = new Map(data.courses.map((c) => [c.id, c.name]));
  for (const x of data.dates.filter((d) => d.term_id === term.id && !d.done && d.date >= today)) {
    const title = `${DATE_KIND_LABEL[x.kind]}: ${x.title}${x.course_id && names.get(x.course_id) ? ` · ${names.get(x.course_id)}` : ""}`;
    const timed = x.time && /^\d{2}:\d{2}$/.test(x.time);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${x.id}@eureka`,
      `DTSTAMP:${dtstamp}`,
      ...(timed ? [`DTSTART:${compact(x.date)}T${x.time!.replace(":", "")}00`] : [`DTSTART;VALUE=DATE:${compact(x.date)}`, `DTEND;VALUE=DATE:${compact(addDays(x.date, 1))}`]),
      fold(`SUMMARY:${icsText(title)}`),
      ...(REMIND.includes(x.kind) ? alarm(`Mañana: ${title}`) : []),
      "END:VEVENT",
    );
  }
  return lines;
}

export function buildIcs(exams: ExamSummary[], today: string, now = new Date(), academic: AcademicData | null = null): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Eureka//Agenda//ES", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Eureka"];
  const dtstamp = stamp(now);
  if (academic) lines.push(...academicEvents(academic, today, dtstamp));
  for (const e of exams) {
    const until = e.exam_date && e.exam_date >= today ? e.exam_date : addDays(today, DEFAULT_WEEKS * 7);
    e.schedule.forEach((s, i) => {
      const first = nextWeekday(today, s.weekday);
      if (first > until) return;
      const what = s.kind === "class" ? "Clase" : "Estudio";
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.id}-${i}@eureka`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${compact(first)}T${s.start.replace(":", "")}00`,
        `DTEND:${compact(first)}T${s.end.replace(":", "")}00`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.weekday - 1]};UNTIL=${compact(until)}T235959`,
        fold(`SUMMARY:${icsText(`${what}: ${e.name}`)}`),
        ...(s.place ? [fold(`LOCATION:${icsText(s.place)}`)] : []),
        "END:VEVENT",
      );
    });
    if (e.exam_date && e.exam_date >= today) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.id}-date@eureka`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${compact(e.exam_date)}`,
        `DTEND;VALUE=DATE:${compact(addDays(e.exam_date, 1))}`,
        fold(`SUMMARY:${icsText(`${e.kind === "subject" ? "Parcial/final" : "Examen"}: ${e.name}`)}`),
        ...alarm(`Mañana: ${e.name}`),
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
