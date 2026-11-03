# Diseño — Eureka (Fase 1)

> SDD, paso 2 de 3: **cómo** se cumple [spec.md](spec.md).

## 1. Vista general

```
┌──────────────────────── Ventana Tauri (WebView2) ────────────────────────┐
│  React 19 + Vite                                                          │
│  App ─ Sidebar · CommandMenu (Ctrl K)                                     │
│      ├ Home          objetivo nuevo, lista de sesiones                    │
│      ├ SessionView   chat · QuestionCard · PhaseBar · PlanTree (xyflow)   │
│      ├ GraphScreen   grafo de conocimiento (Fase 2)                       │
│      ├ PracticeScreen práctica (Fase 3)                                   │
│      ├ ExamScreen    exámenes y materias: ruta, simulacros, plan (Fase 5) │
│      ├ CardsScreen   tarjetas (Fase 6) · AgendaScreen · CodeScreen (F7)   │
│      ├ PomodoroProvider + widget en la barra lateral (Fase 6)            │
│      └ Settings      proveedores, keys, modelo por rol, prompts, búsqueda │
│  lib/transcript.ts   mensajes (formato OpenAI) → ítems del chat  (pura)   │
│  api.ts              ÚNICO módulo que llama a invoke()/Channel            │
└───────────────┬──────────────────────────────────────▲───────────────────┘
                │ invoke("send_message", {id, input,   │ Channel<AgentEvent>
                │          onEvent: Channel})          │ text · session · error · done
┌───────────────▼──────────────────────────────────────┴───────────────────┐
│  Rust (src-tauri/src)                                                     │
│  lib.rs      comandos Tauri + AppState (stores, banderas de cancelación)  │
│  agent.rs    loop del agente (1 turno del aprendiz)                       │
│  tools.rs    esquemas de herramientas + efecto PURO sobre la Session      │
│  prompts.rs  shared + fragmento de fase + bloque de estado; overrides     │
│  llm.rs      cliente /chat/completions con streaming SSE + tool calls     │
│  session.rs  tipos + SessionStore (un JSON por sesión)                    │
│  settings.rs settings.json (preferencias) + auth.json (keys)              │
│  graph.rs    registro append-only, fold, aristas derivadas (Fase 2)       │
│  extract.rs  rol extractor: sesión/notas → proposiciones + cadenas         │
│  practice.rs generador + corrector con tools forzadas (Fase 3)            │
│  research.rs búsqueda web (Tavily) + rol investigador (Fase 4)            │
│  exam.rs     temario, simulacros y corrección determinista (Fase 5)       │
│  cards.rs    tarjetas con repetición espaciada SM-2 (Fase 6)              │
│  study.rs    registro de estudio (pomodoros) (Fase 6)                     │
│  runner.rs   consola de código: py, node, rustc locales (Fase 7)          │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ HTTPS (reqwest + rustls)
        OpenRouter · OpenAI · Anthropic · Gemini · DeepSeek · cualquiera compatible
```

## 2. Decisiones

