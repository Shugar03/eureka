// AC-219..AC-222 in the demo: a shared folder «Apuntes» (no real disk), and the
// plans the app would propose for it.
import type { FolderOp, FolderPlanMeta, SharedFolder } from "../types";

export const DEMO_FOLDER: SharedFolder = { id: "f-demo", path: "C:\\Users\\demo\\Documents\\Facultad\\Apuntes", label: "Apuntes", writable: true, added_at: "2026-11-19T10:00:00Z" };

export const DEMO_TREE = ["tp1 cinematica.pdf", "tp2 dinamica.docx", "resumen analisis.md", "parcial analisis 2025.pdf", "resumen analisis (1).md", "apunte limites.txt"];

export const overviewMeta = (folder: string) => ({ kind: "folder" as const, action: "overview" as const, folder, files: DEMO_TREE.length, dirs: 0 });

const plan = (callId: string, folder: SharedFolder, summary: string, ops: FolderOp[]): FolderPlanMeta => {
  const n = (f: (o: FolderOp) => boolean) => ops.filter(f).length;
  const parts = [
    [n((o) => o.op === "mkdir"), "carpetas nuevas"],
    [n((o) => o.op === "move"), "movidos o renombrados"],
    [n((o) => o.op === "trash"), "a la papelera"],
    [n((o) => o.op === "write" || o.op === "xlsx" || o.op === "docx"), "documentos nuevos"],
  ] as const;
  return { kind: "folder_plan", plan_id: `p${callId}`, folder_id: folder.id, folder: folder.label, summary, counts: parts.filter(([c]) => c > 0).map(([c, l]) => `${c} ${l}`).join(", "), ops, status: "proposed" };
};

/** What organizing «Apuntes» by subject would look like. */
export function organizePlan(callId: string, folder: SharedFolder): FolderPlanMeta {
  return plan(callId, folder, "Una carpeta por materia y los archivos con nombres parejos; el resumen repetido va a la papelera.", [
    { op: "mkdir", path: "Física" },
    { op: "mkdir", path: "Análisis Matemático" },
    { op: "move", from: "tp1 cinematica.pdf", to: "Física/TP 1 - Cinemática.pdf" },
    { op: "move", from: "tp2 dinamica.docx", to: "Física/TP 2 - Dinámica.docx" },
    { op: "move", from: "resumen analisis.md", to: "Análisis Matemático/Resumen.md" },
    { op: "move", from: "parcial analisis 2025.pdf", to: "Análisis Matemático/Parcial 2025.pdf" },
    { op: "move", from: "apunte limites.txt", to: "Análisis Matemático/Apunte - Límites.txt" },
    { op: "trash", path: "resumen analisis (1).md" },
    { op: "write", path: "Índice.md", content: "# Apuntes\n\n- Física: trabajos prácticos\n- Análisis Matemático: resumen, apuntes y parciales" },
  ]);
}

/** An Excel made from what was said in the chat. */
export function excelPlan(callId: string, folder: SharedFolder): FolderPlanMeta {
  return plan(callId, folder, "Una planilla con tus notas por materia y el promedio.", [
    { op: "xlsx", path: "Notas 2026.xlsx", sheets: [{ name: "Notas", columns: ["Materia", "Parcial 1", "Parcial 2", "Promedio"], rows: [["Análisis", 7, 8, "=AVERAGE(B2:C2)"], ["Física", 6, 9, "=AVERAGE(B3:C3)"]] }] },
  ]);
}
