# Auditoría del harness: memoria y herramientas

Fecha: 2026-10-27 · Alcance: `src-tauri/src` (agent, tools, prompts, llm, session, graph, extract, research, practice, exam, cards, study, runner), `src-tauri/prompts/*.md` y, puntualmente, `src/components/SessionView.tsx`.
Es una auditoría de solo lectura: no se tocó código. Las referencias `archivo:línea` son del estado actual del árbol.

---

## 1. Resumen

- **El costo de contexto lo domina el contenido visual, no la charla.** `show_demo` (hasta 100 KB), `show_code` (50 KB) y `show_diagram` (20 KB) guardan su contenido en `tool_calls[].function.arguments` del mensaje del asistente. Ese contenido se reenvía **en cada paso** del resto de la sesión (`agent.rs:87-98`, `llm.rs:52`). Una sola demo puede sumar unos 25k tokens por paso. Esto es lo primero que hay que arreglar (compactación solo en el envío).
- **No hay memoria de corto plazo gestionada.** `Session.messages` (`session.rs:88`) crece sin tope y se manda entero en cada uno de los 12 pasos posibles por turno. No hay estimación de tokens, presupuesto ni resumen. En sesiones largas el costo y la latencia crecen de forma cuadrática, y al final se desborda el contexto.
- **El prompt rompe el caché.** El bloque de estado, que cambia con cada `record_finding` o `update_node`, está dentro del system prompt, **antes** de todo el historial (`prompts.rs:96-104`). El historial nunca queda en un prefijo estable. Además, Anthropic vía la capa compatible con OpenAI no cachea nada.
- **No existe un modelo del aprendiz entre sesiones.** El grafo guarda solo "lo entendido". `extract.md` excluye a propósito las confusiones, y los `findings` con `misconception` mueren con su sesión. Los intentos de práctica, las notas de tarjetas, la lista de repaso de exámenes y el registro de estudio nunca llegan al profesor.
- **La recuperación de memoria es pobre.** `graph::relevant` (`graph.rs:264`) cruza palabras sueltas del `goal` con las proposiciones y solo actúa en probe/plan (`agent.rs:83`). Para sesiones de examen, el `goal` es el título corto del tema, así que el recall es bajo. El profesor tampoco puede consultar la memoria por su cuenta: no hay ninguna herramienta para eso.
- **La higiene de la memoria tiene huecos:**
  - Borrar una sesión no borra su aporte al grafo (`lib.rs:114`).
  - No hay forma de "olvidar" ni de editar nodos.
  - Si una sesión vuelve de done a teach y termina de nuevo, el grafo no se vuelve a extraer (`SessionView.tsx:101`).
  - La extracción conserva el **principio** de las sesiones largas y corta el final (`extract.rs:75`).
  - Los resultados de `research` se filtran al extractor como si fueran texto del aprendiz (`extract.rs:68`).
- **La ergonomía de las herramientas es buena en lo estructural:**
  - Los errores vuelven al modelo.
  - El DAG se valida.
  - Hay una sola pregunta por vez.

  **Pero los resultados no informan:**
  - `record_finding` y `update_node` devuelven `"ok"`.
  - Un id inexistente no lista los válidos.
  - `purpose` y `options` no se validan.
  - Las llamadas que vienen después de `ask_question` en el mismo lote se ejecutan igual.
  - Los roles forzados (`forced()`, `practice.rs:282`) no reintentan con el error de validación.
- **Faltan herramientas clave para el profesor:**
  - `recall` (consultar grafo y perfil a demanda).
  - `note_learner` (anotar confusiones y preferencias de forma persistente).
  - `make_cards` (pasar lo enseñado a repetición espaciada).
  - Un cierre de sesión estructurado (`finish_session`).

---

## 2. Memoria: hallazgos y recomendaciones

### 2.1 Memoria de corto plazo (dentro de una sesión)

**M1. Los payloads visuales se reenvían para siempre. Severidad: Alta**

- **Dónde:** `agent.rs:104-110` guarda `completion.tool_calls` completos. `llm.rs:101-102` serializa todos los mensajes con `Msg::wire` (`llm.rs:52`). Los límites están en `tools.rs:162-164`.
- **Efecto:** una demo de 100 KB son unos 25-30k tokens reenviados en cada paso siguiente. Con varios pasos por turno y muchos turnos, ese costo se multiplica muy rápido.
- **Cambio:** agregar una proyección `wire_messages(&[Msg]) -> Vec<Value>` que se aplique solo al enviar, sin tocar lo que se persiste (la UI sigue necesitando el HTML).
  - Para cada `tool_call` de `show_demo`, `show_code` o `show_diagram` **anterior al último turno del aprendiz**, reemplazar el payload por JSON válido. Ejemplo: `{"title":"…","html":"[omitido: demo ya mostrada, 84 KB]"}`. En `show_code` conviene conservar las primeras ~20 líneas, porque el profesor puede necesitar referirse al código.
  - Hacer lo mismo con los resultados `tool` de `research` viejos: dejar solo la pregunta, la primera oración del resumen y las URLs.
  - Mantener `id` y `tool_call_id` intactos para no romper el emparejamiento.
  - Es la forma más liviana y segura de compactar: limpiar resultados de herramientas viejos (ver Fuentes).

