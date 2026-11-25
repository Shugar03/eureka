// Mi cursada, career plan (malla), recorded classes, study log and streak activity.

/** AC-99…: Mi cursada — terms, courses with their weekly slots, and the dates that matter. */
export type TermKind = "cuatrimestre" | "trimestre" | "semestre" | "anual" | "otro";
export type DateKind = "parcial" | "recuperatorio" | "final" | "tp" | "entrega" | "otro";
export type SlotKind = "teoria" | "practica" | "otro";

export interface Term {
  id: string;
  name: string;
  kind: TermKind;
  start: string | null;
  end: string | null;
  /** AC-145: holidays and weeks without classes. */
  breaks?: TermBreak[];
}

/** AC-145: days without classes, both inclusive. */
export interface TermBreak {
  id: string;
  start: string;
  end: string;
  name: string;
}

export interface BreakInput {
  start: string;
  end?: string | null;
  name: string;
}

export interface ClassSlot {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  start: string;
  end: string;
  room: string;
  kind: SlotKind;
}

export interface Course {
  id: string;
  term_id: string;
  name: string;
  code: string;
  professor: string;
  room: string;
  notes: string;
  color: number;
  slots: ClassSlot[];
  /** AC-150: its study route (an exam of kind "subject"), if linked. */
  exam_id?: string | null;
}

/** AC-150: start a study route for a course from Mi cursada. */
export interface RoutePrefill {
  courseId: string;
  name: string;
}

export interface DateItem {
  id: string;
  term_id: string;
  course_id: string | null;
  kind: DateKind;
  title: string;
  date: string;
  time: string | null;
  notes: string;
  done: boolean;
  grade: number | null;
}

export interface AcademicData {
  terms: Term[];
  courses: Course[];
  dates: DateItem[];
  active_term: string | null;
}

export interface TermInput {
  id?: string | null;
  name: string;
  kind: TermKind;
  start?: string | null;
  end?: string | null;
}

export interface CourseInput {
  id?: string | null;
  term_id: string;
  name: string;
  code?: string;
  professor?: string;
  room?: string;
  notes?: string;
  color?: number | null;
  slots: ClassSlot[];
}

export interface DateInput {
  id?: string | null;
  term_id: string;
  course_id?: string | null;
  kind: DateKind;
  title: string;
  date: string;
  time?: string | null;
  notes?: string;
  done?: boolean;
  grade?: number | null;
}

/** What the agent or the importer suggests; nothing is saved until the person confirms. */
export interface Proposal {
  term?: { name: string; kind?: string; start?: string | null; end?: string | null } | null;
  courses?: { name: string; code?: string; professor?: string; room?: string; notes?: string; slots?: Partial<ClassSlot>[] }[];
  dates?: { course?: string | null; kind: string; title: string; date: string; time?: string | null; notes?: string }[];
}

export interface ImportReport {
  term: string;
  courses_added: number;
  courses_updated: number;
  dates_added: number;
  dates_skipped: number;
}

/** AC-155…157: the career's plan of studies (malla). */
export type CareerStatus = "pendiente" | "cursando" | "regular" | "aprobada";

export interface CareerSubject {
  id: string;
  name: string;
  code: string;
  year: number;
  term: number | null;
  /** Ids that must be at least regular to cursar it. */
  para_cursar: string[];
  /** Ids that must be aprobadas to rendir its final. */
  para_rendir: string[];
  status: CareerStatus;
  grade: number | null;
  failed: number[];
}

export interface CareerSubjectView extends CareerSubject {
  can_take: boolean;
  can_sit_final: boolean;
  missing: string[];
  in_cursada: boolean;
}

export interface CareerView {
  name: string;
  institution: string;
  subjects: CareerSubjectView[];
  approved: number;
  total: number;
  average: number | null;
  average_with_failed: number | null;
}

export interface CareerProposalSubject {
  name: string;
  code?: string;
  year: number;
  term?: number | null;
  para_cursar?: string[];
  para_rendir?: string[];
}

export interface CareerProposal {
  name: string;
  institution?: string;
  subjects: CareerProposalSubject[];
}

export type CareerSubjectInput = Omit<CareerSubject, "id"> & { id: string | null };

// ── Study log & recorded classes ───────────────────────────────────────────

export interface StudyContext {
  kind: string;
  id: string;
  title: string;
}

export interface StudyEntry {
  at: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  minutes: number;
  context: StudyContext | null;
}

/** AC-147: a date or task the teacher announced in a recorded class. */
export interface AnnouncedDate {
  title: string;
  /** YYYY-MM-DD, or "" if the day wasn't said. */
  date: string;
  kind: DateKind;
}

export interface ClassNotes {
  summary: string;
  key_points: string[];
  questions: string[];
  dates: AnnouncedDate[];
}

/** AC-146: a recorded class, transcribed part by part. */
export interface ClassRecord {
  id: string;
  title: string;
  course_id: string | null;
  day: string;
  started_at: string;
  seconds: number;
  parts: number;
  transcript: string;
  notes: ClassNotes | null;
}

export interface ClassSummary {
  id: string;
  title: string;
  course_id: string | null;
  day: string;
  seconds: number;
  parts: number;
  has_notes: boolean;
}

/** AC-141: a day with study, for the kind streak. */
export interface DayActivity {
  day: string;
  kinds: ("chat" | "focus" | "cards" | "practice" | "exam" | "class")[];
  /** Minutes of finished focus blocks. */
  minutes: number;
}
