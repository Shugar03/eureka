import { useEffect, useState } from "react";
import { academicApi, api, errorText } from "../api";
import type { AcademicData, ExamSummary } from "../types";
import { daysUntil, localDate } from "../lib/exam";
import { isoWeekday, slotsOn, upcoming, weeklyHours, WEEKDAYS } from "../lib/plan";
import type { AgendaSlot } from "../lib/plan";
import { DATE_KIND_LABEL, dayOff, termCourses, termDates, upcomingDates, weeklyClassHours } from "../lib/academic";
import { buildIcs } from "../lib/ics";

interface Props {
  onOpenExam: (id: string) => void;
  /** Opens Mi cursada (the classes and dates that come from there). */
  onOpenAcademic?: () => void;
}

/** A slot on the agenda: from a materia/exam, or from Mi cursada (AC-103). */
type Row = AgendaSlot & { academic?: boolean };

const KIND_LABEL = { class: "Clase", study: "Estudio" } as const;
const fmtHours = (h: number) => `${Math.round(h * 10) / 10}`.replace(".", ",");

/** AC-51: the week of every subject and exam, today's slots and upcoming dates. */
export function AgendaScreen({ onOpenExam, onOpenAcademic }: Props) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const today = localDate(new Date());
  const todayWd = isoWeekday(today);

  useEffect(() => {
    api.listExams().then(setExams).catch((e) => setError(errorText(e)));
    academicApi.state().then(setAcademic).catch(() => {});
  }, []);

  if (!exams) return <div className="center muted">{error ?? "Cargando…"}</div>;
  const acCourses = academic ? termCourses(academic, academic.active_term) : [];
  const acDates = academic ? upcomingDates(termDates(academic, academic.active_term), today) : [];
  const acSlots = (wd: number): Row[] =>
    acCourses.flatMap((c) => c.slots.filter((s) => s.weekday === wd).map((s) => ({ weekday: s.weekday, start: s.start, end: s.end, kind: "class" as const, place: s.room || c.room, examId: "", name: c.name, academic: true })));
  const slotsFor = (wd: number): Row[] => [...slotsOn(exams, wd), ...acSlots(wd)].sort((a, b) => a.start.localeCompare(b.start));
  const open = (s: Row) => (s.academic ? onOpenAcademic?.() : onOpenExam(s.examId));
  // AC-145: a holiday or a break has no classes from Mi cursada.
  const todays = dayOff(academic, today) ? slotsOn(exams, todayWd) : slotsFor(todayWd);
  const exDates = upcoming(exams, today);
  const dates = [
    ...exDates.map((e) => ({ key: e.id, date: e.exam_date!, name: e.name, what: e.kind === "subject" ? "parcial/final" : "examen", academic: false, go: () => onOpenExam(e.id) })),
    ...acDates.map((d) => ({ key: d.id, date: d.date, name: d.title + (d.course_id ? ` · ${acCourses.find((c) => c.id === d.course_id)?.name ?? ""}` : ""), what: DATE_KIND_LABEL[d.kind].toLowerCase(), academic: true, go: () => onOpenAcademic?.() })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const base = weeklyHours(exams);
  const hours = { classes: base.classes + weeklyClassHours(acCourses), study: base.study };
  const empty = exams.every((e) => !e.schedule.length) && !dates.length && !acCourses.some((c) => c.slots.length);

  // AC-59: the whole agenda as an .ics file (Google Calendar, Outlook…).
  const exportIcs = () => {
    const url = URL.createObjectURL(new Blob([buildIcs(exams, today, new Date(), academic)], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "eureka-agenda.ics" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
  };

  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Agenda</h1>
        {!empty && (
          <button className="btn ghost small head-action" onClick={exportIcs} title="Para Google Calendar, Outlook o el calendario de tu teléfono">
            Exportar a calendario (.ics)
          </button>
        )}
      </header>
      {exported && (
        <p className="muted small agenda-note" role="status">
          Listo: abrí el archivo <code>eureka-agenda.ics</code> de tu carpeta de descargas (o importalo en Google Calendar → Configuración → Importar).
        </p>
      )}
      <div className="practice-body agenda">
        {empty ? (
          <div className="graph-empty">
            <h2>Tu semana está vacía</h2>
            <p className="muted">Cargá tu horario y tus fechas en <strong>Mi cursada</strong>, o en cada materia o examen: acá ves todo junto.</p>
            {onOpenAcademic && (
              <button className="btn" onClick={onOpenAcademic}>
                Abrir Mi cursada
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="agenda-top">
              <section className="card" aria-label="Hoy">
                <h2>Hoy, {WEEKDAYS[todayWd - 1].toLowerCase()}</h2>
                {todays.length ? (
                  <ul className="agenda-list">
                    {todays.map((s, i) => (
                      <li key={i}>
                        <span className="agenda-time">
                          {s.start}–{s.end}
                        </span>
                        <span className={`slot-kind slot-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
                        <button className="link" onClick={() => open(s)}>
                          {s.name}
                        </button>
                        {s.place && <span className="muted">{s.place}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Hoy no tenés clases ni bloques de estudio cargados.</p>
                )}
              </section>
              <section className="card" aria-label="Próximas fechas">
                <h2>Próximas fechas</h2>
                {dates.length ? (
                  <ul className="agenda-list">
                    {dates.map((e) => {
                      const d = daysUntil(e.date, new Date());
                      return (
                        <li key={e.key}>
                          <span className={`agenda-days ${d <= 7 ? "is-soon" : ""}`}>{d === 0 ? "Hoy" : d === 1 ? "Mañana" : `En ${d} días`}</span>
                          <button className="link" onClick={e.go}>
                            {e.name}
                          </button>
                          <span className="muted">{e.what}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted small">Sin fechas cargadas.</p>
                )}
              </section>
            </div>

            <section className="card" aria-label="Semana">
              <div className="row-between">
                <h2>Semana</h2>
                <span className="muted small" data-testid="week-hours">
                  {fmtHours(hours.classes)} h de clase · {fmtHours(hours.study)} h de estudio planificado
                </span>
              </div>
              <div className="week-grid">
                {WEEKDAYS.map((d, i) => {
                  const slots = slotsFor(i + 1);
                  return (
                    <div key={d} className={`week-col ${i + 1 === todayWd ? "is-today" : ""}`} role="group" aria-label={d}>
                      <h3>{d.slice(0, 3)}</h3>
                      {slots.map((s, j) => (
                        <button key={j} className={`week-slot slot-${s.kind}`} onClick={() => open(s)} title={`${KIND_LABEL[s.kind]} · ${s.name}${s.place ? ` · ${s.place}` : ""}`}>
                          <span className="week-slot-time">{s.start}</span>
                          <span className="week-slot-name">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