| # | Decisión | Por qué | Alternativas descartadas |
|---|---|---|---|
| D1 | **Tauri 2** (Rust + WebView) | El usuario pidió Rust. Binario chico; acceso nativo a archivos. | Electron (como el original): pesado. |
| D2 | **Un solo cliente OpenAI-compatible** escrito a mano (`llm.rs`) | Todos los proveedores objetivo exponen `/chat/completions` con tools. Control total del streaming y de los errores. | Crate `genai`: otra API para aprender y menos control del SSE. |
| D3 | **El agente es un loop con herramientas**, no un parser de texto | Las herramientas dan estado estructurado (plan, fase, hallazgos) que la UI dibuja. | Bloques JSON en el texto: frágil. |
| D4 | **La respuesta del aprendiz es el `tool result` de `ask_question`** | El formato OpenAI exige que cada `tool_call` tenga su `tool` message antes del siguiente turno. Así la pregunta y su respuesta quedan unidas en el historial. | Mensaje `user` aparte: daría 400 en la próxima llamada. |
| D5 | **El prompt y el modelo se reconstruyen en cada paso** del loop | Una herramienta puede cambiar la fase en medio del turno (por ejemplo `plan.md` pide pasar a `teach` y empezar a enseñar en el mismo turno). | Una vez por turno: el modelo enseñaría con instrucciones viejas. |
| D6 | **Bloque de estado** (fase, diagnóstico, plan) agregado al system prompt | El modelo siempre ve la verdad actual aunque el historial sea largo. | Confiar en el historial. |
| D7 | **Prompts embebidos con `include_str!`** + override en `<data>/prompts/<nombre>.md` | En la app instalada no hay archivos sueltos. El override permite editar desde la UI sin recompilar. | Leer de disco: no anda una vez empaquetada. |
| D8 | **`tools::apply` es puro** (sin IO) | Todas las reglas del dominio (ciclos, nodo único `current`, una pregunta por turno) se testean sin red. | Lógica mezclada con el loop. |
| D9 | **Parser SSE sobre bytes** (`SseParser`) | Un carácter multibyte (á, ñ, ¿) partido entre dos paquetes se corrompía al decodificar cada paquete por separado. Ahora se decodifican solo líneas completas. | `from_utf8_lossy` por paquete: bug real, detectado en revisión. |
| D10 | **`api.ts` como único punto de IPC** + dos backends de prueba | (a) Web: `mockIPC` con un profesor guionado, sin tokens y con resultados fijos. (b) Escritorio: la app **real** manejada por CDP contra un **proveedor falso** compatible con OpenAI, que comparte el mismo guion (`src/e2e/teacherScript.ts`). Así el mismo arco de enseñanza se prueba de las dos maneras, y `contract_tests` y `view.test.ts` atan los formatos JSON. | Llamar a un modelo real en los tests: caro y no determinista. |
| D11 | **UI estilo Linear** | Pedido del usuario: fondo casi negro, bordes finos, acento índigo `#5e6ad2`, Inter, paleta de comandos. | — |
| D12 | **Modo oscuro por defecto**, con tokens validados a WCAG AA en los dos temas | Pedido del usuario; axe encontró contrastes de menos de 4.5:1 y se ajustaron los tokens. | Seguir al sistema operativo por defecto. |
| D13 | **Layout con `minmax(0, 1fr)` y `min-height: 0`**; solo scrollea el transcript, con `scrollbar-gutter: stable` | Una conversación larga empujaba el composer fuera de la ventana y el scrollbar movía el layout (lo encontraron la regresión visual y los caminos aleatorios). | — |
| D15 | **Las cadenas son lo que se guarda; las aristas se derivan**. Registro append-only con plegado de la última extracción por fuente | Igual que el original. Reextraer reemplaza sin perder historia, y las ideas iguales se unen por texto normalizado (hash FNV-1a). | Guardar aristas: se desincronizan. |
| D16 | **Roles con herramienta forzada** (`tool_choice`) para el extractor, el generador, el corrector y el investigador | Salida estructurada y validable con cualquier proveedor compatible con OpenAI; nada de parsear JSON del texto. | Modo JSON: no todos los proveedores lo soportan igual. |
| D17 | **`research` corre dentro del turno** (el loop la intercepta antes de `tools::apply`) | La función pura de herramientas sigue sin IO, y el profesor recibe el resumen en el mismo turno. Si no hay key, el resultado es un error legible y la sesión sigue. | Jobs en segundo plano como el original: más complejo para Fase 1–4. |
| D18 | **Demos en `iframe sandbox="allow-scripts"` + CSP `default-src 'none'`** | El HTML generado por el modelo no es de confianza: sin origen propio no ve la app ni la IPC de Tauri; sin red no puede filtrar nada. Verificado con un `fetch` que el e2e espera ver bloqueado. | Renderizar el HTML inline: inseguro. |
| D19 | **Exámenes = temario + sesiones normales + simulacros corregidos en Rust** | Cada tema se estudia con el mismo arco medir → planificar → enseñar (y termina en el grafo), con los objetivos oficiales en el bloque de estado. Las preguntas de opción múltiple traen su respuesta, así que la corrección es determinista, instantánea y gratis. Los roles existentes alcanzan: `extractor` lee la guía, `practice` escribe los simulacros. | Un motor de enseñanza aparte; corregir con un modelo; un sexto rol en Ajustes. |
| D20 | **Una materia es un Exam** (`kind: subject`) con su horario | Programa → unidades → temas → sesiones → simulacros es el mismo modelo; el PDF, la búsqueda, el plan y la agenda funcionan igual para los dos. | Un modelo aparte para materias. |
| D21 | **Tarjetas con SM-2** y fechas locales que manda la UI | Simple, conocido (Anki) y puro: se testea sin reloj. "Hoy" es el día del aprendiz, no el de UTC. | FSRS: más preciso pero más complejo para empezar. |
| D22 | **Un solo registro de estudio** (`study_log.jsonl`) | El pomodoro escribe; el inicio, el plan y las horas por semana leen. El pomodoro vive en un contexto arriba de las pantallas y guarda su hora de fin, así sobrevive a cambiar de pantalla y a recargar. | Un contador por pantalla. |
| D23 | **El código corre con los intérpretes locales y solo con "Ejecutar"** | Rust no tiene opción offline en el navegador y el usuario ya tiene los toolchains. Ninguna herramienta del agente ejecuta: la investigación web mete texto no confiable en el contexto del profesor. Carpeta temporal por ejecución, límite de tiempo, salida cortada, sin ventana de consola. Los tipos de TypeScript se revisan en el navegador porque Node solo los quita. | Pyodide/wasm (sin Rust); dejar que el profesor ejecute. |
| D14 | **`prefers-reduced-motion`** sin animaciones ni scroll suave | Accesibilidad, y además hace deterministas las capturas y los audits. | — |

