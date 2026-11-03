import { useEffect, useRef, useState } from "react";
import { classesApi, errorText, languageApi } from "../../api";
import type { ClassRecord } from "../../types";
import { recordingForTranscription } from "../../lib/audio";
import { quietPart, segmentMs } from "../../lib/listen";

type Part = { blob: Blob; seconds: number };

/**
 * AC-146: records a class in parts of under a minute. Each part is
 * transcribed and saved as soon as it is ready, while the next one records,
 * so a long class never waits until the end and a closed app loses at most
 * the part in flight.
 */
export function useClassRecorder(onUpdate: (c: ClassRecord) => void) {
  const [state, setState] = useState<"idle" | "recording" | "finishing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [queued, setQueued] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = useRef<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const live = useRef(false);
  const queue = useRef<Part[]>([]);
  const working = useRef(false);
  const timer = useRef<number | null>(null);
  const update = useRef(onUpdate);
  update.current = onUpdate;

  const drain = async () => {
    if (working.current) return;
    working.current = true;
    while (queue.current.length) {
      const part = queue.current.shift()!;
      setQueued(queue.current.length + 1);
      let text = "";
      try {
        const audio = await recordingForTranscription(part.blob);
        text = await languageApi.transcribe(audio.bytes, audio.mime, "español");
      } catch (e) {
        const m = errorText(e);
        if (!quietPart(m)) setError(m);
      }
      try {
        if (id.current) update.current(await classesApi.append(id.current, text, part.seconds));
      } catch (e) {
        setError(errorText(e));
      }
    }
    setQueued(0);
    working.current = false;
    if (!live.current) {
      setState("idle");
      id.current = null;
    }
  };

  const nextPart = () => {
    const s = stream.current;
    if (!s || !live.current) return;
    const chunks: Blob[] = [];
    const r = new MediaRecorder(s);
    const began = Date.now();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      queue.current.push({ blob: new Blob(chunks, { type: r.mimeType || "audio/webm" }), seconds: Math.round((Date.now() - began) / 1000) });
      if (live.current) nextPart();
      else s.getTracks().forEach((t) => t.stop());
      void drain();
    };
    rec.current = r;
    r.start();
    window.setTimeout(() => r.state === "recording" && r.stop(), segmentMs());
  };

  const start = async (c: ClassRecord) => {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("No pude usar el micrófono. Dale permiso en los ajustes del sistema y probá de nuevo.");
      return false;
    }
    id.current = c.id;
    live.current = true;
    setElapsed(0);
    setState("recording");
    const t0 = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    nextPart();
    return true;
  };

  const stop = () => {
    live.current = false;
    if (timer.current) window.clearInterval(timer.current);
    setState("finishing");
    if (rec.current?.state === "recording") rec.current.stop();
    else void drain();
  };

  // Leaving the screen mid-class: stop the microphone; what was recorded is saved.
  useEffect(
    () => () => {
      live.current = false;
      if (timer.current) window.clearInterval(timer.current);
      if (rec.current?.state === "recording") rec.current.stop();
    },
    [],
  );

  return { state, elapsed, queued, error, start, stop };
}
