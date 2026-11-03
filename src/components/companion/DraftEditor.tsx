import { useState } from "react";
import type { EntryDraft } from "../../types";
import { MOODS, splitList } from "../../lib/companion";

/** AC-83: a diary entry, proposed by the app or written by hand. Nothing is saved until "Guardar". */
export function DraftEditor({ draft, heading, busy, onSave, onCancel }: { draft: EntryDraft; heading: string; busy: boolean; onSave: (d: EntryDraft) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [mood, setMood] = useState<number | null>(draft.mood ?? null);
  const [emotions, setEmotions] = useState(draft.emotions.join(", "));
  const [helped, setHelped] = useState(draft.helped.join(", "));
  return (
    <section className="card draft" aria-label={heading}>
      <h2>{heading}</h2>
      <label className="field">
        <span>Título</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Título de la entrada" />
      </label>
      <label className="field">
        <span>Lo que quiero recordar</span>
        <textarea value={text} rows={6} onChange={(e) => setText(e.target.value)} aria-label="Texto de la entrada" />
      </label>
      <div className="field">
        <span>¿Cómo me sentía? (opcional)</span>
        <div className="moods" role="radiogroup" aria-label="Ánimo">
          {MOODS.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={mood === m.value} className={`mood ${mood === m.value ? "is-selected" : ""}`} onClick={() => setMood(mood === m.value ? null : m.value)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Emociones (separadas por coma)</span>
        <input value={emotions} onChange={(e) => setEmotions(e.target.value)} aria-label="Emociones" placeholder="cansancio, alivio" />
      </label>
      <label className="field">
        <span>Qué me ayudó (separado por coma)</span>
        <input value={helped} onChange={(e) => setHelped(e.target.value)} aria-label="Qué me ayudó" placeholder="salir a caminar" />
      </label>
      <div className="row-end">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Descartar
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => onSave({ ...draft, title: title.trim(), text: text.trim(), mood, emotions: splitList(emotions), helped: splitList(helped) })}>
          {busy ? "Guardando…" : "Guardar en mi diario"}
        </button>
      </div>
    </section>
  );
}
