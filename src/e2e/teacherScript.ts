// The scripted teacher shared by the browser mock (src/e2e/mockBackend.ts)
// and the fake OpenAI-compatible provider (tests/fake-provider/server.ts):
// both teach "qué es una derivada" in the same fixed arc, so web and desktop
// e2e assert the same flow. Pure: no DOM, no Node APIs, type-only imports.
import type { NodeStatus, Phase, PlanNode, Proposal } from "../types";

export type Call = { name: string; args: Record<string, unknown> };
export type Step = { text?: string; calls?: Call[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (now: Date, n: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

/** What the script "reads" from a pasted timetable: two courses and two dates, relative to today. */
export function timetableProposal(now: Date = new Date()): Proposal {
  return {
    term: { name: "2.º cuatrimestre 2026", kind: "cuatrimestre" },
    courses: [
      { name: "Análisis I", professor: "Pérez", room: "Aula 3", slots: [{ weekday: 1, start: "10:00", end: "12:00" }, { weekday: 3, start: "10:00", end: "12:00" }] },
      { name: "Física I", slots: [{ weekday: 2, start: "14:00", end: "17:00", room: "Laboratorio 2", kind: "practica" }] },
    ],
    dates: [
      { course: "Análisis I", kind: "parcial", title: "Primer parcial", date: inDays(now, 14), time: "10:00" },
      { course: "Física I", kind: "tp", title: "TP 1: informe", date: inDays(now, 7) },
    ],
  };
}

export const PLAN: Omit<PlanNode, "note">[] = [
  { id: "pendiente", title: "Pendiente de una recta", summary: "Cuánto sube por cada paso a la derecha", depends_on: [], status: "known" },
  { id: "limite", title: "Límite", summary: "A qué valor se acerca algo", depends_on: [], status: "pending" },
  { id: "tangente", title: "Recta tangente como límite de secantes", summary: "Acercar dos puntos hasta que se tocan", depends_on: ["pendiente", "limite"], status: "pending" },
  { id: "derivada", title: "La derivada", summary: "La pendiente de la tangente en cada punto", depends_on: ["tangente"], status: "pending" },
];

const ask = (question: string, purpose: string, options?: string[], of?: number): Call => ({
  name: "ask_question",
  args: { question, purpose, ...(options ? { options } : {}), ...(of ? { of } : {}) },
});

export const DEMO = "<!doctype html><html><body style=\"margin:0;font:14px system-ui;background:#0f1011;color:#d0d6e0\">\n<div style=\"padding:12px\"><label>Distancia entre los puntos: <input id=\"h\" type=\"range\" min=\"0.05\" max=\"2\" step=\"0.05\" value=\"1.5\" aria-label=\"Distancia entre los puntos\"></label>\n<p>Pendiente de la secante: <strong id=\"m\"></strong></p><svg id=\"g\" width=\"300\" height=\"160\" viewBox=\"-1 -1 4 5\" style=\"background:#141516;transform:scaleY(-1)\"></svg></div>\n<script>\nconst h=document.getElementById(\"h\"),m=document.getElementById(\"m\"),g=document.getElementById(\"g\");\nfunction draw(){const d=+h.value,x=1,y=x*x,x2=x+d,y2=x2*x2,s=(y2-y)/d;m.textContent=s.toFixed(2);\nlet p=\"\";for(let t=-0.5;t<=2.2;t+=0.05)p+=t+\",\"+t*t+\" \";\ng.innerHTML='<polyline fill=\"none\" stroke=\"#5e6ad2\" stroke-width=\"0.05\" points=\"'+p+'\"/>'+\n'<line x1=\"-0.5\" y1=\"'+(y-1.5*s)+'\" x2=\"3\" y2=\"'+(y+2*s)+'\" stroke=\"#f2994a\" stroke-width=\"0.04\"/>'+\n'<circle cx=\"'+x+'\" cy=\"'+y+'\" r=\"0.08\" fill=\"#fff\"/><circle cx=\"'+x2+'\" cy=\"'+y2+'\" r=\"0.08\" fill=\"#fff\"/>';}\nh.oninput=draw;draw();\nlet net=\"bloqueada\";try{fetch(\"https://example.com\").then(()=>{net=\"abierta\"},()=>{}).finally(()=>{document.body.dataset.net=net})}catch(e){document.body.dataset.net=net}\n</script></body></html>";

/** What the script may look at: the same state a real agent sees. */
export interface TeacherView {
  phase: Phase;
  /** Learner answers so far in the session. */
  answered: number;
  status: (nodeId: string) => NodeStatus | undefined;
  /** The learner's most recent answer or message. */
  lastAnswer: string | null;
  /** True on the first step after learner input (later steps continue the turn). */
  afterLearner: boolean;
  /** True right after a research result came back. */
  afterResearch?: boolean;
}

/** Decides the next step from the session state alone (like a real agent would). */
export function nextStep(v: TeacherView): Step | null {
  const { answered, status, lastAnswer } = v;
  const s = { phase: v.phase };

  if (s.phase === "chat") {
    if (!v.afterLearner) return null;
    const said = lastAnswer ?? "";
    const ui = (args: Record<string, unknown>, text: string): Step => ({ text, calls: [{ name: "ui_command", args }] });
    if (/paus\w*.*pomodoro/i.test(said)) return ui({ command: "pomodoro_pause" }, "Listo, lo pausé.");
    if (/(retom|segu[ií]|reanud)\w*.*pomodoro/i.test(said)) return ui({ command: "pomodoro_resume" }, "Dale, seguimos.");
    if (/(empez|inici|arranc)\w*.*pomodoro de (\d+)/i.test(said)) return ui({ command: "pomodoro_start", minutes: Number(/pomodoro de (\d+)/i.exec(said)![1]) }, "¡Va! Empieza el foco.");
    if (/(modo|tema) claro/i.test(said)) return ui({ command: "set_theme", theme: "light" }, "Listo, puse el modo claro.");
    if (/(modo|tema) oscuro/i.test(said)) return ui({ command: "set_theme", theme: "dark" }, "Listo, puse el modo oscuro.");
    if (/(apag|quit|silenci)\w*.*sonido/i.test(said)) return ui({ command: "set_sound", enabled: false }, "Apagué el sonido del pomodoro.");
    if (/recordame.*(pararme|agua)|recordatorios? (de|para) (pararme|agua)/i.test(said)) return ui({ command: "set_reminders", stand_minutes: 25, water_minutes: 60 }, "Hecho: te aviso que te pares cada 25 min y que tomes agua cada 60.");
    // AC-160…164: the rest of the app, from the chat.
    if (/pomodoro de (\d+) y descanso de (\d+)/i.test(said)) {
      const [, focus, short] = /pomodoro de (\d+) y descanso de (\d+)/i.exec(said)!;
      return ui({ command: "set_pomodoro", focus: Number(focus), short: Number(short) }, "Listo, cambié las duraciones.");
    }
    if (/me llamo (\p{L}+)/iu.test(said)) return ui({ command: "set_profile", first_name: /me llamo (\p{L}+)/iu.exec(said)![1] }, "¡Encantado! Ya lo anoté en tu perfil.");
    if (/tarjetas de|mazo de/i.test(said))
      return {
        text: "Te armé el mazo: revisá las tarjetas, cambiá lo que quieras y crealo.",
        calls: [{ name: "propose_deck", args: { name: "Verbos irregulares", cards: [{ front: "to go", back: "went · gone" }, { front: "to see", back: "saw · seen" }, { front: "to eat", back: "ate · eaten" }] } }],
      };
    // AC-174: their own exercises — pasted after a line, or a document they attached.
    if (/practicar (estos|esta|mis|la gu)/i.test(said)) {
      const book = /Adjunté a mi biblioteca: «([^»]+)»/.exec(said)?.[1] ?? "";
      const text = book ? "" : said.slice(said.indexOf("\n") + 1).trim();
      return { text: "Dale: revisá los ejercicios que leí y elegí cuáles practicar.", calls: [{ name: "propose_own_problems", args: { title: book || "Mis ejercicios", text, book } }] };
    }
    if (/practicar|pr[aá]ctica de/i.test(said)) return { text: "Dale: elegí las ideas y cuántos problemas.", calls: [{ name: "propose_practice", args: { ideas: ["derivadas"], count: 3 } }] };
    if (/ejercicio de (python|programaci)/i.test(said)) return { text: "Te dejo el ejercicio para generarlo en la consola.", calls: [{ name: "propose_code", args: { language: "python", topic: "recorrer listas con for", level: "básico" } }] };
    if (/estudiar el mazo (.+)/i.test(said)) return { text: "Acá lo tenés.", calls: [{ name: "propose_action", args: { kind: "open_deck", deck: /estudiar el mazo (.+)/i.exec(said)![1].trim(), label: "Estudiar el mazo" } }] };
    if (/simulacro/i.test(said)) return { text: "Abrí la preparación y empezá el simulacro.", calls: [{ name: "propose_action", args: { kind: "open_exam", exam: "AWS Certified Cloud Practitioner", activity: "simulacro", label: "Hacer un simulacro" } }] };
    if (/certificaci[oó]n|examen|rendir/i.test(said) && !/entender|aprender/i.test(said))
      return {
        text: "Genial, armemos tu preparación. Te dejo la tarjeta con lo que me contaste; si tenés la guía o el programa, pegala ahí, y si no, la busco en la web.",
        calls: [{ name: "propose_exam", args: { name: "AWS Certified AI Practitioner", kind: "certification", exam_date: "2026-12-15", hours_per_week: 6 } }],
      };
    if (/pomodoro|pararme|tomar agua|recordatorio/i.test(said))
      return { text: "Te dejo los botones: vos decidís si los tocás.", calls: [{ name: "propose_action", args: { kind: "start_pomodoro", minutes: 25, label: "Empezar un pomodoro de 25 min" } }, { name: "propose_action", args: { kind: "open_screen", screen: "library", label: "Abrir la biblioteca" } }] };
    if (/horario|mis clases|cursada|parcial el|tengo parcial/i.test(said))
      return { text: "Te armé tu cursada con lo que me pasaste. Revisala y, si está bien, guardala.", calls: [{ name: "propose_timetable", args: timetableProposal() as unknown as Record<string, unknown> }] };
    if (/entender|aprender|estudiar|quiero|qu[eé] es|por qu[eé]|c[oó]mo funciona/i.test(said)) {
      const goal = said.replace(/^\s*(hola[,!.\s]*)?(quiero|me gustar[ií]a|necesito)\s+(entender|aprender|estudiar|saber)\s*/i, "").trim() || said.trim();
      return { text: "¡Dale! Armemos eso paso a paso.", calls: [{ name: "begin_learning", args: { goal } }] };
    }
    return { text: "¡Hola! Contame qué te gustaría aprender, o en qué te ayudo hoy." };
  }

  if (s.phase === "probe") {
    // AC-184: «Con esto alcanza» ends the diagnosis with what the teacher already has.
    if (/con esto alcanza/i.test(lastAnswer ?? ""))
      return {
        text: "Dale, con lo que vi alcanza para armar el camino.",
        calls: [
          { name: "record_finding", args: { concept: "Pendiente", level: "partial", evidence: lastAnswer ?? "" } },
          { name: "set_phase", args: { phase: "plan" } },
        ],
      };
    if (answered === 0)
      return {
        text: "¡Buenísimo objetivo! Antes de explicar nada quiero ver desde dónde partís.",
        calls: [ask("Con tus palabras: ¿qué significa que una recta tenga **pendiente 2**?", "probe", undefined, 2)],
      };
    if (answered === 1)
      return {
        calls: [
          { name: "record_finding", args: { concept: "Pendiente", level: "solid", evidence: lastAnswer ?? "" } },
          ask("¿A qué valor se acerca $\\frac{1}{n}$ cuando $n$ se hace cada vez más grande?", "probe", ["A 1", "A 0", "Crece sin límite"], 2),
        ],
      };
    const ok = /0/.test(lastAnswer ?? "");
    return {
      text: "Listo el diagnóstico: la pendiente la tenés firme; el límite " + (ok ? "lo intuís bien." : "conviene repasarlo."),
      calls: [
        { name: "record_finding", args: { concept: "Límite", level: ok ? "partial" : "missing", evidence: lastAnswer ?? "" } },
        { name: "set_phase", args: { phase: "plan" } },
      ],
    };
  }

  if (s.phase === "plan")
    return {
      text: "Este es el camino: de la **pendiente** (que ya sabés) a la **derivada**, pasando por límites y tangentes.",
      calls: [
        { name: "set_plan", args: { nodes: PLAN } },
        { name: "set_phase", args: { phase: "teach" } },
        { name: "update_node", args: { id: "limite", status: "current" } },
        ask("Antes de explicarte: si te acercás a un punto de una curva haciendo zoom infinito, ¿qué creés que ves?", "predict"),
      ],
    };

  if (s.phase === "teach") {
    if (status("limite") === "current")
      return {
        text: "Exacto, esa intuición es la clave. Un **límite** describe a qué valor *se acerca* algo, aunque nunca llegue.\n\n$$\\lim_{n\\to\\infty} \\frac{1}{n} = 0$$",
        calls: [
          { name: "update_node", args: { id: "limite", status: "understood", note: "lo relacionó con hacer zoom" } },
          { name: "update_node", args: { id: "tangente", status: "current" } },
          {
            name: "show_diagram",
            args: { title: "De la secante a la tangente", mermaid: "graph LR\n  A[Secante: 2 puntos] -->|acercar los puntos| B[Límite]\n  B --> C[Tangente: 1 punto]" },
          },
          { name: "show_demo", args: { title: "Acercá los puntos", html: DEMO } },
          ask("Una recta secante corta la curva en 2 puntos. Si acercás esos puntos, ¿en qué se convierte?", "check", ["En la tangente", "En una curva", "Desaparece"]),
        ],
      };
    if (status("tangente") === "current") {
      if (!/tangente/i.test(lastAnswer ?? ""))
        return {
          text: "Casi. Pensalo así: con los dos puntos *pegados*, la recta solo **toca** la curva en uno.",
          calls: [
            { name: "update_node", args: { id: "tangente", status: "repair" } },
            ask("Entonces, ¿cómo se llama la recta que toca la curva en un solo punto?", "check", ["Tangente", "Secante"]),
          ],
        };
      return {
        calls: [
          { name: "update_node", args: { id: "tangente", status: "understood" } },
          { name: "update_node", args: { id: "derivada", status: "current" } },
          ask("Última: si $f(x) = x^2$, ¿cuál es la pendiente de la tangente en $x = 3$?", "check", ["3", "6", "9"]),
        ],
      };
    }
    if (status("tangente") === "repair")
      return {
        text: "¡Eso! Ahora sí.",
        calls: [
          { name: "update_node", args: { id: "tangente", status: "understood", note: "reparado: confundía secante y tangente" } },
          { name: "update_node", args: { id: "derivada", status: "current" } },
          ask("Última: si $f(x) = x^2$, ¿cuál es la pendiente de la tangente en $x = 3$?", "check", ["3", "6", "9"]),
        ],
      };
    if (status("derivada") === "current")
      return {
        text:
          "¡Correcto! Juntando todo:\n\n1. La **pendiente** mide cuánto sube una recta.\n2. Acercando dos puntos (un **límite**), la secante se vuelve **tangente**.\n3. La **derivada** es la pendiente de esa tangente: para $x^2$ vale $2x$, o sea $6$ en $x=3$.",
        calls: [
          { name: "update_node", args: { id: "derivada", status: "understood" } },
          { name: "set_phase", args: { phase: "done" } },
        ],
      };
  }

  // "done" only answers new learner messages; the closing summary ends the arc.
  if (v.afterResearch)
    return { text: "Buena pregunta. Lo mandé a investigar: si encuentro algo, aparece en la tarjeta. Mientras tanto, la idea: la derivada mide cambio instantáneo. ¿Querés profundizar en algo?" };
  if (!v.afterLearner) return null;
  return { calls: [{ name: "research", args: { question: `Para qué sirve: ${lastAnswer ?? "la derivada"}` } }] };
}

