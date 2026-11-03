// AC-82..88: the pure parts of Acompañamiento — labels, the breathing cycle,
// the grounding steps and small formatters.

export const MOODS: { value: number; label: string }[] = [
  { value: 1, label: "Muy mal" },
  { value: 2, label: "Mal" },
  { value: 3, label: "Más o menos" },
  { value: 4, label: "Bien" },
  { value: 5, label: "Muy bien" },
];

export const moodLabel = (m: number | null | undefined) => MOODS.find((x) => x.value === m)?.label ?? "";

export const EMOTIONS = ["cansancio", "ansiedad", "tristeza", "enojo", "estrés", "soledad", "confusión", "calma", "alivio", "alegría", "orgullo", "motivación"];

/** Ways to start talking, for when the empty box is the hard part. */
export const STARTERS = ["Estoy abrumado con todo lo que tengo que estudiar", "Hoy tuve un buen día y quiero contarlo", "No sé bien cómo me siento"];

export interface BreathStep {
  label: string;
  seconds: number;
}

/** Inhale 4, hold 4, exhale 6: a slow, longer exhale. */
export const BREATH: BreathStep[] = [
  { label: "Inhalá", seconds: 4 },
  { label: "Sostené", seconds: 4 },
  { label: "Exhalá", seconds: 6 },
];

export const BREATH_CYCLE = BREATH.reduce((n, s) => n + s.seconds, 0);

/** Where the breath is after `elapsed` seconds: the step, the seconds left in it, and the cycle count. */
export function breathAt(elapsed: number): { step: BreathStep; left: number; cycle: number; index: number } {
  const t = Math.max(0, Math.floor(elapsed));
  let into = t % BREATH_CYCLE;
  for (let index = 0; index < BREATH.length; index++) {
    const step = BREATH[index];
    if (into < step.seconds) return { step, left: step.seconds - into, cycle: Math.floor(t / BREATH_CYCLE) + 1, index };
    into -= step.seconds;
  }
  return { step: BREATH[0], left: BREATH[0].seconds, cycle: 1, index: 0 };
}

export const GROUNDING = [
  { n: 5, text: "cosas que podés ver", hint: "Mirá a tu alrededor y nombralas, aunque sean chicas." },
  { n: 4, text: "cosas que podés tocar", hint: "La ropa, la mesa, tus manos. Sentí la textura." },
  { n: 3, text: "cosas que podés oír", hint: "Cerca o lejos. Quedate un momento escuchando." },
  { n: 2, text: "cosas que podés oler", hint: "Si no huelen a nada, imaginá un olor que te guste." },
  { n: 1, text: "cosa que podés saborear", hint: "O pensá en algo rico. Después, una respiración lenta." },
];

/** "cansancio, alivio" → ["cansancio", "alivio"] (trimmed, no empties, no repeats). */
export function splitList(s: string): string[] {
  return [...new Set(s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  const s = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  // "Martes, 20 de octubre": only the first letter up.
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** AC-94: a wheel of feelings, from a big family to the word that fits. Spanish, plain, no jargon. */
export const WHEEL: { core: string; words: string[] }[] = [
  { core: "Alegría", words: ["contento", "entusiasmado", "orgulloso", "agradecido", "esperanzado", "motivado"] },
  { core: "Calma", words: ["tranquilo", "aliviado", "en paz", "relajado", "satisfecho", "a gusto"] },
  { core: "Tristeza", words: ["desanimado", "solo", "decepcionado", "vacío", "nostálgico", "herido"] },
  { core: "Enojo", words: ["frustrado", "irritado", "resentido", "molesto", "impotente", "indignado"] },
  { core: "Miedo", words: ["ansioso", "preocupado", "inseguro", "nervioso", "asustado", "bloqueado"] },
  { core: "Agobio", words: ["cansado", "estresado", "desbordado", "sin energía", "presionado", "confundido"] },
];

/** The record's steps, in order: each one is a question for the person. */
export const THOUGHT_STEPS = [
  { id: "situation", title: "¿Qué pasó?", hint: "Solo los hechos, como si los viera una cámara: dónde, cuándo, con quién." },
  { id: "thought", title: "¿Qué pensaste?", hint: "La frase que te pasó por la cabeza, tal cual. Por ejemplo: «voy a desaprobar todo»." },
  { id: "feeling", title: "¿Cuánto te pegó?", hint: "Elegí la emoción y qué tan fuerte la sentiste, de 0 a 100." },
  { id: "evidence", title: "Mirándolo con calma", hint: "¿Qué hay a favor de ese pensamiento? ¿Y qué no encaja con él?" },
  { id: "alternative", title: "Otra mirada", hint: "Una forma más amable y realista de verlo. Puede ser corta." },
] as const;
