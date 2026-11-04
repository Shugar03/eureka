//! The agent's tools: JSON schemas for the model and their (pure) effect on
//! a session. No IO here, so every rule is unit-testable.

use crate::llm::{Msg, ToolCall};
use crate::session::{Finding, Level, NodeStatus, Phase, PlanNode, Session};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn definitions() -> Value {
    let f = |name: &str, desc: &str, params: Value| {
        json!({ "type": "function", "function": { "name": name, "description": desc, "parameters": params } })
    };
    json!([
        f("ask_question",
          "Le muestra UNA pregunta al aprendiz y termina el turno hasta que responda. El aprendiz responde con texto, confianza (1-5) y su razonamiento.",
          json!({
            "type": "object",
            "properties": {
              "question": { "type": "string", "description": "La pregunta, en Markdown." },
              "purpose": { "type": "string", "enum": ["probe", "predict", "check"] },
              "options": { "type": "array", "items": { "type": "string" },
                           "description": "Opcional: opciones de opción múltiple. Omitir para respuesta abierta." },
              "of": { "type": "integer", "minimum": 1, "maximum": 4,
                      "description": "Solo con purpose probe: cuántas preguntas de diagnóstico calculás hacer en total (2 o 3 lo normal, 4 el tope). El aprendiz ve «pregunta 2 de ~3»; corregilo si cambia tu cálculo." }
            },
            "required": ["question", "purpose"]
          })),
        f("record_finding",
          "Registra lo que el diagnóstico descubrió sobre un prerrequisito.",
          json!({
            "type": "object",
            "properties": {
              "concept": { "type": "string" },
              "level": { "type": "string", "enum": ["solid", "partial", "missing", "misconception"] },
              "evidence": { "type": "string", "description": "Qué lo muestra (cita o paráfrasis de la respuesta)." }
            },
            "required": ["concept", "level", "evidence"]
          })),
        f("set_plan",
          "Reemplaza el plan completo (árbol de dependencias). Mandá todos los nodos con sus estados actuales.",
          json!({
            "type": "object",
            "properties": {
              "nodes": { "type": "array", "items": {
                "type": "object",
                "properties": {
                  "id": { "type": "string" },
                  "title": { "type": "string" },
                  "summary": { "type": "string" },
                  "depends_on": { "type": "array", "items": { "type": "string" } },
                  "status": { "type": "string", "enum": ["known", "pending", "current", "understood", "repair"] }
                },
                "required": ["id", "title", "depends_on", "status"]
              }}
            },
            "required": ["nodes"]
          })),
        f("update_node",
          "Cambia el estado de un nodo del plan.",
          json!({
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "status": { "type": "string", "enum": ["known", "pending", "current", "understood", "repair"] },
              "note": { "type": "string" }
            },
            "required": ["id", "status"]
          })),
        f("show_diagram",
          "Muestra un diagrama Mermaid en la conversación (flujo, secuencia, mapa conceptual). No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "mermaid": { "type": "string", "description": "Código Mermaid válido (ej: graph TD; A-->B)." }
            },
            "required": ["title", "mermaid"]
          })),
        f("show_demo",
          "Muestra una demo interactiva (un documento HTML con CSS y JS inline, sin red ni recursos externos) en un marco aislado. La demo se ve chica en el chat y el aprendiz puede abrirla en un panel o a pantalla completa, así que diseñala para cualquier tamaño: sin anchos fijos en píxeles, con la ilustración (SVG con viewBox) ocupando el espacio disponible y los controles y el texto explicativo juntos, a la vista, sin depender del scroll. No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "html": { "type": "string", "description": "Documento HTML completo y autocontenido." }
            },
            "required": ["title", "html"]
          })),
        f("show_code",
          "Muestra código (un ejemplo o un ejercicio con código inicial) que el aprendiz puede abrir en su consola para ejecutarlo y modificarlo. Vos no lo ejecutás. No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "language": { "type": "string", "enum": crate::runner::Lang::ids() },
              "code": { "type": "string", "description": "Programa completo que se pueda ejecutar tal cual (en Rust, C, C++ y Go con su main; en Java con `public class Main`; en SQL, un script que cree sus tablas)." },
              "task": { "type": "string", "description": "Opcional: qué tiene que hacer el aprendiz con este código." }
            },
            "required": ["title", "language", "code"]
          })),
        f("make_cards",
          "Guarda tarjetas de memoria (repetición espaciada) con lo que el aprendiz acaba de entender, en el mazo de esta sesión, sin preguntar: es para MIENTRAS ENSEÑÁS. Si la persona PIDE un mazo («haceme tarjetas de…»), usá propose_deck. Una idea por tarjeta. No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "cards": { "type": "array", "items": { "type": "object", "properties": {
                "front": { "type": "string", "description": "Pregunta concreta que obliga a recordar" },
                "back": { "type": "string", "description": "Respuesta breve" }
              }, "required": ["front", "back"] }, "description": "Entre 1 y 8" }
            },
            "required": ["cards"]
          })),
        f("recall",
          "Consulta la memoria del aprendiz: ideas que ya entendió (su grafo), confusiones de sesiones anteriores, lo que se habló en otras sesiones (resumen, pendientes) y preguntas de examen que falló. Usalo antes de reenseñar algo o para conectar con lo que ya sabe. Solo lectura. No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "query": { "type": "string", "description": "Palabras clave, con sinónimos (ej.: 'derivada pendiente tangente')" },
              "kind": { "type": "string", "enum": ["todo", "ideas", "confusiones", "sesiones", "examen"], "description": "Qué buscar (por defecto, todo)" }
            },
            "required": ["query"]
          })),
        f("library_search",
          "Busca en la biblioteca del aprendiz (sus PDFs y apuntes, ya indexados) y devuelve fragmentos numerados [L1], [L2]… con libro, sección y página. Usalo ANTES que research cuando el tema puede estar en su bibliografía. Citá con esos números. No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "query": { "type": "string", "description": "Palabras clave con sinónimos, como aparecerían en un libro (ej.: 'calor temperatura transferencia conducción')" }
            },
            "required": ["query"]
          })),
        f("library_read",
          "Lee la sección completa de la que salió un fragmento de library_search (para explicar con el texto del libro). No termina el turno.",
          json!({
            "type": "object",
            "properties": {
              "ref": { "type": "string", "description": "El número del fragmento, ej.: 'L3'" }
            },
            "required": ["ref"]
          })),
        f("research",
          "Busca en la web y devuelve un resumen con fuentes numeradas. Usalo para datos actuales o cuando necesites verificar algo.",
          json!({
            "type": "object",
            "properties": { "question": { "type": "string" } },
            "required": ["question"]
          })),
        f("set_phase",
          "Pasa la sesión a otra fase: probe (medir), plan, teach (enseñar), done.",
          json!({
            "type": "object",
            "properties": { "phase": { "type": "string", "enum": ["probe", "plan", "teach", "done"] } },
            "required": ["phase"]
          })),
        f("begin_learning",
          "Empieza una sesión de aprendizaje con el método de la app (medir lo que ya sabe, planificar y enseñar de a un paso). Usala cuando la persona diga que quiere aprender o entender algo concreto. NO la uses para un saludo, para charla ni para una pregunta suelta que se contesta en un mensaje.",
          json!({
            "type": "object",
            "properties": {
              "goal": { "type": "string", "description": "Qué quiere lograr o entender, en sus palabras, claro y concreto." },
              "title": { "type": "string", "description": "Título corto para la lista de sesiones (3 a 6 palabras, ej.: «Certificación AWS AI»)." },
              "topics": { "type": "array", "items": { "type": "string" }, "description": "Opcional: los temas que nombró, si son varios." }
            },
            "required": ["goal"]
          })),
        f("propose_timetable",
          "Le propone a la persona guardar en Mi cursada su horario de clases y/o fechas importantes (parciales, TPs, finales). NO se guarda hasta que ella lo confirme con un botón. Usala cuando pegue o cuente su horario o sus fechas; resolvé días de la semana y fechas relativas con la fecha de hoy del estado.",
          crate::academic::proposal_schema()),
        f("propose_exam",
          "Le propone a la persona crear su preparación de un examen o certificación (la misma que arma en «Exámenes»). NO se crea hasta que ella lo confirme con un botón. Usala cuando diga que quiere prepararse para un examen, certificación o materia, apenas sepas cuál es; la fecha, la guía y las horas son opcionales y se pueden completar después. Si la persona pegó la guía o el programa, mandalo en `guide`; si no, la tarjeta ofrece buscarla en la web o pegarla.",
          json!({
            "type": "object",
            "properties": {
              "name": { "type": "string", "description": "Nombre exacto del examen, certificación o materia." },
              "kind": { "type": "string", "enum": ["certification", "subject"], "description": "certification (por defecto) o subject (materia con programa)." },
              "exam_date": { "type": "string", "description": "Fecha del examen, AAAA-MM-DD (resolvé «el 15 de diciembre» con la fecha de hoy del estado). Omitir si no la dijo." },
              "hours_per_week": { "type": "number", "description": "Horas por semana que puede estudiar (0,5 a 80). Omitir si no lo dijo." },
              "passing_pct": { "type": "number", "description": "Nota para aprobar en % (1 a 100). Omitir si no la dijo." },
              "guide": { "type": "string", "description": "Texto de la guía o programa SOLO si la persona lo pegó o lo compilaste de fuentes; no lo inventes." }
            },
            "required": ["name"]
          })),
        f("propose_deck",
          "Le propone a la persona un MAZO de tarjetas nuevo cuando ella lo pide («haceme tarjetas de los verbos irregulares»). Ve las tarjetas, las puede editar o sacar, y el mazo se crea recién cuando lo confirma. Para guardar tarjetas mientras enseñás, sin preguntar, usá make_cards.",
          json!({
            "type": "object",
            "properties": {
              "name": { "type": "string", "description": "Nombre corto del mazo." },
              "cards": { "type": "array", "items": { "type": "object", "properties": {
                "front": { "type": "string", "description": "Pregunta concreta que obliga a recordar" },
                "back": { "type": "string", "description": "Respuesta breve" }
              }, "required": ["front", "back"] }, "description": "Entre 1 y 40" }
            },
            "required": ["name", "cards"]
          })),
        f("propose_practice",
          "Le propone a la persona una PRÁCTICA (problemas que se corrigen) sobre ideas que ya entendió, las de su grafo. Ella elige las ideas y cuántos problemas; se genera recién cuando confirma (gasta modelo).",
          json!({
            "type": "object",
            "properties": {
              "ideas": { "type": "array", "items": { "type": "string" }, "description": "De 1 a 8 ideas o temas, con las palabras del grafo si las conocés." },
              "count": { "type": "integer", "description": "Cuántos problemas (1 a 10, por defecto 3)." }
            },
            "required": ["ideas"]
          })),
        f("propose_own_problems",
          "Le propone a la persona practicar SUS PROPIOS ejercicios (una guía, un parcial viejo, una foto de la pizarra) cuando los trae y quiere practicarlos. Mandá el texto de los ejercicios tal como llegó (de su mensaje o de la imagen adjunta), o el título del documento de su biblioteca si lo adjuntó como PDF. Ella revisa lo leído y decide si practica.",
          json!({
            "type": "object",
            "properties": {
              "title": { "type": "string", "description": "Nombre corto de la práctica (ej.: 'Guía 3 de Física')." },
              "text": { "type": "string", "description": "Los enunciados tal como los trajo, sin resolverlos ni resumirlos." },
              "book": { "type": "string", "description": "Título del documento de su biblioteca que tiene los ejercicios, en vez de text." }
            }
          })),
        f("propose_code",
          "Le propone a la persona un EJERCICIO DE PROGRAMACIÓN en la consola de Código (se genera, se ejecuta y se corrige ahí). Se genera recién cuando confirma; puede cambiar el tema y el nivel antes.",
          json!({
            "type": "object",
            "properties": {
              "language": { "type": "string", "enum": crate::runner::Lang::ids() },
              "topic": { "type": "string", "description": "Tema del ejercicio (ej.: «recorrer listas con for»)." },
              "level": { "type": "string", "enum": ["básico", "medio", "avanzado"] }
            },
            "required": ["language", "topic"]
          })),
        f("propose_action",
          "Le ofrece a la persona un botón para hacer algo en la app. NO se ejecuta hasta que ella lo toque. kind: open_screen (abre una pantalla), start_pomodoro (un bloque de foco), set_reminders (recordatorios de pararse y de tomar agua), open_exam (abre la preparación de un examen por su nombre, para un simulacro, la hoja de repaso o el repaso de falladas) u open_deck (abre un mazo por su nombre para estudiarlo).",
          json!({
            "type": "object",
            "properties": {
              "kind": { "type": "string", "enum": ["open_screen", "start_pomodoro", "set_reminders", "open_exam", "open_deck"] },
              "label": { "type": "string", "description": "Texto del botón, corto (ej.: «Abrir la biblioteca»)." },
              "screen": { "type": "string", "enum": ["library", "practice", "exams", "cards", "agenda", "code", "language", "graph", "companion", "academic", "classes", "progress", "settings"], "description": "Solo para open_screen." },
              "minutes": { "type": "integer", "description": "Solo para start_pomodoro: minutos de foco (5 a 90, por defecto 25)." },
              "stand_minutes": { "type": "integer", "description": "Solo para set_reminders: cada cuántos minutos avisar que se pare (10 a 240)." },
              "water_minutes": { "type": "integer", "description": "Solo para set_reminders: cada cuántos minutos avisar que tome agua (10 a 240)." },
              "exam": { "type": "string", "description": "Solo para open_exam: el nombre de la preparación, como figura en app_status." },
              "activity": { "type": "string", "enum": ["simulacro", "hoja", "repaso"], "description": "Solo para open_exam: para qué se abre." },
              "deck": { "type": "string", "description": "Solo para open_deck: el nombre del mazo, como figura en app_status." }
            },
            "required": ["kind", "label"]
          })),
        f("app_status",
          "Mira cómo viene la persona en la app: exámenes y fechas, tarjetas para hoy, minutos de estudio, sesiones y libros. Usala para contestar «¿cómo vengo?», «¿qué tengo para hoy?» o antes de sugerir qué estudiar. Solo lee; no cambia nada.",
          json!({ "type": "object", "properties": {} })),
        f("ui_command",
          "EJECUTA ya un control de la app, porque la persona lo pidió en sus palabras (\"pausá el pomodoro\", \"poné el modo claro\", \"apagá el sonido\"). Si en cambio lo estás sugiriendo vos, ofrecelo con propose_action y que ella decida. command: pomodoro_start (minutes 5-90, por defecto 25), pomodoro_pause, pomodoro_resume, pomodoro_skip, pomodoro_reset, set_theme (theme), set_wallpaper (wallpaper), set_accent (accent), set_sound (enabled, tick_tock), set_reminders (stand_minutes, water_minutes; 0 los apaga), set_accessibility (text_size, spacing, reduce_motion, read_aloud, easy_reading, literal, short_steps, dictation), set_pomodoro (focus 5-120, short 1-60, long 1-90, every 2-8: duraciones en minutos y cada cuántos focos va el descanso largo), set_profile (first_name, school, career, treatment el|ella|elle|ninguno: solo lo que la persona dijo de sí).",
          json!({
            "type": "object",
            "properties": {
              "command": { "type": "string", "enum": ["pomodoro_start", "pomodoro_pause", "pomodoro_resume", "pomodoro_skip", "pomodoro_reset", "set_theme", "set_wallpaper", "set_accent", "set_sound", "set_reminders", "set_accessibility", "set_pomodoro", "set_profile"] },
              "minutes": { "type": "integer", "description": "pomodoro_start: minutos de foco (5 a 90)." },
              "theme": { "type": "string", "enum": ["dark", "light", "system"] },
              "wallpaper": { "type": "string", "enum": ["auto", "none", "amanecer", "noche", "bosque", "atardecer", "oceano", "lavanda"] },
              "accent": { "type": "string", "description": "\"auto\" (el color del fondo) o un color #rrggbb." },
              "enabled": { "type": "boolean", "description": "set_sound: todos los sonidos del pomodoro." },
              "tick_tock": { "type": "boolean", "description": "set_sound: el tic-tac de los últimos segundos." },
              "stand_minutes": { "type": "integer", "description": "set_reminders: cada cuántos minutos avisar que se pare (10 a 240); 0 lo apaga." },
              "water_minutes": { "type": "integer", "description": "set_reminders: cada cuántos minutos avisar que tome agua (10 a 240); 0 lo apaga." },
              "text_size": { "type": "string", "enum": ["normal", "large", "larger"] },
              "spacing": { "type": "boolean" },
              "reduce_motion": { "type": "boolean" },
              "read_aloud": { "type": "boolean" },
              "easy_reading": { "type": "boolean" },
              "literal": { "type": "boolean" },
              "short_steps": { "type": "boolean" },
              "dictation": { "type": "boolean" },
              "focus": { "type": "integer", "description": "set_pomodoro: minutos de foco (5 a 120)." },
              "short": { "type": "integer", "description": "set_pomodoro: minutos del descanso corto (1 a 60)." },
              "long": { "type": "integer", "description": "set_pomodoro: minutos del descanso largo (1 a 90)." },
              "every": { "type": "integer", "description": "set_pomodoro: cada cuántos focos va el descanso largo (2 a 8)." },
              "first_name": { "type": "string", "description": "set_profile: su nombre de pila, como lo dijo." },
              "school": { "type": "string", "description": "set_profile: dónde estudia." },
              "career": { "type": "string", "description": "set_profile: qué estudia." },
              "treatment": { "type": "string", "enum": ["el", "ella", "elle", "ninguno"], "description": "set_profile: cómo pidió que le hables." }
            },
            "required": ["command"]
          })),
    ])
}

