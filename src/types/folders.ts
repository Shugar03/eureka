// Working folders (AC-219..AC-222).

export interface SharedFolder {
  id: string;
  path: string;
  label: string;
  /** «Leer y organizar» (true) or «Solo leer». */
  writable: boolean;
  added_at: string;
}

/** What the teacher looked at in a folder. */
export interface FolderMeta {
  kind: "folder";
  action: "overview" | "read";
  folder: string;
  files?: number;
  dirs?: number;
  path?: string;
}

export type FolderBlock =
  | { type: "heading"; text: string; level?: number }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] };

export type FolderOp =
  | { op: "mkdir"; path: string }
  | { op: "move"; from: string; to: string }
  | { op: "trash"; path: string }
  | { op: "write"; path: string; content: string }
  | { op: "xlsx"; path: string; sheets: { name: string; columns: string[]; rows: unknown[][] }[] }
  | { op: "docx"; path: string; title?: string; blocks: FolderBlock[] };

/** A plan of changes in a folder, applied (and undone) from its card. */
export interface FolderPlanMeta {
  kind: "folder_plan";
  plan_id: string;
  folder_id: string;
  folder: string;
  summary: string;
  counts: string;
  ops: FolderOp[];
  status: "proposed" | "applied" | "failed" | "undone";
  done?: number;
  error?: string | null;
  kept?: string[];
}
