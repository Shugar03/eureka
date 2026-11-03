import { useId, useMemo } from "react";
import { speechText, splitAtWord } from "../../lib/accessibility";
import { useSpeech } from "../../lib/speech";
import { useAccessibility } from "./AccessibilityContext";

/**
 * AC-74: "Escuchar" reads `markdown` aloud and shows the text being read,
 * with the current word marked when the voice reports it. Renders nothing
 * unless the learner turned reading aloud on (or `always`).
 */
export function ReadAloud({ markdown, label = "Escuchar", always = false }: { markdown: string; label?: string; always?: boolean }) {
  const { a } = useAccessibility();
  const tts = useSpeech("es");
  const text = useMemo(() => speechText(markdown), [markdown]);
  const hintId = useId();
  if ((!a.read_aloud && !always) || !text) return null;
  const [before, word, after] = splitAtWord(text, tts.word);
  return (
    <div className="read-aloud">
      <button
        type="button"
        className="btn ghost small"
        disabled={!tts.available}
        title={tts.available ? undefined : "Este equipo no tiene voces para leer en voz alta."}
        aria-describedby={tts.available ? undefined : hintId}
        aria-pressed={tts.speaking}
        onClick={() => (tts.speaking ? tts.stop() : tts.speak(text, a.speech_rate))}
      >
        {tts.speaking ? "Detener lectura" : label}
      </button>
      {!tts.available && (
        <span id={hintId} className="muted small touch-hint">
          Este equipo no tiene voces para leer en voz alta.
        </span>
      )}
      {tts.speaking && (
        <p className="read-aloud-text" data-testid="reading">
          {before}
          {word && <mark>{word}</mark>}
          {after}
        </p>
      )}
    </div>
  );
}
