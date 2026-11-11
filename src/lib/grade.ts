// AC-208: the app corrects a closed question at once, with the key the teacher sent along
// (`answer`; order and match carry their key in their own order). The teacher comes after,
// with the why. An open question, or one without a key, is not corrected here.
import type { QuestionArgs } from "../types";

export interface Grade {
  correct: boolean;
  right: number;
  total: number;
}

/** What the learner built, whatever the format. */
export interface Built {
  choice?: string | null;
  picked?: string[];
  verdicts?: Record<number, boolean>;
  order?: string[];
  /** match: for each left (by index), the right chosen. */
  matches?: Record<number, string>;
  gaps?: string[];
}

export type Format = "open" | "choice" | "multi" | "true_false" | "order" | "match" | "cloze";

export function formatOf(args: QuestionArgs): Format {
  const f = args.format;
  if (f && ["open", "choice", "multi", "true_false", "order", "match", "cloze"].includes(f)) return f;
  return args.options?.filter(Boolean).length ? "choice" : "open";
}

/** Spelling that should not count: case, accents, spaces, final punctuation. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/^[¿¡"«»'(]+|[.,;:!¡?¿"«»')]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const options = (a: QuestionArgs) => a.options?.filter(Boolean) ?? [];
const indices = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);

/** The key as models really send it ("2", "[false, true]", the option's text…); same as tools::key_of. */
export function keyOf(args: QuestionArgs): unknown {
  const f = formatOf(args);
  let v: unknown = args.answer;
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const raw = v.trim();
    try {
      v = JSON.parse(raw);
    } catch {
      v = raw;
    }
  }
  const opts = options(args);
  const scalar = (x: unknown): unknown => {
    if (typeof x !== "string") return x;
    const t = x.trim();
    const low = t.toLowerCase();
    if (["true", "verdadero", "v"].includes(low)) return true;
    if (["false", "falso", "f"].includes(low)) return false;
    if (/^\d+$/.test(t)) return Number(t);
    const i = opts.findIndex((o) => o.trim().toLowerCase() === low);
    return i >= 0 && (f === "choice" || f === "multi") ? i + 1 : t;
  };
  if (f === "choice") return scalar(Array.isArray(v) && v.length === 1 ? v[0] : v);
  if (f === "cloze") return (Array.isArray(v) ? v : [v]).map((x) => String(x));
  return (Array.isArray(v) ? v : [v]).map(scalar);
}

/** Whether this question can be corrected by the app. */
export function gradable(args: QuestionArgs): boolean {
  const f = formatOf(args);
  if (f === "order") return (args.items?.filter(Boolean).length ?? 0) >= 2;
  if (f === "match") return (args.pairs?.length ?? 0) >= 2;
  const key = keyOf(args);
  if (f === "choice") return typeof key === "number";
  if (f === "multi" || f === "true_false" || f === "cloze") return Array.isArray(key) && key.length > 0;
  return false;
}

const of = (right: number, total: number): Grade => ({ correct: right === total, right, total });

export function grade(args: QuestionArgs, b: Built): Grade | null {
  if (!gradable(args)) return null;
  const opts = options(args);
  switch (formatOf(args)) {
    case "choice":
      return of(b.choice === opts[(keyOf(args) as number) - 1] ? 1 : 0, 1);
    case "multi": {
      const want = new Set(indices(keyOf(args)).map((i) => opts[i - 1]));
      const got = new Set(b.picked ?? []);
      // Every option is a decision: picked when it should be, left out when it should not.
      const right = opts.filter((o) => want.has(o) === got.has(o)).length;
      return of(right, opts.length);
    }
    case "true_false": {
      const key = (keyOf(args) as unknown[]).map(Boolean);
      return of(key.filter((v, i) => b.verdicts?.[i] === v).length, key.length);
    }
    case "order": {
      const items = args.items!.filter(Boolean);
      return of(items.filter((x, i) => b.order?.[i] === x).length, items.length);
    }
    case "match": {
      const pairs = args.pairs!;
      return of(pairs.filter((p, i) => b.matches?.[i] === p.right).length, pairs.length);
    }
    case "cloze": {
      const key = (keyOf(args) as unknown[]).map(String);
      const ok = key.filter((k, i) => k.split("|").some((alt) => normalize(alt) === normalize(b.gaps?.[i] ?? ""))).length;
      return of(ok, key.length);
    }
    default:
      return null;
  }
}

/** The right answer, spelled out for the red strip. */
export function expected(args: QuestionArgs): string {
  const opts = options(args);
  switch (formatOf(args)) {
    case "choice":
      return opts[(keyOf(args) as number) - 1] ?? "";
    case "multi":
      return indices(keyOf(args))
        .map((i) => opts[i - 1])
        .filter(Boolean)
        .join(" · ");
    case "true_false":
      return (keyOf(args) as unknown[]).map((v, i) => `${i + 1}. ${v ? "Verdadero" : "Falso"}`).join("  ");
    case "order":
      return (args.items ?? []).filter(Boolean).map((x, i) => `${i + 1}) ${x}`).join("  ");
    case "match":
      return (args.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join(" · ");
    case "cloze": {
      const key = (keyOf(args) as unknown[]).map((k) => String(k).split("|")[0]);
      let i = 0;
      return args.question.replace(/_{3,}/g, () => key[i++] ?? "___");
    }
    default:
      return "";
  }
}
