// Scripted exam roles shared by the browser mock and the fake provider:
// the guide reader (set_syllabus) and the mock-exam author (set_exam_questions).
//
// Guide format it understands (any other text yields no domains → NF-15):
//   Dominio 1: Conceptos de la nube (24%)
//   - Tema            (or "• Tema", as text read from a PDF)
//     - objetivo      (or "– objetivo": a PDF loses the indentation)
// The correct options always start with "Aplicar correctamente", so tests
// can answer right or wrong on purpose. Every 5th question is "Elegí 2".

export interface RawTopic {
  title: string;
  objectives: string[];
}

export interface RawDomain {
  name: string;
  weight?: number;
  topics: RawTopic[];
}

export interface RawQuestion {
  domain_id: string;
  topic_id: string | null;
  stem: string;
  options: string[];
  answer: number[];
  explanation: string;
}

export interface QuestionPlan {
  domain_id: string;
  topics: { id: string; title: string }[];
  n: number;
}

const DOMAIN = /^(?:dominio|domain|secci[oó]n|section|unidad|unit)\s*\d*\s*[:.\-–]\s*(.+?)(?:\s*\((\d+(?:[.,]\d+)?)\s*%\))?\s*$/i;

export function parseGuide(text: string): RawDomain[] {
  const out: RawDomain[] = [];
  for (const line of text.split(/\r?\n/)) {
    const d = DOMAIN.exec(line.trim());
    if (d) {
      out.push({ name: d[1], ...(d[2] ? { weight: Number(d[2].replace(",", ".")) } : {}), topics: [] });
      continue;
    }
    const cur = out[out.length - 1];
    const objective = /^(?:\s{2,}[-*]|\s*[–◦])\s+(.+)$/.exec(line);
    const topic = /^[-*•]\s+(.+)$/.exec(line);
    if (cur && objective && cur.topics.length) cur.topics[cur.topics.length - 1].objectives.push(objective[1].trim());
    else if (cur && topic) cur.topics.push({ title: topic[1].trim(), objectives: [] });
  }
  return out;
}

/** Mirror of exam::normalize_weights (Rust). */
export function normalizeWeights(raw: (number | undefined)[]): number[] {
  const valid = raw.every((w) => w !== undefined && Number.isFinite(w) && w > 0);
  const ws = valid ? (raw as number[]) : raw.map(() => 1);
  const sum = ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => Math.round((1000 * w) / sum) / 10);
}

/** Mirror of exam::allocate (Rust): largest remainder, ties to heavier then earlier. */
export function allocate(count: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (count * w) / sum);
  const out = exact.map(Math.floor);
  const order = weights.map((_, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || weights[b] - weights[a] || a - b);
  const missing = count - out.reduce((a, b) => a + b, 0);
  for (const i of order.slice(0, missing)) out[i]++;
  return out;
}

const WRONG = ["Ignorarlo hasta que falle en producción", "Delegarlo por completo al proveedor sin revisar nada", "Resolverlo a mano cada vez, sin automatizar"];

export function scriptedQuestions(plan: QuestionPlan[]): RawQuestion[] {
  const out: RawQuestion[] = [];
  let k = 0;
  for (const p of plan) {
    for (let i = 0; i < p.n; i++, k++) {
      const t = p.topics[i % Math.max(1, p.topics.length)];
      const title = t?.title ?? p.domain_id;
      const options = [...WRONG];
      options.splice(k % 4, 0, `Aplicar correctamente ${title}`);
      if (k % 5 === 4) options.splice((k + 2) % 5, 0, `Aplicar correctamente ${title} y documentarlo`);
      const answer = options.flatMap((o, j) => (o.startsWith("Aplicar correctamente") ? [j] : []));
      out.push({
        domain_id: p.domain_id,
        topic_id: t?.id ?? null,
        stem: `**Escenario ${k + 1}.** Una empresa tiene que resolver un problema de *${title}*. ¿Qué conviene hacer?`,
        options,
        answer,
        explanation: `Lo correcto es aplicar bien ${title}: las otras opciones posponen el problema o lo vuelven manual y frágil.`,
      });
    }
  }
  return out;
}

/** Reads the distribution written by exam::questions_input (Rust). */
export function parseQuestionsInput(input: string): QuestionPlan[] {
  const plan: QuestionPlan[] = [];
  for (const line of input.split("\n")) {
    const d = /^### (d\d+): .* → (\d+) preguntas$/.exec(line);
    if (d) plan.push({ domain_id: d[1], topics: [], n: Number(d[2]) });
    const t = /^- (d\d+t\d+): ([^—]+?)(?: — .*)?$/.exec(line);
    if (t && plan.length) plan[plan.length - 1].topics.push({ id: t[1], title: t[2].trim() });
  }
  return plan;
}

/** What the scripted guide finder "finds" on the web for any exam name. */
export function scriptedFoundGuide(name: string) {
  return {
    guide: `${name}\n\n${SAMPLE_GUIDE.split("\n").slice(2).join("\n")}`.trim(),
    used: [1],
  };
}


/** A small official-looking guide the e2e tests paste. */
export const SAMPLE_GUIDE = `Guía del examen AWS Certified Cloud Practitioner (CLF-C02)

Dominio 1: Conceptos de la nube (24%)
- Beneficios de la nube de AWS
  - Economías de escala
  - Elasticidad y agilidad
- Principios de diseño del Well-Architected Framework
  - Los seis pilares

Dominio 2: Seguridad y cumplimiento (30%)
- Modelo de responsabilidad compartida
  - Qué asegura AWS y qué asegura el cliente
- Gestión de identidades con IAM
  - Usuarios, grupos y roles
  - Principio de menor privilegio

Dominio 3: Tecnología y servicios de la nube (34%)
- Servicios de cómputo
  - EC2, Lambda y contenedores
- Servicios de almacenamiento
  - S3 y sus clases de almacenamiento

Dominio 4: Facturación, precios y soporte (12%)
- Modelos de precios
  - Bajo demanda, instancias reservadas y Spot
`;

/** What the fake search API returns when asked for an exam guide. */
export const GUIDE_HITS = [
  { title: "Guía oficial del examen", url: "https://certificaciones.example/guia-oficial.pdf", content: "Dominios y pesos del examen", raw_content: SAMPLE_GUIDE },
  { title: "Blog de preparación", url: "https://blog.example/como-prepararse", content: "Consejos para estudiar" },
];

/** Scripted checker (check_answers): picks the "Aplicar correctamente"
 *  options of each "### mN" block written by exam::check_input (Rust). */
export function scriptedCheck(input: string): { answers: { id: string; answer: number[] }[] } {
  const answers: { id: string; answer: number[] }[] = [];
  for (const block of input.split("\n### ").slice(1)) {
    const id = block.split("\n")[0].trim();
    const answer = [...block.matchAll(/^(\d+)\) Aplicar correctamente/gm)].map((m) => Number(m[1]));
    answers.push({ id, answer });
  }
  return { answers };
}

/** Scripted teacher answering a doubt about a graded question (AC-45). */
export function scriptedExplain(ask: string): string {
  return `Buena pregunta: «${ask.trim()}». Esa opción sería la correcta si el escenario pidiera **resolverlo una sola vez**; acá la pista es que tiene que quedar resuelto de forma confiable, por eso conviene aplicar correctamente el concepto.`;
}
