// `?progress` (AC-210): a student a few weeks in, so «Mi progreso» can be seen
// with real-looking data — two paths, long sentence-like names, near-duplicates,
// dates coming, cards due and a streak.
import type { PlanNode, Session, StudentModel, TopicState } from "../types";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const day = (fromNow: number) => {
  const d = new Date();
  d.setDate(d.getDate() + fromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const node = (id: string, title: string, status: PlanNode["status"]): PlanNode => ({ id, title, summary: "", depends_on: [], status, note: "" });

const session = (id: string, goal: string, phase: Session["phase"], daysAgo: number, plan: PlanNode[], exam?: Session["exam"]): Session => ({
  id,
  title: goal,
  goal,
  phase,
  created_at: iso(daysAgo + 1),
  updated_at: iso(daysAgo),
  findings: [],
  plan,
  pending_question: null,
  messages: [{ role: "user", content: `Quiero entender: ${goal}` }],
  exam: exam ?? null,
});

export function progressSessions(): Session[] {
  return [
    session("pg-ml", "Gradientes en Machine Learning", "teach", 1, [
      node("n1", "Derivada como pendiente", "known"),
      node("n2", "Función de error cuadrático", "understood"),
      node("n3", "Magnitud de la pendiente", "current"),
      node("n4", "Por qué se resta el gradiente", "repair"),
      node("n5", "Tasa de aprendizaje (η)", "pending"),
      node("n6", "Entrenar un modelo chico", "pending"),
    ]),
    session(
      "pg-an",
      "Regla de la cadena",
      "teach",
      6,
      [node("a1", "Función compuesta", "understood"), node("a2", "Derivada de la función de afuera", "pending"), node("a3", "Regla de la cadena", "pending"), node("a4", "Cadena con tres funciones", "pending"), node("a5", "Ejercicios de parcial", "pending")],
      { exam_id: "pg-exam", exam_name: "Parcial de Análisis I", domain: "Derivadas", weight: 1, topic_id: "t1", objectives: [] },
    ),
    session("pg-lim", "Límites y continuidad", "done", 16, [node("l1", "Idea de límite", "understood"), node("l2", "Límites laterales", "understood"), node("l3", "Continuidad", "understood"), node("l4", "Asíntotas", "known")]),
  ];
}

const t = (name: string, status: TopicState["status"], evidence: string[], daysAgo: number, sources: string[], confusion = false): TopicState => ({ key: name.toLowerCase(), name, status, evidence, at: iso(daysAgo), sources, confusion });

export function progressModel(): StudentModel {
  return {
    topics: [
      t("Por qué se resta el gradiente en la regla de actualización", "le_cuesta", ["confusión: No sabía qué dirección mover w a partir del signo de la pendiente ni por qué se resta en lugar de sumarla", "le costó en «Gradientes en Machine Learning» (12/11)"], 1, ["confusión", "memoria"], true),
      t("No pudo explicar por qué se resta el gradiente: ante E(w)=(w−3)², w=0 y pendiente −6 respondió «no sé, la verdad que no sé» (confianza 1/5).", "le_cuesta", ["le costó en «Machine Learning desde gradientes» (11/11)"], 2, ["memoria"]),
      t("Regla de la cadena", "le_cuesta", ["tarjetas: 4 olvidos en «Análisis I»"], 3, ["tarjetas"]),
      t("Integrales por partes", "le_cuesta", ["simulacro de Parcial de Análisis I: 2 de 6"], 4, ["examen"]),
      t("Tasa de aprendizaje (η)", "pendiente", ["quedó pendiente en «Gradientes en Machine Learning»"], 1, ["memoria"]),
      t("Derivadas parciales", "pendiente", ["quedó pendiente en «Machine Learning desde gradientes»"], 2, ["memoria"]),
      t("Magnitud de la pendiente", "practicando", ["la confusión «Una pendiente de −6 significa que todavía estoy lejos del mínimo» quedó reparada"], 2, ["confusión"]),
      t("Continuidad en un punto", "practicando", ["práctica: acertaste 2 de 3"], 5, ["práctica"]),
      t("Función de error cuadrático", "domina", ["práctica: acertaste 3 de 3"], 2, ["práctica"]),
      t("Límites y continuidad", "domina", ["terminaste la sesión del 28/10 (5 ideas en tu grafo)"], 16, ["sesión"]),
      t("Mínimo de una parábola", "domina", ["práctica: acertaste 4 de 5"], 4, ["práctica"]),
      t("Derivada como pendiente de la tangente", "domina", ["simulacro de Parcial de Análisis I: 5 de 5"], 4, ["examen"]),
    ],
    pending: [{ item: "Tasa de aprendizaje (η)", session_id: "pg-ml", session_title: "Gradientes en Machine Learning", at: iso(1) }],
    upcoming: [
      { title: "Parcial de Análisis I", date: day(4), days: 4, screen: "exams", id: "pg-exam" },
      { title: "TP de Machine Learning", date: day(8), days: 8, screen: "academic", id: "pg-tp" },
    ],
    preferences: ["entendés mejor con ejemplos numéricos"],
    cards_due: 12,
    minutes_7d: 95,
  };
}

/** Days with study, counted back from today (today not yet). */
export const progressDays = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13];
