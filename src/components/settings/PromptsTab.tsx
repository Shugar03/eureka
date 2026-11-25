import { useEffect, useState } from "react";
import { api, errorText } from "../../api";
import type { PromptView } from "../../types";

const PROMPT_LABEL: Record<string, string> = {
  shared: "Base (todas las fases)",
  probe: "Fase Medir",
  plan: "Fase Planificar",
  teach: "Fase Enseñar",
  done: "Fase Terminada",
  extract: "Extractor (grafo)",
  practice_generate: "Práctica: generador",
  practice_grade: "Práctica: corrector",
  research: "Investigador",
  exam_syllabus: "Examen: lector de la guía",
  exam_questions: "Examen: simulacros",
  exam_guide: "Examen: buscador de guías",
  exam_cheat_sheet: "Examen: hoja de repaso",
  exam_check: "Examen: verificador",
  exam_explain: "Examen: dudas sobre preguntas",
  cards_generate: "Tarjetas: generador",
  code_explain: "Código: explicar errores",
  code_exercise: "Código: ejercicios",
  code_review: "Código: revisión",
  lang_path: "Rutas de programación",
  vision_transcribe: "Lectura de imágenes",
  code_project: "Código: proyectos",
  lang_listening: "Idiomas: listening",
  lang_speaking: "Idiomas: speaking",
  companion: "Acompañamiento: conversación",
  companion_entry: "Acompañamiento: entrada del diario",
};

export function PromptsTab() {
  const [prompts, setPrompts] = useState<PromptView[]>([]);
  const [selected, setSelected] = useState("shared");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = (keep = selected) =>
    api.listPrompts().then((ps) => {
      setPrompts(ps);
      setDraft(ps.find((p) => p.name === keep)?.content ?? "");
    });

  useEffect(() => {
    load().catch((e) => setStatus(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = prompts.find((p) => p.name === selected);
  const pick = (name: string) => {
    setSelected(name);
    setDraft(prompts.find((p) => p.name === name)?.content ?? "");
    setStatus(null);
  };

  return (
    <div className="prompts">
      <nav className="prompt-list">
        {prompts.map((p) => (
          <button key={p.name} className={p.name === selected ? "is-active" : ""} onClick={() => pick(p.name)}>
            {PROMPT_LABEL[p.name] ?? p.name}
            {p.overridden && <span className="dot" title="Modificado" />}
          </button>
        ))}
      </nav>
      <div className="prompt-editor">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Contenido del prompt" spellCheck={false} />
        <div className="row-end">
          {status && <span className="muted" role="status">{status}</span>}
          {current?.overridden && (
            <button
              className="btn"
              onClick={async () => {
                await api.resetPrompt(selected);
                await load();
                setStatus("Restaurado al original.");
              }}
            >
              Restaurar original
            </button>
          )}
          <button
            className="btn primary"
            disabled={draft === current?.content}
            onClick={async () => {
              await api.savePrompt(selected, draft);
              await load();
              setStatus("Guardado. Se usa desde el próximo mensaje.");
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
