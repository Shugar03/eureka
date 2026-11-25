// Settings, providers, accounts, accessibility, prompts and usage types.

export interface Provider {
  id: string;
  label: string;
  base_url: string;
}

export interface ProviderView extends Provider {
  has_key: boolean;
}

/** A connected subscription account (ChatGPT Plus/Pro). Never carries tokens. */
export interface AccountView {
  provider_id: string;
  account_id: string;
  email: string | null;
  /** Unix milliseconds; the backend refreshes before it lapses. */
  expires: number;
}

/** One model a subscription account may call. */
export interface ModelInfo {
  id: string;
  context: number | null;
  tools: boolean;
}

/** AC-106/AC-185: a speech model that runs on this PC (Parakeet v3 or Whisper). */
export interface LocalSpeechModel {
  id: string;
  label: string;
  bytes: number;
  installed: boolean;
}

/** The Voz role's provider id for the speech model on this PC. */
export const LOCAL_SPEECH = "local";
/** AC-185: what «En esta PC» picks first; Whisper tiny/base stay as the light options. */
export const DEFAULT_LOCAL_SPEECH = "parakeet-v3";

export interface ModelRef {
  provider_id: string;
  model: string;
  /** Context window in thousands of tokens (unset: 64). */
  context_k?: number | null;
}

export interface Roles {
  prober: ModelRef;
  teacher: ModelRef;
  extractor: ModelRef;
  practice: ModelRef;
  researcher: ModelRef;
  /** Speech to text for speaking practice; empty = off. */
  speech: ModelRef;
}

export interface SearchView {
  base_url: string;
  has_key: boolean;
}

/** AC-92: what the learner told the app at the start. All optional. */
export interface Identity {
  first_name: string;
  last_name: string;
  school: string;
  career: string;
  age: number | null;
  /** "el", "ella", "elle" or "" (no preference). */
  treatment: "" | "el" | "ella" | "elle";
  treatment_other: string;
  onboarded: boolean;
}

/** AC-73..77: access settings the learner chose (Ajustes → Accesibilidad). */
export interface Accessibility {
  easy_reading: boolean;
  literal: boolean;
  short_steps: boolean;
  read_aloud: boolean;
  speech_rate: number;
  dictation: boolean;
  spacing: boolean;
  text_size: "normal" | "large" | "larger";
  reduce_motion: boolean;
}

export interface SettingsView {
  providers: ProviderView[];
  roles: Roles;
  search: SearchView;
  data_dir: string;
}

export interface ProviderInput extends Provider {
  api_key?: string;
  clear_key?: boolean;
}

export interface SettingsInput {
  providers: ProviderInput[];
  roles: Roles;
  search?: { base_url: string; api_key?: string; clear_key?: boolean };
}

export interface PromptView {
  name: string;
  content: string;
  default_content: string;
  overridden: boolean;
}

/** AC-158/159: what pasting one key did. */
export interface SetupDone {
  status: "done";
  provider_id: string;
  provider: string;
  model: string;
  context_k: number | null;
  alternatives: string[];
  speech_ready: boolean;
  tools_ok: boolean;
}
export type SetupOutcome = SetupDone | { status: "choose"; candidates: string[]; reason: string };

/** AC-186: what the model calls spent, as the providers reported it (only on this PC). */
export interface UsageTotals {
  calls: number;
  /** Calls the provider reported usage for. */
  known: number;
  input: number;
  output: number;
  /** null: no call said how much was cached. */
  cached: number | null;
  reasoning: number | null;
  /** null: no provider reported a cost. */
  cost: number | null;
  ms: number;
}

export interface UsageGroup {
  key: string;
  label: string;
  totals: UsageTotals;
}

export interface UsageSummary {
  today: UsageTotals;
  week: UsageTotals;
  by_role: UsageGroup[];
  sessions: UsageGroup[];
  keep_days: number;
}