**M2. No hay presupuesto de tokens ni ventana deslizante. Severidad: Alta**

- **Dónde:** `agent.rs:87-98` manda `&s.messages` completo. No se parsea `usage` del stream (`llm.rs:104-109`).
- **Cambio, en tres partes:**
  1. **Estimación.** Hacer `fn estimate_tokens(&str) -> usize` como `chars/3.5`. Agregar `context_tokens` opcional por modelo en settings, con 64k por defecto. Cuando haya `usage`, registrarlo en `meta` del mensaje del asistente para calibrar. Opcionalmente, `stream_options: {"include_usage": true}` en modo best-effort: si el proveedor responde 400, reintentar sin ese campo.
  2. **Ventana.** Si la estimación del envío supera el 60 % del presupuesto, mandar:
     - el mensaje inicial (`session.rs:121`);
     - un **resumen acumulado**;
     - los últimos N intercambios completos, cortando siempre en un borde seguro: un mensaje `assistant` con `tool_calls` y todas sus respuestas `tool` van juntos o no van.
  3. **Resumen acumulado.** Agregar a `Session` los campos `summary: String` y `summarized_upto: usize`. Cuando la ventana deja mensajes afuera, se llama una vez a un rol forzado `summarize_history` (modelo del Extractor) con el resumen previo más los mensajes que salen. El resumen debe conservar:
     - predicciones y respuestas del aprendiz;
     - confusiones detectadas y cómo se repararon;
     - analogías y ejemplos que funcionaron;
     - preferencias.

     El resultado se inyecta en el bloque de estado como `## Lo que pasó antes en esta sesión`. Muchas cosas ya están en el plan y las notas, así que el resumen puede ser corto (≤ 400 palabras).
- Conviene priorizar el recall sobre la precisión en el prompt de resumen: un resumen demasiado agresivo pierde detalles que importan después.

**M3. El estado volátil está dentro del prefijo y rompe el caché. Severidad: Media (Alta en costo con OpenAI, DeepSeek o Gemini)**

- **Dónde:** `prompts.rs:96-104` arma `shared + fase + state_block` como **un único** system message. `state_block` (`prompts.rs:108`) cambia con cada herramienta de estado.
- **Matiz:** `shared` más la fase siguen siendo un prefijo estable. El problema es que el bloque volátil está **antes** del historial, así que el historial nunca entra en el caché de prefijo. OpenAI, DeepSeek y Gemini cachean prefijos de forma automática. Anthropic, vía su capa compatible con OpenAI, **no soporta prompt caching** (ver Fuentes).
- **Cambio:**
  - El system message queda solo con `shared + fase`, que cambia únicamente al cambiar de fase.
  - El bloque de estado se manda como **último mensaje `user`, solo en el envío** (no se persiste), envuelto en `<estado_app>…</estado_app>` con una línea que diga que lo genera la app y no el aprendiz.
  - No conviene usar un `system` final, porque la capa de compatibilidad de Anthropic fusiona todos los system en el primero.
  - Hay que actualizar `shared.md:20` ("aparece al final de este prompt") a "aparece en el último mensaje, marcado `<estado_app>`".
  - Se rompen tests que hay que ajustar: `prompts.rs:186-198` (`system_prompt_follows_phase`) y `agent_tests.rs` (`probe_prompt_includes_related_graph_knowledge`).
- **Ojo:** algunos proveedores rechazan dos mensajes `user` seguidos o un `user` justo después de `tool`. Si el último mensaje es `tool`, el `user` sintético va después; OpenAI y OpenRouter lo aceptan. Hay que probarlo con el fake de `agent_tests.rs`.

**M4. Un turno vacío o cortado deja al aprendiz sin señal. Severidad: Baja**

- `agent.rs:101` termina el turno en silencio si el modelo no devuelve texto ni herramientas.
- `agent.rs:141` corta a los 12 pasos sin avisarle antes al modelo.
- **Cambio:**
  - Cuando quedan 2 pasos, agregar al bloque de estado: "Te quedan 2 pasos en este turno: cerrá con `ask_question` o un mensaje."
  - Ante una respuesta vacía, emitir un `AgentEvent::Error` amable ("El modelo no respondió; probá de nuevo").

### 2.2 Memoria de largo plazo (entre sesiones)

**M5. No hay modelo del aprendiz y las confusiones se pierden. Severidad: Alta**

- **Dónde:**
  - `extract.md`: "No incluyas sus confusiones".
  - `session.rs:81` (`findings`) solo vive en la sesión.
  - `practice.rs` documenta que los resultados "never touch the graph".
  - La lista `exam.review` solo la usa la hoja de repaso.
