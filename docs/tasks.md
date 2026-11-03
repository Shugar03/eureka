# Tareas — Eureka

> SDD, paso 3 de 3: el orden de trabajo derivado de [spec.md](spec.md) y [design.md](design.md).
> Convención: cada tarea nombra los AC que cierra. Una tarea está hecha cuando sus tests (unitarios y e2e) pasan.

## Fase 1 — Núcleo ✅

| # | Tarea | AC / NF | Estado |
|---|---|---|---|
| T1 | Proyecto Tauri 2 + React + Vite; scripts npm | — | ✅ |
| T2 | `llm.rs`: cliente OpenAI-compatible con streaming y tool calls; `SseParser` puro | NF-03, NF-04 | ✅ |
| T3 | `settings.rs`: proveedores por defecto, `settings.json` y `auth.json` separados, `has_key` | AC-09, NF-01 | ✅ |
| T4 | `session.rs`: tipos, store atómico, resumen con progreso | AC-08 | ✅ |
| T5 | `tools.rs`: 5 herramientas con validación (ciclos, nodo `current` único, pregunta única) | AC-03…06, NF-05 | ✅ |
| T6 | `prompts.rs` + `prompts/*.md`: composición por fase, bloque de estado, overrides | AC-01, AC-12 | ✅ |
| T7 | `agent.rs`: loop con `MAX_STEPS`, reconstrucción por paso, cancelación | NF-02 | ✅ probado contra servidores SSE falsos (integración + app real) · ⚠️ falta una prueba manual con un proveedor real |
| T8 | Comandos Tauri + `api.ts` | todos | ✅ |
| T9 | UI: Home, SessionView, QuestionCard, PlanTree, PhaseBar, Settings | AC-01…13 | ✅ |
| T10 | Backend simulado (`src/e2e/mockBackend.ts`) con profesor guionado | D10 | ✅ |
| T11 | BDD: `features/*.feature`; e2e: `tests/e2e/*.e2e.ts` (headed) | AC-01…13 | ✅ |
| T12 | Rediseño estilo Linear: sidebar, paleta Ctrl+K, tokens claro/oscuro | D11 | ✅ |
| T13 | Modo oscuro por defecto + selector Oscuro/Claro/Sistema persistente | AC-14 | ✅ |
| T14 | Superficie de testeo máxima: integración del loop en Rust, contrato IPC, app real por CDP + proveedor falso, caminos aleatorios, casos borde, a11y WCAG AA, regresión visual, cobertura | AC-15, AC-16, NF-08…10 | ✅ |

## Fase 2 — Grafo de conocimiento ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T20 | Spec y BDD: AC-17…21, NF-11, NF-12 (`features/grafo.feature`) | — | ✅ |
| T21 | `graph.rs`: normalizar, validar, plegar, derivar aristas, relevancia; store append-only | AC-17, 18, NF-11, 12 | ✅ |
| T22 | `extract.rs` + `prompts/extract.md`: rol extractor con `record_knowledge` forzada | AC-17, 21 | ✅ |
| T23 | El profesor ve "Ya en el grafo" al medir y planificar | AC-20 | ✅ |
| T24 | UI: `GraphScreen` (filtro, detalle, fuentes, importar notas), aviso al terminar | AC-17, 19, 21 | ✅ |

## Fase 3 — Práctica ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T30 | Spec y BDD: AC-22…26, NF-13 (`features/practica.feature`) | — | ✅ |
| T31 | `practice.rs`: generador (`set_problems`) y corrector (`grade_answer`) validados; store | AC-23, 25, NF-13 | ✅ |
| T32 | UI: `PracticeScreen` (elegir ideas, pistas graduales, corrección, reintento, resumen) | AC-22, 24, 26 | ✅ |

