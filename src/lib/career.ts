// AC-155…157: what the malla screen shows — labels, years, grades.
import type { CareerProposal, CareerStatus, CareerSubjectView } from "../types";

export const STATUS_LABEL: Record<CareerStatus, string> = {
  pendiente: "Por cursar",
  cursando: "Cursando",
  regular: "Regular",
  aprobada: "Aprobada",
};

export const STATUSES: CareerStatus[] = ["pendiente", "cursando", "regular", "aprobada"];

const ORDINAL = ["Primer", "Segundo", "Tercer", "Cuarto", "Quinto", "Sexto", "Séptimo", "Octavo"];
export const yearLabel = (y: number) => `${ORDINAL[y - 1] ?? `${y}.º`} año`;

/** 8 → "8", 7.5 → "7,5", 7.25 → "7,25". */
export const gradeText = (g: number) => `${Math.round(g * 100) / 100}`.replace(".", ",");

/** "2, 3,5 4" → [2, 3.5, 4]; anything that is not a grade is an error. */
export function parseGrades(text: string): number[] {
  const parts = text
    .split(/[\s;]+|,(?=\s)|,$/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => {
    const n = Number(p.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 10) throw `«${p}» no es una nota de 0 a 10.`;
    return n;
  });
}

/** Subjects by year of the plan, in order (each year by cuatrimestre). */
export function byYear<T extends { year: number; term?: number | null }>(subjects: T[]): [number, T[]][] {
  const years = [...new Set(subjects.map((s) => s.year))].sort((a, b) => a - b);
  return years.map((y) => [y, subjects.filter((s) => s.year === y).sort((a, b) => (a.term ?? 0) - (b.term ?? 0))]);
}

/** What the row says next to the status: the next step, or what blocks it. */
export function nextStep(s: CareerSubjectView): string | null {
  if (s.status === "aprobada") return null;
  if (s.can_sit_final) return "Podés rendir el final";
  if (s.can_take) return s.in_cursada ? "La estás cursando (está en tu cursada)" : "Podés cursarla";
  if (s.missing.length) return `${s.status === "pendiente" ? "Para cursarla te falta regularizar" : "Para rendir te falta aprobar"}: ${s.missing.join(", ")}`;
  return null;
}

/** Percentage passed, for the progress bar. */
export const progressPct = (approved: number, total: number) => (total ? Math.round((approved / total) * 100) : 0);

/** How big a proposal is, for its preview. */
export const proposalCount = (p: CareerProposal) => ({ subjects: p.subjects.length, years: new Set(p.subjects.map((s) => s.year)).size });
