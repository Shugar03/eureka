// AC-60/152/154: any deck file that comes from outside — Anki's plain text,
// Anki's own package (.apkg) or a deck someone shared (.eureka) — becomes the
// same preview: a name, the cards, and what was left out and why.
import { cardsApi } from "../api";
import { parseAnkiText } from "./anki";

export interface PendingImport {
  name: string;
  cards: [string, string][];
  /** What was left out, in words; null when nothing. */
  leftOut: string | null;
  /** Where it came from, for the preview's title. */
  origin: "anki" | "shared";
}

export const DECK_FILES = ".apkg,.eureka,.txt,.csv,.tsv,text/plain";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The reasons notes were left out, in one sentence (null when none). */
export function leftOutText(parts: { media?: number; empty?: number; skipped?: number }): string | null {
  const out: string[] = [];
  if (parts.media) out.push(`${plural(parts.media, "nota tenía", "notas tenían")} solo imagen o sonido (no se importan)`);
  if (parts.empty) out.push(`${plural(parts.empty, "estaba vacía o sin dorso", "estaban vacías o sin dorso")}`);
  if (parts.skipped) out.push(`${plural(parts.skipped, "tarjeta no se pudo usar", "tarjetas no se pudieron usar")} (vacía o demasiado larga)`);
  return out.length ? `Quedaron afuera: ${out.join("; ")}.` : null;
}

export const fileStem = (name: string) => name.replace(/\.[^.]+$/, "");

export async function readDeckFile(file: File): Promise<PendingImport> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "apkg") {
    const p = await cardsApi.readApkg(new Uint8Array(await file.arrayBuffer()));
    if (!p.cards.length) throw p.media_only ? "Ese mazo de Anki solo tiene imágenes o sonidos: Eureka todavía no los importa." : "No encontré tarjetas en ese mazo de Anki.";
    return {
      name: fileStem(file.name),
      cards: p.cards,
      leftOut: leftOutText({ media: p.media_only, empty: p.empty }),
      origin: "anki",
    };
  }
  if (ext === "eureka") {
    const d = await cardsApi.readShared(new Uint8Array(await file.arrayBuffer()));
    return {
      name: d.name,
      cards: d.cards,
      leftOut: leftOutText({ skipped: d.skipped }),
      origin: "shared",
    };
  }
  const { cards, skipped } = parseAnkiText(await file.text());
  if (!cards.length) throw "No encontré tarjetas: en Anki usá Archivo → Exportar → «Paquete de mazos de Anki (.apkg)» o «Notas en texto plano».";
  return {
    name: fileStem(file.name),
    cards,
    leftOut: leftOutText({ empty: skipped }),
    origin: "anki",
  };
}