## Fase 4 — Investigación y visuales ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T40 | Spec y BDD: AC-27…31, NF-14 (`features/visuales.feature`) | — | ✅ |
| T41 | Herramientas `show_diagram`, `show_demo`, `research`; `research.rs` (Tavily + investigador) | AC-27…30 | ✅ |
| T42 | UI: `Diagram` (Mermaid estricto), `DemoFrame` (sandbox + CSP), `ResearchCard`, Ajustes de búsqueda | AC-27…31, NF-14 | ✅ |

## Fase 5 — Exámenes y certificaciones ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T50 | Spec y BDD: AC-32…36, NF-15 (`features/examenes.feature`) | — | ✅ |
| T51 | `exam.rs`: temario (`set_syllabus`) con pesos normalizados, reparto por peso, simulacros (`set_exam_questions`) validados, corrección determinista, store | AC-32, 35, 36, NF-15 | ✅ |
| T52 | Sesión vinculada al examen (`Session.exam`): el profesor ve examen, dominio, peso y objetivos | AC-34 | ✅ |
| T54 | Importar la guía desde PDF (pdf.js local, carga diferida) y buscarla en la web (`find_exam_guide`: Tavily con texto completo + `researcher` con `submit_exam_guide`) | AC-37, 38 | ✅ |
| T55 | Simulacro con tiempo (reloj, avisos, entrega automática, navegación, marcar, borrador local) y repaso de falladas (2 aciertos seguidos) | AC-39, 40 | ✅ |
| T53 | UI: `ExamScreen` (guía pegada o `.txt`/`.md`, ruta por dominios, preparación, simulacro con resultado por dominio y recomendación) | AC-32…36 | ✅ |

### Fase 5b — Exámenes: más herramientas ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T56 | Respuesta múltiple ("Elegí N"), todo o nada, compatible con exámenes guardados | AC-41 | ✅ |
| T57 | Meta (nota, fecha, horas), evolución y "¿Estoy listo?" | AC-42 | ✅ |
| T58 | Simulacro dirigido (dominio flojo, lo fallado, dominios elegidos) y hoja de repaso final | AC-43, 44 | ✅ |
| T59 | "¿Por qué no la B?", verificación a ciegas por un segundo modelo y reporte de preguntas | AC-45, 46 | ✅ |

## Fase 6 — Herramientas de estudio ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T60 | `cards.rs`: mazos, SM-2, generación de un examen, del grafo o de apuntes; `CardsScreen` | AC-47, 48 | ✅ |
| T61 | `study.rs` (registro de estudio) y pomodoro en la barra lateral; tiempo de estudio en el inicio | AC-49 | ✅ |
| T62 | Materias, horario semanal, Agenda y plan con fecha | AC-50…52 | ✅ |

## Fase 7 — Programación ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T70 | `runner.rs`: intérpretes locales (py, node, rustc), límites, carpeta temporal; `CodeScreen` con CodeMirror y tipos de TS en el navegador | AC-53, NF-16 | ✅ |
| T71 | "Explicar este error" y herramienta `show_code` del profesor | AC-54 | ✅ |
| T72 | Ejercicios con pruebas ocultas, pistas y solución | AC-55 | ✅ |

## Fase 8 — Más herramientas y memoria del aprendiz ✅

