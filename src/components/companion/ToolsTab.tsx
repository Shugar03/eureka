import { useEffect, useState } from "react";
import { companionApi, errorText } from "../../api";
import type { CompanionView, EntryDraft } from "../../types";
import { breathAt, BREATH, GROUNDING, MOODS } from "../../lib/companion";
import { EmotionWheel } from "./EmotionWheel";
import { ThoughtWizard } from "./ThoughtWizard";

/** AC-87, AC-93, AC-94: small tools. None of them needs a model or the network. */
export function ToolsTab({ onView }: { onView: (v: CompanionView) => void }) {
  return (
    <div className="stack">
      <p className="muted small">Herramientas cortas para bajar un cambio, ponerle nombre a lo que sentís y mirar un pensamiento con calma. Funcionan sin conexión. Solo se guarda lo que vos decidas guardar.</p>
      <ThoughtRecordCard onView={onView} />
      <WheelCard onView={onView} />
      <Breathing />
      <Grounding />
    </div>
  );
}

function ThoughtRecordCard({ onView }: { onView: (v: CompanionView) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (d: EntryDraft) => {
    setBusy(true);
    setError(null);
    try {
      onView(await companionApi.saveEntry(d));
      setOpen(false);
      setNotice("Guardado en tu diario.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (open) {
    return (
      <>
        <ThoughtWizard busy={busy} onSave={save} onCancel={() => setOpen(false)} />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }
  return (
    <section className="card" aria-label="Para un pensamiento que da vueltas">
      <h2>Para un pensamiento que da vueltas</h2>
      <p className="muted small">Cinco preguntas, de a una: qué pasó, qué pensaste, cuánto te pegó, qué hay a favor y en contra, y otra mirada posible. No es para decidir si tenías razón, sino para verlo con más aire.</p>
      <div className="row-end">
        {notice && (
          <span className="muted small" role="status">
            {notice}
          </span>
        )}
        <button
          className="btn primary"
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
        >
          Empezar un registro
        </button>
      </div>
    </section>
  );
}

function WheelCard({ onView }: { onView: (v: CompanionView) => void }) {
  const [words, setWords] = useState<string[]>([]);
  const [mood, setMood] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (mood === null) return;
    setError(null);
    try {
      onView(await companionApi.checkin(mood, words, ""));
      setWords([]);
      setMood(null);
      setNotice("Guardado como check-in en tu diario.");
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card" aria-label="Rueda de emociones">
      <h2>Rueda de emociones</h2>
      <p className="muted small">Cuando cuesta ponerle nombre a lo que sentís. Ponerle nombre ya ayuda un poco.</p>
      <EmotionWheel selected={words} onChange={setWords} />
      {words.length > 0 && (
        <div className="field">
          <span>Si querés guardarlo en el diario, ¿cómo estás en general?</span>
          <div className="moods" role="radiogroup" aria-label="Ánimo para el check-in">
            {MOODS.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={mood === m.value} className={`mood ${mood === m.value ? "is-selected" : ""}`} onClick={() => setMood(m.value)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="row-end">
            <button className="btn" disabled={mood === null} onClick={save}>
              Guardar como check-in
            </button>
          </div>
        </div>
      )}
      <p className="muted small" role="status">
        {notice}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Breathing() {
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const b = breathAt(t);
  // Grows while inhaling and holding, shrinks while exhaling; the CSS drops the motion if it is turned off.
  const big = running && b.index < 2;
  return (
    <section className="card" aria-label="Respiración guiada">
      <h2>Respiración guiada</h2>
      <p className="muted small">
        {BREATH.map((s) => `${s.label.toLowerCase()} ${s.seconds}`).join(" · ")}. Una exhalación larga ayuda al cuerpo a aflojar.
      </p>
      <div className="breath-stage">
        <div className="breath-circle" style={{ transform: `scale(${big ? 1 : 0.6})`, transitionDuration: `${running ? b.step.seconds : 0.6}s` }} aria-hidden>
          <span>{running ? b.left : ""}</span>
        </div>
        <p className="breath-cue" data-testid="breath-cue">
          {running ? b.step.label : "Cuando quieras"}
        </p>
        <span className="sr-only" role="status">
          {running ? b.step.label : ""}
        </span>
        {running && <p className="muted small">Ciclo {b.cycle}</p>}
      </div>
      <div className="row-end">
        <button
          className="btn primary"
          onClick={() => {
            setT(0);
            setRunning((r) => !r);
          }}
        >
          {running ? "Terminar" : "Empezar"}
        </button>
      </div>
    </section>
  );
}

function Grounding() {
  const [i, setI] = useState(-1);
  const done = i >= GROUNDING.length;
  const step = GROUNDING[i];
  return (
    <section className="card" aria-label="Anclaje 5-4-3-2-1">
      <h2>5-4-3-2-1</h2>
      <p className="muted small">Para cuando la cabeza va muy rápido: volver al presente por los sentidos.</p>
      {i < 0 && (
        <div className="row-end">
          <button className="btn primary" onClick={() => setI(0)}>
            Empezar
          </button>
        </div>
      )}
      {step && (
        <div className="grounding-step" data-testid="grounding-step">
          <p className="grounding-n" aria-hidden>
            {step.n}
          </p>
          <p>
            <strong>
              {step.n} {step.text}
            </strong>
          </p>
          <p className="muted">{step.hint}</p>
          <div className="row-end">
            <button className="btn ghost" onClick={() => setI(i - 1)} disabled={i === 0}>
              Anterior
            </button>
            <button className="btn primary" onClick={() => setI(i + 1)}>
              {i === GROUNDING.length - 1 ? "Terminar" : "Siguiente"}
            </button>
          </div>
        </div>
      )}
      {done && (
        <div className="grounding-step">
          <p>
            <strong>Listo.</strong> Respirá hondo una vez más. Estás acá, en este momento.
          </p>
          <div className="row-end">
            <button className="btn" onClick={() => setI(0)}>
              Repetir
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