- **Cambio (el camino más barato, sin llamadas nuevas al LLM):**
  - Extender el tool forzado `record_knowledge` (`extract.rs` `tool_def`) con:
    - `misconceptions: [{concept, wrong_idea, fixed: bool}]`;
    - `preferences: [string]` (por ejemplo "aprende mejor con ejemplos numéricos", "prefiere demos");
    - `level_notes: [{topic, level}]`.
  - Persistir todo en `<data>/learner/profile.json` (`LearnerStore` nuevo), fusionando por `concept` normalizado (`graph::normalize`), con `updated_at` y la `source` de cada entrada.
  - Topes duros:
    - hasta 30 confusiones (ganan las más recientes);
    - hasta 10 preferencias;
    - hasta 40 notas de nivel.
- **Cuándo se lee:** en probe y plan, inyectar en el bloque de estado `## Lo que sabemos del aprendiz`, con las preferencias y las confusiones **no resueltas** relevantes al objetivo (mismo ranking que en M7), con un máximo de 8 líneas.
- **Prompts:** en `probe.md`, "verificá primero las confusiones previas relacionadas". En `teach.md`, "si una confusión previa reaparece, atacala explícitamente".

**M6. El profesor no ve sus errores pasados en exámenes ni en práctica. Severidad: Media**

- **Exámenes:**
  - `exam::study` (`exam.rs:790`) crea la sesión con `ExamLink`, pero `state_block` (`prompts.rs:130-143`) muestra solo los objetivos.
  - Cambio: en `state_block`, si `s.exam` existe, cargar el `Exam` y listar los `review` cuyo `question.topic_id == link.topic_id`, hasta 5, con el enunciado recortado a 200 caracteres, la respuesta correcta y la racha.
  - Como `state_block` es puro, conviene pasarle un `&[String]` precomputado desde `agent.rs` (igual que `known`).
- **Práctica:** al cerrar un intento `incorrect` o `partial` (`practice.rs` `answer`), agregar una entrada al perfil (M5) del tipo `{concept: target.text, wrong_idea: feedback}`, sin llamada nueva al LLM.

**M7. `graph::relevant` es demasiado ingenuo. Severidad: Media**

- **Dónde:** `graph.rs:247-276`.
  - Cuenta palabras de 4 letras o más compartidas con el `goal`.
  - El stemming solo quita una "s" final.
  - La lista de stopwords es corta.
  - No pondera por IDF.
  - No cruza idiomas.
  - Se recalcula leyendo y plegando todo el ledger en cada paso (`agent.rs:83`, `graph.rs:294`).
- **Cambio:**
  1. Ampliar la consulta: `goal` más los títulos del plan (si existe) más los objetivos del examen. Hoy, en exámenes, `goal` es solo el título del tema (`exam.rs:797`).
  2. Ponderar por IDF dentro del grafo: las palabras raras pesan más.
  3. Mostrar también en teach los 5 nodos mejor rankeados para el nodo `current`.
  4. **Recuperación a demanda:** agregar una herramienta `recall` (ver §3.3) para que el modelo formule su propia consulta con sinónimos. Así se evita depender de embeddings, que no todos los proveedores compatibles con OpenAI exponen.
  5. Cachear `GraphView` en `GraphStore` (invalidar en `append`).

**M8. La extracción pierde el final de sesiones largas e incluye investigación como si fuera del aprendiz. Severidad: Media**

- `extract.rs:75-86`: `truncate` conserva los primeros 60k caracteres, y el final (donde se alcanza el objetivo) se pierde. Cambio: en `session_transcript`, conservar objetivo y plan completos más **la cola** de la conversación, con un marcador `[…se omitió el inicio…]`. El plan con sus notas ya resume el principio.
- `extract.rs:68`: la condición `"tool" if m.meta.is_some()` también incluye los resultados de `research` (`meta.kind = "research"`). Cambio: filtrar `meta.kind == "answer"`, o rotular `Investigación (no es del aprendiz):` para que el extractor no lo trate como algo entendido.
- Pasar también los `findings` al transcript (sección `## Diagnóstico`), para que el extractor alimente las confusiones de M5.

**M9. Hay sesiones que nunca llegan al grafo. Severidad: Media**

- `SessionView.tsx:101` extrae solo si `phase === "done" && !session.graph`:
  - Una sesión abandonada en teach con 4 nodos `understood` no aporta nada.
  - Una sesión que vuelve de done a teach (como permite `done.md`) y termina otra vez no se reextrae.
- **Cambio:**
  - Reextraer cuando `session.graph.at < session.updated_at` y `phase === "done"`. Re-extraer reemplaza el aporte (`graph.rs:188` `fold`), así que es idempotente.
  - Agregar el botón "Guardar lo aprendido hasta acá" cuando haya al menos 1 nodo `understood`.

### 2.3 Higiene de memoria

**M10. No se puede olvidar. Severidad: Alta (privacidad y confianza)**