| # | Tarea | AC | Estado |
|---|---|---|---|
| T80 | Hoy en el inicio; lo fallado a tarjetas; revisar mi código; exportar .ics | AC-56…59 | ✅ |
| T81 | Respaldo (.zip) y Anki (texto plano); rutas de programación; recordatorios | AC-60…62 | ✅ |
| T82 | Visión (fotos y PDF escaneados); proyectos de varios archivos; idiomas (listening y speaking) | AC-63…65 | ✅ |
| T83 | Auditoría del harness ([auditoria-harness.md](auditoria-harness.md)): contexto gestionado, estado al final, herramientas informativas, perfil del aprendiz, olvidar fuentes | AC-66, NF-17 | ✅ |
| T84 | Pendientes de la auditoría: transiciones de fase, herramientas por fase, `recall` + IDF, reintento en roles forzados, resumen acumulado, reextraer, olvidar fuente en el grafo | AC-67, AC-68, NF-18…20 | ✅ |
| T85 | Contexto por modelo en Ajustes; prompts con `recall`, reglas de fase y resumen | NF-21 | ✅ |
| T86 | Biblioteca local: PDF/txt/md → Markdown con pdf.js, secciones y BM25 en Rust, lector y búsqueda, `library_search`/`library_read` con citas verificadas, benchmark con libro inventado | AC-69…72, NF-22 | ✅ |
| T87 | Accesibilidad: pestaña de ajustes (tamaño, espaciado, sin animaciones), leer en voz alta con la palabra marcada, dictar, el profesor adapta su forma de escribir, sin datos de salud en el perfil | AC-73…76 | ✅ |
| T88 | OpenCode Go como proveedor: `x-opencode-session` por sesión y user agent propio | AC-77 | ✅ |
| T89 | Los ajustes de accesibilidad llegan también a práctica, exámenes, tarjetas, idiomas y código (no a las llamadas internas) | AC-75 | ✅ |
| T90 | Rediseño «Eureka Glass»: vidrio, serif, barra lateral a todo el alto, esquinas rectas, gris azulado #161B25, Outfit en toda la app | AC-78 | ✅ |
| T91 | Mi espacio: fondos en código o propios, acento tomado de la imagen con contraste verificado, nombre y saludo | AC-78…81 | ✅ |
| T92 | Acompañamiento v1: charla de escucha con prompt propio, diario (check-ins y entradas aprobadas), detector local de riesgo + líneas de ayuda, PIN, exportar/borrar, respiración y 5-4-3-2-1, separado del estudio | AC-82…88 | ✅ |
| T93 | OpenCode Go llega a las instalaciones existentes (una sola vez); aviso de modo demo en el navegador; aire entre las tarjetas del inicio | AC-77 | ✅ |
| T93 | Acompañamiento v2: registro de pensamientos, rueda de emociones y «Lo que noté» (patrones locales que la persona confirma o descarta) | AC-93…96 | ✅ |
| T94 | Chat agéntico: fase `chat`, `begin_learning` y `propose_action`, inicio como chat, botones del asistente | AC-89…91 | ✅ |
| T95 | Bienvenida por pasos y perfil (nombre, estudios, trato) que el asistente usa | AC-92 | ✅ |
| T96 | Sonidos del pomodoro (tic-tac y campanita) y recordatorios de pararse y tomar agua | AC-97, AC-98 | ✅ |
| T97 | Mi cursada: períodos, materias con horarios semanales, fechas importantes, carga pegando el horario o contándoselo al asistente (propuesta que se confirma), contexto del asistente, Agenda y recordatorios | AC-99…103 | ✅ |
| T98 | El chat arma una preparación de examen desde lenguaje natural (`propose_exam`), se puede escribir libre con una pregunta pendiente, y el asistente maneja la app (`ui_command`, `app_status`, «La app ahora»); tabla de paridad | AC-120…124 | ✅ |
| T99 | Banco de citas: 366 (una por día del año) con autor y obra verificables, otra/favorita/ocultar, frases propias, bienvenida al abrir | AC-130…133 | ✅ |
| T108 | Diez lenguajes en la consola: C, C++, Java, C#, Go y SQL (SQLite incluido) con ejercicios, rutas, revisión, proyectos y plantillas; compilar y ejecutar con límites separados | AC-171…172 | ✅ |
| T111 | Invertir los colores de una demo (recordado en el equipo) | AC-175 | ✅ |
| T110 | Mis problemas desde el chat: el asistente propone practicar los ejercicios que la persona pegó, mandó en una foto o adjuntó como PDF, con la misma tarjeta para revisarlos | AC-174 | ✅ |
| T109 | Practicar mis propios problemas: pegar la guía o traerla de un PDF o una foto, revisar los ejercicios leídos, y practicarlos con la respuesta de la guía o una de Eureka que se avisa y se puede pedir revisar | AC-173 | ✅ |
| T107 | Grafo para recorrer: vista por profundidad (base abajo, el razonamiento sube), conexiones entre sesiones punteadas, sesiones conectadas y «Ver dónde apareció» que marca el mensaje en su sesión | AC-170 | ✅ |
| T106 | Investigar en segundo plano: el profesor sigue mientras se busca, el resultado llega una sola vez a la sesión, a la tarjeta y al profesor, y una investigación cortada al cerrar la app lo dice | AC-169 | ✅ |
| T105 | Pensar mientras se lee la explicación (viaja con la próxima respuesta), práctica escrita de a un problema que sube o baja de nivel según cómo fue el anterior, y un empujón hecho para lo que se viene pensando | AC-166…168 | ✅ |
| T104 | Pegar una sola key y listo (servicio por el formato, modelo elegido y probado con una herramienta, contexto si el servicio lo dice, sin pisar la Voz); el chat también pide mazos, prácticas y ejercicios, abre exámenes y mazos por nombre, cambia el pomodoro y el perfil, y las propuestas de examen y horario se corrigen antes de confirmar | AC-158…165 | ✅ |
| T103 | Horario y malla desde una foto o PDF, `.apkg` de Anki (importar y exportar), compartir mazos (`.eureka`, doble clic), la malla de la carrera (correlativas, aprobadas, promedio) y el asistente la conoce | AC-151…157 | ✅ |
| T102 | Grabar la clase (partes transcriptas mientras se graba), apuntes con fechas anunciadas, escuchar el repaso y las tarjetas, plan que se reajusta con cada simulacro, materia con su ruta | AC-146…150 | ✅ |
| T101 | Mi cursada en el `.ics` y feriados / días sin clases (feriados nacionales de Argentina calculados por ley) | AC-144…145 | ✅ |
| T100 | Panel «Tu día» en el inicio (racha, clases de hoy, lo que se viene, notas) y racha amable con un día libre por semana | AC-140…143 | ✅ |