/// What the agent loop should do after a tool runs.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Tool executed; send this result back to the model and keep looping.
    Result(String),
    /// A question is now pending: stop the turn and wait for the learner.
    AwaitLearner,
}

#[derive(Deserialize)]
struct FindingArgs {
    concept: String,
    level: Level,
    evidence: String,
}

#[derive(Deserialize)]
struct PlanArgs {
    nodes: Vec<PlanNodeArgs>,
}

#[derive(Deserialize)]
struct PlanNodeArgs {
    id: String,
    title: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    depends_on: Vec<String>,
    status: NodeStatus,
}

#[derive(Deserialize)]
struct UpdateArgs {
    id: String,
    status: NodeStatus,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Deserialize)]
struct PhaseArgs {
    phase: Phase,
}

#[derive(Deserialize)]
struct BeginArgs {
    goal: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    topics: Vec<String>,
}

/// The longest session title kept for the list.
const TITLE_MAX: usize = 60;
/// The longest goal (with its topics) kept in the session state.
const GOAL_MAX: usize = 400;

/// `s` cut to at most `max` characters at a word boundary, with "…" if it was cut.
fn shorten(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max.saturating_sub(1)).collect();
    // Back to the last space, unless that would throw away most of it.
    let at_word = match cut.rfind(char::is_whitespace) {
        Some(i) if cut[..i].chars().count() >= max / 2 => cut[..i].to_string(),
        _ => cut,
    };
    format!("{}…", at_word.trim_end_matches(|c: char| c.is_whitespace() || ",;:.-–—(".contains(c)))
}

/// The goal with its topics appended; a topic that doesn't fit whole is left out, never cut.
fn goal_with_topics(goal: &str, topics: &[String]) -> String {
    let goal = shorten(goal, GOAL_MAX);
    let mut kept: Vec<&str> = Vec::new();
    for t in topics {
        let with = format!("{goal} (temas: {})", kept.iter().copied().chain(std::iter::once(t.as_str())).collect::<Vec<_>>().join("; "));
        if with.chars().count() > GOAL_MAX {
            break;
        }
        kept.push(t);
    }
    if kept.is_empty() {
        goal
    } else {
        format!("{goal} (temas: {})", kept.join("; "))
    }
}

#[derive(Deserialize)]
struct ActionArgs {
    kind: String,
    label: String,
    #[serde(default)]
    exam: Option<String>,
    #[serde(default)]
    activity: Option<String>,
    #[serde(default)]
    deck: Option<String>,
    #[serde(default)]
    screen: Option<String>,
    #[serde(default)]
    minutes: Option<u32>,
    #[serde(default)]
    stand_minutes: Option<u32>,
    #[serde(default)]
    water_minutes: Option<u32>,
}

