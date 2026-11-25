import { useEffect, useState } from "react";
import type { ReminderSettings } from "../../lib/reminders";
import { validReminders } from "../../lib/reminders";
import { loadReminderSettings, saveReminderSettings } from "../Reminders";

/** A minutes box that keeps what you type and applies it (clamped) on leaving it, so "25" can be typed. */
function Minutes({ value, label, disabled, onCommit }: { value: number; label: string; disabled: boolean; onCommit: (n: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  const commit = () => (raw.trim() !== "" && Number.isFinite(Number(raw)) ? onCommit(Number(raw)) : setRaw(String(value)));
  return <input type="number" min={10} max={240} value={raw} disabled={disabled} aria-label={label} onChange={(e) => setRaw(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

/** AC-62: what to remind and when (saved on this device). */
export function RemindersSection() {
  const [s, setS] = useState<ReminderSettings>(loadReminderSettings);
  const update = (patch: Partial<ReminderSettings>) => {
    const next = validReminders({ ...s, ...patch });
    setS(next);
    saveReminderSettings(next);
  };
  return (
    <section className="card" aria-label="Recordatorios">
      <h2>Recordatorios</h2>
      <p className="muted small">Avisos del sistema (y dentro de la app) para tus clases, fechas de examen, tarjetas del día, y para que te pares y tomes agua mientras estudiás. El sonido se apaga en los ajustes del pomodoro.</p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Recordatorios activados
      </label>
      <div className="goal-form">
        <label>
          Minutos antes de cada clase o bloque
          <input type="number" min={0} max={120} value={s.slotMinutes} disabled={!s.enabled} onChange={(e) => update({ slotMinutes: Number(e.target.value) })} aria-label="Minutos antes de cada clase" />
        </label>
        <label>
          Tarjetas del día a las
          <input type="time" value={s.cardsAt} disabled={!s.enabled} onChange={(e) => update({ cardsAt: e.target.value })} aria-label="Hora del recordatorio de tarjetas" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.exams} disabled={!s.enabled} onChange={(e) => update({ exams: e.target.checked })} /> Cuenta regresiva de exámenes (7, 3 y 1 día antes, y el mismo día)
      </label>
      <div className="health-reminders">
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked={s.stand} disabled={!s.enabled} onChange={(e) => update({ stand: e.target.checked })} aria-label="Avisarme que me pare" /> Avisarme que me pare cada
          </label>
          <Minutes value={s.standMinutes} disabled={!s.enabled || !s.stand} label="Minutos para pararme" onCommit={(n) => update({ standMinutes: n })} />
          <span className="muted small">min (un pomodoro dura 25). Un descanso del pomodoro cuenta como pararte.</span>
        </div>
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked={s.water} disabled={!s.enabled} onChange={(e) => update({ water: e.target.checked })} aria-label="Avisarme que tome agua" /> Avisarme que tome agua cada
          </label>
          <Minutes value={s.waterMinutes} disabled={!s.enabled || !s.water} label="Minutos para tomar agua" onCommit={(n) => update({ waterMinutes: n })} />
          <span className="muted small">min</span>
        </div>
      </div>
    </section>
  );
}
