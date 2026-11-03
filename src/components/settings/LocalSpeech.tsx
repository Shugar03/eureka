import { useEffect, useState } from "react";
import { errorText, localSpeechApi } from "../../api";
import type { LocalSpeechModel } from "../../types";

export const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * AC-106: the Voz role on this PC. The model is downloaded once (size shown first),
 * then dictation and speaking work without internet or an API key.
 */
export function LocalSpeech({ model, onModel, onChanged }: { model: string; onModel: (id: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<LocalSpeechModel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localSpeechApi.status().then(setList).catch((e) => setError(errorText(e)));
  }, []);

  const download = async (id: string) => {
    setBusy(id);
    setError(null);
    setProgress(null);
    try {
      setList(await localSpeechApi.download(id, setProgress));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const remove = async (id: string) => {
    try {
      setList(await localSpeechApi.remove(id));
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const chosen = list.find((m) => m.id === model);
  return (
    <div className="local-speech">
      <select aria-label="Modelo de voz local" value={model} onChange={(e) => onModel(e.target.value)}>
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {mb(m.bytes)}
            {m.installed ? " · descargado" : ""}
          </option>
        ))}
      </select>
      {chosen && !chosen.installed && (
        <button type="button" className="btn small primary" disabled={!!busy} onClick={() => download(chosen.id)}>
          {busy === chosen.id ? "Descargando…" : `Descargar (${mb(chosen.bytes)})`}
        </button>
      )}
      {chosen?.installed && (
        <button type="button" className="btn small ghost" onClick={() => remove(chosen.id)}>
          Borrar modelo
        </button>
      )}
      {busy && progress && (
        <progress className="local-speech-bar" max={progress.total} value={progress.done} aria-label="Descarga del modelo de voz">
          {mb(progress.done)}
        </progress>
      )}
      <p className="muted small local-speech-note">
        Whisper corre en tu PC: después de descargarlo no usa internet ni API key. El primer dictado tarda unos segundos en cargar el modelo. «Rápido» va bien para dictar; «Mejor» entiende más en español. Guardá los ajustes para usarlo.
      </p>
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
