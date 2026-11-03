import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Exam, ExamProposal } from "../types";
import { daysUntil } from "../lib/exam";
import { longDate, sameName } from "../lib/examChat";

/**
 * AC-120: the exam preparation the agent proposed, from what the person said in
 * the chat. Nothing is created until "Crear mi preparación": it builds the
 * same exam as the Exámenes screen (syllabus, domains, dated plan) and then
 * shows the roadmap.
 */
export function ExamProposalCard({ proposal, onOpenExam }: { proposal: ExamProposal; onOpenExam: (id: string) => void }) {
  // AC-165: what the agent understood can be corrected before creating it.
  const [p, setP] = useState<ExamProposal>(proposal);
  const [editing, setEditing] = useState(false);
  const [guide, setGuide] = useState("");
  const [existing, setExisting] = useState<string | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [busy, setBusy] = useState<"guide" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  // Reloading a conversation must not offer to build the same exam twice.
  useEffect(() => {
    api
      .listExams()
      .then((all) => setExisting(all.find((e) => sameName(e.name, proposal.name))?.id ?? null))
      .catch(() => {});
  }, [proposal.name]);

  if (dismissed) return null;

  const haveGuide = !!(p.guide || guide.trim());
  const create = async () => {
    setError(null);
    try {
      let text = (p.guide ?? guide).trim();
      if (!text) {
        setBusy("guide");
        const found = await api.findExamGuide(p.name);
        text = found.guide;
        setSource(`Armé el temario con la guía que encontré en la web (${found.sources.length} ${found.sources.length === 1 ? "fuente" : "fuentes"}).`);
      }
      setBusy("create");
      const created = await api.createExam(p.name, text, p.kind);
      const hasGoal = p.exam_date || p.hours_per_week || p.passing_pct;
      setExam(hasGoal ? await api.setExamGoal(created.id, { passing_pct: p.passing_pct, exam_date: p.exam_date, hours_per_week: p.hours_per_week }) : created);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const days = p.exam_date ? daysUntil(p.exam_date, new Date()) : null;
  return (
    <section className="exam-offer" aria-label={`Preparación de ${proposal.name}`}>
      <h3>{exam ? "Tu preparación está lista" : `Preparar «${p.name}»`}</h3>
      {editing && !exam ? (
        <div className="exam-edit" role="group" aria-label="Corregir la preparación">
          <label className="field">
            <span>Nombre</span>
            <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} aria-label="Nombre del examen" />
          </label>
          <label className="field">
            <span>Tipo</span>
            <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as ExamProposal["kind"] })} aria-label="Tipo de examen">
              <option value="certification">Examen o certificación</option>
              <option value="subject">Materia</option>
            </select>
          </label>
          <label className="field">
            <span>Fecha</span>
            <input type="date" value={p.exam_date ?? ""} onChange={(e) => setP({ ...p, exam_date: e.target.value || null })} aria-label="Fecha del examen" />
          </label>
          <label className="field">
            <span>Horas por semana</span>
            <input type="number" min={0.5} max={80} step={0.5} value={p.hours_per_week ?? ""} onChange={(e) => setP({ ...p, hours_per_week: e.target.value ? Number(e.target.value) : null })} aria-label="Horas por semana" />
          </label>
          <label className="field">
            <span>Nota para aprobar (%)</span>
            <input type="number" min={1} max={100} value={p.passing_pct ?? ""} onChange={(e) => setP({ ...p, passing_pct: e.target.value ? Number(e.target.value) : null })} aria-label="Nota para aprobar" />
          </label>
        </div>
      ) : (
      <ul className="exam-facts">
        <li>
          <span>Tipo</span> {p.kind === "subject" ? "Materia (su programa es el temario)" : "Examen o certificación"}
        </li>
        <li>
          <span>Fecha</span> {p.exam_date ? `${longDate(p.exam_date)}${days !== null && days >= 0 ? ` (faltan ${days} ${days === 1 ? "día" : "días"})` : ""}` : "sin fecha todavía"}
        </li>
        {p.hours_per_week && (
          <li>
            <span>Horas por semana</span> {p.hours_per_week}
          </li>
        )}
        {p.passing_pct && (
          <li>
            <span>Nota para aprobar</span> {p.passing_pct} %
          </li>
        )}
        <li>
          <span>Guía</span> {p.guide ? `la que me pasaste (${p.guide.length} caracteres)` : guide.trim() ? "la que pegaste" : "todavía no la tengo: puedo buscarla en la web o la pegás acá"}
        </li>
      </ul>
      )}

      {exam ? (
        <div className="exam-roadmap">
          {source && <p className="muted small">{source}</p>}
          <p>
            Armé <strong>{exam.domains.length}</strong> {exam.domains.length === 1 ? "dominio" : "dominios"} y <strong>{exam.domains.reduce((n, d) => n + d.topics.length, 0)}</strong> temas. Esta es tu ruta:
          </p>
          <ol className="roadmap" aria-label="Ruta de estudio">
            {exam.domains.map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong> <span className="muted small">{d.weight} % del examen · {d.topics.length} {d.topics.length === 1 ? "tema" : "temas"}</span>
              </li>
            ))}
          </ol>
          <div className="row">
            <button className="btn primary small" onClick={() => onOpenExam(exam.id)}>
              Abrir mi ruta de estudio
            </button>
          </div>
        </div>
      ) : existing ? (
        <div className="row">
          <span className="muted small">Ya tenés una preparación con este nombre.</span>
          <button className="btn small" onClick={() => onOpenExam(existing)}>
            Abrirla
          </button>
        </div>
      ) : (
        <>
          {!p.guide && (
            <label className="field">
              <span>Pegá la guía o el programa (opcional: si no, la busco en la web)</span>
              <textarea value={guide} rows={3} onChange={(e) => setGuide(e.target.value)} aria-label="Guía o programa del examen" />
            </label>
          )}
          <div className="row">
            <button className="btn primary small" onClick={create} disabled={busy !== null || !p.name.trim()}>
              {busy === "guide" ? "Buscando la guía…" : busy === "create" ? "Armando la ruta…" : haveGuide ? "Crear mi preparación" : "Buscar la guía y crear mi preparación"}
            </button>
            <button className="btn ghost small" onClick={() => setEditing((e) => !e)} disabled={busy !== null} aria-pressed={editing}>
              {editing ? "Listo" : "Corregir"}
            </button>
            <button className="btn ghost small" onClick={() => setDismissed(true)} disabled={busy !== null}>
              Ahora no
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
