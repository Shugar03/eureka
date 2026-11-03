import { useEffect, useMemo, useState } from "react";
import { academicApi, api, cardsApi, classesApi, errorText } from "../../api";
import type { AcademicData, AnnouncedDate, ClassRecord, ClassSummary } from "../../types";
import { localDate } from "../../lib/exam";
import { DATE_KIND_LABEL, dateLabel, termCourses } from "../../lib/academic";
import { classScript, durationText } from "../../lib/listen";
import { Markdown } from "../Markdown";
import { ReadAloud } from "../a11y/ReadAloud";
import { useAccessibility } from "../a11y/AccessibilityContext";
import { useClassRecorder } from "./useClassRecorder";

interface Props {
  onOpenSettings: () => void;
  onOpenDeck: (id: string) => void;
  onStudy: (message: string) => void;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** AC-146…148: record a class, turn it into notes, and study from them. */
export function ClassesScreen({ onOpenSettings, onOpenDeck, onStudy }: Props) {
  const { speechReady } = useAccessibility();
  const today = localDate(new Date());
  const [list, setList] = useState<ClassSummary[] | null>(null);
  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [open, setOpen] = useState<ClassRecord | null>(null);
  const [live, setLive] = useState<ClassRecord | null>(null);
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => classesApi.list().then(setList).catch((e) => setError(errorText(e)));
  useEffect(() => {
    void refresh();
    academicApi.state().then(setAcademic).catch(() => {});
  }, []);

  const recorder = useClassRecorder((c) => {
    setLive(c);
    setOpen((o) => (o?.id === c.id ? c : o));
  });
  // When the last part is saved, the class shows up in the list and opens.
  useEffect(() => {
    if (recorder.state === "idle" && live) {
      setOpen(live);
      setLive(null);
      void refresh();
    }
  }, [recorder.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const courses = academic ? termCourses(academic, academic.active_term) : [];
  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name ?? academic?.courses.find((c) => c.id === id)?.name;
  const defaultTitle = `${courseName(courseId || null) ?? "Clase"} · ${capitalize(dateLabel(today))}`;

  const begin = async () => {
    setError(null);
    try {
      const c = await classesApi.start(title.trim() || defaultTitle, courseId || null, today);
      setLive(c);
      setOpen(null);
      if (!(await recorder.start(c))) setLive(null);
      setTitle("");
    } catch (e) {
      setError(errorText(e));
    }
  };

  const busy = recorder.state !== "idle";

  return (
    <div className="practice-screen classes">
      <header className="chat-head">
        <h1 className="chat-title">Clases</h1>
      </header>
      <div className="practice-body">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        {!speechReady ? (
          <section className="card" aria-label="Grabar una clase">
            <h2>Grabar una clase</h2>
            <p className="muted">Grabás la clase y se transcribe mientras habla el docente. Después armo los apuntes, las tarjetas y te los leo en voz alta.</p>
            <p>Para transcribir hace falta elegir la Voz. La opción «En esta PC» funciona sin internet y sin costo.</p>
            <div className="row">
              <button className="btn primary" onClick={onOpenSettings}>
                Elegir la Voz en Ajustes
              </button>
            </div>
          </section>
        ) : busy ? (
          <section className="card class-live" aria-label="Clase en curso">
            <div className="row-between">
              <h2>{live?.title}</h2>
              <span className="class-rec" role="status">
                {recorder.state === "recording" ? <>● Grabando {clock(recorder.elapsed)}</> : "Terminando de transcribir…"}
              </span>
            </div>
            <p className="muted small" data-testid="class-progress">
              {live?.parts ?? 0} {live?.parts === 1 ? "parte transcripta" : "partes transcriptas"}
              {recorder.queued > 0 && ` · transcribiendo ${recorder.queued}`}. Se guarda a medida que avanza.
            </p>
            {recorder.error && (
              <p className="error-text small" role="alert">
                {recorder.error}
              </p>
            )}
            <p className="class-tail" aria-live="polite" data-testid="class-tail">
              {live?.transcript ? `…${live.transcript.slice(-600)}` : "Esperando la primera parte…"}
            </p>
            {recorder.state === "recording" && (
              <div className="row">
                <button className="btn primary" onClick={recorder.stop}>
                  Terminar la clase
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="card" aria-label="Grabar una clase">
            <h2>Grabar una clase</h2>
            <p className="muted small">Dejá la compu cerca del docente. Se transcribe de a partes mientras grabás; al terminar armo los apuntes.</p>
            <div className="class-form">
              <label className="field">
                <span>Materia</span>
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Materia de la clase">
                  <option value="">Sin materia</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Nombre</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} aria-label="Nombre de la clase" />
              </label>
              <button className="btn primary" onClick={begin}>
                Empezar a grabar
              </button>
            </div>
          </section>
        )}

        {open && <ClassDetail key={open.id} c={open} courseName={courseName(open.course_id)} academic={academic} today={today} onChange={(c) => (setOpen(c), void refresh())} onDeleted={() => (setOpen(null), void refresh())} onOpenDeck={onOpenDeck} onStudy={onStudy} />}

        <section className="card" aria-label="Tus clases">
          <h2>Tus clases</h2>
          {!list ? (
            <p className="muted small">Cargando…</p>
          ) : list.length === 0 ? (
            <p className="muted small">Todavía no grabaste ninguna clase.</p>
          ) : (
            <ul className="class-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button className={`class-row${open?.id === c.id ? " is-open" : ""}`} onClick={() => classesApi.get(c.id).then(setOpen).catch((e) => setError(errorText(e)))} disabled={busy}>
                    <strong>{c.title}</strong>
                    <span className="muted small">
                      {capitalize(dateLabel(c.day))} · {durationText(c.seconds)}
                      {courseName(c.course_id) ? ` · ${courseName(c.course_id)}` : ""}
                    </span>
                    {c.has_notes && <span className="class-badge">Con apuntes</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ClassDetail({ c, courseName, academic, today, onChange, onDeleted, onOpenDeck, onStudy }: { c: ClassRecord; courseName?: string; academic: AcademicData | null; today: string; onChange: (c: ClassRecord) => void; onDeleted: () => void; onOpenDeck: (id: string) => void; onStudy: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [armed, setArmed] = useState(false);
  const n = c.notes;
  const script = useMemo(() => (n ? classScript(c.title, n) : ""), [c.title, n]);
  const material = n ? `${n.summary}\n\nIdeas clave:\n${n.key_points.map((k) => `- ${k}`).join("\n")}` : "";

  const act = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setStatus(null);
    try {
      await f();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const addDate = (d: AnnouncedDate, i: number) =>
    act("date", async () => {
      if (!academic?.active_term) throw new Error("Primero armá tu cursada (un período) en Mi cursada.");
      await academicApi.saveDate({ term_id: academic.active_term, course_id: c.course_id, kind: d.kind, title: d.title, date: d.date, time: null, notes: `Anunciado en «${c.title}»`, done: false, grade: null });
      setAdded((s) => new Set(s).add(i));
    });

  return (
    <section className="card class-detail" aria-label={`Clase: ${c.title}`}>
      <div className="row-between">
        <h2>{c.title}</h2>
        <span className="muted small">
          {capitalize(dateLabel(c.day))} · {durationText(c.seconds)}
          {courseName ? ` · ${courseName}` : ""}
        </span>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}

      {!n ? (
        <div className="row">
          <button className="btn primary" disabled={!!busy || c.transcript.trim().length < 80} onClick={() => act("notes", async () => onChange(await classesApi.notes(c.id, today)))}>
            {busy === "notes" ? "Armando los apuntes…" : "Armar apuntes"}
          </button>
          {c.transcript.trim().length < 80 && <span className="muted small">Hay muy poco transcripto para armar apuntes.</span>}
        </div>
      ) : (
        <>
          <ReadAloud markdown={script} label="Escuchar el repaso" always />
          {n.key_points.length > 0 && (
            <div>
              <h3 className="class-h3">Ideas clave</h3>
              <ul className="class-points">
                {n.key_points.map((k) => (
                  <li key={k}>
                    <Markdown text={k} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="class-notes" data-testid="class-notes">
            <Markdown text={n.summary} />
          </div>
          {n.questions.length > 0 && (
            <div>
              <h3 className="class-h3">Para repasar</h3>
              <ul className="class-points">
                {n.questions.map((q) => (
                  <li key={q}>
                    <Markdown text={q} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {n.dates.length > 0 && (
            <div role="group" aria-label="Fechas que se anunciaron">
              <h3 className="class-h3">Fechas que se anunciaron</h3>
              <ul className="class-dates">
                {n.dates.map((d, i) => (
                  <li key={`${d.title}-${i}`}>
                    <span>
                      {!d.title.toLowerCase().startsWith(DATE_KIND_LABEL[d.kind].toLowerCase()) && <strong>{DATE_KIND_LABEL[d.kind]} </strong>}
                      {d.title}
                      <span className="muted small"> · {d.date ? dateLabel(d.date) : "sin día"}</span>
                    </span>
                    {added.has(i) ? (
                      <span className="muted small">Agregada a Mi cursada</span>
                    ) : d.date ? (
                      <button className="btn ghost small" onClick={() => addDate(d, i)} disabled={!!busy} aria-label={`Agregar a Mi cursada: ${d.title}`}>
                        Agregar a Mi cursada
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => act("cards", async () => onOpenDeck((await cardsApi.generateDeck(c.title, { kind: "notes", text: material }, Math.min(12, Math.max(4, n.key_points.length + 2)), today)).id))}>
              {busy === "cards" ? "Haciendo tarjetas…" : "Hacer tarjetas"}
            </button>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() =>
                act("graph", async () => {
                  const g = await api.importNotes(c.title, material);
                  setStatus(`Listo: tu grafo tiene ${g.nodes.length} ideas.`);
                })
              }
            >
              {busy === "graph" ? "Sumando al grafo…" : "Sumar al grafo"}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => onStudy(`Quiero repasar la clase «${c.title}». Las ideas clave fueron: ${n.key_points.join("; ")}`)}>
              Charlar sobre esta clase
            </button>
            <button className="btn ghost" disabled={!!busy} onClick={() => act("notes", async () => onChange(await classesApi.notes(c.id, today)))}>
              {busy === "notes" ? "Rearmando…" : "Rearmar apuntes"}
            </button>
          </div>
        </>
      )}

      <details className="class-transcript">
        <summary>
          Transcripción ({c.parts} {c.parts === 1 ? "parte" : "partes"})
        </summary>
        <p>{c.transcript || "Sin texto todavía."}</p>
      </details>
      <div className="row-end">
        <button className={`btn small ${armed ? "danger" : "ghost"}`} onClick={() => (armed ? act("delete", async () => (await classesApi.remove(c.id), onDeleted())) : setArmed(true))} onBlur={() => setArmed(false)}>
          {armed ? "¿Seguro? Borrar la clase" : "Borrar la clase"}
        </button>
      </div>
    </section>
  );
}
