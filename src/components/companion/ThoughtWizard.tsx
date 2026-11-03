import { useState } from "react";
import { THOUGHT_STEPS } from "../../lib/companion";
import type { EntryDraft, ThoughtRecord } from "../../types";
import { EmotionWheel } from "./EmotionWheel";

const EMPTY: ThoughtRecord = { situation: "", thought: "", before: 50, after: null, for_it: "", against: "", alternative: "" };

/**
 * AC-93: a thought record, one question at a time. It needs no model and no
 * network. The person writes everything; the app only gives the order.
 */
export function ThoughtWizard({ busy, onSave, onCancel }: { busy: boolean; onSave: (d: EntryDraft) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [r, setR] = useState<ThoughtRecord>(EMPTY);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [remeasure, setRemeasure] = useState(false);
  const set = (patch: Partial<ThoughtRecord>) => setR((cur) => ({ ...cur, ...patch }));
  const s = THOUGHT_STEPS[step];
  const last = step === THOUGHT_STEPS.length - 1;
  // Each step needs only what the record needs: what happened and what was thought.
  const ready = s.id === "situation" ? r.situation.trim() !== "" : s.id === "thought" ? r.thought.trim() !== "" : true;

  return (
    <section className="card wizard" aria-label="Registro de pensamientos">
      <div className="row-between">
        <h2>Registro de pensamientos</h2>
        <span className="muted small" data-testid="wizard-step">
          Paso {step + 1} de {THOUGHT_STEPS.length}
        </span>
      </div>
      <div className="wizard-bar" aria-hidden>
        <span style={{ width: `${((step + 1) / THOUGHT_STEPS.length) * 100}%` }} />
      </div>
      <h3 className="wizard-q">{s.title}</h3>
      <p className="muted small">{s.hint}</p>

      {s.id === "situation" && <textarea rows={4} value={r.situation} maxLength={600} onChange={(e) => set({ situation: e.target.value })} aria-label="Qué pasó" />}
      {s.id === "thought" && <textarea rows={3} value={r.thought} maxLength={600} onChange={(e) => set({ thought: e.target.value })} aria-label="Qué pensaste" />}
      {s.id === "feeling" && (
        <>
          <EmotionWheel selected={emotions} onChange={setEmotions} />
          <label className="a11y-range">
            Qué tan fuerte fue: {r.before}/100
            <input type="range" min={0} max={100} step={5} value={r.before} onChange={(e) => set({ before: Number(e.target.value) })} aria-label="Intensidad antes" aria-valuetext={`${r.before} de 100`} />
          </label>
        </>
      )}
      {s.id === "evidence" && (
        <>
          <label className="field">
            <span>Lo que apoya ese pensamiento</span>
            <textarea rows={3} value={r.for_it} maxLength={800} onChange={(e) => set({ for_it: e.target.value })} aria-label="Lo que apoya el pensamiento" />
          </label>
          <label className="field">
            <span>Lo que no encaja con él</span>
            <textarea rows={3} value={r.against} maxLength={800} onChange={(e) => set({ against: e.target.value })} aria-label="Lo que no encaja con el pensamiento" />
          </label>
        </>
      )}
      {s.id === "alternative" && (
        <>
          <textarea rows={3} value={r.alternative} maxLength={800} onChange={(e) => set({ alternative: e.target.value })} aria-label="Otra mirada" />
          <label className="check">
            <input
              type="checkbox"
              checked={remeasure}
              onChange={(e) => {
                setRemeasure(e.target.checked);
                set({ after: e.target.checked ? r.before : null });
              }}
            />
            Volver a medir cuánto me pega ahora
          </label>
          {remeasure && (
            <label className="a11y-range">
              Ahora: {r.after ?? r.before}/100
              <input type="range" min={0} max={100} step={5} value={r.after ?? r.before} onChange={(e) => set({ after: Number(e.target.value) })} aria-label="Intensidad ahora" aria-valuetext={`${r.after ?? r.before} de 100`} />
            </label>
          )}
        </>
      )}

      <div className="row-between">
        <button className="btn ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)} disabled={busy}>
          {step === 0 ? "Cancelar" : "Anterior"}
        </button>
        {last ? (
          <button className="btn primary" disabled={busy} onClick={() => onSave({ title: "", text: "", mood: null, emotions, helped: [], record: { ...r, after: remeasure ? r.after : null } })}>
            {busy ? "Guardando…" : "Guardar en mi diario"}
          </button>
        ) : (
          <button className="btn primary" disabled={!ready} onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        )}
      </div>
    </section>
  );
}
