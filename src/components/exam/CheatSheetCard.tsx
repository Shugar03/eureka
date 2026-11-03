import { useRef, useState } from "react";
import { api, errorText } from "../../api";
import type { Exam } from "../../types";
import { Markdown } from "../Markdown";
import { saveFile } from "../../lib/saveFile";

interface Props {
  exam: Exam;
  onChanged: (e: Exam) => void;
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/** AC-44: the final review sheet, to read, download or print. */
export function CheatSheetCard({ exam, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const sheet = exam.cheat_sheet;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.createCheatSheet(exam.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!sheet) return;
    saveFile(`hoja-de-repaso-${slug(exam.name)}.md`, `# ${exam.name} — hoja de repaso\n\n${sheet.markdown}\n`, "text/markdown").catch(() => {});
  };

  // Prints only the sheet: a throwaway frame with its rendered HTML.
  const print = () => {
    const html = body.current?.innerHTML;
    if (!html) return;
    const frame = Object.assign(document.createElement("iframe"), { title: "Hoja de repaso para imprimir" });
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(
      `<!doctype html><meta charset="utf-8"><title>${exam.name}</title><style>body{font:12px/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px}h2{font-size:15px;margin:16px 0 4px;border-bottom:1px solid #ccc}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}</style><h1>${exam.name} — hoja de repaso</h1>${html}`,
    );
    doc.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };

  return (
    <section className="card" aria-label="Hoja de repaso">
      <div className="row-between">
        <div>
          <h2>Hoja de repaso</h2>
          <p className="muted small">Un resumen de una o dos páginas para el día antes: lo esencial de cada dominio, lo que venís fallando y las trampas típicas.</p>
        </div>
        <button className="btn" disabled={busy} onClick={generate}>
          {busy ? "Escribiendo…" : sheet ? "Regenerar" : "Generar hoja"}
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {sheet && (
        <>
          <div className="cheat-sheet" ref={body} data-testid="cheat-sheet">
            <Markdown text={sheet.markdown} />
          </div>
          <div className="row-end">
            <span className="muted small">Generada el {new Date(sheet.at).toLocaleDateString()}</span>
            <button className="btn ghost small" onClick={download}>
              Descargar .md
            </button>
            <button className="btn ghost small" onClick={print}>
              Imprimir o PDF
            </button>
          </div>
        </>
      )}
    </section>
  );
}
