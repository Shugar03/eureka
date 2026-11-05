import { useId, useRef, useState } from "react";
import { errorText, libraryApi, ocrApi, visionApi } from "../../api";
import { textToMarkdown } from "../../lib/bookText";
import { imageRgba, imageToDataUrl } from "../../lib/images";
import { photoText } from "../../lib/ocr";
import { addPdf } from "../../lib/scanned";
import { OcrProgress } from "../OcrProgress";
import { isDocument, isPhoto, titleOf, type Attachment } from "../../lib/attachments";
import { useDictation } from "../a11y/useDictation";
import { Icon } from "../Icon";
import { systemDictation } from "../../lib/platform";

/** AC-105: what the "+" of the chat holds until the message is sent. */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** AC-187: a long scanned PDF waits for an OK after its estimate. */
  const [ask, setAsk] = useState<{ text: string; answer: (yes: boolean) => void } | null>(null);

  const addOne = async (file: File): Promise<Attachment> => {
    if (isPhoto(file)) {
      setWorking(`Leyendo ${file.name}…`);
      // AC-188: printed text is read on this PC; the vision model only when the OCR
      // isn't sure (handwriting, diagrams, a blurry photo) or can't run here.
      const { text, via } = await photoText({
        available: () => ocrApi.available(),
        ocr: async () => {
          const img = await imageRgba(file);
          return ocrApi.page(img.width, img.height, img.data);
        },
        vision: async () => visionApi.read([await imageToDataUrl(file)], "notes"),
      });
      return { id: `${file.name}-${Date.now()}`, kind: "image", label: file.name, detail: via === "ocr" ? "texto leído en esta PC" : "texto leído de la imagen", text };
    }
    if (!isDocument(file)) throw `${file.name}: por ahora acepto PDF, texto, Markdown o fotos (PNG, JPG, WEBP).`;
    setWorking(`Guardando ${file.name} en tu biblioteca…`);
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const added = await addPdf(file, titleOf(file.name), {
        onStatus: setWorking,
        confirm: (_pages, text) =>
          new Promise<boolean>((answer) =>
            setAsk({
              text,
              answer: (yes) => {
                setAsk(null);
                answer(yes);
              },
            }),
          ),
      });
      return { id: added.book.id, kind: "book", label: added.book.title, detail: added.ocr === "started" ? "en tu biblioteca · leyendo con OCR" : "en tu biblioteca" };
    }
    const markdown = /\.(md|markdown)$/i.test(file.name) ? await file.text() : textToMarkdown(await file.text());
    const saved = await libraryApi.import(titleOf(file.name), file.name, markdown, 0, []);
    return { id: saved.id, kind: "book", label: saved.title, detail: "en tu biblioteca" };
  };

  const add = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setError(null);
    for (const f of [...files].slice(0, 5)) {
      try {
        const a = await addOne(f);
        setItems((xs) => [...xs, a]);
      } catch (e) {
        setError(typeof e === "string" ? e : `No pude leer ${f.name}: ${errorText(e)}`);
      }
    }
    setWorking(null);
  };

  return { items, working, error, ask, add, remove: (id: string) => setItems((xs) => xs.filter((x) => x.id !== id)), clear: () => setItems([]) };
}

export function AttachButton({ onFiles, disabled }: { onFiles: (f: FileList | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Adjuntar archivos" title="Adjuntar: PDF, texto, Markdown o foto de apuntes" disabled={disabled} onClick={() => input.current?.click()}>
        <Icon name="plus" size={18} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="attach-input"
        accept=".pdf,.txt,.md,.markdown,image/png,image/jpeg,image/webp"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function AttachChips({ items, working, error, ask, onRemove }: { items: Attachment[]; working: string | null; error: string | null; ask?: { text: string; answer: (yes: boolean) => void } | null; onRemove: (id: string) => void }) {
  return (
    <>
      <OcrProgress />
      {(items.length > 0 || working || error || ask) && <Chips items={items} working={working} error={error} ask={ask} onRemove={onRemove} />}
    </>
  );
}

function Chips({ items, working, error, ask, onRemove }: { items: Attachment[]; working: string | null; error: string | null; ask?: { text: string; answer: (yes: boolean) => void } | null; onRemove: (id: string) => void }) {
  return (
    <div className="attach-chips">
      {ask && (
        <span className="row ocr-ask" role="group" aria-label="Leer las páginas escaneadas">
          <span className="small">{ask.text}. ¿Las leo con OCR en esta PC?</span>
          <button type="button" className="btn small primary" onClick={() => ask.answer(true)}>
            Leer con OCR
          </button>
          <button type="button" className="btn ghost small" onClick={() => ask.answer(false)}>
            Ahora no
          </button>
        </span>
      )}
      {items.map((a) => (
        <span className="chip attach-chip" key={a.id}>
          <Icon name={a.kind === "book" ? "book" : "image"} size={14} />
          <span>
            <strong>{a.label}</strong> <small>{a.detail}</small>
          </span>
          <button type="button" aria-label={`Quitar ${a.label}`} onClick={() => onRemove(a.id)}>
            ×
          </button>
        </span>
      ))}
      {working && <span className="muted small" role="status">{working}</span>}
      {error && <span className="error-text small" role="alert">{error}</span>}
    </div>
  );
}

const NO_VOICE = `Para hablar hace falta un modelo de Voz (Ajustes → Avanzado → Voz).${systemDictation()}`;

/** A microphone that is always there; without a Voz model it says where to set one up. */
export function MicButton({ onText, label: idleLabel = "Hablar con el micrófono" }: { onText: (text: string) => void; /** What the button is called while idle (a card with two fields needs two names). */ label?: string }) {
  const d = useDictation(onText);
  const hintId = useId();
  const label = d.state === "recording" ? "Terminar de grabar" : d.state === "transcribing" ? "Transcribiendo…" : idleLabel;
  return (
    <>
      <button
        type="button"
        className={`icon-btn ${d.state === "recording" ? "is-recording" : ""}`}
        aria-label={label}
        aria-pressed={d.state === "recording"}
        title={d.ready ? label : NO_VOICE}
        aria-describedby={d.ready ? undefined : hintId}
        disabled={d.state === "transcribing"}
        onClick={d.toggle}
      >
        <Icon name="mic" size={18} />
      </button>
      {!d.ready && !d.message && (
        <span id={hintId} className="sr-only">
          {NO_VOICE}
        </span>
      )}
      {d.message && <span id={d.ready ? undefined : hintId} className={`small ${d.isError ? "error-text" : "muted"}`} role={d.isError ? "alert" : "status"}>{d.message}</span>}
    </>
  );
}