- `delete_session` (`lib.rs:114`) borra el JSON, pero la extracción sigue en `graph/extractions.jsonl`. `GraphScreen.tsx` no tiene borrar ni editar.
- **Cambio, compatible con el ledger de solo-agregar:**
  - `forget_source(source)` agrega una `Extraction` **vacía** para esa fuente con `at = now`. Como `fold` toma la última por fuente, el aporte desaparece. Esto hay que hacerlo **sin pasar por** `graph::validate` (`graph.rs:138`), que rechaza las extracciones vacías.
  - Llamarlo desde `delete_session`.
  - En el grafo, agregar "Olvidar esta fuente" por cada `Source` de un nodo.
  - Para el perfil (M5), mostrar una pantalla "Lo que la app sabe de vos" con borrar por ítem y "borrar todo".
  - Opcional: un comando `compact_ledger` que reescriba el archivo con solo la última extracción por fuente, para que el borrado sea físico.

**M11. Datos viejos y contradicciones. Severidad: Baja**

- `state_block` (`prompts.rs:123-128`) presenta los nodos del grafo como verdades firmes ("No las reenseñes") sin fecha.
- **Cambio:**
  - Mostrar la antigüedad ("hace 3 meses") a partir del `at` de la fuente más reciente (agregar `last_at` a `Node` en `fold`).
  - Reformular: "Verificá con una pregunta rápida antes de marcarlas `known`".
  - Para las contradicciones entre fuentes (dos proposiciones opuestas), alcanza con que el perfil gane por recencia. No vale la pena detectarlas automáticamente todavía.

**M12. Privacidad hacia el proveedor. Severidad: Baja**

- Todo el historial, incluidos el "razonamiento" del aprendiz, los apuntes importados y los grafos, viaja al proveedor configurado.
- **Cambio:** agregar una línea en Ajustes ("Tus sesiones se envían al proveedor elegido") y no inyectar nunca el perfil completo, solo los fragmentos relevantes (M5). No hay datos sensibles en URLs, así que eso está bien.

---

## 3. Herramientas

### 3.1 Herramientas del profesor (`tools.rs:10-115`, `agent.rs:120-133`)

**`ask_question`**

| Problema | Cambio propuesto |
|---|---|
| `purpose` y `options` no se validan (`QuestionArgs`, `tools.rs:186`): puede llegar `purpose: "quiz"` o una sola opción. | Deserializar `purpose` como enum y validar `options` (2 a 6 entradas, no vacías, sin repetidas). Error accionable: "error: `options` necesita entre 2 y 6 opciones distintas; omitilo para respuesta abierta". |
| Las llamadas que vienen **después** de `ask_question` en el mismo lote se ejecutan (`agent.rs:120-133`). Por ejemplo, el modelo puede marcar `understood` antes de que el aprendiz conteste. `shared.md:18` dice que "el turno termina". | Si ya hay una pregunta pendiente, devolver `"ignorada: ya preguntaste; esta llamada se descarta. Repetila después de la respuesta."` para toda llamada de estado (`update_node`, `set_phase`, `set_plan`) posterior. Alternativa: documentar en la descripción "llamala al final, sola o última". |
| La descripción no dice que no hay que revelar la respuesta ni explica para qué sirve `purpose`. | Agregar la descripción del enum: `probe` (medir), `predict` (antes de explicar), `check` (verificar después). |

**`record_finding`**

| Problema | Cambio propuesto |
|---|---|
| Devuelve `"ok"`: el modelo no ve el diagnóstico acumulado. | Devolver `"registrado: <concepto> → <nivel>. Diagnóstico: N conceptos (k solid, …)"`. |
| `concept` no tiene descripción, así que salen nombres inconsistentes que rompen la deduplicación (`eq_ignore_ascii_case` no cubre tildes). | Agregar la descripción "nombre corto y estable del prerrequisito, el mismo si lo volvés a registrar" y deduplicar con `graph::normalize`. |
| Solo se usa en probe; en teach las confusiones nuevas no quedan registradas. | Habilitarla en teach desde `teach.md`: "si aparece una confusión, `record_finding` con `misconception`". Así alimenta M5. |

**`set_plan`**

| Problema | Cambio propuesto |
|---|---|
| Acepta varios `current` y no tiene tope de tamaño. | Rechazar más de un `current`. Si hay más de 15 nodos, avisar: "error: plan de N nodos; recortá a ≤ 15". |
| Puede degradar nodos `understood` a `pending` sin avisar. | Si un nodo estaba `understood` o `known` y vuelve a `pending`, conservar el estado anterior y avisarlo en el resultado. |
| `summary` no es obligatorio, pero `plan.md` lo pide. | Agregar `summary` a `required`, con descripción. |
| El resultado es `"plan guardado (N nodos)"`. | Agregar "próximo nodo enseñable: `<id>`" (el primer `pending` con dependencias cumplidas). |

**`update_node`**