#[derive(Deserialize)]
struct ExamArgs {
    name: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    exam_date: Option<String>,
    #[serde(default)]
    hours_per_week: Option<f64>,
    #[serde(default)]
    passing_pct: Option<f64>,
    #[serde(default)]
    guide: Option<String>,
}

/// Checks a `propose_exam` before it reaches the screen; the UI trusts what passes.
fn check_exam(a: &ExamArgs) -> Result<String, String> {
    let name = a.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("error: el examen necesita un nombre (hasta 120 caracteres)".into());
    }
    if a.kind.as_deref().is_some_and(|k| !["certification", "subject"].contains(&k)) {
        return Err("error: kind tiene que ser certification o subject".into());
    }
    if let Some(d) = a.exam_date.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| "error: exam_date va como AAAA-MM-DD".to_string())?;
    }
    if a.hours_per_week.is_some_and(|h| !(0.5..=80.0).contains(&h)) {
        return Err("error: hours_per_week va de 0,5 a 80".into());
    }
    if a.passing_pct.is_some_and(|p| !(1.0..=100.0).contains(&p)) {
        return Err("error: passing_pct va de 1 a 100".into());
    }
    let guide = a.guide.as_deref().map(str::trim).filter(|g| !g.is_empty());
    Ok(match guide {
        Some(g) => format!("propuesta mostrada: «{name}» con la guía que mandaste ({} caracteres)", g.chars().count()),
        None => format!("propuesta mostrada: «{name}» sin guía; la persona puede pedir que se busque en la web o pegarla"),
    })
}

const THEMES: &[&str] = &["dark", "light", "system"];
const WALLPAPERS: &[&str] = &["auto", "none", "amanecer", "noche", "bosque", "atardecer", "oceano", "lavanda"];
const A11Y_FLAGS: &[&str] = &["spacing", "reduce_motion", "read_aloud", "easy_reading", "literal", "short_steps", "dictation"];

/// AC-122: validates a `ui_command` and returns it normalised (what the screen runs)
/// with a line for the model saying what was done. The screen trusts what passes.
pub fn check_ui_command(raw: &str) -> Result<(Value, String), String> {
    let a: Value = serde_json::from_str(raw).map_err(|e| format!("error: argumentos inválidos ({e})"))?;
    let cmd = a["command"].as_str().unwrap_or("");
    let int = |k: &str, lo: i64, hi: i64| -> Result<Option<i64>, String> {
        match a.get(k).filter(|v| !v.is_null()) {
            None => Ok(None),
            Some(v) => v.as_i64().filter(|n| (lo..=hi).contains(n)).map(Some).ok_or(format!("error: {k} va de {lo} a {hi}")),
        }
    };
    let one_of = |k: &str, list: &[&str]| -> Result<String, String> {
        a[k].as_str().filter(|v| list.contains(v)).map(String::from).ok_or(format!("error: {k} tiene que ser uno de {}", list.join(", ")))
    };
    let flag = |k: &str| a.get(k).and_then(Value::as_bool);
    let (out, said): (Value, String) = match cmd {
        "pomodoro_start" => {
            let m = int("minutes", 5, 90)?.unwrap_or(25);
            (json!({ "command": cmd, "minutes": m }), format!("pomodoro de {m} min en marcha"))
        }
        "pomodoro_pause" => (json!({ "command": cmd }), "pomodoro en pausa".into()),
        "pomodoro_resume" => (json!({ "command": cmd }), "pomodoro retomado".into()),
        "pomodoro_skip" => (json!({ "command": cmd }), "saltó a la siguiente etapa del pomodoro".into()),
        "pomodoro_reset" => (json!({ "command": cmd }), "pomodoro reiniciado".into()),
        "set_theme" => {
            let t = one_of("theme", THEMES)?;
            (json!({ "command": cmd, "theme": t }), format!("tema {t}"))
        }
        "set_wallpaper" => {
            let w = one_of("wallpaper", WALLPAPERS)?;
            (json!({ "command": cmd, "wallpaper": w }), format!("fondo {w}"))
        }
        "set_accent" => {
            let c = a["accent"].as_str().map(str::trim).unwrap_or("");
            let hex = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
            if c != "auto" && !hex {
                return Err("error: accent tiene que ser \"auto\" o un color #rrggbb".into());
            }
            (json!({ "command": cmd, "accent": c.to_lowercase() }), format!("color de acento {c}"))
        }
        "set_sound" => {
            let (enabled, tick) = (flag("enabled"), flag("tick_tock"));
            if enabled.is_none() && tick.is_none() {
                return Err("error: indicá enabled y/o tick_tock".into());
            }
            (json!({ "command": cmd, "enabled": enabled, "tick_tock": tick }), "sonido del pomodoro actualizado".into())
        }
        "set_reminders" => {
            let (stand, water) = (int("stand_minutes", 0, 240)?, int("water_minutes", 0, 240)?);
            let bad = |m: Option<i64>| m.is_some_and(|n| n != 0 && n < 10);
            if bad(stand) || bad(water) {
                return Err("error: los minutos van de 10 a 240 (o 0 para apagar)".into());
            }
            if stand.is_none() && water.is_none() {
                return Err("error: indicá stand_minutes y/o water_minutes".into());
            }
            (json!({ "command": cmd, "stand_minutes": stand, "water_minutes": water }), "recordatorios actualizados".into())
        }
        "set_accessibility" => {
            let size = a.get("text_size").filter(|v| !v.is_null());
            if let Some(v) = size {
                if !v.as_str().is_some_and(|s| ["normal", "large", "larger"].contains(&s)) {
                    return Err("error: text_size tiene que ser normal, large o larger".into());
                }
            }
            let flags: Vec<&str> = A11Y_FLAGS.iter().copied().filter(|k| flag(k).is_some()).collect();
            if size.is_none() && flags.is_empty() {
                return Err("error: indicá al menos un ajuste de accesibilidad".into());
            }
            let mut o = json!({ "command": cmd, "text_size": size });
            for k in flags {
                o[k] = json!(flag(k));
            }
            (o, "ajustes de accesibilidad actualizados".into())
        }
        "set_pomodoro" => {
            let (focus, short, long, every) = (int("focus", 5, 120)?, int("short", 1, 60)?, int("long", 1, 90)?, int("every", 2, 8)?);
            if focus.is_none() && short.is_none() && long.is_none() && every.is_none() {
                return Err("error: indicá focus, short, long y/o every".into());
            }
            (json!({ "command": cmd, "focus": focus, "short": short, "long": long, "every": every }), "duraciones del pomodoro actualizadas".into())
        }
        "set_profile" => {
            // The same limits as the profile screen (Identity::clamped).
            let text = |k: &str, n: usize| -> Result<Option<String>, String> {
                match a.get(k).filter(|v| !v.is_null()) {
                    None => Ok(None),
                    Some(v) => v.as_str().map(str::trim).filter(|s| !s.is_empty() && s.chars().count() <= n).map(|s| Some(s.to_string())).ok_or(format!("error: {k} va con texto de hasta {n} caracteres")),
                }
            };
            let (name, school, career) = (text("first_name", 40)?, text("school", 80)?, text("career", 80)?);
            let treatment = match a.get("treatment").filter(|v| !v.is_null()) {
                None => None,
                Some(v) => Some(v.as_str().filter(|t| ["el", "ella", "elle", "ninguno"].contains(t)).ok_or("error: treatment tiene que ser el, ella, elle o ninguno")?.to_string()),
            };
            if name.is_none() && school.is_none() && career.is_none() && treatment.is_none() {
                return Err("error: indicá first_name, school, career y/o treatment".into());
            }
            (json!({ "command": cmd, "first_name": name, "school": school, "career": career, "treatment": treatment }), "perfil actualizado".into())
        }
        other => return Err(format!("error: comando desconocido '{other}'")),
    };
    Ok((out, format!("ejecutado: {said}")))
}

/// Screens `propose_action` can open (the app's routes).
pub const SCREENS: &[&str] = &["library", "practice", "exams", "cards", "agenda", "code", "language", "graph", "companion", "academic", "classes", "progress", "settings"];

/// Checks a `propose_action` before it reaches the screen; the UI trusts what passes.
fn check_action(a: &ActionArgs) -> Result<(), String> {
    if a.label.trim().is_empty() || a.label.chars().count() > 60 {
        return Err("error: el botón necesita un texto corto (hasta 60 caracteres)".into());
    }
    let in_range = |v: Option<u32>, lo: u32, hi: u32| v.is_none_or(|x| (lo..=hi).contains(&x));
    match a.kind.as_str() {
        "open_screen" => match a.screen.as_deref() {
            Some(sc) if SCREENS.contains(&sc) => Ok(()),
            _ => Err(format!("error: screen tiene que ser una de {}", SCREENS.join(", "))),
        },
        "start_pomodoro" if in_range(a.minutes, 5, 90) => Ok(()),
        "start_pomodoro" => Err("error: minutes va de 5 a 90".into()),
        "set_reminders" if a.stand_minutes.is_none() && a.water_minutes.is_none() => Err("error: indicá stand_minutes o water_minutes".into()),
        "set_reminders" if in_range(a.stand_minutes, 10, 240) && in_range(a.water_minutes, 10, 240) => Ok(()),
        "set_reminders" => Err("error: los minutos van de 10 a 240".into()),
        "open_exam" if !named(&a.exam) => Err("error: open_exam necesita exam, el nombre de la preparación".into()),
        "open_exam" if a.activity.as_deref().is_some_and(|x| !["simulacro", "hoja", "repaso"].contains(&x)) => Err("error: activity tiene que ser simulacro, hoja o repaso".into()),
        "open_exam" => Ok(()),
        "open_deck" if !named(&a.deck) => Err("error: open_deck necesita deck, el nombre del mazo".into()),
        "open_deck" => Ok(()),
        other => Err(format!("error: tipo de acción desconocido '{other}'")),
    }
}

fn named(v: &Option<String>) -> bool {
    v.as_deref().map(str::trim).is_some_and(|n| !n.is_empty() && n.chars().count() <= 120)
}

#[derive(Deserialize)]
struct DeckCard {
    front: String,
    back: String,
}

#[derive(Deserialize)]
struct DeckArgs {
    name: String,
    cards: Vec<DeckCard>,
}