## 3. El loop del agente (`agent::run_turn`)

```
para paso en 1..=12:
    si cancelado → fin
    s = cargar sesión;  si hay pregunta pendiente → fin (esperando al aprendiz)
    endpoint = modelo del rol según s.phase      ← D5
    system   = shared + fase + estado(s)         ← D5, D6
    c = stream_chat(endpoint, system, s.messages, tools)   (texto → Channel)
    si c vacío → fin
    guardar mensaje assistant (texto + tool_calls)
    para cada tool_call:
        Result(r)     → agregar mensaje tool(r)
        AwaitLearner  → (sin tool message: lo pone la respuesta, D4)
    guardar sesión; emitir Session
    si no hubo tool_calls o hay pregunta pendiente → fin
error "límite de pasos"   ← NF-02
```

Concurrencia: `AppState.running` guarda una bandera `AtomicBool` por sesión. Un segundo `send_message` sobre la misma sesión se rechaza. `stop_agent` levanta la bandera; si el corte llega a mitad del stream, se guarda el texto parcial y se descartan las tool calls incompletas.

## 4. Herramientas

| Herramienta | Efecto | Reglas |
|---|---|---|
| `ask_question {question, purpose, options?}` | `pending_question = call.id`; corta el turno | Una por turno; la segunda devuelve "ignorada" |
| `record_finding {concept, level, evidence}` | Agrega o reemplaza un hallazgo | Un hallazgo por concepto, sin distinguir mayúsculas |
| `set_plan {nodes}` | Reemplaza el plan completo | Ids únicos, dependencias existentes, sin ciclos (Kahn). Conserva las notas de los nodos que siguen |
| `update_node {id, status, note?}` | Cambia el estado | Solo un `current` a la vez |
| `set_phase {phase}` | Cambia la fase | No se puede pasar a `teach` sin plan |

## 5. Datos en disco

Carpeta: `%APPDATA%\lat.eureka.app\` en Windows. La variable `LA_DATA_DIR` la reemplaza (tests).

```
settings.json         { providers:[{id,label,base_url}], roles:{teacher,prober} }
auth.json             { "<provider_id>": "<api key>" }        ← nunca vuelve a la UI
sessions/<id>.json    Session (mensajes en formato OpenAI + meta para la UI)
prompts/<nombre>.md   overrides opcionales (shared, probe, plan, teach, done)
```

Las escrituras de sesión son atómicas: se escribe un `.tmp` y después se renombra.

## 6. Contrato IPC

| Comando | Args | Devuelve |
|---|---|---|
| `get_settings` / `save_settings` | `{input}` | `SettingsView` (providers con `has_key`) |
| `list_models` | `{providerId}` | `string[]` |
| `list_sessions` / `create_session` / `get_session` / `delete_session` | `{goal}` / `{id}` | `SessionSummary[]` / `Session` |
| `send_message` | `{id, input: LearnerInput \| null, onEvent: Channel}` | `()` al terminar el turno |
| `stop_agent` | `{id}` | `()` |
| `list_prompts` / `save_prompt` / `reset_prompt` | `{name, content}` | `PromptView[]` |

`AgentEvent = text{delta} | session{session} | error{message} | done`.

## 7. Estrategia de pruebas

Ver [testing.md](testing.md): pirámide TDD (Rust + Vitest), BDD (Gherkin → e2e) , app real con proveedor falso, caminos aleatorios, regresión visual y accesibilidad.