| Problema | Cambio propuesto |
|---|---|
| Error poco accionable: `no existe el nodo 'x'` (`tools.rs:219`). | `"error: no existe el nodo 'x'. Ids válidos: a, b, c"`. |
| Devuelve `"ok"`. | `"<id> → understood. Progreso: 3/6. Próximo nodo con dependencias cumplidas: <id>"`, o "todos entendidos: cerrá con `set_phase` done". |
| Permite `understood` sin haber pasado por `current`, y marcar `current` un nodo con dependencias sin entender. | Advertencia (sin bloquear): "ojo: depende de `x`, que sigue pending". |
| `note` no tiene descripción, y es memoria valiosa para la extracción. | "Cómo lo expresó el aprendiz o qué confusión se reparó (1 oración)". |

**`set_phase`**

| Problema | Cambio propuesto |
|---|---|
| Permite cualquier transición: probe → done, plan sin diagnóstico, done con nodos pendientes. | Validar `probe→plan` (al menos 1 finding), `plan→teach` (ya existe) y `teach→done` (el último nodo `understood`). Si no se cumple, devolver un error que diga qué falta. |
| El resultado es solo `"fase actual: teach"`. | Agregar 1 línea con lo que se espera en la fase nueva ("empezá con `update_node` current + `ask_question` predict"). Hoy eso solo aparece en el próximo paso, cuando cambia el prompt. |

**`show_diagram` / `show_demo` / `show_code`**

| Problema | Cambio propuesto |
|---|---|
| El contenido queda en el historial para siempre (M1). | Compactación en el envío. |
| El Mermaid no se valida: un error de sintaxis se ve roto en la UI y el modelo nunca se entera. | Hacer un chequeo barato en Rust: la primera línea empieza con `graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap`. Si no, "error: Mermaid tiene que empezar con …". |
| `show_code.task` existe en el esquema, pero `CodeArgs` lo ignora. Está bien, solo verificarlo en la UI. | Sin cambio. |

**`research`**

| Problema | Cambio propuesto |
|---|---|
| Sin tope: el modelo puede investigar hasta 12 veces por turno, y cada vez son búsqueda más LLM (`agent.rs:122-126`). | Máximo 2 por turno (contador local en `run_turn`). Si se pasa: "error: límite de investigación del turno alcanzado; seguí con lo que tenés". |
| Si los argumentos JSON están mal, `unwrap_or_default` termina en "la pregunta de investigación está vacía", que es un mensaje engañoso. | Diferenciar: "error: argumentos inválidos (…); mandá `{\"question\": \"…\"}`". |
| Los resultados viejos se reenvían enteros. | M1. |

### 3.2 Roles con herramienta forzada (`practice.rs:282` `forced`, `extract.rs:94`, `research.rs`, `exam.rs`, `cards.rs`, `runner.rs`)

Hay un problema común a todos: **una sola llamada, sin reintento**. Si la validación falla (JSON roto, cero ítems válidos, falta la tool), el error va al usuario y el modelo nunca lo ve. Algunos proveedores o modelos ignoran `tool_choice` con nombre y responden en texto.

**Cambio:** que `forced()` (y `extract::extract`) acepte un validador `Fn(&str) -> Result<T>`. Si falla, reintentar **una vez** con:
- un mensaje `assistant` con la llamada fallida;
- un `tool` con el error concreto;
- un `user` que diga "corregí y volvé a llamar `<tool>`".

Si la respuesta no trae tool call, reintentar con `tool_choice: "required"`.

| Herramienta forzada | Problema | Cambio propuesto |
|---|---|---|
| `record_knowledge` (`extract.rs`) | La descripción "Guarda las proposiciones…" no tiene descripción de campos. `key` y `chains` no tienen ejemplo. Descarta confusiones. | Describir `key` ("p1, p2…") y `premises` ("claves de `propositions`"). Agregar `misconceptions` y `preferences` (M5). |
| `set_problems` (`practice.rs:98`) | `targets` debe usar ids exactos, pero los ids son hashes `p…` poco legibles. Un id mal copiado descarta el problema en silencio. | En `generate_input`, numerar las ideas (`[1] p3fa…`) y aceptar índice o id. En el reintento, decir qué targets no existían. |
| `grade_answer` (`practice.rs:115`) | No ve los intentos anteriores del mismo problema, así que puede repetir la misma devolución. | Agregar a `grade_input` los últimos 2 intentos (veredicto y feedback). |
| `submit_research` (`research.rs`) | Bien diseñado. `used` vacío equivale a todas las fuentes, sin señal. | Si `used` está vacío, `for_teacher` debería decir "(sin citas)". |
| `set_syllabus` (`exam.rs:337`) | `objectives` no tiene descripción y `weight` no tiene rango. | `weight`: `minimum 0`, `maximum 100`. `objectives`: "frases que empiezan con verbo". |
| `set_exam_questions` (`exam.rs:455`) | `options` no tiene `minItems`/`maxItems`. `topic_id` es opcional pero útil para M6. | `minItems 4`, `maxItems 6`. `topic_id` obligatorio. |
| `check_answers` (`exam.rs:843`) | Si el verificador falla, se guarda el simulacro **sin verificar** en silencio (`exam.rs:815-819`, `Err(_)`). | Guardar `dropped: None` ya pasa; mostrar en la UI "no verificado" y loguear el error. |
| `submit_exam_guide` (`exam.rs:662`) | Correcto (permite `guide` vacío). | Sin cambio. |
| `submit_cheat_sheet` (`exam.rs:988`) | El input tiene el grafo y los fallos, pero no el perfil del aprendiz. | Agregar las confusiones (M5) relevantes. |
| `set_cards` (`cards.rs:157`) | Si la fuente es un examen, se usa `sheet_input(&exam, &[])` (`cards.rs:285`) sin el grafo: puede generar tarjetas de lo que ya domina. | Pasar `known`, como hace `cheat_sheet`. |
| `set_code_exercise` (`runner.rs:169`) | Los campos no tienen descripción en el esquema; todo depende del prompt. | Copiar al esquema las reglas clave (starter sin solución, tests que terminan con error, imprimir `OK`). Esto debe seguir siendo autoría pura: **ninguna herramienta ejecuta código**, y está bien que siga así (`lib.rs` `run_code` solo desde la UI). |

