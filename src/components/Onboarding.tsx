import { useState } from "react";
import { thisDevice } from "../lib/platform";
import type { Identity } from "../types";
import type { Theme } from "../lib/theme";
import { greeting, PRESETS, sceneUrl } from "../lib/workspace";
import { validReminders } from "../lib/reminders";
import { loadReminderSettings, saveReminderSettings } from "./Reminders";
import { usePomodoro } from "./pomodoro/PomodoroContext";
import { AboutFields, NameFields, TreatmentFields } from "./workspace/IdentityFields";
import { EMPTY_IDENTITY, useWorkspace } from "./workspace/WorkspaceContext";

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Oscuro" },
  { id: "light", label: "Claro" },
  { id: "system", label: "Según el sistema" },
];

const STEPS = ["name", "about", "treatment", "space", "care"] as const;
type Step = (typeof STEPS)[number];

const TITLE: Record<Step, string> = {
  name: "Bienvenido a Eureka",
  about: "Contame de vos",
  treatment: "¿Cómo preferís que te hablemos?",
  space: "Tu espacio",
  care: "Cuidarte mientras estudiás",
};

/**
 * AC-92: the first-run welcome, in steps. Everything is optional and can be
 * skipped; what is said here is used to talk to the person the way they asked.
 */
export function Onboarding() {
  const { identity, setIdentity, theme, setTheme, ws, update } = useWorkspace();
  const pomo = usePomodoro();
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<Identity>({ ...(identity ?? EMPTY_IDENTITY) });
  const [care, setCare] = useState({ stand: true, standMinutes: "25", water: true, waterMinutes: "60", sound: pomo.sound.enabled });
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const patch = (p: Partial<Identity>) => setDraft((d) => ({ ...d, ...p }));

  const finish = () => {
    setIdentity({ ...draft, onboarded: true });
    if (care.stand || care.water) {
      saveReminderSettings(validReminders({ ...loadReminderSettings(), enabled: true, stand: care.stand, standMinutes: Number(care.standMinutes), water: care.water, waterMinutes: Number(care.waterMinutes) }));
    }
    pomo.setSound({ ...pomo.sound, enabled: care.sound });
  };
  const skipAll = () => setIdentity({ onboarded: true });

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Bienvenida">
      <div className="onboarding-card">
        <div className="onboarding-top">
          <p className="onboarding-step" aria-live="polite">
            Paso {i + 1} de {STEPS.length}
          </p>
          <div className="onboarding-dots" aria-hidden>
            {STEPS.map((s, k) => (
              <span key={s} className={k <= i ? "is-on" : ""} />
            ))}
          </div>
        </div>
        <h1 className="onboarding-title">{TITLE[step]}</h1>

        {step === "name" && (
          <>
            <p className="muted">Solo toma un minuto y todo es opcional. Así puedo hablarte como te gusta.</p>
            <NameFields identity={draft} onChange={patch} />
          </>
        )}
        {step === "about" && (
          <>
            <p className="muted">Con esto ajusto los ejemplos y el tono. Podés dejar en blanco lo que prefieras no contar.</p>
            <AboutFields identity={draft} onChange={patch} />
          </>
        )}
        {step === "treatment" && (
          <>
            <p className="muted">Elegí lo que te haga sentir cómodo; no hay respuestas incorrectas.</p>
            <TreatmentFields identity={draft} onChange={patch} />
          </>
        )}
        {step === "space" && (
          <>
            <p className="muted">Que sea un lugar tuyo. Lo podés cambiar cuando quieras en Ajustes → Mi espacio, donde también elegís el color de acento o subís tu propia imagen.</p>
            <div className="tabs" role="radiogroup" aria-label="Luz">
              {THEMES.map((t) => (
                <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? "is-active" : ""} onClick={() => setTheme(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="wp-grid onboarding-wp" role="radiogroup" aria-label="Fondos">
              {PRESETS.map((p) => {
                const on = ws.wallpaper.kind === "preset" && ws.wallpaper.id === p.id;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} className={`wp-tile ${on ? "is-selected" : ""}`} onClick={() => update({ wallpaper: { kind: "preset", id: p.id }, palette: [], accent: null })}>
                    <span className="wp-thumb" style={{ backgroundImage: `url("${sceneUrl(p.id)}")` }} />
                    <span className="wp-label">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === "care" && (
          <>
            <p className="muted">Estudiar muchas horas seguidas cansa. Si querés, te aviso para que te pares y tomes agua. Lo cambiás cuando quieras.</p>
            <div className="health-reminders">
              <div className="check-row">
                <label className="check">
                  <input type="checkbox" checked={care.stand} onChange={(e) => setCare({ ...care, stand: e.target.checked })} aria-label="Avisarme que me pare" /> Avisarme que me pare cada
                </label>
                <input type="number" min={10} max={240} value={care.standMinutes} disabled={!care.stand} onChange={(e) => setCare({ ...care, standMinutes: e.target.value })} aria-label="Minutos para pararme" />
                <span className="muted small">min (lo que dura un pomodoro)</span>
              </div>
              <div className="check-row">
                <label className="check">
                  <input type="checkbox" checked={care.water} onChange={(e) => setCare({ ...care, water: e.target.checked })} aria-label="Avisarme que tome agua" /> Avisarme que tome agua cada
                </label>
                <input type="number" min={10} max={240} value={care.waterMinutes} disabled={!care.water} onChange={(e) => setCare({ ...care, waterMinutes: e.target.value })} aria-label="Minutos para tomar agua" />
                <span className="muted small">min</span>
              </div>
              <label className="check">
                <input type="checkbox" checked={care.sound} onChange={(e) => setCare({ ...care, sound: e.target.checked })} aria-label="Sonidos del pomodoro" /> Sonidos del pomodoro (tic-tac al final y una campanita)
              </label>
            </div>
            <p className="onboarding-hello" data-testid="hello">
              {greeting(draft.first_name)}
            </p>
          </>
        )}

        <p className="muted small onboarding-privacy">Tu nombre, cómo preferís que te hablemos y qué estudiás se comparten con el modelo de IA que elijas para poder hablarte así. Lo demás queda en {thisDevice()}.</p>

        <div className="onboarding-actions">
          <button className="btn ghost" onClick={skipAll}>
            Omitir todo
          </button>
          <span className="row">
            <button className="btn" onClick={() => setI(i - 1)} disabled={i === 0}>
              Atrás
            </button>
            {last ? (
              <button className="btn primary" onClick={finish}>
                Empezar
              </button>
            ) : (
              <button className="btn primary" onClick={() => setI(i + 1)}>
                Siguiente
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
