import type { Phase } from "../types";
import { PHASES } from "../lib/transcript";

export function PhaseBar({ phase }: { phase: Phase }) {
  const current = PHASES.findIndex((p) => p.id === phase);
  return (
    <ol className="phases" aria-label="Fases">
      {PHASES.map((p, i) => (
        <li
          key={p.id}
          className={i < current ? "is-past" : i === current ? "is-current" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          <span className="phase-dot">{i < current ? "✓" : i + 1}</span>
          {p.label}
        </li>
      ))}
    </ol>
  );
}
