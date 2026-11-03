import { useEffect, useState } from "react";
import { academicApi, api, errorText } from "../../api";
import type { AcademicData, BreakInput, ExamSummary, RoutePrefill, Course, CourseInput, DateInput, DateItem, ImportReport, Proposal, TermInput } from "../../types";
import { localDate } from "../../lib/exam";
import { fileText } from "../../lib/fileText";
import { DATE_KIND_LABEL, dateLabel, daysLabel, doneDates, overdueDates, slotText, suggestTerm, termCourses, termDates, TERM_KIND_LABEL, upcomingDates, weeklyClassHours } from "../../lib/academic";
import { CourseForm, DateForm, TermForm } from "./Forms";
import { ProposalPreview } from "./ProposalPreview";
import { BreaksCard } from "./BreaksCard";
import { CareerPanel } from "./CareerPanel";
import { WeekGrid } from "./WeekGrid";

type Editor = { kind: "term"; id?: string } | { kind: "course"; id?: string } | { kind: "date"; id?: string } | { kind: "import" } | null;

const hours = (h: number) => `${Math.round(h * 10) / 10}`.replace(".", ",");

/**
 * AC-99…: the learner's academic life. A week grid, the dates that matter
 * (parciales, TPs, finales), and their courses, by term. It can be filled by
 * hand, by pasting a timetable, or by telling it to the assistant in the chat.
 */
