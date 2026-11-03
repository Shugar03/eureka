// AC-120: reading what the agent proposes for an exam preparation. The same
// checks the backend makes (tools.rs `check_exam`), so a bad one never
// becomes a card. No DOM, no IPC.
import type { ExamKind, ExamProposal } from "../types";

const safeJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const isoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

export function parseExamProposal(raw: string): ExamProposal | null {
  const a = safeJson<Record<string, unknown>>(raw);
  if (!a || typeof a.name !== "string") return null;
  const name = a.name.trim();
  if (!name || name.length > 120) return null;
  const kind = (a.kind ?? "certification") as ExamKind;
  if (kind !== "certification" && kind !== "subject") return null;
  const date = typeof a.exam_date === "string" && a.exam_date.trim() ? a.exam_date.trim() : null;
  if (date && !isoDate(date)) return null;
  const num = (v: unknown, lo: number, hi: number): number | null | undefined => {
    if (v === undefined || v === null) return null;
    return typeof v === "number" && v >= lo && v <= hi ? v : undefined;
  };
  const hours = num(a.hours_per_week, 0.5, 80);
  const pct = num(a.passing_pct, 1, 100);
  if (hours === undefined || pct === undefined) return null;
  const guide = typeof a.guide === "string" && a.guide.trim() ? a.guide.trim() : null;
  return { name, kind, exam_date: date, hours_per_week: hours, passing_pct: pct, guide };
}

/** "15 de diciembre de 2026" for a YYYY-MM-DD date, without time zones. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

/** The same exam, by name, ignoring case and accents: the card says "ya la tenés" instead of making a copy. */
export const sameName = (a: string, b: string) => {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
};
