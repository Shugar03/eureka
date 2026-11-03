// AC-148: what "Escuchar" reads for a class, a deck or a cheat sheet — plain
// text with pauses (sentences and ellipses), for the system voice. Free and
// on this PC: nothing is sent anywhere.
import type { Card, ClassNotes } from "../types";

/** "1 h 05 min", "12 min", "45 s". */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** The class notes as something to listen to: the key ideas first, then the notes, then the doubts. */
export function classScript(title: string, n: ClassNotes): string {
  const parts = [`Repaso de ${title}.`];
  if (n.key_points.length) parts.push(`Las ideas clave. ${n.key_points.map((k, i) => `${i + 1}. ${k}`).join(" … ")}`);
  parts.push(`Los apuntes. ${n.summary}`);
  if (n.questions.length) parts.push(`Para repasar. ${n.questions.join(" … ")}`);
  return parts.join("\n\n");
}

/**
 * A deck as an audio quiz: each question, a pause to answer in your head,
 * then the answer. At most `limit` cards (due ones first, then the rest).
 */
export function deckScript(name: string, cards: Pick<Card, "front" | "back">[], limit = 20): string {
  const list = cards.slice(0, limit);
  if (!list.length) return "";
  const body = list.map((c, i) => `Tarjeta ${i + 1}. ${c.front} … … … Respuesta: ${c.back}`).join("\n\n");
  return `Repaso de ${name}: ${list.length} ${list.length === 1 ? "tarjeta" : "tarjetas"}. Después de cada pregunta hay una pausa para que respondas en tu cabeza.\n\n${body}`;
}

/** A segment of the class recording: under the local Whisper limit (60 s). */
export const SEGMENT_MS = 50_000;
/** Tests shorten the segments with `window.__eurekaSegmentMs`. */
export const segmentMs = () => (globalThis as { __eurekaSegmentMs?: number }).__eurekaSegmentMs ?? SEGMENT_MS;

/** Silence or a cough is not an error worth stopping the class for. */
export const quietPart = (message: string) => /muy corta|no se entendió/i.test(message);
