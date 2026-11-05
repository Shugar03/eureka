import { useSyncExternalStore } from "react";
import { ocrJobs, progressText, type OcrJob } from "../lib/ocr";

export const useOcrJobs = () => useSyncExternalStore(ocrJobs.subscribe, ocrJobs.list);

/** AC-187: the scanned PDFs being read in the background, each cancelable. */
export function OcrProgress({ onDone }: { onDone?: (job: OcrJob) => void }) {
  const jobs = useOcrJobs();
  if (!jobs.length) return null;
  return (
    <div className="ocr-jobs">
      {jobs.map((j) => (
        <div key={j.key} className="ocr-job" role="status" aria-label={`Lectura de «${j.title}»`}>
          {j.state === "running" ? (
            <>
              <span className="small">
                <strong>{j.title}</strong> · {j.progress ? progressText(j.progress.index, j.progress.total, j.progress.secondsLeft) : "Preparando la lectura…"}
              </span>
              <progress max={j.progress?.total ?? 1} value={j.progress ? j.progress.index - 1 : 0} aria-label="Progreso de la lectura" />
              <button type="button" className="btn ghost small" onClick={() => ocrJobs.cancel(j.key)}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <span className={`small ${j.state === "error" ? "error-text" : ""}`}>
                <strong>{j.title}</strong> ·{" "}
                {j.state === "done" ? "terminé de leerlo con OCR." : j.state === "canceled" ? "lectura pausada: agregá el mismo PDF otra vez para seguir donde quedó." : `no pude terminar de leerlo: ${j.error}`}
              </span>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  onDone?.(j);
                  ocrJobs.dismiss(j.key);
                }}
              >
                Listo
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