### 3.3 Herramientas que faltan

| Herramienta | Para qué | Diseño mínimo |
|---|---|---|
| `recall` | Que el profesor consulte a demanda el grafo, el perfil y los fallos de examen, en vez de depender solo de lo que se precargó. | `{query: string, kind?: "ideas"|"confusiones"|"examen"}` → hasta 8 líneas rankeadas (M7) con su antigüedad. Es de solo lectura e idempotente. |
| `note_learner` | Registrar en el momento una preferencia o confusión persistente ("se traba con notación sigma"). | `{kind: "preference"|"misconception", text, concept?}` → se escribe en el perfil (M5). Devuelve lo guardado. |
| `make_cards` | Pasar lo enseñado a repetición espaciada al cerrar un nodo o la sesión. | `{cards: [{front, back}]}` (hasta 10) → se agregan a un mazo "Sesión: <título>" (reusar `cards::validate_cards`). Devuelve el nombre del mazo y la cantidad. |
| `finish_session` (o extender `set_phase` done) | Un cierre estructurado: resumen, confusiones resueltas y abiertas, próximo paso sugerido. | `{summary, open_questions[], next_goal?}` → se guarda en `Session` y alimenta el extractor y el perfil. También podría disparar la extracción. |
| `schedule_review` (opcional) | Proponer un repaso en la agenda. | Depende de `exam.schedule`, así que conviene dejarlo para después. Primero `make_cards`. |

**Exposición por fase:** hoy las 9 herramientas están disponibles en todas las fases. Conviene filtrar `definitions()` por fase:
- **probe:** `ask_question`, `record_finding`, `recall`, `set_phase`, `research`.
- **plan:** se suma `set_plan`.
- **teach:** todo.

Menos herramientas es menos confusión, y mantener las definiciones fijas por fase sigue siendo amigable con el caché.

### 3.4 Barandas del loop

- `MAX_STEPS = 12` (`agent.rs:16`) es razonable. Falta el aviso previo (M4). El mensaje final "Escribí algo para continuar" está bien.
- La regla de una pregunta por vez está bien (`tools.rs:199`), con el hueco de las llamadas posteriores en el mismo lote (§3.1).
- **Cancelación:**
  - Se revisa entre chunks y entre pasos. Si se cancela con llamadas a herramientas, estas se descartan (`agent.rs:112-118`). Correcto.
  - `research::run` no es cancelable a mitad de camino: si el aprendiz para, la búsqueda sigue hasta 30 s más la llamada al LLM. Conviene revisar `cancel` antes de `research::run`.
- **Llamadas en paralelo:** se aplican en orden y sin `parallel_tool_calls` explícito. Es aceptable. `set_phase(teach)` antes de `set_plan` en el mismo lote falla y se autocorrige en el paso siguiente. Habría que documentar en `plan.md`: "primero `set_plan`, después `set_phase`".
- **Concurrencia:** `extract_session` recarga la sesión antes de guardar (`lib.rs:186-189`). Bien hecho.

---

## 4. Prompts

1. **`shared.md:16`:** "español rioplatense neutro" es contradictorio, porque el rioplatense no es neutro. Todos los demás prompts usan voseo. Propuesta: "por defecto, español rioplatense (voseo)".
2. **`shared.md:18`:** dice que después de `ask_question` "el turno termina", pero el harness ejecuta las llamadas que siguen en el lote (§3.1). Hay que alinear prompt y código. Recomendación: que el código rechace las llamadas de estado y que el prompt diga "llamala última".
3. **`shared.md:20`:** "aparece al final de este prompt" tiene que cambiar si se aplica M3.
4. **`shared.md` no menciona** `record_finding`, `set_plan`, `update_node` ni `set_phase`: se los delega a los fragmentos de fase. Está bien. Pero no dice qué hacer cuando:
   - el aprendiz escribe texto libre fuera de una pregunta (dudas, "no sé", cambio de tema);
   - responde "no sé" con confianza 1.

   Agregar 2 líneas.
