/** AC-82..88: Acompañamiento — a listening mode and a private journal. */

export interface CompanionTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface CompanionConversation {
  turns: CompanionTurn[];
  /** Signals of risk appeared: the help lines stay visible. */
  risk: boolean;
}

/** AC-93: a thought record — what happened, what I thought, and another way to see it. */
export interface ThoughtRecord {
  situation: string;
  thought: string;
  /** Intensity 0–100 before looking at the thought again, and (optionally) after. */
  before: number;
  after?: number | null;
  for_it: string;
  against: string;
  alternative: string;
}

export interface JournalEntry {
  id: string;
  at: string;
  kind: "entry" | "checkin" | "thought";
  title: string;
  text: string;
  mood: number | null;
  emotions: string[];
  helped: string[];
  record?: ThoughtRecord | null;
}

export interface EntryDraft {
  id?: string | null;
  title: string;
  text: string;
  mood?: number | null;
  emotions: string[];
  helped: string[];
  record?: ThoughtRecord | null;
}

export interface HelpResource {
  name: string;
  detail: string;
}

export interface CompanionView {
  locked: boolean;
  has_pin: boolean;
  privacy_ack: boolean;
  resources: HelpResource[];
  conversation: CompanionConversation;
  entries: JournalEntry[];
  /** What the person said about each noticed pattern (AC-95). */
  insights: Record<string, "confirmed" | "rejected">;
}
