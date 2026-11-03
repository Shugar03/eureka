// The "Voz" role turns audio into text, so it needs a transcription model.
// A text model there fails the first time someone dictates, so say it up front.

const TRANSCRIPTION = /whisper|transcri|speech|stt|asr|voxtral|parakeet|scribe|audio/i;

export const looksLikeTranscription = (model: string) => TRANSCRIPTION.test(model);

/** A warning for a model that doesn't look like a transcription one; null when it is fine (or empty). */
export function speechModelWarning(model: string, providerId: string): string | null {
  const m = model.trim();
  if (!m || providerId === "local" || looksLikeTranscription(m)) return null;
  const base = `«${m}» parece un modelo de texto. Para dictar y para el speaking hace falta uno de transcripción, por ejemplo whisper-1 (OpenAI) o whisper-large-v3 (Groq), o elegí «En esta PC» para usar Whisper sin internet.`;
  return providerId === "opencode-go" ? `${base} OpenCode Go no lista modelos de transcripción: dejá este rol vacío o usá otro proveedor solo para la voz.` : base;
}