5. **El bloque de estado mezcla idiomas:** `- Fase: probe` (enum en inglés, `prompts.rs:111`) frente a los encabezados "Fase: MEDIR" de `probe.md`. Mostrar `Fase: medir (probe)` para que sea consistente.
6. **"Ya en el grafo" (`prompts.rs:123-128`):** dice "No las reenseñes", pero `probe.md` no dice cómo verificarlas. Agregar a `probe.md`: "si el estado muestra ideas ya en el grafo, alcanza con una pregunta rápida de transferencia para confirmarlas".
7. **`plan.md`:**
   - Falta el orden de llamadas (`set_plan` → explicación → `set_phase`). En realidad ya está, pero la explicación al aprendiz no puede ir "antes" de `set_plan` en el streaming, así que el texto debería decir "en el mismo mensaje".
   - Falta pedir que el `summary` de cada nodo sea una proposición, lo que ayuda al extractor.
8. **`teach.md`:**
   - No menciona `show_diagram`, `show_demo` ni `show_code` dentro del ciclo. Sugerencia: "en el paso Explicar, si la idea es espacial o dinámica, una visual".
   - No dice que `record_finding` sirve también en teach (§3.1).
   - Falta "si el aprendiz responde bien con confianza ≤ 2, no lo marques `understood`: pedí otra verificación". Está implícito en `shared.md`; vale la pena hacerlo explícito en el paso 5.
9. **`done.md`:** no pide cierre ni memoria. Si se agrega `finish_session` o `make_cards`, se menciona acá.
10. **`extract.md`:** excluye las confusiones (es correcto para el grafo), pero con M5 hay que agregar una sección "Confusiones y preferencias" que vaya a los campos nuevos.
11. **`research.md` y `shared.md`:** "Citá las fuentes que devuelve como [1], [2]" es consistente. Está bien.
12. **Idioma de los roles auxiliares:** "Escribí en el idioma del material, examen o registro" es correcto para el contenido. Las devoluciones al aprendiz (`practice_grade`, `exam_explain`, `code_explain`) dicen "en el idioma del aprendiz", pero el código no le pasa al rol cuál es ese idioma. Si el material está en inglés y el aprendiz habla castellano, el resultado queda ambiguo. Agregar al input una línea `Idioma del aprendiz: español (rioplatense)`.
13. **Tono y voseo:** consistente en todos los `.md`. No se encontraron tuteos.

---

## 5. Plan priorizado

Cada ítem lleva menos de una hora. **[T]** = necesita tests nuevos o ajustados.

1. **[T] Compactar payloads visuales en el envío (M1).** Hacer `fn wire_messages` en `llm.rs` (o `agent.rs`) que reemplace los argumentos de `show_demo`, `show_code` y `show_diagram` anteriores al último mensaje del aprendiz. Test: el JSON resultante es válido, los `id` se conservan y lo persistido queda intacto.
2. **[T] Compactar resultados de `research` viejos (M1).** Misma función. Test.
3. **[T] Mover el bloque de estado a un `user` final solo en el envío (M3)**, y actualizar `shared.md:20`. Ajustar `prompts.rs` tests y `probe_prompt_includes_related_graph_knowledge`.
4. **[T] Resultados informativos en `update_node`, `set_plan` y `record_finding`:** próximo nodo enseñable, ids válidos en el error y progreso (§3.1). Ajustar los tests de `tools.rs` que comparan `"ok"`.
5. **[T] Validar `ask_question`** (`purpose` como enum, `options` de 2 a 6) **y rechazar llamadas de estado posteriores** a una pregunta en el mismo lote.
6. **[T] Validar transiciones de `set_phase`** (probe→plan necesita findings; teach→done necesita el objetivo `understood`).
7. **[T] Tope de `research` por turno (2) y error claro ante argumentos inválidos** (`agent.rs:122`).
8. **[T] Reintento único en `forced()`** con el error de validación (§3.2), y fallback a `tool_choice: "required"`.
9. **[T] Extracción: conservar la cola de la conversación y no la cabeza; excluir `research` del transcript; incluir `findings`** (M8).
10. **Reextraer al volver a terminar y botón "Guardar lo aprendido hasta acá"** (M9, `SessionView.tsx:101`). Test de UI con `mockBackend`.
11. **[T] `forget_source`, llamado desde `delete_session`, más el botón "Olvidar fuente" en `GraphScreen`** (M10). Test: después de olvidar, `fold` no muestra la fuente.
12. **[T] Fallos de examen del tema en el bloque de estado** (M6, filtrar `exam.review` por `topic_id`).
13. **[T] `record_knowledge` con `misconceptions` y `preferences`, más `LearnerStore` (`profile.json`) con topes** (M5, parte 1: persistir).
14. **[T] Inyectar el perfil relevante en probe y plan, y actualizar `probe.md` y `teach.md`** (M5, parte 2: leer).
15. **Pantalla "Lo que la app sabe de vos"** (ver y borrar el perfil) (M10).
16. **[T] Herramienta `recall`** (de solo lectura: grafo más perfil más fallos) **y ranking con IDF y consulta ampliada** (M7).
17. **[T] Estimación de tokens, presupuesto por modelo y ventana con corte en borde seguro** (M2, partes 1 y 2, sin resumen todavía).
18. **[T] Resumen acumulado `summarize_history`** (M2, parte 3).
19. **[T] Herramienta `make_cards`** (mazo por sesión) **y mención en `done.md` y `teach.md`.**
20. **Ajustes de prompts:** voseo en `shared.md:16`, texto libre y "no sé", orden en `plan.md`, visuales en `teach.md`, idioma del aprendiz en los roles auxiliares (§4).
21. **[T] Filtrar herramientas por fase** (§3.3).
22. **Aviso de pasos restantes y error ante una respuesta vacía** (M4).