> T104 con el modelo real (29/10, deepseek-v4.1-flash): pegar la key `oc_…` configuró todo en 3,1 s (OpenCode Go, deepseek-v4.1-flash, prueba con herramienta OK; el servicio no informa contexto → 64 mil). En el chat del `.exe`, cada pedido eligió la herramienta correcta: `propose_deck` (5 tarjetas, 11 s), `propose_code` (9 s), `propose_practice` (16 s, buscó antes con `recall` y `app_status`), `set_pomodoro` y `set_profile` (el perfil quedó guardado). Encontrado y corregido: el esquema de `ui_command` no traía `set_pomodoro`/`set_profile` ni sus campos, y el modelo los mandaba vacíos (hay un test que lo cuida).

> T103 con el modelo real (29/10, deepseek-v4.1-flash, `eureka.exe` de desarrollo): una foto de una grilla de horarios (5 bloques, 3 materias, 2 fechas) se transcribió bloque por bloque en 14 s y se leyó en 9 s sin errores (teórica/práctica, aulas, docentes, parcial 12/11 y TP 20/11); un plan de 11 materias con correlativas «para cursar»/«para rendir» se leyó entero en 9 s. El `.apkg` y el `.eureka` pasan por IPC como cuerpo crudo, y abrir el exe con un `.eureka` como argumento muestra la vista previa en Tarjetas.

> T102 con el modelo real (29/10, deepseek-v4.1-flash por IPC, sin micrófono): apuntes en 13 s, con fórmulas, «esto siempre cae en el parcial», la regla de la cadena como pendiente y las dos fechas bien deducidas (parcial jueves 12/11, TP miércoles 11/11); ignoró «¿se escucha atrás?». Falta grabar con un micrófono real y Whisper local una clase larga.


## Deuda conocida


