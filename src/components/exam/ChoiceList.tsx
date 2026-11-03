import { isRight } from "../../lib/exam";

interface Props {
  /** Groups the inputs of one question. */
  name: string;
  options: string[];
  /** Indices of the correct options; several make it "Elegí N" (AC-41). */
  answer: number[];
  chosen: number[];
  /** After grading: mark right and wrong options. */
  reveal: boolean;
  disabled: boolean;
  onChange: (next: number[]) => void;
}

/** "A", "B", … for option j (shown beside it; screen readers skip it). */
export const letter = (j: number) => String.fromCharCode(65 + j);

/** The options of a multiple-choice question: radios, or checkboxes capped at N. */
export function ChoiceList({ name, options, answer, chosen, reveal, disabled, onChange }: Props) {
  const multi = answer.length > 1;
  const full = chosen.length >= answer.length;
  const toggle = (j: number) => {
    if (!multi) return onChange([j]);
    onChange(chosen.includes(j) ? chosen.filter((x) => x !== j) : [...chosen, j].sort((a, b) => a - b));
  };
  return (
    <div className="options">
      {multi && (
        <p className="pick-hint muted small">
          Elegí {answer.length} {!reveal && `· ${chosen.length}/${answer.length}`}
        </p>
      )}
      {options.map((o, j) => {
        const picked = chosen.includes(j);
        const mark = reveal ? (answer.includes(j) ? "is-correct" : picked ? "is-wrong" : "") : picked ? "is-selected" : "";
        return (
          <label key={j} className={`option ${mark}`}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              checked={picked}
              disabled={disabled || reveal || (multi && full && !picked)}
              onChange={() => toggle(j)}
            />
            <span className="opt-letter" aria-hidden>
              {letter(j)}
            </span>
            <span>{o}</span>
          </label>
        );
      })}
    </div>
  );
}

/** "Correcta." / "Incorrecta." / "Sin responder." for a graded question. */
export function verdictLabel(answer: number[], chosen: number[]): string {
  if (!chosen.length) return "Sin responder.";
  return isRight(answer, chosen) ? "Correcta." : "Incorrecta.";
}
