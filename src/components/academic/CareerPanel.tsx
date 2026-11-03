import { useEffect, useState } from "react";
import { careerApi, errorText } from "../../api";
import type { CareerProposal, CareerStatus, CareerSubjectInput, CareerSubjectView, CareerView } from "../../types";
import { byYear, gradeText, nextStep, parseGrades, progressPct, proposalCount, STATUS_LABEL, STATUSES, yearLabel } from "../../lib/career";
import { fileText } from "../../lib/fileText";

/**
 * AC-155…157: la malla de la carrera. The plan of studies is pasted (or read
 * from a photo or PDF) into a proposal the person confirms; then each subject
 * gets its status and grade, and the correlativas say what can come next.
 */
export function CareerPanel() {
  const [view, setView] = useState<CareerView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    careerApi
      .get()
      .then(setView)
      .catch((e) => setError(errorText(e)));
  }, []);

  const run = async (f: () => Promise<CareerView | null>, after?: () => void) => {
    setError(null);
    try {
      setView(await f());
      after?.();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (view === undefined) return <div className="center muted">{error ?? "Cargando…"}</div>;

  const errorBox = error && (
    <p className="error-text" role="alert">
      {error}
    </p>
  );

  if (!view || loading)
    return (
      <>
        {errorBox}
        {!view && !loading && (
          <section className="graph-empty" aria-label="Cargá tu carrera">
            <h2>Tu carrera, materia por materia</h2>
            <p className="muted">Cargá el plan de estudios una vez y marcá lo que ya aprobaste: te muestro tu promedio, qué podés cursar el próximo cuatrimestre y qué finales podés rendir según las correlativas.</p>
            <button className="btn primary" onClick={() => setLoading(true)}>
              Cargar mi plan de estudios
            </button>
          </section>
        )}
        {loading && <LoadPlan replacing={!!view} onSaved={(v) => (setView(v), setLoading(false))} onClose={() => setLoading(false)} />}
      </>
    );

  const save = (input: CareerSubjectInput) => run(() => careerApi.saveSubject(input), () => setEditing(null));
  const takeNow = view.subjects.filter((s) => s.can_take && !s.in_cursada);
  const finals = view.subjects.filter((s) => s.can_sit_final);
  const pct = progressPct(view.approved, view.total);

  return (
    <>
      {errorBox}
      <section className="card career-summary" aria-label="Resumen de tu carrera">
        <div className="row-between">
          <div>
            <h2>{view.name}</h2>
            {view.institution && <p className="muted small">{view.institution}</p>}
          </div>
          <div className="career-average" data-testid="career-average">
            {view.average != null ? (
              <>
                <strong>{gradeText(view.average)}</strong>
                <span className="muted small">promedio{view.average_with_failed != null ? ` · ${gradeText(view.average_with_failed)} con aplazos` : ""}</span>
              </>
            ) : (
              <span className="muted small">Tu promedio aparece cuando cargues una nota</span>
            )}
          </div>
        </div>
        <div className="career-progress" role="progressbar" aria-label="Materias aprobadas" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.approved} aria-valuetext={`${view.approved} de ${view.total} materias aprobadas`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="small" data-testid="career-progress">
          {view.approved} de {view.total} materias aprobadas ({pct} %)
        </p>
        {finals.length > 0 && (
          <p className="small">
            <strong>Podés rendir el final de:</strong> {finals.map((s) => s.name).join(", ")}
          </p>
        )}
        {takeNow.length > 0 && (
          <p className="small">
            <strong>Podés cursar:</strong> {takeNow.map((s) => s.name).join(", ")}
          </p>
        )}
      </section>

      {byYear(view.subjects).map(([year, subjects]) => (
        <section key={year} className="card" aria-label={yearLabel(year)}>
          <h2 className="section-title">{yearLabel(year)}</h2>
          <ul className="career-list">
            {subjects.map((s) =>
              editing === s.id ? (
                <li key={s.id}>
                  <SubjectForm subject={s} all={view.subjects} onSave={save} onDelete={() => run(() => careerApi.deleteSubject(s.id), () => setEditing(null))} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <SubjectRow key={s.id} s={s} onEdit={() => setEditing(s.id)} onStatus={(status) => save(toInput(s, { status }))} />
              ),
            )}
          </ul>
        </section>
      ))}

      {editing === "new" && (
        <section className="card" aria-label="Nueva materia">
          <SubjectForm subject={null} all={view.subjects} onSave={save} onCancel={() => setEditing(null)} />
        </section>
      )}

      <div className="row wrap">
        <button className="btn small" onClick={() => setEditing("new")}>
          Agregar materia
        </button>
        <button className="btn ghost small" onClick={() => setLoading(true)} title="Lo que ya marcaste se conserva en las materias que sigan estando" aria-describedby="career-reload-hint">
          Volver a cargar el plan
        </button>
        <span id="career-reload-hint" className="muted small touch-hint">
          Lo que ya marcaste se conserva en las materias que sigan estando.
        </span>
        <button className={`btn small ${armed ? "danger" : "ghost"}`} onBlur={() => setArmed(false)} onClick={() => (armed ? run(async () => (await careerApi.remove(), null), () => setArmed(false)) : setArmed(true))}>
          {armed ? "¿Seguro? Borrar mi carrera" : "Borrar mi carrera"}
        </button>
      </div>
    </>
  );
}

const toInput = (s: CareerSubjectView, over: Partial<CareerSubjectInput> = {}): CareerSubjectInput => ({
  id: s.id,
  name: s.name,
  code: s.code,
  year: s.year,
  term: s.term,
  para_cursar: s.para_cursar,
  para_rendir: s.para_rendir,
  status: s.status,
  grade: s.grade,
  failed: s.failed,
  ...over,
});

function SubjectRow({ s, onEdit, onStatus }: { s: CareerSubjectView; onEdit: () => void; onStatus: (st: CareerStatus) => void }) {
  const step = nextStep(s);
  return (
    <li className={`career-row st-${s.status}`} aria-label={s.name}>
      <div className="career-main">
        <strong>
          {s.name}
          {s.code && <span className="muted small"> · {s.code}</span>}
          {s.term && <span className="muted small"> · {s.term}.º cuatr.</span>}
        </strong>
        {step && <span className={`small ${s.can_take || s.can_sit_final ? "career-go" : "muted"}`}>{step}</span>}
        {s.failed.length > 0 && <span className="muted small">Aplazos: {s.failed.map(gradeText).join(", ")}</span>}
      </div>
      <div className="row">
        {s.status === "aprobada" && s.grade != null && <span className="career-grade">{gradeText(s.grade)}</span>}
        <select value={s.status} onChange={(e) => onStatus(e.target.value as CareerStatus)} aria-label={`Estado de ${s.name}`}>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
        <button className="btn ghost small" onClick={onEdit} aria-label={`Editar ${s.name}`}>
          Editar
        </button>
      </div>
    </li>
  );
}

function SubjectForm({ subject: s, all, onSave, onDelete, onCancel }: { subject: CareerSubjectView | null; all: CareerSubjectView[]; onSave: (i: CareerSubjectInput) => void; onDelete?: () => void; onCancel: () => void }) {
  const [name, setName] = useState(s?.name ?? "");
  const [code, setCode] = useState(s?.code ?? "");
  const [year, setYear] = useState(s?.year ?? 1);
  const [status, setStatus] = useState<CareerStatus>(s?.status ?? "pendiente");
  const [grade, setGrade] = useState(s?.grade != null ? gradeText(s.grade) : "");
  const [failed, setFailed] = useState(s ? s.failed.map(gradeText).join(" ") : "");
  const [cursar, setCursar] = useState<string[]>(s?.para_cursar ?? []);
  const [rendir, setRendir] = useState<string[]>(s?.para_rendir ?? []);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = all.filter((o) => o.id !== s?.id);

  const submit = () => {
    try {
      const g = grade.trim() ? parseGrades(grade) : [];
      if (status === "aprobada" && g.length !== 1) throw "Poné la nota con la que la aprobaste.";
      onSave({ id: s?.id ?? null, name, code, year, term: s?.term ?? null, para_cursar: cursar, para_rendir: rendir, status, grade: status === "aprobada" ? g[0] : null, failed: parseGrades(failed) });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="career-form" aria-label={s ? `Editar ${s.name}` : "Nueva materia"} role="group">
      <div className="career-form-grid">
        <label className="field">
          <span>Materia</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre de la materia" />
        </label>
        <label className="field">
          <span>Código</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Código de la materia" />
        </label>
        <label className="field">
          <span>Año</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Año de la materia">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => (
              <option key={y} value={y}>
                {yearLabel(y)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as CareerStatus)} aria-label="Estado">
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </label>
        {status === "aprobada" && (
          <label className="field">
            <span>Nota</span>
            <input value={grade} onChange={(e) => setGrade(e.target.value)} inputMode="decimal" aria-label="Nota final" placeholder="8" />
          </label>
        )}
        <label className="field">
          <span>Aplazos (si hubo)</span>
          <input value={failed} onChange={(e) => setFailed(e.target.value)} inputMode="decimal" aria-label="Notas de los finales desaprobados" placeholder="2 3" />
        </label>
      </div>
      {others.length > 0 && (
        <div className="career-corr">
          <fieldset>
            <legend>Para cursarla, tener regularizada…</legend>
            {others.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" checked={cursar.includes(o.id)} onChange={() => toggle(cursar, setCursar, o.id)} />
                {o.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Para rendir el final, tener aprobada…</legend>
            {others.map((o) => (
              <label key={o.id} className="check">
                <input type="checkbox" checked={rendir.includes(o.id)} onChange={() => toggle(rendir, setRendir, o.id)} />
                {o.name}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row-end">
        {onDelete && (
          <button className={`btn small ${armed ? "danger" : "ghost"}`} onBlur={() => setArmed(false)} onClick={() => (armed ? onDelete() : setArmed(true))}>
            {armed ? "¿Seguro? Borrar materia" : "Borrar materia"}
          </button>
        )}
        <button className="btn ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn primary" onClick={submit} disabled={!name.trim()}>
          Guardar
        </button>
      </div>
    </div>
  );
}

/** AC-155: paste the plan (or read it from a photo or PDF), review, confirm. */
function LoadPlan({ replacing, onSaved, onClose }: { replacing: boolean; onSaved: (v: CareerView | null) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CareerProposal | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const { text, viaVision } = await fileText(file, "curriculum", () => setNotice(`Leyendo ${file.name} con el modelo (es una imagen)…`));
      if (!text) throw "No encontré texto en el archivo.";
      setText(text);
      setNotice(viaVision ? `Leí ${file.name} con el modelo: revisá que las materias y las correlativas estén bien y tocá «Leer el plan».` : `Copié el texto de ${file.name}: revisalo y tocá «Leer el plan».`);
    } catch (e) {
      setNotice(null);
      setError(typeof e === "string" ? e : `No se pudo leer ${file.name}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const act = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const count = proposal && proposalCount(proposal);
  return (
    <section className="card draft" aria-label="Cargar el plan de estudios">
      <h2>Pegá el plan de estudios</h2>
      <p className="muted small">
        Copialo de la web de tu facultad o del PDF del plan: las materias por año y sus correlativas. Lo leo y te muestro qué entendí antes de guardar nada. El texto (o la imagen) se envía al modelo de IA que elegiste.
        {replacing && " Lo que ya marcaste (aprobadas, notas) se conserva en las materias que sigan estando."}
      </p>
      <label className="btn ghost small file-pick" title="Una foto del plan, una captura o el PDF de la facultad">
        {busy && !text ? "Leyendo…" : "Desde una foto o PDF"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,.pdf,application/pdf,.txt,text/plain"
          aria-label="Leer el plan desde una foto o un PDF"
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
        <span>Plan de estudios</span>
        <textarea value={text} rows={8} onChange={(e) => setText(e.target.value)} aria-label="Plan de estudios para leer" placeholder={"1.º año\nAnálisis Matemático I (AM1)\nÁlgebra y Geometría Analítica\n2.º año\nAnálisis Matemático II — correlativas: AM1, Álgebra"} />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!proposal ? (
        <div className="row-end">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => act(async () => setProposal(await careerApi.parse(text)))} disabled={busy || !text.trim()}>
            {busy ? "Leyendo…" : "Leer el plan"}
          </button>
        </div>
      ) : (
        <div className="proposal" role="region" aria-label="Lo que entendí del plan">
          <p className="proposal-head">
            <strong>{proposal.name}</strong>
            {proposal.institution && ` · ${proposal.institution}`} — {count!.subjects} materias en {count!.years} {count!.years === 1 ? "año" : "años"}. Revisá las correlativas: después las podés corregir materia por materia.
          </p>
          {byYear(proposal.subjects).map(([y, subjects]) => (
            <div key={y}>
              <h3 className="small">{yearLabel(y)}</h3>
              <ul className="proposal-list">
                {subjects.map((s) => (
                  <li key={s.name}>
                    <strong>{s.name}</strong>
                    {s.code && <span className="muted small">{s.code}</span>}
                    {!!s.para_cursar?.length && <span className="muted small">para cursar: {s.para_cursar.join(", ")}</span>}
                    {!!s.para_rendir?.length && <span className="muted small">para rendir: {s.para_rendir.join(", ")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="row-end">
            <button className="btn ghost" onClick={() => setProposal(null)} disabled={busy}>
              Descartar
            </button>
            <button className="btn primary" onClick={() => act(async () => onSaved(await careerApi.savePlan(proposal)))} disabled={busy}>
              {busy ? "Guardando…" : "Guardar mi carrera"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
