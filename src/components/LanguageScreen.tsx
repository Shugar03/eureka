import { useEffect, useRef, useState } from "react";
import { errorText, languageApi } from "../api";
import type { Listening } from "../types";
import { improvedText, LANGUAGES, LEVELS, seconds, speakingTask } from "../lib/language";
import { useSpeech } from "../lib/speech";
import { isRight, pct } from "../lib/exam";
import { ChoiceList, verdictLabel } from "./exam/ChoiceList";
import { Markdown } from "./Markdown";
import { useStudyContext } from "./pomodoro/PomodoroContext";
import { recordingForTranscription } from "../lib/audio";

/** AC-65: listening and speaking practice for language exams. */
export function LanguageScreen() {
  const [tab, setTab] = useState<"listening" | "speaking">("listening");
  const [language, setLanguage] = useState("inglés");
  const [level, setLevel] = useState("B2");
  const code = LANGUAGES.find((l) => l.id === language)!.code;
  useStudyContext({ kind: "language", id: language, title: `Idioma: ${LANGUAGES.find((l) => l.id === language)!.label}` });

  return (
    <div className="practice-screen">
      <header className="chat-head">
        <h1 className="chat-title">Idiomas</h1>
      </header>
      <div className="practice-body">
        <div className="row-between">
          <div className="tabs" role="radiogroup" aria-label="Práctica">
            <button role="radio" aria-checked={tab === "listening"} className={tab === "listening" ? "is-active" : ""} onClick={() => setTab("listening")}>
              Listening
            </button>
            <button role="radio" aria-checked={tab === "speaking"} className={tab === "speaking" ? "is-active" : ""} onClick={() => setTab("speaking")}>
              Speaking
            </button>
          </div>
          <span className="row">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Idioma">
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nivel">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </span>
        </div>
        {tab === "listening" ? <ListeningPanel language={language} level={level} code={code} /> : <SpeakingPanel language={language} level={level} code={code} />}
      </div>
    </div>
  );
}