/// AC-161: a deck the person asked for, checked before it reaches the card.
fn check_deck(a: &DeckArgs) -> Result<String, String> {
    let name = a.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("error: el mazo necesita un nombre (hasta 80 caracteres)".into());
    }
    if a.cards.is_empty() || a.cards.len() > 40 {
        return Err("error: mandá entre 1 y 40 tarjetas".into());
    }
    if let Some(i) = a.cards.iter().position(|c| c.front.trim().is_empty() || c.back.trim().is_empty() || c.front.len() > crate::cards::MAX_TEXT || c.back.len() > crate::cards::MAX_TEXT) {
        return Err(format!("error: la tarjeta {} necesita frente y dorso (hasta {} caracteres cada uno)", i + 1, crate::cards::MAX_TEXT));
    }
    Ok(format!("propuesta mostrada: el mazo «{name}» con {} tarjetas. La persona las puede editar y decide si lo crea; no digas que ya está creado.", a.cards.len()))
}

#[derive(Deserialize)]
struct PracticeArgs {
    ideas: Vec<String>,
    #[serde(default)]
    count: Option<u32>,
}

#[derive(Deserialize)]
struct OwnArgs {
    #[serde(default)]
    title: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    book: String,
}

#[derive(Deserialize)]
struct ProposeCodeArgs {
    language: String,
    topic: String,
    #[serde(default)]
    level: Option<String>,
}

pub const MAX_DIAGRAM_BYTES: usize = 20_000;
pub const MAX_DEMO_BYTES: usize = 100_000;
pub const MAX_CODE_BYTES: usize = 50_000;

#[derive(Deserialize)]
struct DiagramArgs {
    title: String,
    mermaid: String,
}

#[derive(Deserialize)]
struct CodeArgs {
    title: String,
    language: String,
    code: String,
}

#[derive(Deserialize)]
struct DemoArgs {
    title: String,
    html: String,
}

#[derive(Deserialize)]
struct QuestionArgs {
    question: String,
    #[serde(default)]
    purpose: Option<String>,
    #[serde(default)]
    options: Option<Vec<String>>,
    #[serde(default)]
    of: Option<u8>,
}

/// The diagnosis is short on purpose: past this many probe questions the agent has to plan with what it has.
pub const PROBE_MAX: usize = 4;

/// How many diagnostic questions were already asked, not counting the call being applied.
fn probe_questions_asked(s: &Session, current_call: &str) -> usize {
    s.messages
        .iter()
        .flat_map(|m| m.tool_calls.iter().flatten())
        .filter(|c| c.id != current_call && c.function.name == "ask_question")
        .filter(|c| serde_json::from_str::<serde_json::Value>(&c.function.arguments).ok().and_then(|v| v.get("purpose").and_then(|p| p.as_str()).map(str::to_owned)).as_deref() == Some("probe"))
        .count()
}

/// Audit item 6: a phase change needs what the next phase builds on.
fn check_transition(s: &Session, to: Phase) -> Result<(), String> {
    match (s.phase, to) {
        (_, Phase::Chat) => Err("error: no se vuelve a la charla libre; para empezar a aprender usá begin_learning".into()),
        (Phase::Chat, _) => Err("error: todavía no empezó el aprendizaje; usá begin_learning cuando la persona diga qué quiere aprender".into()),
        (Phase::Probe, Phase::Plan) if s.findings.is_empty() => Err("error: para planificar primero medí: registrá al menos un hallazgo con record_finding".into()),
        (_, Phase::Teach) if s.plan.is_empty() => Err("error: no se puede enseñar sin plan; llamá set_plan primero".into()),
        (_, Phase::Done) if s.plan.is_empty() => Err("error: no se puede cerrar sin plan".into()),
        (_, Phase::Done) => {
            let goal = s.plan.last().unwrap();
            if goal.status == NodeStatus::Understood {
                Ok(())
            } else {
                Err(format!("error: para cerrar, el objetivo `{}` tiene que estar understood; verificalo con una pregunta de check y después update_node", goal.id))
            }
        }
        _ => Ok(()),
    }
}

/// What's expected right after a phase change (the next step's prompt says more).
fn phase_hint(p: Phase) -> &'static str {
    match p {
        Phase::Chat => "Conversá y usá tus herramientas con criterio.",
        Phase::Probe => "Medí con preguntas cortas y registrá cada hallazgo.",
        Phase::Plan => "Armá el plan con set_plan y explicáselo en el mismo mensaje.",
        Phase::Teach => "Empezá con update_node (current) en el primer nodo enseñable y una pregunta predict.",
        Phase::Done => "Cerrá con un resumen corto y qué repasar.",
    }
}

/// Audit item 21: fewer tools per phase is less confusion, and each phase's
/// list is fixed (cache-friendly). Teach and done see everything but `begin_learning`.
pub fn definitions_for(phase: Phase) -> Value {
    let keep: &[&str] = match phase {
        Phase::Chat => &["begin_learning", "recall", "library_search", "library_read", "research", "show_diagram", "show_demo", "show_code", "make_cards", "propose_action", "propose_timetable", "propose_exam", "propose_deck", "propose_practice", "propose_own_problems", "propose_code", "app_status", "ui_command"],
        // The app's controls are within reach in every phase ("pausá el pomodoro" mid-diagnosis).
        Phase::Probe => &["ask_question", "record_finding", "recall", "set_phase", "library_search", "research", "ui_command"],
        Phase::Plan => &["ask_question", "record_finding", "recall", "set_phase", "library_search", "library_read", "research", "set_plan", "update_node", "show_diagram", "ui_command"],
        // Teach and done: everything except what only makes sense before the method starts.
        Phase::Teach | Phase::Done => {
            return Value::Array(definitions().as_array().unwrap().iter().filter(|d| d["function"]["name"] != "begin_learning").cloned().collect());
        }
    };
    Value::Array(definitions().as_array().unwrap().iter().filter(|d| keep.contains(&d["function"]["name"].as_str().unwrap_or(""))).cloned().collect())
}

/// The next node to teach: the first pending/repair one whose dependencies are done.
fn next_teachable(plan: &[PlanNode]) -> Option<&PlanNode> {
    let done = |id: &str| plan.iter().any(|n| n.id == id && matches!(n.status, NodeStatus::Known | NodeStatus::Understood));
    plan.iter().find(|n| matches!(n.status, NodeStatus::Pending | NodeStatus::Repair) && n.depends_on.iter().all(|d| done(d)))
}

