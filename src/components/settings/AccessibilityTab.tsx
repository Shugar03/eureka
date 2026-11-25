import { useState } from "react";
import { errorText } from "../../api";
import { thisDevice } from "../../lib/platform";
import type { Accessibility } from "../../types";
import { Markdown } from "../Markdown";
import { ReadAloud } from "../a11y/ReadAloud";
import { useAccessibility } from "../a11y/AccessibilityContext";

const SIZES: { id: Accessibility["text_size"]; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "large", label: "Grande" },
  { id: "larger", label: "Muy grande" },
];

const SAMPLE = "La **derivada** mide cuánto cambia una función en un punto. Por ejemplo, si $f(x) = x^2$, en $x = 3$ cambia 6 veces más rápido que $x$.";

/** AC-73..77: access settings. Functional choices, never a diagnosis. */
export function AccessibilityTab() {
  const { a, update, speechReady } = useAccessibility();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Accessibility>) =>
    update(patch)
      .then(() => {
        setError(null);
        setSaved(true);
      })
      .catch((e) => {
        setSaved(false);
        setError(errorText(e));
      });
  const check = (key: keyof Accessibility, label: string, hint: string) => (
    <label className="check a11y-check">
      <input type="checkbox" checked={a[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>
        {label}
        <small className="muted">{hint}</small>
      </span>
    </label>
  );
  return (
    <div className="stack">
      <p className="muted small">Elegí lo que te sirva para estudiar más cómodo. No hace falta ningún diagnóstico, y todo se guarda solo en {thisDevice()}. Los cambios se aplican al instante.</p>

      <section className="card" aria-label="Leer y escuchar">
        <h2>Leer y escuchar</h2>
        {check("read_aloud", "Leeme en voz alta", "Agrega «Escuchar» a cada mensaje del profesor, a cada pregunta y a las secciones de tus libros. Marca la palabra que se está leyendo.")}
        <label className="a11y-range">
          Velocidad de lectura: {a.speech_rate.toFixed(1)}×
          <input type="range" min={0.6} max={1.4} step={0.1} value={a.speech_rate} onChange={(e) => set({ speech_rate: Number(e.target.value) })} aria-label="Velocidad de lectura" aria-valuetext={`${a.speech_rate.toFixed(1)} veces`} />
        </label>
        {check("dictation", "Responder dictando", "Agrega «Dictar» donde escribís tus respuestas. El profesor no te corrige la ortografía de lo dictado.")}
        {a.dictation && !speechReady && <p className="warn-text small">Para dictar hace falta un modelo de Voz: elegilo en Avanzado → Voz.</p>}
      </section>

      <section className="card" aria-label="Cómo se ve">
        <h2>Cómo se ve</h2>
        <div className="field">
          <span>Tamaño del texto</span>
          <div className="tabs a11y-sizes" role="radiogroup" aria-label="Tamaño del texto">
            {SIZES.map((s) => (
              <button key={s.id} role="radio" aria-checked={a.text_size === s.id} className={a.text_size === s.id ? "is-active" : ""} onClick={() => set({ text_size: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {check("spacing", "Más espacio entre letras, palabras y líneas", "Renglones más cortos y separados. A muchas personas les cansa menos leer así.")}
        {check("reduce_motion", "Sin animaciones", "Quita movimientos y parpadeos de la interfaz.")}
      </section>

      <section className="card" aria-label="Cómo te habla el profesor">
        <h2>Cómo te habla el profesor</h2>
        <p className="muted small">Cambian la forma de explicar, no lo que aprendés ni cuánto se te exige.</p>
        {check("easy_reading", "Lectura fácil", "Frases cortas, una idea por frase, palabras comunes y los términos técnicos explicados al usarlos.")}
        {check("literal", "Lenguaje literal y sin sorpresas", "Sin ironías ni metáforas. Antes de cada paso te dice qué va a pasar.")}
        {check("short_steps", "Pasos cortos con meta visible", "Mensajes de pocas frases, bloques como «3 preguntas y listo» y pausas al cerrar cada idea.")}
      </section>

      <section className="card" aria-label="Vista previa">
        <h2>Vista previa</h2>
        <div className="bubble assistant">
          <Markdown text={SAMPLE} />
          <ReadAloud markdown={SAMPLE} always />
        </div>
      </section>
      <p className="muted small" role="status">
        {saved && !error ? "Guardado." : ""}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
