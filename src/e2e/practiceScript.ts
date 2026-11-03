// Scripted practice generator and grader shared by the browser mock and the
// fake provider. The solution's first word is the expected answer.
import { normalize } from "./graphFold.ts";

export interface RawProblem {
  statement: string;
  targets: string[];
  hints: string[];
  solution: string;
}

const BANK: Omit<RawProblem, "targets">[] = [
  {
    statement: "Un auto avanza $s(t) = t^2$ metros a los $t$ segundos. ¿Qué tan rápido va **justo** en $t = 3$?",
    hints: ["¿Qué mide la rapidez en un instante y no en un intervalo?", "Pensá en la recta que toca la curva de $s$ en $t=3$.", "Calculá la pendiente de esa recta: $2t$ en $t=3$."],
    solution: "6 m/s: la rapidez instantánea es la pendiente de la tangente a $s(t)$, y $s'(t)=2t$.",
  },
  {
    statement: "Hacés zoom infinito sobre una curva suave en un punto. ¿Qué figura terminás viendo?",
    hints: ["¿Qué le pasa a la curvatura cuando mirás cada vez más cerca?", "Dos puntos muy cercanos de la curva definen…", "Es la recta tangente."],
    solution: "recta: de cerca, una curva suave se parece a su recta tangente.",
  },
  {
    statement: "¿A qué valor se acerca $(1+h)^2$ cuando $h$ se hace cada vez más chico?",
    hints: ["Probá con $h = 0.1$ y $h = 0.01$.", "¿Qué pasa con $h$ en el límite?", "Reemplazá $h$ por $0$."],
    solution: "1: cuando $h \to 0$, $(1+h)^2 \to 1$.",
  },
];

export function scriptedProblems(targets: string[], count: number): RawProblem[] {
  return Array.from({ length: count }, (_, i) => {
    const b = BANK[i % BANK.length];
    const round = Math.floor(i / BANK.length);
    return { ...b, statement: round ? `${b.statement} (variante ${round + 1})` : b.statement, targets: [targets[i % targets.length]] };
  });
}

export function expectedOf(solution: string): string {
  return normalize(solution.split(/[:\s]/)[0] ?? "");
}

export function scriptedGrade(answer: string, solution: string): { verdict: "correct" | "partial" | "incorrect"; feedback: string } {
  const a = normalize(answer);
  if (a.includes("casi")) return { verdict: "partial", feedback: "Vas bien, pero te falta justificar el paso clave." };
  return a.split(" ").includes(expectedOf(solution))
    ? { verdict: "correct", feedback: "Bien: identificaste la idea que hacía falta y la aplicaste." }
    : { verdict: "incorrect", feedback: "Todavía no: revisá qué idea necesitás para este problema." };
}
