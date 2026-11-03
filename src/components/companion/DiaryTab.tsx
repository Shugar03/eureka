import { useState } from "react";
import { companionApi, errorText } from "../../api";
import type { CompanionView, EntryDraft, HelpResource, JournalEntry } from "../../types";
import { dayLabel, EMOTIONS, hourLabel, MOODS, moodLabel } from "../../lib/companion";
import { DraftEditor } from "./DraftEditor";
import { EmotionWheel } from "./EmotionWheel";
import { InsightsPanel } from "./InsightsPanel";
import { saveFile } from "../../lib/saveFile";
import { thisDevice } from "../../lib/platform";

/** AC-83: check-ins and entries, newest first. */
export function DiaryTab({ view, onView }: { view: CompanionView; onView: (v: CompanionView) => void }) {
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (f: () => Promise<CompanionView>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      onView(await f());
      after?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const days = new Map<string, JournalEntry[]>();
  for (const e of view.entries) {
    const k = dayLabel(e.at);
    days.set(k, [...(days.get(k) ?? []), e]);
  }

  return (
    <div className="stack">
      <CheckIn onSave={(mood, emotions, note) => run(() => companionApi.checkin(mood, emotions, note))} busy={busy} />

      <InsightsPanel view={view} onView={onView} />

      {editing ? (
        <DraftEditor draft={editing} heading={editing.id ? "Editar entrada" : "Escribir una entrada"} busy={busy} onCancel={() => setEditing(null)} onSave={(d) => run(() => companionApi.saveEntry(d), () => setEditing(null))} />
      ) : (
        <div className="row-between">
          <h2 className="diary-title">Mi diario</h2>
          <button className="btn" onClick={() => setEditing({ title: "", text: "", mood: null, emotions: [], helped: [] })}>
            Escribir una entrada
          </button>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {view.entries.length === 0 && <p className="muted">Todavía no hay nada acá. Un check-in de 10 segundos ya cuenta.</p>}
      {[...days].map(([day, list]) => (
        <section key={day} className="diary-day" aria-label={day}>
          <h3>{day}</h3>
          <ul className="diary-list">
            {list.map((e) => (
              <li key={e.id} className={`diary-entry kind-${e.kind}`} data-testid="entry">
                <div className="row-between">
                  <strong>{e.title}</strong>
                  <span className="muted small">{hourLabel(e.at)}</span>
                </div>
                {(e.mood || e.emotions.length > 0) && (
                  <p className="diary-meta">
                    {e.mood && <span className={`mood-pill mood-${e.mood}`}>{moodLabel(e.mood)}</span>}
                    {e.emotions.map((x) => (
                      <span key={x} className="emo-pill">
                        {x}
                      </span>
                    ))}
                  </p>
                )}
                {e.record && (
                  <p className="diary-meta">
                    <span className="mood-pill">
                      Intensidad {e.record.before}
                      {e.record.after !== null && e.record.after !== undefined ? ` → ${e.record.after}` : ""}
                    </span>
                  </p>
                )}
                {e.text && <p className="diary-text">{e.text}</p>}
                {e.helped.length > 0 && <p className="muted small">Me ayudó: {e.helped.join(", ")}</p>}
                <div className="row">
                  {e.kind === "entry" && (
                    <button className="btn ghost small" onClick={() => setEditing({ id: e.id, title: e.title, text: e.text, mood: e.mood, emotions: e.emotions, helped: e.helped })}>
                      Editar
                    </button>
                  )}
                  <button
                    className={`btn small ${armed === e.id ? "danger" : "ghost"}`}
                    onClick={() => (armed === e.id ? run(() => companionApi.deleteEntry(e.id), () => setArmed(null)) : setArmed(e.id))}
                    onBlur={() => setArmed((a) => (a === e.id ? null : a))}
                    aria-label={armed === e.id ? `Confirmar borrar ${e.title}` : `Borrar ${e.title}`}
                  >
                    {armed === e.id ? "¿Seguro? Borrar" : "Borrar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Privacy view={view} onView={onView} />
    </div>
  );
}

/** AC-83: ten seconds — how am I, and which emotions. */
function CheckIn({ onSave, busy }: { onSave: (mood: number, emotions: string[], note: string) => void; busy: boolean }) {
  const [mood, setMood] = useState<number | null>(null);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [wheel, setWheel] = useState(false);
  return (
    <section className="card" aria-label="Check-in">
      <h2>¿Cómo estás ahora?</h2>
      <div className="moods" role="radiogroup" aria-label="Cómo estás">
        {MOODS.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mood === m.value} className={`mood ${mood === m.value ? "is-selected" : ""}`} onClick={() => setMood(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="emotions" role="group" aria-label="Emociones">
        {[...EMOTIONS, ...emotions.filter((x) => !EMOTIONS.includes(x))].map((x) => (
          <button key={x} type="button" aria-pressed={emotions.includes(x)} className={`emo ${emotions.includes(x) ? "is-selected" : ""}`} onClick={() => setEmotions((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]))}>
            {x}
          </button>
        ))}
      </div>
      <div>
        <button type="button" className="link small" onClick={() => setWheel((w) => !w)} aria-expanded={wheel}>
          {wheel ? "Cerrar la rueda de emociones" : "No encuentro la palabra: abrir la rueda de emociones"}
        </button>
      </div>
      {wheel && <EmotionWheel selected={emotions} onChange={setEmotions} />}
      <label className="field">
        <span>Algo que quieras anotar (opcional)</span>
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label="Nota del check-in" />
      </label>
      <div className="row-end">
        <button
          className="btn primary"
          disabled={mood === null || busy}
          onClick={() => {
            if (mood === null) return;
            onSave(mood, emotions, note);
            setMood(null);
            setEmotions([]);
            setNote("");
          }}
        >
          Guardar check-in
        </button>
      </div>
    </section>
  );
}

const lines = (rs: HelpResource[]) => rs.map((r) => (r.detail ? `${r.name} — ${r.detail}` : r.name)).join("\n");
const parseLines = (s: string): HelpResource[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, ...rest] = l.split(/\s[—–-]\s/);
      return { name: name.trim(), detail: rest.join(" — ").trim() };
    });

/** AC-85, AC-86, AC-88: PIN, help lines, export and erase. */
function Privacy({ view, onView }: { view: CompanionView; onView: (v: CompanionView) => void }) {
  const [pin, setPin] = useState("");
  const [res, setRes] = useState(lines(view.resources));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const act = async (f: () => Promise<CompanionView>, ok: string) => {
    setError(null);
    setStatus(null);
    try {
      onView(await f());
      setStatus(ok);
      setPin("");
    } catch (e) {
      setError(errorText(e));
    }
  };

  const download = async () => {
    setError(null);
    try {
      if (await saveFile("eureka-diario.json", await companionApi.exportAll(), "application/json")) setStatus("Listo: se guardó eureka-diario.json.");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <section className="card" aria-label="Tu privacidad">
      <h2>Tu privacidad</h2>
      <p className="muted small">Tu diario se guarda solo en {thisDevice()}. El profesor no lo lee ni se usa para enseñarte, y no entra en las copias de seguridad.</p>

      <div className="field">
        <span>PIN para el diario</span>
        <div className="row">
          <input className="pin-input" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} onChange={(e) => setPin(e.target.value)} aria-label={view.has_pin ? "PIN actual" : "PIN nuevo"} placeholder={view.has_pin ? "PIN actual" : "4 a 12 caracteres"} />
          {view.has_pin ? (
            <>
              <button className="btn" onClick={() => act(() => companionApi.setPin(null, pin), "Quitamos el PIN.")}>
                Quitar PIN
              </button>
              <button className="btn" onClick={() => act(() => companionApi.lock(), "Diario bloqueado.")}>
                Bloquear ahora
              </button>
            </>
          ) : (
            <button className="btn" disabled={pin.trim().length < 4} onClick={() => act(() => companionApi.setPin(pin, null), "Listo: el diario se bloquea al salir de esta pantalla.")}>
              Poner PIN
            </button>
          )}
        </div>
        <span className="muted small">El PIN evita que alguien que use tu computadora vea el diario. No cifra los archivos.</span>
      </div>

      <label className="field">
        <span>Líneas de ayuda de tu país (una por renglón: nombre — detalle)</span>
        <textarea value={res} rows={4} onChange={(e) => setRes(e.target.value)} aria-label="Líneas de ayuda" />
        <span className="muted small">Cargamos las de Argentina; verificá que los números sigan vigentes o cambialos por los de tu país.</span>
      </label>
      <div className="row">
        <button className="btn" onClick={() => act(() => companionApi.saveResources(parseLines(res)), "Guardamos las líneas de ayuda.")}>
          Guardar líneas de ayuda
        </button>
        <button className="btn" onClick={download}>
          Descargar todo mi diario
        </button>
        <button className={`btn ${armed ? "danger" : "ghost"}`} onClick={() => (armed ? act(() => companionApi.erase(), "Se borró todo.") : setArmed(true))} onBlur={() => setArmed(false)}>
          {armed ? "¿Seguro? Borrar todo para siempre" : "Borrar todo"}
        </button>
      </div>
      <p className="muted small" role="status">
        {status}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
