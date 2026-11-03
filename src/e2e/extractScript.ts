// Scripted extractor shared by the browser mock and the fake provider.
// Sessions about the derivative yield a fixed chain from slope to derivative;
// notes yield one proposition per line, chained in order.

export interface RawExtraction {
  propositions: { key: string; text: string }[];
  chains: { premises: string[]; conclusion: string }[];
}

export const NOTES_HEADER = "# Notas del aprendiz:";

export const DERIVATIVE: RawExtraction = {
  propositions: [
    { key: "p1", text: "La pendiente mide cuánto sube una recta por cada paso a la derecha" },
    { key: "p2", text: "Un límite describe el valor al que se acerca una expresión" },
    { key: "p3", text: "La recta tangente es el límite de las rectas secantes cuando los dos puntos se juntan" },
    { key: "p4", text: "La derivada es la pendiente de la recta tangente" },
  ],
  chains: [
    { premises: ["p2"], conclusion: "p3" },
    { premises: ["p1", "p3"], conclusion: "p4" },
  ],
};

export function scriptedExtraction(input: string): RawExtraction {
  if (!input.startsWith(NOTES_HEADER)) return DERIVATIVE;
  const lines = input
    .split("\n")
    .slice(1)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  const propositions = lines.map((text, i) => ({ key: `n${i + 1}`, text }));
  const chains = propositions.slice(1).map((p, i) => ({ premises: [propositions[i].key], conclusion: p.key }));
  return { propositions, chains };
}
