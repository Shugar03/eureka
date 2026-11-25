// Knowledge graph (Phase 2) and local library (AC-69…71, AC-187/188).

export type GraphSource = { kind: "session"; id: string; title: string } | { kind: "notes"; id: string; title: string };

export interface GraphNode {
  id: string;
  text: string;
  sources: GraphSource[];
}

export interface GraphChain {
  premises: string[];
  conclusion: string;
  source: GraphSource;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphView {
  nodes: GraphNode[];
  chains: GraphChain[];
  edges: GraphEdge[];
}

export interface GraphSummary {
  propositions: number;
  chains: number;
  at: string;
  /** Messages the extraction saw (audit item 10: more now → re-extract). */
  messages?: number;
}

// ── Library (AC-69…71) ──────────────────────────────────────────────────────

export interface BookSection {
  id: number;
  title: string;
  level: number;
  page: number | null;
  markdown: string;
}

export interface Book {
  id: string;
  title: string;
  file_name: string;
  created_at: string;
  pages: number;
  scanned: number[];
  sections: BookSection[];
  /** AC-187: pages read with OCR on this PC. */
  ocr?: OcrInfo | null;
}

export interface OcrInfo {
  hash: string;
  pages: number[];
  pending: number[];
  review: { page: number; lines: string[] }[];
}

export interface OcrStatus {
  hash: string;
  read: number;
  pending: number[];
  review: number;
}

/** AC-187/188: one page or photo read by the local OCR. */
export interface OcrPageText {
  markdown: string;
  lines: { text: string; confidence: number; bbox: [number, number, number, number] }[];
  confidence: number;
  chars: number;
  review: string[];
}

/** What a book receives for each OCR'd page. */
export interface OcrPageInput {
  page: number;
  markdown: string;
  review: string[];
}

export interface BookSummary {
  id: string;
  title: string;
  file_name: string;
  created_at: string;
  pages: number;
  sections: number;
  scanned: number;
  chars: number;
  ocr?: OcrStatus | null;
}

export interface LibraryHit {
  book_id: string;
  book_title: string;
  section_id: number;
  section: string;
  page: number | null;
  snippet: string;
  text: string;
  score: number;
}
