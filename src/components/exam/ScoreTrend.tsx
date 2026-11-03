import { useState } from "react";
import type { ScorePoint } from "../../lib/exam";

interface Props {
  points: ScorePoint[];
  /** Passing mark in percent, drawn as a reference line. */
  passing: number | null;
}

const W = 560;
const H = 180;
const M = { top: 14, right: 16, bottom: 26, left: 40 };
const TICKS = [0, 25, 50, 75, 100];

/** AC-42: one series (percent correct per mock) against the passing mark. */
export function ScoreTrend({ points, passing }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (pct: number) => M.top + ih - (pct / 100) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const shown = hover == null ? null : points[hover];
  const summary = `Evolución de ${points.length} simulacros: el último ${Math.round(last.pct)}%${passing != null ? `, aprobación ${passing}%` : ""}.`;

  return (
    <figure className="trend" aria-label="Evolución de tus simulacros">
      <div className="trend-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          {TICKS.map((t) => (
            <g key={t}>
              <line className="trend-grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="trend-tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {passing != null && (
            <g>
              <line className="trend-goal" x1={M.left} x2={W - M.right} y1={y(passing)} y2={y(passing)} />
              {/* Left end: the latest points (and their label) sit on the right. */}
              <text className="trend-goal-label" x={M.left + 6} y={y(passing) - 6} textAnchor="start">
                Aprobación {passing}%
              </text>
            </g>
          )}
          {points.length > 1 && <path className="trend-line" d={path} />}
          {points.map((p, i) => (
            <g key={p.n}>
              <circle className="trend-dot" cx={x(i)} cy={y(p.pct)} r={hover === i ? 5.5 : 4} />
              <text className="trend-tick" x={x(i)} y={H - 8} textAnchor="middle">
                {p.n}
              </text>
              <circle
                className="trend-hit"
                cx={x(i)}
                cy={y(p.pct)}
                r={14}
                tabIndex={0}
                aria-label={`Simulacro ${p.n}: ${Math.round(p.pct)}%`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
          <text className="trend-end" x={x(points.length - 1)} y={y(last.pct) - 10} textAnchor="middle">
            {Math.round(last.pct)}%
          </text>
        </svg>
        {shown && hover != null && (
          <div className="trend-tip" role="tooltip" style={{ left: `${(100 * x(hover)) / W}%`, top: `${(100 * y(shown.pct)) / H}%` }}>
            <strong>Simulacro {shown.n}</strong>
            <span>{Math.round(shown.pct)}% correctas</span>
            {passing != null && <span className="muted">{shown.pct >= passing ? "aprobado" : `${Math.round(passing - shown.pct)} puntos abajo`}</span>}
          </div>
        )}
      </div>
      <details className="trend-table">
        <summary>Ver como tabla</summary>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Simulacro</th>
              <th>% correctas</th>
              {passing != null && <th>¿Aprobado?</th>}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.n}>
                <td>{p.n}</td>
                <td>{Math.round(p.pct)}%</td>
                {passing != null && <td>{p.pct >= passing ? "Sí" : "No"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
