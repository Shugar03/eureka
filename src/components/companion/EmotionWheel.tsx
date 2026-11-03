import { useState } from "react";
import { WHEEL } from "../../lib/companion";

/**
 * AC-94: from a big family ("Tristeza") to the word that fits ("desanimado").
 * Several words can be picked, across families.
 */
export function EmotionWheel({ selected, onChange }: { selected: string[]; onChange: (words: string[]) => void }) {
  const [core, setCore] = useState<string | null>(null);
  const family = WHEEL.find((w) => w.core === core);
  const toggle = (w: string) => onChange(selected.includes(w) ? selected.filter((x) => x !== w) : [...selected, w]);
  return (
    <div className="wheel">
      <div className="wheel-cores" role="radiogroup" aria-label="Familia de emociones">
        {WHEEL.map((w) => {
          const picked = w.words.filter((x) => selected.includes(x)).length;
          return (
            <button key={w.core} type="button" role="radio" aria-checked={core === w.core} className={`wheel-core core-${w.core.toLowerCase()} ${core === w.core ? "is-selected" : ""}`} onClick={() => setCore(core === w.core ? null : w.core)}>
              {w.core}
              {picked > 0 && <span className="wheel-count"> · {picked}</span>}
            </button>
          );
        })}
      </div>
      {family ? (
        <div className="wheel-words" role="group" aria-label={`Palabras de ${family.core}`}>
          {family.words.map((w) => (
            <button key={w} type="button" aria-pressed={selected.includes(w)} className={`emo ${selected.includes(w) ? "is-selected" : ""}`} onClick={() => toggle(w)}>
              {w}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">Elegí la familia que más se parece a lo que sentís, y después la palabra que mejor le queda. Si no sabés, empezá por la que se acerque.</p>
      )}
      {selected.length > 0 && (
        <p className="wheel-chosen" data-testid="wheel-chosen">
          Elegiste: <strong>{selected.join(", ")}</strong>
        </p>
      )}
    </div>
  );
}