- Biblioteca: medir un turno real del profesor (tokens de `usage` y si cita bien); EPUB y .docx; OCR local de páginas escaneadas; las paráfrasis sin palabras en común (1 de cada 4) no siempre llegan.
- De la auditoría: `recall` usa palabras, no embeddings. El tamaño de contexto se lee del proveedor solo si lo informa (OpenRouter sí; OpenCode Go no): si no, 64 mil por defecto.
- Una sola key: la detección por formato solo se probó con una key real de OpenCode Go (`oc_`); los formatos de OpenRouter, Anthropic, Gemini, OpenAI y DeepSeek salen de su documentación y no se probaron con keys reales.
- Mi cursada: **probar la lectura de horarios con un modelo real** con horarios de facultades distintas; la malla: electivas con créditos (hoy son materias comunes), materias equivalentes entre planes, y promedio ponderado por horas o créditos.
- Acompañamiento: **antes de abrirlo a otras personas, que lo revise una psicóloga o un psicólogo**, y probar la respuesta ante riesgo con un modelo real (hoy solo está probada con modelo simulado y el detector local). Falta: usar lo confirmado en «Lo que noté» dentro de la charla (solo si la persona lo activa, porque implica enviarlo al proveedor), el puente opcional al plan de estudio y el modelo local para este modo (v3); no hay respaldo cifrado del diario; las líneas de ayuda de Argentina hay que verificarlas (los horarios no coinciden entre fuentes).
- Acompañamiento: revisión profesional, prueba con modelo real, cifrado en reposo, modelo local, versión 2 (ver [acompanamiento.md](acompanamiento.md)).
- Paridad chat↔pantallas: falta «Guardar lo aprendido» en el grafo, idiomas y acompañamiento desde el chat, y que el simulacro arranque solo al abrir el examen (hoy abre la preparación) (ver [agente-paridad.md](agente-paridad.md)).
- Chat agéntico: probar con un modelo real que decide bien cuándo llamar `begin_learning` (hoy solo con guion), y que no ofrece botones de más. Las pruebas de escritorio (`tests/desktop`, 18) pasan desde el 29/10/2026: se pasa la bienvenida y la cita del día al lanzar, y los tests esperan el turno de charla antes de Medir.
- Sonidos y recordatorios: el aviso de pararse cuenta el tiempo con la app abierta, no el que se está sentado de verdad.
- Mi espacio: la imagen propia se guarda en `localStorage` (≈2,5 MB máx.); mover a archivo si se piden fondos más pesados. El rediseño no se miró en la app de escritorio compilada, ni en pantallas chicas.
- Accesibilidad: falta probarlo con personas neurodivergentes y con especialistas (psicopedagogía, fonoaudiología). La versión para chicos, con un adulto a cargo, queda como proyecto aparte.
- OpenCode Go se pensó para agentes de programación y monitorea el tráfico: usarlo para una app de estudio es una zona gris de sus términos.
- `.apkg` de Anki: falta probarlo con un archivo **exportado por Anki de verdad** (los tests usan paquetes armados con SQLite) y que Anki acepte el que exporta Eureka; no se importan imágenes ni sonidos de las notas. El doble clic en un `.eureka` necesita el instalador (`npm run tauri build`): con el `.exe` de desarrollo se prueba pasando el archivo como argumento.

- Depurador paso a paso (breakpoints): fuera de alcance; la depuración es leer errores con su línea, pruebas y "Explicar este error".
- Ejecución aislada del código (contenedor o usuario sin permisos): hoy corre con los permisos del usuario, solo cuando él toca Ejecutar.
- Clases: subir un audio grabado en otro lado (hoy solo se graba en vivo); separar quién habla; marcar momentos durante la clase.

- Exámenes: leer PDFs escaneados (OCR).
- Exámenes de idiomas: secciones de listening y speaking (hoy solo lectura, gramática y vocabulario por opción múltiple).


- Investigación en segundo plano (jobs) en vez de dentro del turno, como el original.
- Dictado por voz para el campo "pensando en voz alta".

- Medidor de costo por turno (tokens × precio del modelo).
- Primera prueba manual con un proveedor real (OpenRouter / Anthropic / Gemini) para validar el *tool calling* de cada uno; el proveedor falso imita el formato de OpenAI.
- e2e de la app real en CI de Windows (necesita un runner con escritorio para WebView2).
- Íconos propios de la app (hoy son los de la plantilla de Tauri).

