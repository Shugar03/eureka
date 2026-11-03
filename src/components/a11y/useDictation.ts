import { useRef, useState } from "react";
import { errorText, languageApi } from "../../api";
import { useAccessibility } from "./AccessibilityContext";
import { recordingForTranscription } from "../../lib/audio";

const SETUP_HINT = "Para hablar, elegí la Voz en Ajustes → Avanzado («En esta PC» funciona sin internet). Mientras tanto, Win + H dicta en Windows.";

/** Record with the microphone and hand the transcription to `onText` (Voz model). */
export function useDictation(onText: (text: string) => void) {
  const { speechReady } = useAccessibility();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
          const audio = await recordingForTranscription(blob);
          onText(await languageApi.transcribe(audio.bytes, audio.mime, "español"));
        } catch (e) {
          setError(errorText(e));
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setState("recording");
    } catch {
      setError("No pude usar el micrófono. Dale permiso en Windows y probá de nuevo.");
    }
  };

  const toggle = () => {
    if (!speechReady) return setHint((h) => !h);
    if (state === "recording") rec.current?.stop();
    else if (state === "idle") void start();
  };

  return {
    state,
    ready: speechReady,
    toggle,
    isError: !!error,
    message: error ?? (hint && !speechReady ? SETUP_HINT : state === "recording" ? "Grabando… tocá de nuevo para terminar." : null),
  };
}