/// One line about where the plan stands, for tool results (audit §3.1).
fn plan_status(plan: &[PlanNode]) -> String {
    let todo = plan.iter().filter(|n| n.status != NodeStatus::Known).count();
    let done = plan.iter().filter(|n| n.status == NodeStatus::Understood).count();
    match next_teachable(plan) {
        Some(n) => format!("{done}/{todo} entendidos; próximo enseñable: `{}` {}", n.id, n.title),
        None if done == todo && todo > 0 => format!("{done}/{todo} entendidos: el plan está completo; verificá el objetivo y pasá a `done`"),
        None => format!("{done}/{todo} entendidos"),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(call: &ToolCall) -> Result<T, String> {
    serde_json::from_str(&call.function.arguments).map_err(|e| format!("error: argumentos inválidos ({e})"))
}

/// Applies one tool call to the session. Errors are returned to the model as
/// tool results so it can correct itself.
pub fn apply(s: &mut Session, call: &ToolCall) -> Outcome {
    let r = match call.function.name.as_str() {
        "ask_question" => {
            if s.pending_question.is_some() {
                return Outcome::Result("ignorada: una pregunta por vez; ya hay una pregunta esperando respuesta.".into());
            }
            match parse::<QuestionArgs>(call) {
                Ok(q) if q.purpose.as_deref().is_some_and(|p| !["probe", "predict", "check"].contains(&p)) => {
                    Err("error: purpose tiene que ser probe, predict o check".into())
                }
                Ok(q) if q.options.as_ref().is_some_and(|o| !o.is_empty() && !(2..=6).contains(&o.len())) => {
                    Err("error: si das opciones, que sean entre 2 y 6".into())
                }
                Ok(q) if q.of.is_some_and(|n| !(1..=PROBE_MAX as u8).contains(&n)) => Err(format!("error: of tiene que estar entre 1 y {PROBE_MAX}")),
                Ok(q) if q.purpose.as_deref() == Some("probe") && s.phase == Phase::Probe && probe_questions_asked(s, &call.id) >= PROBE_MAX => {
                    return Outcome::Result(format!("ignorada: ya hiciste {PROBE_MAX} preguntas de diagnóstico, que es el tope. Registrá lo que sabés con record_finding y pasá a plan con set_phase."));
                }
                Ok(q) if !q.question.trim().is_empty() => {
                    s.pending_question = Some(call.id.clone());
                    return Outcome::AwaitLearner;
                }
                Ok(_) => Err("error: la pregunta está vacía".into()),
                Err(e) => Err(e),
            }
        }
        "record_finding" => parse::<FindingArgs>(call).map(|a| {
            // One finding per concept: newer evidence replaces older.
            s.findings.retain(|f| !f.concept.eq_ignore_ascii_case(&a.concept));
            s.findings.push(Finding { concept: a.concept, level: a.level, evidence: a.evidence });
            format!("hallazgo guardado ({} en total)", s.findings.len())
        }),
        "set_plan" => parse::<PlanArgs>(call).and_then(|a| set_plan(s, a)),
        "update_node" => parse::<UpdateArgs>(call).and_then(|a| {
            let ids: Vec<String> = s.plan.iter().map(|n| n.id.clone()).collect();
            let node = s.plan.iter_mut().find(|n| n.id == a.id).ok_or(format!("error: no existe el nodo '{}'; los ids son: {}", a.id, ids.join(", ")))?;
            node.status = a.status;
            if let Some(n) = a.note {
                node.note = n;
            }
            // Only one node is "current" at a time.
            if a.status == NodeStatus::Current {
                for n in s.plan.iter_mut().filter(|n| n.id != a.id && n.status == NodeStatus::Current) {
                    n.status = NodeStatus::Pending;
                }
            }
            Ok(format!("ok: `{}` → {}. {}", a.id, format!("{:?}", a.status).to_lowercase(), plan_status(&s.plan)))
        }),
        "begin_learning" => parse::<BeginArgs>(call).and_then(|a| {
            if s.phase != Phase::Chat {
                return Err("error: ya hay una sesión de aprendizaje en curso; seguí con la fase actual".into());
            }
            let goal = a.goal.trim();
            if goal.is_empty() {
                return Err("error: contá qué quiere entender".into());
            }
            let topics: Vec<String> = a.topics.iter().map(|t| t.trim().chars().take(120).collect::<String>()).filter(|t| !t.is_empty()).take(8).collect();
            s.goal = goal_with_topics(goal, &topics);
            // A short title of its own if the model gave one; else the goal, cut at a word.
            s.title = shorten(a.title.as_deref().filter(|t| !t.trim().is_empty()).unwrap_or(goal), TITLE_MAX);
            s.phase = Phase::Probe;
            Ok(format!("Empezó la sesión de aprendizaje: «{}». Fase: probe. {}", s.goal, phase_hint(Phase::Probe)))
        }),
        "propose_timetable" => serde_json::from_str::<crate::academic::Proposal>(&call.function.arguments)
            .map_err(|e| format!("error: argumentos inválidos ({e})"))
            .and_then(|p| crate::academic::check_proposal(p).map_err(|e| format!("error: {e}")))
            .map(|p| format!("propuesta mostrada: {} materias y {} fechas. La persona decide si las guarda en Mi cursada; no digas que ya están guardadas.", p.courses.len(), p.dates.len())),
        "ui_command" => check_ui_command(&call.function.arguments).map(|(_, said)| said),
        "propose_exam" => parse::<ExamArgs>(call).and_then(|a| {
            check_exam(&a).map(|m| format!("{m}. La persona decide si la crea; no digas que ya está creada."))
        }),
        "propose_deck" => parse::<DeckArgs>(call).and_then(|a| check_deck(&a)),
        "propose_practice" => parse::<PracticeArgs>(call).and_then(|a| {
            let ideas: Vec<&str> = a.ideas.iter().map(|i| i.trim()).filter(|i| !i.is_empty()).collect();
            if ideas.is_empty() || ideas.len() > 8 || ideas.iter().any(|i| i.chars().count() > 160) {
                return Err("error: mandá de 1 a 8 ideas cortas".into());
            }
            if a.count.is_some_and(|c| !(1..=10).contains(&c)) {
                return Err("error: count va de 1 a 10".into());
            }
            Ok(format!("propuesta mostrada: práctica sobre {}. La persona elige las ideas de su grafo y decide si la genera; no digas que ya está hecha.", ideas.join(", ")))
        }),
        // AC-174: the person's own exercises, from what they sent or a document of their library.
        "propose_own_problems" => parse::<OwnArgs>(call).and_then(|a| {
            let (text, book) = (a.text.trim(), a.book.trim());
            if text.is_empty() && book.is_empty() {
                return Err("error: mandá text (los enunciados) o book (el título del documento de su biblioteca)".into());
            }
            if text.chars().count() > 30_000 || a.title.chars().count() > 80 || book.chars().count() > 200 {
                return Err("error: text hasta 30000 caracteres, title hasta 80".into());
            }
            let from = if book.is_empty() { "lo que mandó".to_string() } else { format!("«{book}» de su biblioteca") };
            Ok(format!("propuesta mostrada: practicar sus propios ejercicios de {from}. La persona los lee, los revisa y decide si practica; no digas que ya está hecha ni resuelvas los ejercicios en el chat."))
        }),
        "propose_code" => parse::<ProposeCodeArgs>(call).and_then(|a| {
            if crate::runner::Lang::from_id(&a.language).is_none() {
                return Err(format!("error: language tiene que ser uno de: {}", crate::runner::Lang::ids().join(", ")));
            }
            if a.topic.trim().is_empty() || a.topic.chars().count() > 200 {
                return Err("error: el ejercicio necesita un tema (hasta 200 caracteres)".into());
            }
            if a.level.as_deref().is_some_and(|l| !["básico", "medio", "avanzado"].contains(&l)) {
                return Err("error: level tiene que ser básico, medio o avanzado".into());
            }
            Ok("propuesta mostrada: el ejercicio se genera en Código cuando la persona lo confirme; no digas que ya está hecho.".to_string())
        }),
        "propose_action" => parse::<ActionArgs>(call).and_then(|a| {
            check_action(&a)?;
            Ok("botón mostrado: la persona decide si lo toca. No digas que ya está hecho.".to_string())
        }),
        "set_phase" => parse::<PhaseArgs>(call).and_then(|a| {
            check_transition(s, a.phase)?;
            s.phase = a.phase;
            Ok(format!("fase actual: {}. {}", format!("{:?}", a.phase).to_lowercase(), phase_hint(a.phase)))
        }),
        "show_diagram" => parse::<DiagramArgs>(call).and_then(|a| {
            if a.title.trim().is_empty() || a.mermaid.trim().is_empty() {
                Err("error: el diagrama necesita título y código".into())
            } else if a.mermaid.len() > MAX_DIAGRAM_BYTES {
                Err(format!("error: el diagrama supera {MAX_DIAGRAM_BYTES} bytes"))
            } else {
                Ok("diagrama mostrado al aprendiz".to_string())
            }
        }),
        "show_code" => parse::<CodeArgs>(call).and_then(|a| {
            if a.title.trim().is_empty() || a.code.trim().is_empty() {
                Err("error: el código necesita título y contenido".into())
            } else if crate::runner::Lang::from_id(&a.language).is_none() {
                Err(format!("error: lenguaje no soportado ({})", crate::runner::Lang::ids().join(", ")))
            } else if a.code.len() > MAX_CODE_BYTES {
                Err(format!("error: el código supera {MAX_CODE_BYTES} bytes"))
            } else {
                Ok("código mostrado al aprendiz; puede abrirlo en su consola".to_string())
            }
        }),
        "show_demo" => parse::<DemoArgs>(call).and_then(|a| {
            if a.title.trim().is_empty() || a.html.trim().is_empty() {
                Err("error: la demo necesita título y HTML".into())
            } else if a.html.len() > MAX_DEMO_BYTES {
                Err(format!("error: la demo supera {MAX_DEMO_BYTES} bytes"))
            } else {
                Ok("demo mostrada al aprendiz".to_string())
            }
        }),
        other => Err(format!("error: herramienta desconocida '{other}'")),
    };
    Outcome::Result(r.unwrap_or_else(|e| e))
}

fn set_plan(s: &mut Session, a: PlanArgs) -> Result<String, String> {
    if a.nodes.is_empty() {
        return Err("error: el plan no puede estar vacío".into());
    }
    let ids: HashSet<&str> = a.nodes.iter().map(|n| n.id.as_str()).collect();
    if ids.len() != a.nodes.len() {
        return Err("error: hay ids de nodo repetidos".into());
    }
    for n in &a.nodes {
        if let Some(d) = n.depends_on.iter().find(|d| !ids.contains(d.as_str())) {
            return Err(format!("error: '{}' depende de '{}', que no existe", n.id, d));
        }
    }
    if has_cycle(&a.nodes) {
        return Err("error: el plan tiene un ciclo de dependencias".into());
    }
    // Keep notes from the previous plan for nodes that survive.
    let old = std::mem::take(&mut s.plan);
    s.plan = a
        .nodes
        .into_iter()
        .map(|n| {
            let note = old.iter().find(|o| o.id == n.id).map(|o| o.note.clone()).unwrap_or_default();
            PlanNode { id: n.id, title: n.title, summary: n.summary, depends_on: n.depends_on, status: n.status, note }
        })
        .collect();
    Ok(format!("plan guardado ({} nodos). {}", s.plan.len(), plan_status(&s.plan)))
}

fn has_cycle(nodes: &[PlanNodeArgs]) -> bool {
    // Kahn's algorithm: a cycle leaves nodes that never reach in-degree 0.
    let mut remaining: Vec<&PlanNodeArgs> = nodes.iter().collect();
    let mut done: HashSet<&str> = HashSet::new();
    loop {
        let before = remaining.len();
        remaining.retain(|n| {
            if n.depends_on.iter().all(|d| done.contains(d.as_str())) {
                done.insert(n.id.as_str());
                false
            } else {
                true
            }
        });
        if remaining.is_empty() {
            return false;
        }
        if remaining.len() == before {
            return true;
        }
    }
}

/// A learner's reply, from the UI.
#[derive(Debug, Default, Deserialize)]
pub struct LearnerInput {
    #[serde(default)]
    pub text: String,
    /// 1-5; only meaningful when answering a question.
    #[serde(default)]
    pub confidence: Option<u8>,
    #[serde(default)]
    pub thinking: String,
    /// Written in the chat box instead of answering with the question's form.
    #[serde(default)]
    pub free: bool,
    /// AC-166: what they thought while reading the teacher's last explanation.
    #[serde(default)]
    pub reading: String,
}

/// Appends the learner's input. If a question is pending, the input becomes
/// that question's tool result (every tool call must be answered before the
/// next user turn in the OpenAI wire format).
pub fn add_learner_input(s: &mut Session, input: LearnerInput) {
    let meta = json!({
        "kind": "answer",
        "text": input.text,
        "confidence": input.confidence,
        "thinking": input.thinking,
        "free": input.free,
        "reading": input.reading,
    });
    // AC-166: the notes taken while reading travel with whatever is sent next.
    let reading = match input.reading.trim() {
        "" => String::new(),
        r => format!("\nMientras leía la explicación pensó: {r}"),
    };
    match s.pending_question.take() {
        // AC-121: they wrote in the chat instead of using the form. It may be the answer, or a doubt,
        // a request, or a change of subject: the agent must not force the question again.
        Some(id) if input.free => {
            let body = format!("El aprendiz escribió libremente en el chat en vez de usar el formulario de respuesta: «{}». Puede ser su respuesta a la pregunta o puede ser otra cosa (una duda, un pedido, un cambio de tema). Atendelo con naturalidad y, si no respondió la pregunta, no se la repitas.{reading}", input.text);
            s.messages.push(Msg::tool(id, body, Some(meta)));
        }
        Some(id) => {
            let mut body = format!("Respuesta del aprendiz: {}", input.text);
            if let Some(c) = input.confidence {
                body.push_str(&format!("\nConfianza: {c}/5"));
            }
            if !input.thinking.trim().is_empty() {
                body.push_str(&format!("\nSu razonamiento: {}", input.thinking));
            }
            body.push_str(&reading);
            s.messages.push(Msg::tool(id, body, Some(meta)));
        }
        None => s.messages.push(Msg::user(format!("{}{reading}", input.text), Some(meta))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::FunctionCall;

    fn call(name: &str, args: Value) -> ToolCall {
        ToolCall {
            id: format!("call_{name}"),
            kind: "function".into(),
            function: FunctionCall { name: name.into(), arguments: args.to_string() },
        }
    }

    fn node(id: &str, deps: &[&str], status: &str) -> Value {
        json!({ "id": id, "title": id, "depends_on": deps, "status": status })
    }

    #[test]
    fn ask_question_sets_pending_and_stops_turn() {
        let mut s = Session::new("derivadas");
        let out = apply(&mut s, &call("ask_question", json!({ "question": "¿Qué es una pendiente?", "purpose": "probe" })));
        assert_eq!(out, Outcome::AwaitLearner);
        assert_eq!(s.pending_question.as_deref(), Some("call_ask_question"));
    }

    #[test]
    fn the_diagnosis_stops_asking_after_the_cap() {
        let mut s = Session::new("x");
        s.phase = Phase::Probe;
        for i in 0..PROBE_MAX {
            let c = ToolCall { id: format!("p{i}"), ..call("ask_question", json!({ "question": "q", "purpose": "probe", "of": 3 })) };
            assert_eq!(apply(&mut s, &c), Outcome::AwaitLearner);
            s.messages.push(Msg { role: "assistant".into(), content: None, tool_calls: Some(vec![c]), tool_call_id: None, meta: None });
            s.pending_question = None;
        }
        let over = apply(&mut s, &ToolCall { id: "p-extra".into(), ..call("ask_question", json!({ "question": "otra", "purpose": "probe" })) });
        assert!(matches!(over, Outcome::Result(r) if r.starts_with("ignorada") && r.contains("pasá a plan")), "the fifth probe question is refused");
        // A prediction during teaching is not a diagnostic question and is never capped.
        s.phase = Phase::Teach;
        let predict = apply(&mut s, &ToolCall { id: "p-predict".into(), ..call("ask_question", json!({ "question": "¿qué pasa?", "purpose": "predict" })) });
        assert_eq!(predict, Outcome::AwaitLearner);
        assert!(matches!(apply(&mut Session::new("y"), &call("ask_question", json!({ "question": "a", "purpose": "probe", "of": 9 }))), Outcome::Result(r) if r.starts_with("error")), "of out of range is an error");
    }

    #[test]
    fn second_question_in_same_turn_is_rejected() {
        let mut s = Session::new("x");
        apply(&mut s, &call("ask_question", json!({ "question": "a", "purpose": "probe" })));
        let out = apply(&mut s, &call("ask_question", json!({ "question": "b", "purpose": "probe" })));
        assert!(matches!(out, Outcome::Result(r) if r.starts_with("ignorada")));
    }

    #[test]
    fn answer_becomes_tool_result_of_pending_question() {
        let mut s = Session::new("x");
        apply(&mut s, &call("ask_question", json!({ "question": "a", "purpose": "probe" })));
        add_learner_input(&mut s, LearnerInput { text: "creo que sí".into(), confidence: Some(2), thinking: "dudo".into(), ..Default::default() });
        let last = s.messages.last().unwrap();
        assert_eq!(last.role, "tool");
        assert_eq!(last.tool_call_id.as_deref(), Some("call_ask_question"));
        let body = last.content.as_deref().unwrap();
        assert!(body.contains("creo que sí") && body.contains("2/5") && body.contains("dudo"));
        assert!(s.pending_question.is_none());
    }

    #[test]
    fn free_text_without_pending_question_is_user_message() {
        let mut s = Session::new("x");
        add_learner_input(&mut s, LearnerInput { text: "una duda".into(), ..Default::default() });
        assert_eq!(s.messages.last().unwrap().role, "user");
    }

    #[test]
    fn finding_replaces_previous_one_for_same_concept() {
        let mut s = Session::new("x");
        apply(&mut s, &call("record_finding", json!({ "concept": "Pendiente", "level": "partial", "evidence": "a" })));
        apply(&mut s, &call("record_finding", json!({ "concept": "pendiente", "level": "solid", "evidence": "b" })));
        assert_eq!(s.findings.len(), 1);
        assert_eq!(s.findings[0].level, Level::Solid);
    }

    #[test]
    fn plan_rejects_unknown_dependency() {
        let mut s = Session::new("x");
        let out = apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &["zzz"], "pending")] })));
        assert!(matches!(out, Outcome::Result(r) if r.contains("no existe")));
        assert!(s.plan.is_empty());
    }

    #[test]
    fn plan_rejects_cycles() {
        let mut s = Session::new("x");
        let out = apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &["b"], "pending"), node("b", &["a"], "pending")] })));
        assert!(matches!(out, Outcome::Result(r) if r.contains("ciclo")));
    }

    #[test]
    fn plan_accepts_dag_and_keeps_notes_on_replan() {
        let mut s = Session::new("x");
        apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &[], "known"), node("b", &["a"], "pending")] })));
        apply(&mut s, &call("update_node", json!({ "id": "b", "status": "understood", "note": "lo explicó bien" })));
        apply(&mut s, &call("set_plan", json!({ "nodes": [
            node("a", &[], "known"), node("b", &["a"], "understood"), node("c", &["b"], "pending")
        ] })));
        assert_eq!(s.plan.len(), 3);
        assert_eq!(s.plan[1].note, "lo explicó bien");
    }

    #[test]
    fn only_one_current_node() {
        let mut s = Session::new("x");
        apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &[], "current"), node("b", &["a"], "pending")] })));
        apply(&mut s, &call("update_node", json!({ "id": "b", "status": "current" })));
        assert_eq!(s.plan[0].status, NodeStatus::Pending);
        assert_eq!(s.plan[1].status, NodeStatus::Current);
    }

    #[test]
    fn results_tell_the_model_where_the_plan_stands() {
        let mut s = Session::new("x");
        let plan = apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &[], "known"), node("b", &["a"], "pending"), node("c", &["b"], "pending")] })));
        assert!(matches!(&plan, Outcome::Result(r) if r == "plan guardado (3 nodos). 0/2 entendidos; próximo enseñable: `b` b"), "{plan:?}");
        let up = apply(&mut s, &call("update_node", json!({ "id": "b", "status": "understood" })));
        assert!(matches!(&up, Outcome::Result(r) if r == "ok: `b` → understood. 1/2 entendidos; próximo enseñable: `c` c"), "{up:?}");
        apply(&mut s, &call("update_node", json!({ "id": "c", "status": "understood" })));
        let done = apply(&mut s, &call("update_node", json!({ "id": "c", "status": "understood" })));
        assert!(matches!(&done, Outcome::Result(r) if r.contains("el plan está completo")));
        let missing = apply(&mut s, &call("update_node", json!({ "id": "zz", "status": "current" })));
        assert!(matches!(&missing, Outcome::Result(r) if r.ends_with("los ids son: a, b, c")));
        let f = apply(&mut s, &call("record_finding", json!({ "concept": "x", "level": "solid", "evidence": "e" })));
        assert_eq!(f, Outcome::Result("hallazgo guardado (1 en total)".into()));
    }

    #[test]
    fn questions_are_validated() {
        let mut s = Session::new("x");
        let bad = apply(&mut s, &call("ask_question", json!({ "question": "¿?", "purpose": "quiz" })));
        assert!(matches!(&bad, Outcome::Result(r) if r.contains("probe, predict o check")));
        let one = apply(&mut s, &call("ask_question", json!({ "question": "¿?", "purpose": "check", "options": ["solo una"] })));
        assert!(matches!(&one, Outcome::Result(r) if r.contains("entre 2 y 6")));
        assert!(s.pending_question.is_none());
        assert_eq!(apply(&mut s, &call("ask_question", json!({ "question": "¿?", "purpose": "check", "options": [] }))), Outcome::AwaitLearner, "no options = free text");
    }

    #[test]
    fn phase_changes_need_what_the_next_phase_builds_on() {
        let mut s = Session::new("x");
        let early = apply(&mut s, &call("set_phase", json!({ "phase": "plan" })));
        assert!(matches!(&early, Outcome::Result(r) if r.contains("registrá al menos un hallazgo")));
        assert_eq!(s.phase, Phase::Probe);
        apply(&mut s, &call("record_finding", json!({ "concept": "x", "level": "partial", "evidence": "e" })));
        let ok = apply(&mut s, &call("set_phase", json!({ "phase": "plan" })));
        assert!(matches!(&ok, Outcome::Result(r) if r.starts_with("fase actual: plan. Armá el plan")));
        apply(&mut s, &call("set_plan", json!({ "nodes": [node("a", &[], "pending"), node("goal", &["a"], "pending")] })));
        apply(&mut s, &call("set_phase", json!({ "phase": "teach" })));
        let not_yet = apply(&mut s, &call("set_phase", json!({ "phase": "done" })));
        assert!(matches!(&not_yet, Outcome::Result(r) if r.contains("el objetivo `goal` tiene que estar understood")));
        apply(&mut s, &call("update_node", json!({ "id": "goal", "status": "understood" })));
        apply(&mut s, &call("set_phase", json!({ "phase": "done" })));
        assert_eq!(s.phase, Phase::Done);
    }

    #[test]
    fn cannot_teach_without_plan() {
        let mut s = Session::new("x");
        let out = apply(&mut s, &call("set_phase", json!({ "phase": "teach" })));
        assert!(matches!(out, Outcome::Result(r) if r.starts_with("error")));
        assert_eq!(s.phase, Phase::Probe);
    }

    #[test]
    fn bad_arguments_are_reported_to_model() {
        let mut s = Session::new("x");
        let out = apply(&mut s, &call("record_finding", json!({ "concept": "x" })));
        assert!(matches!(out, Outcome::Result(r) if r.starts_with("error: argumentos")));
    }

    #[test]
    fn diagrams_and_demos_are_validated_but_do_not_end_the_turn() {
        let mut s = Session::new("x");
        let ok = apply(&mut s, &call("show_diagram", json!({ "title": "T", "mermaid": "graph TD; A-->B" })));
        assert_eq!(ok, Outcome::Result("diagrama mostrado al aprendiz".into()));
        let demo = apply(&mut s, &call("show_demo", json!({ "title": "D", "html": "<p>hola</p>" })));
        assert_eq!(demo, Outcome::Result("demo mostrada al aprendiz".into()));
        assert!(s.pending_question.is_none());

        let empty = apply(&mut s, &call("show_diagram", json!({ "title": " ", "mermaid": "graph TD" })));
        assert!(matches!(empty, Outcome::Result(r) if r.starts_with("error")));
        let untitled = apply(&mut s, &call("show_demo", json!({ "title": " ", "html": "<p>hola</p>" })));
        assert!(matches!(untitled, Outcome::Result(r) if r.starts_with("error")));
        let at_limit = apply(&mut s, &call("show_demo", json!({ "title": "D", "html": "x".repeat(MAX_DEMO_BYTES) })));
        assert_eq!(at_limit, Outcome::Result("demo mostrada al aprendiz".into()));
        let at_limit = apply(&mut s, &call("show_diagram", json!({ "title": "D", "mermaid": "x".repeat(MAX_DIAGRAM_BYTES) })));
        assert_eq!(at_limit, Outcome::Result("diagrama mostrado al aprendiz".into()));
        let blank = apply(&mut s, &call("ask_question", json!({ "question": "   ", "purpose": "probe" })));
        assert_eq!(blank, Outcome::Result("error: la pregunta está vacía".into()));
        assert!(s.pending_question.is_none());
        let huge = apply(&mut s, &call("show_demo", json!({ "title": "D", "html": "x".repeat(MAX_DEMO_BYTES + 1) })));
        assert!(matches!(huge, Outcome::Result(r) if r.contains("supera")));
        let huge = apply(&mut s, &call("show_diagram", json!({ "title": "D", "mermaid": "x".repeat(MAX_DIAGRAM_BYTES + 1) })));
        assert!(matches!(huge, Outcome::Result(r) if r.contains("supera")));
    }

    #[test]
    fn code_is_validated_but_never_run() {
        let mut s = Session::new("x");
        let ok = apply(&mut s, &call("show_code", json!({ "title": "Hola", "language": "python", "code": "print('hola')" })));
        assert_eq!(ok, Outcome::Result("código mostrado al aprendiz; puede abrirlo en su consola".into()));
        let bad = apply(&mut s, &call("show_code", json!({ "title": "X", "language": "cobol", "code": "x" })));
        assert!(matches!(bad, Outcome::Result(r) if r.contains("no soportado")));
        let empty = apply(&mut s, &call("show_code", json!({ "title": "X", "language": "rust", "code": " " })));
        assert!(matches!(empty, Outcome::Result(r) if r.starts_with("error")));
        let huge = apply(&mut s, &call("show_code", json!({ "title": "X", "language": "rust", "code": "x".repeat(MAX_CODE_BYTES + 1) })));
        assert!(matches!(huge, Outcome::Result(r) if r.contains("supera")));
    }

    #[test]
    fn definitions_cover_every_tool() {
        let names: Vec<String> = definitions().as_array().unwrap().iter().map(|d| d["function"]["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, ["ask_question", "record_finding", "set_plan", "update_node", "show_diagram", "show_demo", "show_code", "make_cards", "recall", "library_search", "library_read", "research", "set_phase", "begin_learning", "propose_timetable", "propose_exam", "propose_deck", "propose_practice", "propose_own_problems", "propose_code", "propose_action", "app_status", "ui_command"]);
        let probe: Vec<String> = definitions_for(Phase::Probe).as_array().unwrap().iter().map(|d| d["function"]["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(probe, ["ask_question", "record_finding", "recall", "library_search", "research", "set_phase", "ui_command"]);
        assert!(definitions_for(Phase::Plan).as_array().unwrap().iter().any(|d| d["function"]["name"] == "set_plan"));
        let teach: Vec<String> = definitions_for(Phase::Teach).as_array().unwrap().iter().map(|d| d["function"]["name"].as_str().unwrap().to_string()).collect();
        assert!(!teach.contains(&"begin_learning".to_string()) && teach.contains(&"propose_action".to_string()) && teach.len() == definitions().as_array().unwrap().len() - 1);
        let chat: Vec<String> = definitions_for(Phase::Chat).as_array().unwrap().iter().map(|d| d["function"]["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(chat, ["show_diagram", "show_demo", "show_code", "make_cards", "recall", "library_search", "library_read", "research", "begin_learning", "propose_timetable", "propose_exam", "propose_deck", "propose_practice", "propose_own_problems", "propose_code", "propose_action", "app_status", "ui_command"]);
        assert!(!chat.contains(&"ask_question".to_string()) && !chat.contains(&"set_phase".to_string()), "the method's tools wait for begin_learning");
    }

    fn begin(goal: &str, title: Option<&str>, topics: &[&str]) -> Session {
        let mut s = Session::new_chat("hola");
        let args = json!({ "goal": goal, "title": title, "topics": topics });
        assert!(matches!(apply(&mut s, &call("begin_learning", args)), Outcome::Result(r) if r.contains("Empezó")));
        s
    }

    #[test]
    fn a_long_goal_gets_a_short_title_cut_at_a_word_and_a_goal_that_is_never_cut_mid_word() {
        let long = "Prepararse para rendir la certificación AWS Certified AI Business Strategist, sin fecha fija, cuando se sienta listo";
        let s = begin(long, None, &[]);
        assert!(s.title.chars().count() <= TITLE_MAX && s.title.ends_with('…'), "{}", s.title);
        assert_eq!(s.title, "Prepararse para rendir la certificación AWS Certified AI…");
        assert_eq!(s.goal, long, "the goal keeps all of what was said");

        // The model's own short title wins.
        assert_eq!(begin(long, Some("  Certificación AWS AI "), &[]).title, "Certificación AWS AI");
        assert_eq!(begin("Entender la derivada", Some("   "), &[]).title, "Entender la derivada", "a blank title falls back to the goal");
    }

    #[test]
    fn topics_that_do_not_fit_are_left_out_whole_instead_of_cut() {
        let topics: Vec<String> = (1..=8).map(|n| format!("tema número {n} con bastante texto para ocupar lugar y llenar el espacio disponible")).collect();
        let refs: Vec<&str> = topics.iter().map(String::as_str).collect();
        let s = begin("Aprender mucho", None, &refs);
        assert!(s.goal.chars().count() <= GOAL_MAX, "{}", s.goal);
        assert!(s.goal.ends_with(')'), "closed, not cut: {}", s.goal);
        let kept = s.goal.matches("tema número").count();
        assert!(kept >= 1 && kept < 8, "some topics fit, not all: {kept}");
        for n in 1..=kept {
            assert!(s.goal.contains(&topics[n - 1]), "topic {n} is whole");
        }
    }

    #[test]
    fn shorten_cuts_at_words_and_leaves_short_text_alone() {
        assert_eq!(shorten("  corto  ", 20), "corto");
        assert_eq!(shorten("uno dos tres cuatro", 12), "uno dos…");
        assert_eq!(shorten("abcdefghijklmnopqrstuvwxyz", 10), "abcdefghi…", "one long word is cut, not dropped");
        assert_eq!(shorten("hola, mundo, chau y más", 13), "hola, mundo…", "no dangling comma");
        assert_eq!(shorten("ñandú árbol corazón", 9).chars().count() <= 9, true, "counts characters, not bytes");
    }

    #[test]
    fn an_exam_proposal_is_checked_before_it_can_become_a_card() {
        let ok = |args: Value| match apply(&mut Session::new_chat("hola"), &call("propose_exam", args)) {
            Outcome::Result(r) => r,
            _ => unreachable!(),
        };
        let r = ok(json!({ "name": "AWS Certified AI Practitioner", "exam_date": "2026-12-15", "hours_per_week": 6.5, "passing_pct": 70 }));
        assert!(r.starts_with("propuesta mostrada") && r.contains("sin guía") && r.contains("no digas que ya está creada"), "{r}");
        let with = ok(json!({ "name": "Álgebra I", "kind": "subject", "guide": "Unidad 1: matrices\nUnidad 2: determinantes" }));
        assert!(with.contains("con la guía que mandaste (") && !with.contains("sin guía"), "{with}");
        for (bad, why) in [
            (json!({ "name": "  " }), "necesita un nombre"),
            (json!({ "name": "X", "kind": "language" }), "certification o subject"),
            (json!({ "name": "X", "exam_date": "15/12/2026" }), "AAAA-MM-DD"),
            (json!({ "name": "X", "exam_date": "2026-02-30" }), "AAAA-MM-DD"),
            (json!({ "name": "X", "hours_per_week": 100 }), "0,5 a 80"),
            (json!({ "name": "X", "passing_pct": 0 }), "1 a 100"),
        ] {
            let r = ok(bad.clone());
            assert!(r.starts_with("error:") && r.contains(why), "{bad}: {r}");
        }
        assert!(ok(json!({ "name": "X", "exam_date": "" })).starts_with("propuesta"), "an empty date means none");
    }

    #[test]
    fn writing_in_the_chat_while_a_question_waits_answers_it_without_forcing_it() {
        let mut s = Session::new("derivadas");
        s.pending_question = Some("q1".into());
        add_learner_input(&mut s, LearnerInput { text: "esperá, antes explicame qué es un límite".into(), free: true, ..Default::default() });
        assert!(s.pending_question.is_none());
        let m = s.messages.last().unwrap();
        let body = m.content.clone().unwrap();
        assert_eq!((m.role.as_str(), m.tool_call_id.as_deref()), ("tool", Some("q1")), "every tool call is still answered");
        assert!(body.contains("escribió libremente") && body.contains("antes explicame qué es un límite") && body.contains("no se la repitas"), "{body}");
        assert!(!body.contains("Confianza"));
        assert_eq!(m.meta.as_ref().unwrap()["free"], true);

        // Through the form, nothing changes.
        let mut s = Session::new("derivadas");
        s.pending_question = Some("q2".into());
        add_learner_input(&mut s, LearnerInput { text: "sube 2".into(), confidence: Some(4), thinking: "lo vi".into(), ..Default::default() });
        let body = s.messages.last().unwrap().content.clone().unwrap();
        assert!(body.starts_with("Respuesta del aprendiz: sube 2") && body.contains("Confianza: 4/5") && body.contains("Su razonamiento: lo vi"), "{body}");
        // With no question pending, free text is just a message.
        let mut s = Session::new("x");
        add_learner_input(&mut s, LearnerInput { text: "hola".into(), free: true, ..Default::default() });
        assert_eq!(s.messages.last().unwrap().role, "user");
    }

    #[test]
    fn what_they_thought_while_reading_travels_with_the_next_input() {
        // AC-166: with the answer to a check, with a free message, and with no question waiting.
        let reading = || "no entiendo por qué la tangente toca en un solo punto".to_string();
        let mut s = Session::new("derivadas");
        s.pending_question = Some("q1".into());
        add_learner_input(&mut s, LearnerInput { text: "sube 2".into(), confidence: Some(3), reading: reading(), ..Default::default() });
        let m = s.messages.last().unwrap();
        assert!(m.content.as_deref().unwrap().ends_with("Mientras leía la explicación pensó: no entiendo por qué la tangente toca en un solo punto"));
        assert_eq!(m.meta.as_ref().unwrap()["reading"], reading());
        s.pending_question = Some("q2".into());
        add_learner_input(&mut s, LearnerInput { text: "esperá".into(), free: true, reading: reading(), ..Default::default() });
        assert!(s.messages.last().unwrap().content.as_deref().unwrap().contains("pensó: no entiendo"));
        add_learner_input(&mut s, LearnerInput { text: "hola".into(), reading: reading(), ..Default::default() });
        assert!(s.messages.last().unwrap().content.as_deref().unwrap().starts_with("hola\nMientras leía"));
        add_learner_input(&mut s, LearnerInput { text: "chau".into(), reading: "  ".into(), ..Default::default() });
        assert_eq!(s.messages.last().unwrap().content.as_deref(), Some("chau"), "blank notes add nothing");
    }

    #[test]
    fn every_language_of_the_console_can_be_named_by_the_agent() {
        // AC-171: a language missing from a schema is one the model can't call.
        let defs = definitions();
        for tool in ["show_code", "propose_code"] {
            let d = defs.as_array().unwrap().iter().find(|d| d["function"]["name"] == tool).unwrap();
            let langs: Vec<&str> = d["function"]["parameters"]["properties"]["language"]["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
            assert_eq!(langs, crate::runner::Lang::ids(), "{tool}");
        }
        let mut s = Session::new("x");
        let ok = apply(&mut s, &call("show_code", json!({ "title": "Hola", "language": "csharp", "code": "Console.WriteLine(1);" })));
        assert!(matches!(ok, Outcome::Result(r) if r.starts_with("código mostrado")));
        let bad = apply(&mut s, &call("propose_code", json!({ "language": "cobol", "topic": "x" })));
        assert!(matches!(bad, Outcome::Result(r) if r.starts_with("error:") && r.contains("cpp")));
    }

    #[test]
    fn every_ui_command_the_checker_accepts_is_in_the_schema_with_its_fields() {
        let defs = definitions();
        let ui = defs.as_array().unwrap().iter().find(|d| d["function"]["name"] == "ui_command").unwrap();
        let props = &ui["function"]["parameters"]["properties"];
        let commands: Vec<&str> = props["command"]["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        for c in ["set_pomodoro", "set_profile", "set_accessibility", "pomodoro_start"] {
            assert!(commands.contains(&c), "{c} missing from the enum: the model can't call it");
        }
        for f in ["focus", "short", "long", "every", "first_name", "school", "career", "treatment"] {
            assert!(props.get(f).is_some(), "{f} missing: without it the model sends the command empty");
        }
    }

    #[test]
    fn the_new_proposals_are_checked_before_they_reach_a_card() {
        let res = |name: &str, a: Value| match apply(&mut Session::new_chat("hola"), &call(name, a)) {
            Outcome::Result(r) => r,
            _ => panic!("not a result"),
        };
        let deck = res("propose_deck", json!({ "name": "Verbos", "cards": [{ "front": "to go", "back": "went" }] }));
        assert!(deck.starts_with("propuesta mostrada: el mazo «Verbos» con 1 tarjetas") && deck.contains("no digas que ya está creado"), "{deck}");
        assert!(res("propose_deck", json!({ "name": "V", "cards": [] })).starts_with("error:"));
        assert!(res("propose_deck", json!({ "name": "V", "cards": [{ "front": "a", "back": " " }] })).contains("la tarjeta 1"));
        assert!(res("propose_practice", json!({ "ideas": ["derivadas"], "count": 3 })).starts_with("propuesta mostrada: práctica sobre derivadas"));
        assert!(res("propose_practice", json!({ "ideas": [], "count": 3 })).starts_with("error:"));
        assert!(res("propose_practice", json!({ "ideas": ["x"], "count": 50 })).contains("count va de 1 a 10"));
        // AC-174
        assert!(res("propose_own_problems", json!({ "title": "Guía 3", "text": "1) ¿2+2?" })).starts_with("propuesta mostrada: practicar sus propios ejercicios de lo que mandó"));
        assert!(res("propose_own_problems", json!({ "book": "Guía de Física" })).contains("«Guía de Física» de su biblioteca"));
        assert!(res("propose_own_problems", json!({ "title": "x" })).starts_with("error:"));
        assert!(res("propose_own_problems", json!({ "text": "x".repeat(30_001) })).starts_with("error:"));
        assert!(res("propose_code", json!({ "language": "python", "topic": "listas", "level": "básico" })).starts_with("propuesta mostrada"));
        assert!(res("propose_code", json!({ "language": "cobol", "topic": "x" })).starts_with("error:"));
        assert!(res("propose_code", json!({ "language": "rust", "topic": "x", "level": "experto" })).contains("level"));
        let action = |a: Value| res("propose_action", a);
        assert!(action(json!({ "kind": "open_exam", "label": "Hacer un simulacro", "exam": "AWS Cloud Practitioner", "activity": "simulacro" })).starts_with("botón mostrado"));
        assert!(action(json!({ "kind": "open_exam", "label": "Abrir" })).contains("necesita exam"));
        assert!(action(json!({ "kind": "open_exam", "label": "Abrir", "exam": "X", "activity": "bailar" })).contains("activity"));
        assert!(action(json!({ "kind": "open_deck", "label": "Estudiar", "deck": "Verbos" })).starts_with("botón mostrado"));
        assert!(action(json!({ "kind": "open_deck", "label": "Estudiar" })).contains("necesita deck"));
    }

    #[test]
    fn ui_commands_are_validated_and_normalised_before_the_screen_runs_them() {
        let ok = |a: Value| check_ui_command(&a.to_string()).unwrap();
        assert_eq!(ok(json!({ "command": "pomodoro_start" })).0, json!({ "command": "pomodoro_start", "minutes": 25 }));
        assert_eq!(ok(json!({ "command": "pomodoro_start", "minutes": 40 })).1, "ejecutado: pomodoro de 40 min en marcha");
        assert_eq!(ok(json!({ "command": "pomodoro_pause" })).1, "ejecutado: pomodoro en pausa");
        assert_eq!(ok(json!({ "command": "set_theme", "theme": "light" })).0, json!({ "command": "set_theme", "theme": "light" }));
        assert_eq!(ok(json!({ "command": "set_accent", "accent": "#E0675A" })).0["accent"], "#e0675a");
        assert_eq!(ok(json!({ "command": "set_accent", "accent": "auto" })).0["accent"], "auto");
        assert_eq!(ok(json!({ "command": "set_sound", "enabled": false })).0, json!({ "command": "set_sound", "enabled": false, "tick_tock": null }));
        assert_eq!(ok(json!({ "command": "set_reminders", "stand_minutes": 25, "water_minutes": 0 })).0["water_minutes"], 0);
        let a11y = ok(json!({ "command": "set_accessibility", "text_size": "large", "reduce_motion": true })).0;
        assert_eq!((a11y["text_size"].clone(), a11y["reduce_motion"].clone(), a11y.get("spacing")), (json!("large"), json!(true), None), "only what was asked");

        for (bad, why) in [
            (json!({ "command": "pomodoro_start", "minutes": 500 }), "minutes va de 5 a 90"),
            (json!({ "command": "set_theme", "theme": "rojo" }), "theme tiene que ser"),
            (json!({ "command": "set_theme" }), "theme tiene que ser"),
            (json!({ "command": "set_wallpaper", "wallpaper": "playa" }), "wallpaper tiene que ser"),
            (json!({ "command": "set_accent", "accent": "rojo" }), "accent tiene que ser"),
            (json!({ "command": "set_accent", "accent": "#12345" }), "accent tiene que ser"),
            (json!({ "command": "set_sound" }), "enabled y/o tick_tock"),
            (json!({ "command": "set_reminders" }), "stand_minutes y/o water_minutes"),
            (json!({ "command": "set_reminders", "stand_minutes": 5 }), "10 a 240"),
            (json!({ "command": "set_accessibility" }), "al menos un ajuste"),
            (json!({ "command": "set_accessibility", "text_size": "enorme" }), "text_size"),
            (json!({ "command": "format_disk" }), "comando desconocido"),
            (json!({ "command": "set_pomodoro" }), "focus, short, long"),
            (json!({ "command": "set_pomodoro", "focus": 300 }), "focus va de 5 a 120"),
            (json!({ "command": "set_profile" }), "first_name, school"),
            (json!({ "command": "set_profile", "first_name": "x".repeat(41) }), "hasta 40"),
            (json!({ "command": "set_profile", "treatment": "señor" }), "treatment tiene que ser"),
        ] {
            let e = check_ui_command(&bad.to_string()).unwrap_err();
            assert!(e.starts_with("error:") && e.contains(why), "{bad}: {e}");
        }
        assert_eq!(ok(json!({ "command": "set_pomodoro", "focus": 50, "short": 10 })).0, json!({ "command": "set_pomodoro", "focus": 50, "short": 10, "long": null, "every": null }));
        assert_eq!(ok(json!({ "command": "set_profile", "first_name": " Ana ", "treatment": "ella" })).0, json!({ "command": "set_profile", "first_name": "Ana", "school": null, "career": null, "treatment": "ella" }));
        assert!(check_ui_command("no json").is_err());
        // Through apply, the model gets the same line.
        let mut s = Session::new_chat("hola");
        assert!(matches!(apply(&mut s, &call("ui_command", json!({ "command": "pomodoro_pause" }))), Outcome::Result(r) if r == "ejecutado: pomodoro en pausa"));
    }
}
