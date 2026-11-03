import { useEffect, useState } from "react";
import { errorText, projectApi } from "../../api";
import type { Lang, Project, ProjectSummary, RunResult } from "../../types";
import { langLabel, runSummary } from "../../lib/code";
import { ENTRY, langOfPath, PROJECT_TOOLS, safePath, template } from "../../lib/projects";
import { CodeEditor } from "./CodeEditor";
import { Markdown } from "../Markdown";

interface Props {
  lang: Lang;
}

/** AC-64: multi-file projects with the language's own run and test tools. */
export function ProjectPanel({ lang }: Props) {
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [current, setCurrent] = useState(0);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [mode, setMode] = useState<"run" | "test" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFile, setNewFile] = useState("");
  const [hints, setHints] = useState(0);

  const refresh = () => projectApi.list().then(setList).catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const open = async (id: string) => {
    setError(null);
    try {
      const p = await projectApi.get(id);
      setProject(p);
      setCurrent(0);
      setResult(null);
      setHints(0);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const create = async () => {
    setError(null);
    try {
      const p = await projectApi.save({ id: "", name: name.trim(), lang, files: template(lang, name), statement: "", hints: [], updated_at: "" });
      setName("");
      setProject(p);
      setCurrent(0);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const guided = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await projectApi.generate(lang, topic, "medio");
      setProject(p);
      setCurrent(0);
      setResult(null);
      setHints(0);
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!project) {
    const mine = list.filter((p) => p.lang === lang);
    return (
      <div className="project-home">
        <section className="card" aria-label="Nuevo proyecto">
          <h2>Proyecto de {langLabel(lang)}</h2>
          <p className="muted small">
            Varios archivos, con las herramientas del lenguaje: {PROJECT_TOOLS[lang]}. Empezá de una plantilla o pedile al profesor un mini proyecto con pruebas que fallan (TDD).
          </p>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre, p. ej. Notas del curso" aria-label="Nombre del proyecto" />
            <button className="btn" disabled={!name.trim()} onClick={create}>
              Crear desde plantilla
            </button>
          </div>
          <div className="row">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tema del proyecto guiado, p. ej. parsear un CSV" aria-label="Tema del proyecto guiado" />
            <button className="btn" disabled={busy || !topic.trim()} onClick={guided}>
              {busy ? "Armando…" : "Proyecto guiado"}
            </button>
          </div>
        </section>
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
          </div>
        )}
        {mine.length > 0 && (
          <section className="sessions" aria-label="Proyectos">
            <h2>Tus proyectos de {langLabel(lang)}</h2>
            <ul>
              {mine.map((p) => (
                <li key={p.id} className="session-row">
                  <button className="session-open" onClick={() => open(p.id)}>
                    <span className="session-title">{p.name}</span>
                    <span className="session-meta">{p.files} archivos</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  const file = project.files[current] ?? project.files[0];
  const edit = (content: string) => setProject((p) => p && { ...p, files: p.files.map((f, i) => (i === current ? { ...f, content } : f)) });

  const exec = async (m: "run" | "test") => {
    setBusy(true);
    setError(null);
    setMode(m);
    try {
      const saved = await projectApi.save(project);
      setProject(saved);
      setResult(await projectApi.run(project.lang, saved.files, m, ""));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const addFile = () => {
    const path = newFile.trim();
    if (!safePath(path)) return setError("Nombre de archivo inválido (p. ej. utils.py o src/modelo.rs).");
    if (project.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return setError("Ese archivo ya existe.");
    setProject({ ...project, files: [...project.files, { path, content: "" }] });
    setCurrent(project.files.length);
    setNewFile("");
    setError(null);
  };

  const removeFile = (i: number) => {
    if (project.files[i].path === ENTRY[project.lang]) return setError(`${ENTRY[project.lang]} es obligatorio.`);
    setProject({ ...project, files: project.files.filter((_, j) => j !== i) });
    setCurrent(0);
  };

  const summary = result ? runSummary(result) : null;
  return (
    <div className="project">
      <div className="row-between">
        <button className="crumb" onClick={() => (setProject(null), refresh())} aria-label="Volver a proyectos">
          ← Proyectos
        </button>
        <strong>{project.name}</strong>
      </div>
      {project.statement && (
        <section className="card exercise" aria-label="Consigna del proyecto">
          <Markdown text={project.statement} />
          {project.hints.slice(0, hints).map((h, i) => (
            <p key={i} className="hint">
              <span className="tag tag-predict">Pista {i + 1}</span> {h}
            </p>
          ))}
          {project.hints.length > 0 && (
            <button className="btn small" disabled={hints >= project.hints.length} onClick={() => setHints((n) => n + 1)}>
              Pedir pista ({hints}/{project.hints.length})
            </button>
          )}
        </section>
      )}
      <div className="project-body">
        <nav className="file-list" aria-label="Archivos">
          {project.files.map((f, i) => (
            <div key={f.path} className={`file-item ${i === current ? "is-active" : ""}`}>
              <button className="file-open" onClick={() => setCurrent(i)} aria-current={i === current ? "true" : undefined}>
                {f.path}
              </button>
              {f.path !== ENTRY[project.lang] && (
                <button className="file-del" onClick={() => removeFile(i)} aria-label={`Quitar ${f.path}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="file-add">
            <input value={newFile} onChange={(e) => setNewFile(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFile()} placeholder="nuevo.py" aria-label="Nuevo archivo" />
            <button className="btn ghost small" onClick={addFile} aria-label="Agregar archivo">
              +
            </button>
          </div>
        </nav>
        <div className="project-editor">
          <CodeEditor key={file.path} value={file.content} onChange={edit} lang={langOfPath(file.path, project.lang)} errorLines={[]} onRun={() => exec("run")} />
        </div>
      </div>
      <div className="row-end">
        <span className="muted small">Se guarda solo al ejecutar o probar.</span>
        <button className="btn" disabled={busy} onClick={() => exec("test")}>
          {busy && mode === "test" ? "Probando…" : "Probar (tests)"}
        </button>
        <button className="btn primary" disabled={busy} onClick={() => exec("run")}>
          {busy && mode === "run" ? "Ejecutando…" : "Ejecutar"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {result && summary && (
        <section className="card output" aria-label="Salida del proyecto">
          <div className="row-between">
            <h2>{mode === "test" ? "Tests" : "Salida"}</h2>
            <span className={`run-status run-${summary.tone}`} data-testid="project-status">
              {mode === "test" && summary.tone === "ok" ? "¡Todas las pruebas pasan!" : summary.text}
            </span>
          </div>
          {result.stdout && <pre className="out-stdout">{result.stdout}</pre>}
          {result.stderr && <pre className={result.exit_code === 0 ? "out-stdout" : "out-stderr"}>{result.stderr}</pre>}
        </section>
      )}
    </div>
  );
}

