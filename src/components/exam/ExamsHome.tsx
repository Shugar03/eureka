import { useEffect, useState } from "react";
import { academicApi, api, errorText, visionApi } from "../../api";
import type { ExamKind, ExamSummary, Lang, RoutePrefill, SourceRef } from "../../types";
import { LANGS } from "../../lib/code";
import { pdfText } from "../../lib/pdfText";
import { imageToDataUrl, isImage, pdfPageImages } from "../../lib/images";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

export function ExamsHome({ onOpen, prefill = null }: { onOpen: (id: string) => void; prefill?: RoutePrefill | null }) {
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [name, setName] = useState(prefill?.name ?? "");
  const [guide, setGuide] = useState("");
  const [kind, setKind] = useState<ExamKind>(prefill ? "subject" : "certification");
  const subject = kind === "subject";
  const [lang, setLang] = useState<Lang>("python");
  const [level, setLevel] = useState("básico");
  const [langGoal, setLangGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceRef[]>([]);

  const refresh = () => api.listExams().then(setExams).catch((e) => setError(errorText(e)));
  useEffect(() => {
    refresh();
  }, []);

  const createPath = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await api.createLanguagePath(lang, level, langGoal);
      onOpen(e.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await api.createExam(name, guide, kind);
      // AC-150: started from a course in Mi cursada: link them (the date comes from its next exam).
      if (prefill) await academicApi.linkRoute(prefill.courseId, e.id);
      onOpen(e.id);
    } catch (e) {
      setError(errorText(e));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    setReading(true);
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      let text = isImage(file) ? "" : isPdf ? await pdfText(await file.arrayBuffer()) : await file.text();
      let viaVision = false;
      // AC-63: a photo, or a scanned PDF without text: read it with the vision model.
      if (!text.trim() && (isImage(file) || isPdf)) {
        setNotice(`Leyendo ${file.name} con el modelo (es una imagen)…`);
        const images = isImage(file) ? [await imageToDataUrl(file)] : await pdfPageImages(await file.arrayBuffer());
        text = await visionApi.read(images, "guide");
        viaVision = true;
      }
      if (!text.trim()) throw "El archivo no tiene texto.";
      setGuide(text);
      setSources([]);
      setNotice(viaVision ? `Leí ${file.name} con el modelo: revisá que la transcripción esté bien antes de armar la ruta.` : `Guía cargada de ${file.name}. Revisala y armá la ruta.`);
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setError(typeof e === "string" ? e : `No se pudo leer ${file.name}: ${errorText(e)}`);
    } finally {
      setReading(false);
    }
  };

  const search = async () => {
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const found = await api.findExamGuide(name);
      setGuide(found.guide);
      setSources(found.sources);
      setNotice("Guía encontrada en la web. Revisala con las fuentes antes de armar la ruta.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSearching(false);
    }
  };

  const remove = async (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    await api.deleteExam(id).catch((e) => setError(errorText(e)));
    refresh();
  };

  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Exámenes y materias</h1>
      </header>
      <div className="practice-body">
        <section className={`card ${kind === "language" ? "is-language" : ""}`} aria-label="Nuevo examen">
          <h2>{subject ? "Cursar una materia" : "Preparar un examen o certificación"}</h2>
          <div className="tabs" role="radiogroup" aria-label="Qué vas a preparar">
            <button role="radio" aria-checked={!subject} className={!subject ? "is-active" : ""} onClick={() => setKind("certification")}>
              Examen o certificación
            </button>
            <button role="radio" aria-checked={subject} className={subject ? "is-active" : ""} onClick={() => setKind("subject")}>
              Materia
            </button>
            <button role="radio" aria-checked={kind === "language"} className={kind === "language" ? "is-active" : ""} onClick={() => setKind("language")}>
              Lenguaje de programación
            </button>
          </div>
          {kind === "language" && (
            <div className="lang-form">
              <p className="muted small">Una ruta por módulos, desde tu nivel hasta medio-avanzado. Cada tema tiene una sesión guiada con código y ejercicios con pruebas en la consola.</p>
              <div className="tabs tabs-wrap" role="radiogroup" aria-label="Lenguaje de la ruta">
                {LANGS.map((l) => (
                  <button key={l.id} role="radio" aria-checked={lang === l.id} className={lang === l.id ? "is-active" : ""} onClick={() => setLang(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="row">
                <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel de partida">
                  {["desde cero", "básico", "medio", "avanzado"].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <input value={langGoal} onChange={(e) => setLangGoal(e.target.value)} placeholder="Para qué lo querés: backend, scripts, sistemas, frontend…" aria-label="Para qué lo querés" />
              </div>
              <div className="row-end">
                <button className="btn primary" disabled={busy} onClick={createPath}>
                  {busy ? "Armando la ruta…" : "Armar ruta de programación"}
                </button>
              </div>
            </div>
          )}
          <p className="muted small">
            {subject ? (
              <>
                Pegá el <strong>programa</strong> de la materia (sus unidades y temas). Se arma una ruta de estudio por unidad, y después cargás tu horario de clases y la fecha del parcial o final.
              </>
            ) : (
              <>
                Pegá la <strong>guía oficial</strong> del examen (AWS, Google Cloud, Azure, Oracle, IBM, un examen de inglés…): los dominios, sus pesos y lo que hay que saber. Se arma una ruta de estudio por temas y podés medirte con simulacros.
              </>
            )}
          </p>
          <div className="name-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={subject ? "Nombre de la materia, p. ej. Análisis Matemático II" : "Nombre del examen, p. ej. AWS Certified Cloud Practitioner (CLF-C02)"} aria-label="Nombre del examen" />
            <button className="btn" disabled={searching || !name.trim()} onClick={search}>
              {searching ? "Buscando…" : "Buscar la guía en la web"}
            </button>
          </div>
          <textarea
            className="guide-input"
            value={guide}
            onChange={(e) => setGuide(e.target.value)}
            placeholder={subject ? "Pegá acá el programa: unidades y temas…" : "Pegá acá el temario de la guía oficial…"}
            aria-label="Guía oficial del examen"
            rows={10}
          />
          {notice && (
            <p className="muted small" role="status">
              {notice}
            </p>
          )}
          {sources.length > 0 && (
            <ul className="guide-sources" aria-label="Fuentes de la guía">
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>{" "}
                  <span className="muted small">{hostOf(s.url)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row-between">
            <label className="btn ghost small file-pick">
              {reading ? "Leyendo archivo…" : "Cargar PDF, foto, .txt o .md"}
              <input
                type="file"
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp"
                aria-label="Cargar la guía desde un archivo"
                disabled={reading}
                onChange={(e) => {
                  load(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <button className="btn primary" disabled={busy || !name.trim() || !guide.trim()} onClick={create}>
              {busy ? "Leyendo la guía…" : "Armar ruta de estudio"}
            </button>
          </div>
        </section>

        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {exams.length > 0 && (
          <section className="sessions" aria-label="Exámenes">
            <h2>Tus exámenes y materias</h2>
            <ul>
              {exams.map((e) => (
                <li key={e.id} className="session-row">
                  <button className="session-open" onClick={() => onOpen(e.id)}>
                    <span className="session-title">{e.name}</span>
                    <span className="session-meta">
                      <span className="progress" aria-hidden>
                        <span style={{ width: `${(100 * e.started) / Math.max(1, e.topics)}%` }} />
                      </span>
                      {e.kind === "subject" ? "Materia · " : e.kind === "language" ? "Programación · " : ""}
                      {e.domains} {e.kind === "subject" ? "unidades" : e.kind === "language" ? "módulos" : "dominios"} · {e.started}/{e.topics} temas empezados
                      {e.last_score != null && ` · último simulacro ${Math.round(e.last_score)}%`}
                      {e.to_review > 0 && ` · ${e.to_review} para repasar`}
                    </span>
                  </button>
                  <button
                    className={`btn small ${armed === e.id ? "danger" : "ghost"}`}
                    onClick={() => remove(e.id)}
                    onBlur={() => setArmed((a) => (a === e.id ? null : a))}
                    aria-label={armed === e.id ? `Confirmar borrar ${e.name}` : `Borrar ${e.name}`}
                  >
                    {armed === e.id ? "¿Seguro? Borrar" : "Borrar"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
