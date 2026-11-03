import { useState } from "react";
import { mmss, PHASE_LABEL, remaining } from "../../lib/pomodoro";
import { ding, tick } from "../../lib/sounds";
import { usePomodoro } from "./PomodoroContext";

/** AC-49: the pomodoro in the sidebar, on every screen. */
export function PomodoroWidget() {
  const p = usePomodoro();
  const [open, setOpen] = useState(false);
  const left = remaining(p.state, p.now);
  const total = p.settings[p.state.phase] * p.msPerMin;
  const idle = !p.state.running && left === total;
  const s = p.settings;

  return (
    <section className={`pomo pomo-${p.state.phase}`} aria-label="Pomodoro">
      <div className="pomo-row">
        <span className="pomo-phase">
          {PHASE_LABEL[p.state.phase]}
          <span className="muted"> · {p.state.done}/{s.every}</span>
        </span>
        <span className="pomo-time" data-testid="pomo-time">
          {mmss(left)}
        </span>
      </div>
      <div className="pomo-bar" aria-hidden>
        <span style={{ width: `${100 * (1 - left / Math.max(1, total))}%` }} />
      </div>
      <div className="pomo-row">
        {p.state.running ? (
          <button className="btn small" onClick={p.pause}>
            Pausar
          </button>
        ) : (
          <button className="btn small primary" onClick={p.start}>
            {idle ? (p.state.phase === "focus" ? "Iniciar foco" : "Iniciar descanso") : "Seguir"}
          </button>
        )}
        <button className="btn ghost small" onClick={p.skip} aria-label={p.state.phase === "focus" ? "Saltar al descanso" : "Saltar al foco"} title="Saltar">
          ⏭
        </button>
        <button className="btn ghost small" onClick={p.reset} aria-label="Reiniciar pomodoro" title="Reiniciar">
          ↺
        </button>
        <button className="btn ghost small" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ajustes del pomodoro" title="Ajustes">
          ⚙
        </button>
      </div>
      {p.context && <p className="pomo-ctx muted">Estudiando: {p.context.title}</p>}
      {p.notice && (
        <p className="pomo-notice" role="status">
          {p.notice}
        </p>
      )}
      {open && (
        <div className="pomo-settings">
          {(
            [
              ["focus", "Foco (min)"],
              ["short", "Descanso (min)"],
              ["long", "Descanso largo (min)"],
              ["every", "Largo cada (bloques)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input type="number" value={s[k]} onChange={(e) => p.setSettings({ ...s, [k]: Number(e.target.value) })} aria-label={label} />
            </label>
          ))}
          <div className="pomo-sound">
            <label className="check">
              <input type="checkbox" checked={p.sound.enabled} onChange={(e) => p.setSound({ ...p.sound, enabled: e.target.checked })} aria-label="Sonido" /> Sonido
            </label>
            <label className="check">
              <input type="checkbox" checked={p.sound.tickTock} disabled={!p.sound.enabled} onChange={(e) => p.setSound({ ...p.sound, tickTock: e.target.checked })} aria-label="Tic-tac al final" /> Tic-tac en los últimos 10 s
            </label>
            <button className="btn small" disabled={!p.sound.enabled} onClick={() => { tick(true); setTimeout(() => tick(false), 500); setTimeout(ding, 1000); }}>
              Probar sonido
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