Orden sugerido: 1 a 4 primero (costo y calidad inmediata), 5 a 12 (robustez y memoria básica), 13 a 19 (modelo del aprendiz y memoria gestionada), y 20 a 22 al final.

---

## 6. Fuentes

1. Anthropic, "Effective context engineering for AI agents" (2025). Compactación, limpieza de resultados de herramientas ("one of the safest lightest touch forms of compaction"), notas estructuradas y recuperación just-in-time. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
2. Anthropic, "Writing effective tools for agents — with agents" (2025). Errores accionables, respuestas con contexto relevante, eficiencia de tokens ("More tools don't always lead to better outcomes"). https://www.anthropic.com/engineering/writing-tools-for-agents
3. Anthropic, "Building effective agents" (2024). Preferir patrones simples y componibles, y diseñar bien la interfaz agente-herramienta. https://www.anthropic.com/research/building-effective-agents
4. Anthropic Docs, "OpenAI SDK compatibility". El prompt caching **no** está soportado por esa capa, y los mensajes system se fusionan en uno inicial. https://docs.claude.com/en/api/openai-sdk
5. Claude Cookbook, "Context engineering tools" (2026). Compara compactación, limpieza de resultados y memoria persistente. https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools
6. Faros AI, "Harness engineering: What makes AI coding agents work in 2026". Encuadre de "Agent = Model + Harness" y sus capas (herramientas, verificación, contexto y memoria, barandas, observabilidad). https://www.faros.ai/blog/harness-engineering

---

## 7. Estado de implementación

| # | Cambio | Estado |
|---|---|---|
| 1–2 | Compactar payloads visuales e investigación vieja (`context::compact`) | ✅ |
| 3 | Estado como último mensaje `<estado_app>`; system prompt estable (`prompts::phase_prompt`) | ✅ |
| 4 | Resultados informativos (`set_plan`, `update_node`, `record_finding`; ids válidos en errores) | ✅ |
| 5 | Validar `ask_question` (purpose, 2–6 opciones) e ignorar llamadas posteriores a una pregunta | ✅ |
| 6 | Validar transiciones de `set_phase` (`tools::check_transition`) | ✅ |
| 7 | Tope de 2 `research` por turno y error claro sin pregunta | ✅ |
| 8 | Reintento único en roles forzados (`practice::forced_valid`, también la extracción) | ✅ |
| 9 | Extracción: conservar la cola, excluir investigación, incluir el diagnóstico | ✅ |
| 10 | Reextraer si la sesión terminada siguió; «Guardar lo aprendido hasta acá» | ✅ |
| 11 | Olvidar fuente (`GraphStore::forget`): al borrar una sesión y con «Olvidar esta fuente» en el grafo | ✅ |
| 12 | Fallos de examen del tema en el estado | ✅ |
| 13–15 | Perfil del aprendiz (`learner.rs`): escritura por el extractor y la práctica, lectura en probe/plan, pantalla para ver y olvidar | ✅ |
| 16 | `recall` (grafo, perfil, fallos de examen) y ranking con IDF; consulta = objetivo + títulos del plan | ✅ |
| 17 | Estimación de tokens y ventana con corte seguro (`context::window`); tamaño de contexto por modelo en Ajustes | ✅ |
| 18 | Resumen acumulado (`Session.summary`, cada 6 mensajes que salen de la ventana) | ✅ |
| 19 | `make_cards` (mazo por sesión) | ✅ |
| 20 | Ajustes de prompts ("no sé", visuales y confusiones en `teach.md`, `<estado_app>`, `recall`, reglas de fase y resumen en `shared.md`/`probe.md`) | ✅ |
| 21 | Herramientas filtradas por fase (`tools::definitions_for`) | ✅ |
| 22 | Aviso de pasos restantes y error ante respuesta vacía | ✅ |