## T98 — Prueba real del modelo del estudiante (AC-108..113) — corrida el 29/10/2026

Con la app real (`Eureka.exe` o `npm run app`) y un proveedor configurado (rol Extractor, o el del Profesor):

1. Charlar sobre un tema (por ejemplo «explicame qué es un triángulo equilátero») al menos 4 mensajes; pedir algo que quede para después («después vemos la demostración»).
2. Cerrar o ir a otra pantalla y esperar más de 10 minutos con la app abierta.
3. «Mi progreso» → «Lo que recuerda de tus sesiones» debe mostrar el resumen y el pendiente; el inicio, «Desde la última vez anoté lo de …» y el pendiente en «Tu plan de hoy».
4. Empezar otra charla con «hola»: el agente debería ofrecer retomar el pendiente o el plan de hoy, sin inventar.
5. En Práctica, fallar un problema y después acertar uno de la misma idea: en «Mi progreso» esa idea pasa de «Le cuesta» a «Ya lo domina» o «Practicando».
6. Anotar acá qué tal salieron los resúmenes y si el agente los usó; ajustar `prompts/remember_session.md` y la sección «Lo que sabés de la persona» de `prompts/shared.md` según lo que se vea.

### Resultado (Eureka.exe, OpenCode Go · deepseek-v4.1-flash en todos los roles, datos aparte)

1. **Charla**: 4 vueltas bien. Corrigió «la altura es igual al lado» con fórmula y un argumento sin cuentas, aceptó dejar la demostración para después y guardó una tarjeta sola (`make_cards`).
2. **Consolidación**: a los ~12 min (10 de quietud + la vuelta del ciclo de 3 min). Resumen concreto; pendiente «la demostración de los 180°» y los dos chequeos sin responder; costó «confundió la altura con el lado».
3. **Inicio y Mi progreso**: «Desde la última vez anoté lo de …», «Tu plan de hoy» con la tarjeta y «Retomá: la demostración…»; Mi progreso con los dos pendientes y la idea de la altura.
4. **«hola»**: saludó por el nombre y ofreció los dos pendientes y la tarjeta, sin inventar; dejó el botón «Repasar la tarjeta de hoy». Detalle: después del botón mandó un segundo mensaje que repite el primero.
5. **Práctica**: fallar → «Le cuesta» (con la respuesta y la corrección como evidencia); Reintentar y acertar → «Ya lo domina». La corrección es buena y comenta la confianza.

**Bugs que encontró y quedaron arreglados:**
- Práctica (y todo lo que fuerza una herramienta: tarjetas, exámenes, extracción, leer horarios) fallaba con 400 «Thinking mode does not support this tool_choice». `forced_valid` ahora prueba por nombre → `"required"` → `"auto"` (`practice::call_tool`; test `a_provider_that_refuses_to_force_a_tool…`). Es intermitente: la consolidación había andado.
- La consolidación de la charla «hola» anotó como pendientes nuevos los que el tutor solo había recordado, y «la tarjeta de hoy». `remember_session.md` ahora dice que `pending` es solo lo que esa sesión dejó abierto (sin volver a correr la prueba).

- (Encontrado por los caminos aleatorios de escritorio.) Una sesión que terminaba en una herramienta sin texto final (`set_phase: done`) relanzaba al agente cada vez que se reabría: `needsAgent` ahora solo cuenta un resultado de herramienta si es la respuesta a `ask_question`.
- La cita del día volvía a aparecer al recargar la ventana: ahora se recuerda en `sessionStorage` (se va al cerrar la app).

**Queda:** lo que costó según la memoria de una sesión («confundió la altura con el lado») no se une con la idea del grafo que después se acertó en práctica, así que la misma idea sale en «Le cuesta» y en «Ya lo domina». Hace falta unir por significado (hoy es por palabras) o que un acierto posterior resuelva lo que costó en esa sesión.
