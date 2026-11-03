import { useRef, useState } from "react";
import { errorText, languageApi } from "../../api";
import { useAccessibility } from "./AccessibilityContext";
import { recordingForTranscription } from "../../lib/audio";

/**
 * AC-76: "Dictar" records the learner and hands the transcription to
 * `onText`. Uses the Voz model; without one the button says where to set it.
 */
export function Dictate({ onText }: { onText: (text: string) => void }) {
  const { a, speechReady } = useAccessibility();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  if (!a.dictation) return null;

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

  return (
    <span className="dictate">
      <button
        type="button"
        className={`btn small ${state === "recording" ? "is-recording" : ""}`}
        disabled={!speechReady || state === "transcribing"}
        title={speechReady ? undefined : "Configurá un modelo en Ajustes → Avanzado → Voz para dictar."}
        aria-pressed={state === "recording"}
        onClick={() => (state === "recording" ? rec.current?.stop() : start())}
      >
        {state === "recording" ? "Terminar de dictar" : state === "transcribing" ? "Transcribiendo…" : "Dictar"}
      </button>
      {!speechReady && <span className="muted small">Para dictar, elegí un modelo de Voz en Ajustes.</span>}
      {error && (
        <span className="error-text small" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