export function AcademicScreen({ onOpenChat, onStudy, onOpenExam, onNewRoute }: { onOpenChat: () => void; onStudy: (message: string) => void; onOpenExam?: (id: string) => void; onNewRoute?: (p: RoutePrefill) => void }) {
  const [data, setData] = useState<AcademicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  // AC-155: this term, or the whole career (the malla).
  const [tab, setTab] = useState<"cursada" | "carrera">("cursada");
  const today = localDate(new Date());

  const [exams, setExams] = useState<ExamSummary[]>([]);
  useEffect(() => {
    academicApi
      .state()
      .then(setData)
      .catch((e) => setError(errorText(e)));
    api
      .listExams()
      .then(setExams)
      .catch(() => {});
  }, []);

  if (!data) return <div className="center muted">{error ?? "Cargando…"}</div>;

  const termId = data.active_term && data.terms.some((t) => t.id === data.active_term) ? data.active_term : (data.terms[0]?.id ?? null);
  const term = data.terms.find((t) => t.id === termId) ?? null;
  const courses = termCourses(data, termId);
  const dates = termDates(data, termId);
  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name;

  const run = async (f: () => Promise<AcademicData>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      setData(await f());
      after?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => setEditor(null);
  const addBreaks = async (items: BreakInput[]) => {
    if (!termId) return false;
    setBusy(true);
    setError(null);
    try {
      setData(await academicApi.addBreaks(termId, items));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const confirm = (key: string, go: () => void) => (armed === key ? (setArmed(null), go()) : setArmed(key));
  const saveDate = (i: DateInput) => run(() => academicApi.saveDate(i), close);
  const toggleDone = (x: DateItem) => run(() => academicApi.saveDate({ ...x, done: !x.done }));
  const importProposal = async (p: Proposal): Promise<ImportReport> => {
    const r = await academicApi.importProposal(p);
    setData(r.data);
    return r.report;
  };

  const needTerm = () => {
    if (!termId) {
      setEditor({ kind: "term" });
      return false;
    }
    return true;
  };

  const editing = {
    course: editor?.kind === "course" ? courses.find((c) => c.id === editor.id) : undefined,
    date: editor?.kind === "date" ? dates.find((d) => d.id === editor.id) : undefined,
    term: editor?.kind === "term" ? data.terms.find((t) => t.id === editor.id) : undefined,
  };

  const tabs = (
    <div className="tabs" role="tablist" aria-label="Mi cursada o mi carrera">
      <button role="tab" aria-selected={tab === "cursada"} className={tab === "cursada" ? "is-active" : ""} onClick={() => setTab("cursada")}>
        Este período
      </button>
      <button role="tab" aria-selected={tab === "carrera"} className={tab === "carrera" ? "is-active" : ""} onClick={() => setTab("carrera")}>
        Mi carrera
      </button>
    </div>
  );

  if (tab === "carrera")
    return (
      <div className="practice-screen academic">
        <header className="chat-head">
          <h1 className="chat-title">Mi cursada</h1>
          {tabs}
        </header>
        <div className="practice-body">
          <CareerPanel />
        </div>
      </div>
    );

  return (
    <div className="practice-screen academic">
      <header className="chat-head">
        <h1 className="chat-title">Mi cursada</h1>
        {tabs}
        <div className="head-actions">
          <button className="btn small" onClick={() => setEditor({ kind: "import" })}>
            Pegar mi horario
          </button>
          <button className="btn small" onClick={() => needTerm() && setEditor({ kind: "course" })}>
            Agregar materia
          </button>
          <button className="btn small" onClick={() => needTerm() && setEditor({ kind: "date" })}>
            Agregar fecha
          </button>
        </div>
      </header>

      <div className="practice-body">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        {editor?.kind === "import" && <ImportPanel onSave={importProposal} onClose={close} />}
        {editor?.kind === "term" && <TermForm term={editing.term} suggestion={suggestTerm(new Date())} busy={busy} onCancel={close} onSave={(i: TermInput) => run(() => academicApi.saveTerm(i), close)} />}
        {editor?.kind === "course" && termId && <CourseForm key={editor.id ?? "new"} course={editing.course} termId={termId} busy={busy} onCancel={close} onSave={(i: CourseInput) => run(() => academicApi.saveCourse(i), close)} />}
        {editor?.kind === "date" && termId && <DateForm key={editor.id ?? "new"} item={editing.date} termId={termId} courses={courses} busy={busy} onCancel={close} onSave={saveDate} />}

        {!term ? (
          <section className="graph-empty" aria-label="Armá tu cursada">
            <h2>Armá tu cursada</h2>
            <p className="muted">Tené en un solo lugar tus materias, tus horarios y las fechas que no te podés olvidar: parciales, entregas de TPs y finales.</p>
            <ul className="academic-ways">
              <li>
                <strong>Pegá tu horario.</strong> Copialo de tu facultad (texto de un PDF, de la web, o como te lo pasaron) y lo leo por vos.
              </li>
              <li>
                <strong>Contáselo al asistente</strong> en el chat, con tus palabras: «lunes y miércoles de 10 a 12 tengo Análisis con Pérez en el aula 3».
              </li>
              <li>
                <strong>Cargalo a mano</strong>: primero el período (por ejemplo, 2.º cuatrimestre), después cada materia.
              </li>
            </ul>
            <div className="row">
              <button className="btn primary" onClick={() => setEditor({ kind: "import" })}>
                Pegar mi horario
              </button>
              <button className="btn" onClick={onOpenChat}>
                Contárselo al asistente
              </button>
              <button className="btn" onClick={() => setEditor({ kind: "term" })}>
                Cargarlo a mano
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="term-bar" role="group" aria-label="Período de la cursada">
              <select value={termId ?? ""} onChange={(e) => run(() => academicApi.setActive(e.target.value))} aria-label="Período">
                {data.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="muted small">
                {TERM_KIND_LABEL[term.kind]}
                {term.start && term.end ? ` · del ${dateLabelShort(term.start)} al ${dateLabelShort(term.end)}` : ""} · {hours(weeklyClassHours(courses))} h de clase por semana
              </span>
              <span className="row">
                <button className="btn ghost small" onClick={() => setEditor({ kind: "term" })}>
                  Nuevo período
                </button>
                <button className="btn ghost small" onClick={() => setEditor({ kind: "term", id: term.id })}>
                  Editar período
                </button>
                <button className={`btn small ${armed === `t:${term.id}` ? "danger" : "ghost"}`} onClick={() => confirm(`t:${term.id}`, () => run(() => academicApi.deleteTerm(term.id)))} onBlur={() => setArmed(null)}>
                  {armed === `t:${term.id}` ? "¿Seguro? Borrar período" : "Borrar período"}
                </button>
              </span>
            </div>

            <div className="academic-top">
              <section className="card" aria-label="Semana">
                <h2>Mi semana</h2>
                {courses.some((c) => c.slots.length) ? (
                  <WeekGrid courses={courses} today={today} onOpenCourse={(id) => setEditor({ kind: "course", id })} />
                ) : (
                  <p className="muted small">Cuando cargues los horarios de tus materias, vas a ver acá tu semana.</p>
                )}
              </section>

              <section className="card" aria-label="Fechas importantes">
                <h2>Fechas importantes</h2>
                <DatesList
                  dates={dates}
                  today={today}
                  courseName={courseName}
                  armed={armed}
                  onToggle={toggleDone}
                  onEdit={(id) => setEditor({ kind: "date", id })}
                  onDelete={(id) => confirm(`d:${id}`, () => run(() => academicApi.deleteDate(id)))}
                  onBlur={() => setArmed(null)}
                />
              </section>
            </div>

            <BreaksCard term={term} today={today} busy={busy} onAdd={addBreaks} onDelete={(id) => run(() => academicApi.deleteBreak(term.id, id))} />

            <section className="academic-courses" aria-label="Materias">
              <h2 className="section-title">Materias</h2>
              {courses.length === 0 ? (
                <p className="muted small">Todavía no cargaste materias en este período.</p>
              ) : (
                <ul className="course-list">
                  {courses.map((c) => (
                    <CourseCard
                      key={c.id}
                      course={c}
                      next={
                        upcomingDates(
                          dates.filter((d) => d.course_id === c.id),
                          today,
                        )[0]
                      }
                      route={exams.find((e) => e.id === c.exam_id) ?? null}
                      armed={armed === `c:${c.id}`}
                      onEdit={() => setEditor({ kind: "course", id: c.id })}
                      onStudy={() => onStudy(`Quiero estudiar ${c.name}`)}
                      onOpenRoute={onOpenExam && c.exam_id ? () => onOpenExam(c.exam_id!) : undefined}
                      onNewRoute={onNewRoute ? () => onNewRoute({ courseId: c.id, name: c.name }) : undefined}
                      onDelete={() => confirm(`c:${c.id}`, () => run(() => academicApi.deleteCourse(c.id)))}
                      onBlur={() => setArmed(null)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const dateLabelShort = (d: string) => dateLabel(d).replace(/^[^,]+, /, "");

function DatesList({
  dates,
  today,
  courseName,
  armed,
  onToggle,
  onEdit,
  onDelete,
  onBlur,
}: {
  dates: DateItem[];
  today: string;
  courseName: (id: string | null) => string | undefined;
  armed: string | null;
  onToggle: (d: DateItem) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onBlur: () => void;
}) {
  const upcoming = upcomingDates(dates, today);
  const overdue = overdueDates(dates, today);
  const done = doneDates(dates);
  const row = (x: DateItem) => {
    const left = daysLabel(x.date);
    return (
      <li key={x.id} className={`date-row kind-${x.kind} ${x.done ? "is-done" : ""}`} data-testid="date-item">
        <input type="checkbox" checked={x.done} onChange={() => onToggle(x)} aria-label={`Marcar como hecho: ${x.title}`} />
        <div className="date-main">
          <span>
            <span className="date-kind">{DATE_KIND_LABEL[x.kind]}</span> <strong>{x.title}</strong>
            {courseName(x.course_id) && <span className="muted"> · {courseName(x.course_id)}</span>}
          </span>
          <span className="muted small">
            {dateLabel(x.date)}
            {x.time ? ` · ${x.time}` : ""}
            {x.grade != null ? ` · nota ${x.grade}` : ""}
          </span>
        </div>
        {!x.done && <span className={`agenda-days ${x.date < today ? "is-late" : x.date <= addDaysStr(today, 7) ? "is-soon" : ""}`}>{left}</span>}
        <span className="row">
          <button className="btn ghost small" onClick={() => onEdit(x.id)} aria-label={`Editar ${x.title}`}>
            Editar
          </button>
          <button className={`btn small ${armed === `d:${x.id}` ? "danger" : "ghost"}`} onClick={() => onDelete(x.id)} onBlur={onBlur} aria-label={armed === `d:${x.id}` ? `Confirmar borrar ${x.title}` : `Borrar ${x.title}`}>
            {armed === `d:${x.id}` ? "¿Seguro?" : "Borrar"}
          </button>
        </span>
      </li>
    );
  };
  if (!dates.length) return <p className="muted small">Sin fechas todavía. Cargá tus parciales, entregas de TPs y finales para que no se te pasen.</p>;
  return (
    <>
      {overdue.length > 0 && (
        <div role="group" aria-label="Sin marcar">
          <h3 className="date-group is-late">Pasaron y no las marcaste</h3>
          <ul className="date-list">{overdue.map(row)}</ul>
        </div>
      )}
      {upcoming.length > 0 ? <ul className="date-list">{upcoming.map(row)}</ul> : <p className="muted small">No hay fechas próximas pendientes.</p>}
      {done.length > 0 && (
        <details className="date-done">
          <summary>Hechas ({done.length})</summary>
          <ul className="date-list">{done.map(row)}</ul>
        </details>
      )}
    </>
  );
}

function addDaysStr(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function CourseCard({
  course: c,
  next,
  route,
  armed,
  onEdit,
  onStudy,
  onOpenRoute,
  onNewRoute,
  onDelete,
  onBlur,
}: {
  course: Course;
  next?: DateItem;
  route: ExamSummary | null;
  armed: boolean;
  onEdit: () => void;
  onStudy: () => void;
  onOpenRoute?: () => void;
  onNewRoute?: () => void;
  onDelete: () => void;
  onBlur: () => void;
}) {
  return (
    <li className={`course-card cc-${c.color}`} data-testid="course">
      <div className="row-between">
        <strong>{c.name}</strong>
        {c.code && <span className="muted small">{c.code}</span>}
      </div>
      {c.professor && <span className="muted small">Prof. {c.professor}</span>}
      {c.slots.length > 0 ? (
        <ul className="course-slots">
          {c.slots.map((s, i) => (
            <li key={i}>{slotText(s, c.room)}</li>
          ))}
        </ul>
      ) : (
        <span className="muted small">Sin horario cargado</span>
      )}
      {next && (
        <span className="small">
          Próxima: <strong>{DATE_KIND_LABEL[next.kind]}</strong> {daysLabel(next.date).toLowerCase()}
        </span>
      )}
      {c.notes && <span className="muted small course-notes">{c.notes}</span>}
      {route && (
        <span className="small" data-testid="course-route">
          Ruta de estudio: <strong>{route.name}</strong>
          {route.exam_date ? ` · apunta al ${dateLabelShort(route.exam_date)}` : " · sin parcial ni final por delante"}
        </span>
      )}
      <div className="row">
        <button className="btn small" onClick={onEdit} aria-label={`Editar ${c.name}`}>
          Editar
        </button>
        <button className="btn small" onClick={onStudy} aria-label={`Estudiar ${c.name}`}>
          Estudiar esta materia
        </button>
        {route && onOpenRoute ? (
          <button className="btn small" onClick={onOpenRoute} aria-label={`Abrir la ruta de ${c.name}`}>
            Abrir su ruta
          </button>
        ) : (
          onNewRoute && (
            <button className="btn small" onClick={onNewRoute} aria-label={`Armar la ruta de estudio de ${c.name}`} title="Con su programa: unidades, temas, simulacros y un plan hasta su próximo parcial o final">
              Armar su ruta
            </button>
          )
        )}
        <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={onDelete} onBlur={onBlur} aria-label={armed ? `Confirmar borrar ${c.name}` : `Borrar ${c.name}`}>
          {armed ? "¿Seguro? Borrar" : "Borrar"}
        </button>
      </div>
    </li>
  );
}

/** AC-101: paste a timetable (or a list of dates); it is read into a proposal to review, never saved blind. */
function ImportPanel({ onSave, onClose }: { onSave: (p: Proposal) => Promise<ImportReport>; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // AC-151: a photo or a PDF of the timetable becomes text to review here first.
  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setProposal(null);
    try {
      const { text, viaVision } = await fileText(file, "timetable", () => setNotice(`Leyendo ${file.name} con el modelo (es una imagen)…`));
      if (!text) throw "No encontré texto en el archivo.";
      setText(text);
      setNotice(viaVision ? `Leí ${file.name} con el modelo: revisá que días y horas estén bien y tocá «Leer mi horario».` : `Copié el texto de ${file.name}: revisalo y tocá «Leer mi horario».`);
    } catch (e) {
      setNotice(null);
      setError(typeof e === "string" ? e : `No se pudo leer ${file.name}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      setProposal(await academicApi.parse(text));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card draft" aria-label="Pegar mi horario">
      <h2>Pegá tu horario o tus fechas</h2>
      <p className="muted small">
        Copialo como te lo pasaron: una tabla, una lista, un mensaje, o subí una foto o un PDF. Lo leo y te muestro qué entendí antes de guardar nada. El texto (o la imagen) se envía al modelo de IA que elegiste para poder leerlo.
      </p>
      <label className="btn ghost small file-pick" title="Una foto del horario, una captura o el PDF que te pasó la facultad">
        {busy && !text ? "Leyendo…" : "Desde una foto o PDF"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,.pdf,application/pdf,.txt,text/plain"
          aria-label="Leer el horario desde una foto o un PDF"
          disabled={busy}
          onChange={(e) => {
            load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {notice && (
        <p className="muted small" role="status">
          {notice}
        </p>
      )}
      <label className="field">
        <span>Tu horario o tus fechas</span>
        <textarea
          value={text}
          rows={7}
          onChange={(e) => setText(e.target.value)}
          aria-label="Horario o fechas para leer"
          placeholder={"Lunes 10:00 a 12:00 · Análisis I · Aula 3 · Prof. Pérez\nMiércoles 10:00 a 12:00 · Análisis I · Aula 3\nPrimer parcial: 12/11"}
        />
      </label>
      {!proposal && (
        <div className="row-end">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={read} disabled={busy || !text.trim()}>
            {busy ? "Leyendo…" : "Leer mi horario"}
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {proposal && <ProposalPreview proposal={proposal} onSave={onSave} onDiscard={() => setProposal(null)} onOpen={onClose} />}
    </section>
  );
}