function ListeningPanel({ language, level, code }: { language: string; level: string; code: string }) {
  const [topic, setTopic] = useState("");
  const [item, setItem] = useState<Listening | null>(null);
  const [answers, setAnswers] = useState<number[][]>([]);
  const [graded, setGraded] = useState(false);
  const [rate, setRate] = useState(1);
  const [plays, setPlays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tts = useSpeech(code);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const l = await languageApi.listening(language, level, topic);
      setItem(l);
      setAnswers(l.questions.map(() => []));
      setGraded(false);
      setPlays(0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const play = () => {
    if (!item) return;
    if (tts.speaking) return tts.stop();
    setPlays((n) => n + 1);
    tts.speak(item.transcript, rate);
  };

  const right = item ? item.questions.filter((q, i) => isRight(q.answer, answers[i] ?? [])).length : 0;
  return (
    <>
      <section className="card" aria-label="Nuevo listening">
        <h2>Listening</h2>
        <p className="muted small">Un audio de tu nivel con preguntas, como en IELTS, TOEFL o Cambridge. Se lee con las voces del sistema; el texto aparece recién al corregir.</p>
        <div className="row">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Tema (opcional): un viaje, una entrevista de trabajo…" aria-label="Tema del listening" />
          <button className="btn" disabled={busy} onClick={generate}>
            {busy ? "Escribiendo…" : "Nuevo listening"}
          </button>
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {item && (
        <>
          <section className="card" aria-label="Audio">
            <div className="row-between">
              <h2>{item.title}</h2>
              <span className="muted small" data-testid="plays">
                {plays ? `Escuchado ${plays} ${plays === 1 ? "vez" : "veces"}` : "Sin escuchar"}
              </span>
            </div>
            {!tts.available && <p className="error-text">Este equipo no tiene voces para leer en voz alta.</p>}
            <div className="row">
              <button className="btn primary" disabled={!tts.available} onClick={play}>
                {tts.speaking ? "Detener" : plays ? "Escuchar de nuevo" : "Escuchar"}
              </button>
              <div className="tabs" role="radiogroup" aria-label="Velocidad">
                {[0.8, 1, 1.15].map((r) => (
                  <button key={r} role="radio" aria-checked={rate === r} className={rate === r ? "is-active" : ""} onClick={() => setRate(r)}>
                    {r === 1 ? "Normal" : r < 1 ? "Lenta" : "Rápida"}
                  </button>
                ))}
              </div>
            </div>
          </section>
          {item.questions.map((q, i) => (
            <fieldset key={q.id} className="card mock-q" aria-label={`Pregunta ${i + 1}`}>
              <legend className="muted small">
                Pregunta {i + 1} de {item.questions.length}
              </legend>
              <Markdown text={q.stem} />
              <ChoiceList name={`l-${q.id}`} options={q.options} answer={q.answer} chosen={answers[i] ?? []} reveal={graded} disabled={false} onChange={(c) => setAnswers((a) => a.map((x, k) => (k === i ? c : x)))} />
              {graded && (
                <div className="explanation">
                  <strong>{verdictLabel(q.answer, answers[i] ?? [])}</strong> <Markdown text={q.explanation} />
                </div>
              )}
            </fieldset>
          ))}
          {graded ? (
            <section className="card" aria-label="Resultado del listening">
              <div className="row-between">
                <h2>Resultado</h2>
                <span className="readiness-value" data-testid="listening-score">
                  {right}/{item.questions.length} · {pct(right / item.questions.length)}
                </span>
              </div>
              <details open>
                <summary>Transcripción</summary>
                <div className="transcript-text">
                  <Markdown text={item.transcript} />
                </div>
              </details>
            </section>
          ) : (
            <div className="row-end">
              <button className="btn primary" onClick={() => setGraded(true)}>
                Corregir
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function SpeakingPanel({ language, level, code }: { language: string; level: string; code: string }) {
  const [n, setN] = useState(0);
  const [task, setTask] = useState(() => speakingTask(level, 0));
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [secs, setSecs] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<"transcribe" | "feedback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const tts = useSpeech(code);

  useEffect(() => setTask(speakingTask(level, n)), [level, n]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => clearInterval(t);
  }, [recording]);

  const transcribe = async (blob: Blob, duration: number) => {
    setBusy("transcribe");
    setError(null);
    try {
      const rec = await recordingForTranscription(blob);
      setTranscript(await languageApi.transcribe(rec.bytes, rec.mime, language));
      setSecs(duration);
      setFeedback(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        transcribe(new Blob(chunks, { type: r.mimeType || "audio/webm" }), (Date.now() - started.current) / 1000);
      };
      rec.current = r;
      started.current = Date.now();
      setElapsed(0);
      r.start();
      setRecording(true);
    } catch {
      setError("No pude usar el micrófono. Dale permiso o subí un audio grabado.");
    }
  };

  const stop = () => {
    rec.current?.stop();
    setRecording(false);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const duration = await new Promise<number>((res) => {
      const a = new Audio(URL.createObjectURL(file));
      a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => res(0);
    });
    transcribe(file, duration);
  };

  const correct = async () => {
    setBusy("feedback");
    setError(null);
    try {
      setFeedback(await languageApi.speakingFeedback({ language, level, task, transcript, seconds: secs }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const better = feedback ? improvedText(feedback) : "";
  return (
    <>
      <section className="card" aria-label="Consigna de speaking">
        <div className="row-between">
          <h2>Speaking · {level}</h2>
          <button className="btn ghost small" onClick={() => setN((x) => x + 1)}>
            Otra consigna
          </button>
        </div>
        <p className="speaking-task" data-testid="speaking-task">
          {task}
        </p>
        <p className="muted small">Hablá 1 o 2 minutos, como en el examen. Se transcribe con tu modelo de voz (Ajustes → Voz) y el profesor corrige gramática, vocabulario y fluidez. La pronunciación se infiere de lo que la transcripción entendió.</p>
        <div className="row">
          {recording ? (
            <button className="btn danger" onClick={stop}>
              Detener · {seconds(elapsed)}
            </button>
          ) : (
            <button className="btn primary" disabled={!!busy} onClick={start}>
              Grabar respuesta
            </button>
          )}
          <label className="btn ghost small file-pick">
            Subir un audio
            <input
              type="file"
              accept="audio/*"
              aria-label="Subir audio de mi respuesta"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {busy === "transcribe" && <span className="muted small">Transcribiendo…</span>}
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {transcript && (
        <section className="card" aria-label="Lo que dijiste">
          <h2>Lo que dijiste</h2>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} aria-label="Transcripción de tu respuesta" />
          <div className="row-end">
            <span className="muted small">
              {secs ? `${seconds(secs)} · ${Math.round((transcript.split(/\s+/).filter(Boolean).length * 60) / Math.max(1, secs))} palabras por minuto` : ""}
            </span>
            <button className="btn primary" disabled={!!busy} onClick={correct}>
              {busy === "feedback" ? "Corrigiendo…" : "Corregir"}
            </button>
          </div>
        </section>
      )}
      {feedback && (
        <section className="card" aria-label="Devolución de speaking">
          <div className="ask-assistant" data-testid="speaking-feedback">
            <Markdown text={feedback} />
          </div>
          {better && (
            <div className="row">
              <button className="btn small" disabled={!tts.available} onClick={() => (tts.speaking ? tts.stop() : tts.speak(better, 0.95))}>
                {tts.speaking ? "Detener" : "Escuchar la versión mejorada"}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
