# Tokens: cuánto manda Eureka y dónde ahorrar (AC-186)

Primer paso de afinar el arnés: **medir antes de optimizar**. Este informe sale del benchmark sin red
`agent::tests::token_bench::token_budget` (`src-tauri/src/token_bench.rs`). Nada acá está estimado a mano:
el benchmark corre el **loop real** del agente (`agent::run_turn`, `practice::forced_valid`,
`memory::consolidate`) contra el proveedor falso de los tests, captura el cuerpo exacto de cada pedido y lo cuenta.

- **Tokenizador**: `tiktoken-rs` con `o200k_base` (el de los GPT-4o/5). Es un **proxy**: DeepSeek, Claude, Gemini
  y Kimi tienen tokenizadores propios (en español suelen dar entre 0 y 25 % más). Las tools se cuentan como su JSON;
  cada proveedor las reescribe a su manera, así que esa columna sobreestima un poco.
- **Qué es cada columna**: *sistema* = `messages[0]` (shared + fragmento de la fase); *tools* = el arreglo `tools`
  de la fase; *historial* = los mensajes entre el sistema y el estado (ya compactados y ventaneados por
  `context.rs`); *estado* = el último mensaje `<estado_app>` (`prompts::state_block` + lo que agrega `agent.rs`).
- **Prefijo repetido**: tokens de cada pedido que repiten byte a byte el pedido anterior de la misma conversación
  desde el principio (tools → sistema → mensajes, sin contar el estado). Es el techo de lo que un caché de prefijo
  puede servir; lo que cobra cada proveedor depende de su caché.
- La sesión de prueba tiene la configuración vacía (sin Mi cursada, carrera, biblioteca ni exámenes). Con eso
  cargado el **estado** crece (es lo único volátil que crece con los datos de la persona).

Para correrlo y ver las tablas: `cargo test --lib token_ -- --nocapture` (con las variables de entorno de siempre).

## Números por turno del aprendiz

Una sesión guionada: charla → diagnóstico → plan → enseñar (con diagrama y una demo de 3,5 KB) → cierre; después
el pase de memoria en segundo plano, un set de práctica y una sesión larga (200 mensajes) que pasa la ventana.

> Las tablas de esta sección son la **medición inicial** (antes de optimizar). Lo que cambió con las optimizaciones
> aplicadas está en «Optimizaciones aplicadas: antes y después», más abajo.

| turno | fases | llamadas | sistema | tools | historial | estado | total turno | prefijo repetido |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 01 charla | chat | 1 | 3 611 | 3 984 | 16 | 118 | 7 729 | 0 (primera) |
| 02 charla → diagnóstico | chat → probe | 2 | 6 220 | 5 497 | 225 | 184 | 12 126 | 7 611 (63 %) |
| 03 diagnóstico | probe | 1 | 2 609 | 1 513 | 281 | 66 | 4 469 | 4 280 (96 %) |
| 04 diagnóstico → plan | probe → plan | 2 | 4 715 | 3 399 | 1 076 | 176 | 9 366 | 4 403 (47 %) |
| 05 plan → enseñar (diagrama + demo) | plan → teach | 2 | 4 669 | 6 260 | 1 905 | 472 | 13 306 | 4 604 (35 %) |
| 06 enseñar (chequeo) | teach | 1 | 2 563 | 4 374 | 1 327 | 236 | 8 500 | 7 929 (93 %) |
| 07 enseñar → cierre | teach → done | 2 | 4 487 | 8 748 | 3 376 | 473 | 17 084 | 8 264 (48 %) |
| 08 cierre | done | 1 | 1 924 | 4 374 | 1 845 | 236 | 8 379 | 8 098 (97 %) |
| 09 memoria (segundo plano) | remember_session, extract | 2 | 839 | 396 | 1 204 | 0 | 2 439 | 0 |
| 10 práctica | set_problems | 1 | 481 | 150 | 110 | 0 | 741 | 0 |
| 11 sesión larga, turno A | teach | 1 | 2 563 | 4 374 | 32 430 | 180 | 39 547 | — |
| 12 sesión larga, turno B | teach | 1 | 2 563 | 4 374 | 32 713 | 180 | 39 830 | 6 953 (17 %) |

### Por llamada y por fase

| fase | sistema | tools | historial (en la sesión guionada) | estado | total por llamada |
|---|---:|---:|---:|---:|---:|
| chat | 3 611 | 3 984 (18 tools) | 16–67 | 118 | 7 729–7 780 |
| probe | 2 609 | 1 513 (7 tools) | 158–464 | 66–78 | 4 346–4 664 |
| plan | 2 106 | 1 886 (11 tools) | 612–913 | 98–236 | 4 702–5 141 |
| teach | 2 563 | 4 374 (22 tools) | 992–1 576 | 236 | 8 165–8 750 |
| done | 1 924 | 4 374 (22 tools) | 1 800–1 845 | 236 | 8 334–8 379 |
| práctica (forzada) | 481 | 150 | 110 | — | 741 |
| memoria: remember_session | 346 | 136 | 602 | — | 1 084 |
| memoria: extract | 493 | 260 | 602 | — | 1 355 |

- **Llamadas por turno**: 1 cuando el modelo pregunta o contesta; 2 cuando cambia de fase (un paso solo para
  `begin_learning`/`set_phase` y otro ya en la fase nueva). El tope es `MAX_STEPS = 12`.
- **Por turno**: entre 4,5 k y 17 k tokens de entrada; **~10 k de promedio** (81 k en los 8 turnos, 12 llamadas,
  ~6,7 k por llamada).
- **Estático contra volátil**: sistema + tools son el **85 %** de toda la entrada de los turnos 01–08 (69 k de 81 k).
  Por turno va de 98 % (charla) a 75 % (cierre). En una sesión larga se invierte: 18 % estático, 82 % historial.
- **Prefijo repetido en la sesión guionada**: 45 k de 81 k (**56 %**). Lo que no se repite viene casi todo de los
  cambios de fase (cada una cambia sistema y tools: 27 k tokens sin repetir en los turnos 02, 04, 05 y 07).

### Tamaño de cada tool (JSON, o200k)

| # | tool | tokens | fases |
|---:|---|---:|---|
| 1 | `ui_command` | 808 | todas |
| 2 | `propose_timetable` | 506 | chat, teach, done |
| 3 | `propose_action` | 417 | chat, teach, done |
| 4 | `propose_exam` | 331 | chat, teach, done |
| 5 | `ask_question` | 192 | probe, plan, teach, done |
| 6 | `propose_own_problems` | 187 | chat, teach, done |
| 7 | `show_code` | 181 | chat, teach, done |
| 8 | `begin_learning` | 179 | chat |
| 9 | `propose_deck` | 171 | chat, teach, done |
| 10 | `make_cards` | 163 | chat, teach, done |
| 11 | `recall` | 161 | todas |
| 12 | `show_demo` | 161 | chat, teach, done |
| 13 | `propose_code` | 151 | chat, teach, done |
| 14 | `propose_practice` | 145 | chat, teach, done |
| 15 | `set_plan` | 137 | plan, teach, done |

El resto: `library_search` 128, `record_finding` 101, `show_diagram` 87, `app_status` 86, `library_read` 78,
`update_node` 75, `set_phase` 68, `research` 59. `ui_command` sola es el 53 % de las tools del diagnóstico y el 20 %
de las de la charla. Los siete `propose_*` suman **1 908** tokens (44 % de las tools de enseñar y cerrar).

### Prompts

`shared` 1 854 (va en todas las fases), `chat` 1 755, `probe` 753, `teach` 707, `plan` 250, `done` 68. El sistema de
la charla (3 611) es el más grande y es por donde empieza casi toda sesión. Fuera del loop: `companion` 995,
`code_project` 782, `code_exercise` 622, `academic_parse` 583, `extract` 493, `practice_generate` 481.

## ¿El prefijo estático es estable byte a byte?

**Sí, entre pasos y entre turnos de la misma fase** (lo verifica `the_static_prefix_is_byte_stable_between_steps`):

- **Orden de las tools**: `tools::definitions()` es un `Vec` fijo y `definitions_for` filtra sin reordenar; no hay
  `HashMap` en el camino. Mismo orden en cada paso y cada turno.
- **System prompt**: `prompts::phase_prompt` = `shared` + fragmento de la fase, de los `.md` compilados (o el
  archivo que la persona editó). No tiene fechas, horas, ids ni nada aleatorio.
- **Lo que cambia va al final**: la fecha de hoy (`academic::state_section`), los «faltan N días», la pantalla
  (`ui_snapshot`), el modelo del estudiante, la memoria de otras sesiones, el resumen y el aviso de pasos van en el
  mensaje `<estado_app>`, siempre el último y nunca guardado en el historial. En el paso siguiente ese lugar lo ocupa
  el mensaje del asistente, así que todo lo anterior se repite tal cual.
- **OpenCode Go** recibe `x-opencode-session: eureka-<id de la sesión>` estable por sesión (enruta el caché).

Donde **sí** se rompe (por diseño, no por un bug):

1. **Cambio de fase**: cambian sistema y tools a la vez → el paso siguiente no repite nada.
2. **`context::compact` al llegar una respuesta nueva**: las demos, diagramas y código anteriores a la última
   entrada del aprendiz se reemplazan por un stub. El caché se corta en el primer mensaje reescrito. En la sesión
   guionada cuesta poco (turno 06: 571 tokens sin repetir), porque la demo estaba cerca del final.
3. **La ventana que se desliza (`context::window`)**: pasado el 60 % del presupuesto (64 k por defecto), cada turno
   que agrega una respuesta larga saca mensajes viejos y cambia el aviso «Se omitieron N mensajes», que va en la
   posición 2. Todo el historial se corre: en el turno B de la sesión larga solo se repiten **6 953 de 39 830
   tokens (17 %)**; cuando no se saca nada (respuesta corta) se repite el 99 %. **Era la mayor pérdida medida;
   corregida con la ventana por bloques (ver abajo).**
4. **Llega una investigación en segundo plano (`research::patch`)**: el mensaje «Investigación en curso» se
   reescribe en su lugar con el resultado, así que el turno siguiente corta el caché en ese mensaje.
5. **Suscripción ChatGPT (Responses API)**: no mandaba `prompt_cache_key`; ahora manda el id de la conversación.

No encontré un bug que rompa el caché que se pueda arreglar con un cambio trivial; los cinco puntos son decisiones
de diseño y quedan como optimizaciones.

## El pase de memoria en segundo plano

- El loop de `lib.rs` arranca a los 30 s y corre **cada 3 minutos**, pero solo llama al modelo por sesiones que
  están para pasar (`memory::due`): la persona habló, hay **al menos 4 mensajes nuevos** desde el último pase y la
  sesión lleva **10 minutos quieta**, sin turno corriendo y sin un fallo en los últimos 30 min.
- Sin sesiones así: **0 llamadas** (solo lee la configuración; con una cuenta de ChatGPT puede refrescar el token).
- Por sesión que pasa: **2 llamadas** — `remember_session` y, si el grafo quedó viejo, `extract`. En la sesión
  guionada: 1 084 + 1 355 = **2 439 tokens**. Las dos mandan **la misma transcripción** (602 tokens acá; con tope de
  60 000 caracteres, ~15 k tokens) con sistema y tools distintos, así que no comparten caché.
- En el peor caso cada una se multiplica: hasta 3 intentos de `tool_choice` (por nombre, `required`, `auto`) y un
  reintento con el error de validación → hasta 6 llamadas por tarea.
- En la práctica: unas 2 llamadas por sesión de estudio, una vez que la sesión se calma.

## Optimizaciones aplicadas: antes y después

Cuatro cambios, cada uno en su commit y medido con el mismo benchmark (la línea base quedó con los números nuevos,
así que `token_budget` falla si vuelven a crecer).

### Por fase (tokens por llamada, o200k)

| fase | sistema | tools antes → después | historial | estado | por llamada antes → después |
|---|---:|---:|---:|---:|---:|
| chat | 3 611 | 3 984 → **3 708** | 16–67 | 118 | 7 729 → **7 453** |
| probe | 2 609 | 1 513 → **1 270** | 158–464 | 66–78 | 4 469 → **4 226** |
| plan | 2 106 | 1 886 → **1 643** | 612–913 | 98–236 | 4 702–5 141 → **4 459–4 898** |
| teach | 2 563 | 4 374 → **2 561** | 992–1 576 | 236 | 8 165–8 750 → **6 352–6 937** |
| done | 1 924 | 4 374 → **2 561** | 1 800–1 845 | 236 | 8 334–8 379 → **6 521–6 566** |

Sistema, historial y estado no cambiaron en la sesión guionada (no toqué los prompts).

### Por turno del aprendiz

| turno | antes | después | prefijo repetido antes → después |
|---|---:|---:|---:|
| 01 charla | 7 729 | 7 453 | 0 → 0 |
| 02 charla → diagnóstico | 12 126 | 11 607 | 63 % → 63 % |
| 03 diagnóstico | 4 469 | 4 226 | 96 % → 96 % |
| 04 diagnóstico → plan | 9 366 | 8 880 | 47 % → 47 % |
| 05 plan → enseñar | 13 306 | 11 250 | 35 % → 39 % |
| 06 enseñar | 8 500 | 6 687 | 93 % → 91 % |
| 07 enseñar → cierre | 17 084 | 13 458 | 48 % → 48 % |
| 08 cierre | 8 379 | 6 566 | 97 % → 96 % |
| **turnos 01–08** | **80 959** | **70 127 (−13 %)** | 56 % → 55 % |

### Sesión larga (pasada la ventana)

| | antes | después |
|---|---:|---:|
| entrada por turno | ~39 800 | ~27 600 |
| prefijo repetido entre turnos seguidos | **17 %** | **98 %** (y 83 % de promedio en los turnos b–f, contando el turno en que cae un bloque) |
| tokens sin repetir por turno | ~32 900 | ~460 (≈ 22 k el turno en que cae un bloque) |

### Qué se hizo

1. **Ventana del historial por bloques** (`context::window`). El corte solo cae en marcas fijas, una cada ~20 % del
   presupuesto contada desde el principio del historial y siempre en un límite seguro (nunca en un resultado de tool):
   las marcas dependen solo de lo que está antes, así que los mensajes nuevos no las mueven. El techo sigue siendo
   el 60 % y el aviso «Se omitieron N» cambia solo cuando cae un bloque (cada ~20 % del presupuesto de mensajes
   nuevos). Como deja entre 40 y 60 % en vez de pegarse al 60 %, además manda menos historial. Lo prueban
   `context::the_window_moves_in_blocks…` y la sesión larga de `the_static_prefix_is_byte_stable_between_steps`
   (exige más de 75 % repetido en los turnos b–f).
2. **Dieta de tools** (`tools::definitions_for`). En enseñar y cerrar salieron `propose_timetable`, `propose_exam`,
   `propose_deck`, `propose_practice`, `propose_own_problems`, `propose_code` y `app_status` (−1 577 tokens):
   - **por qué**: el único prompt que los pide es `chat.md`; `teach.md`, `done.md` y `shared.md` no los nombran, y el
     guion de prueba (`src/e2e/teacherScript.ts`) solo los usa en la fase `chat`. Ningún flujo e2e los necesita
     fuera de la charla.
   - **qué quedó y por qué**: `make_cards` y `show_*` (los pide `teach.md`); `ui_command` (`shared.md`: «en cualquier
     fase»); `recall`, `library_*`, `research` (`shared.md`); `set_plan`/`set_phase` (`done.md` permite ampliar el
     plan); **`propose_action`**, aunque ningún prompt de enseñar lo pide, porque es la puerta a cada pantalla
     (examen, mazo, práctica, pomodoro) desde una sesión y AC-124 pide que todo se pueda pedir por chat.
   - **diagnóstico y plan** no cambiaron de lista: sus tools son todas del método o están en `shared.md`.
   - `ui_command`: los rangos y el sentido de cada campo van una sola vez, en la descripción, en vez de repetirse en
     cada propiedad (808 → 565). `propose_timetable`: descripción y tres textos de campos más cortos (506 → 473).
     No moví nada al prompt: cualquier texto en `shared.md` costaría en todas las llamadas, incluso las que no tienen
     esas tools.
3. **Caché del proveedor** (`llm::completions_body`, `responses_body`).
   - **Claude por OpenRouter** (host `openrouter.ai` y modelo `anthropic/…` o con «claude»): dos puntos de corte
     con el formato documentado (un bloque de texto con `cache_control: {"type": "ephemeral"}`). Uno va en el
     mensaje de sistema, que en Anthropic va después de las tools, así que cubre las dos. El otro va en el último
     mensaje con texto del historial, justo antes del estado. Anthropic permite cuatro.
   - Con los números de la sesión guionada, ~39 k tokens repetidos se leerían a 0,1×, menos el recargo de 1,25× al
     escribir: **~30 k tokens-equivalentes menos de 70 k (~40 %)** para quien usa Claude por OpenRouter.
   - Los pedidos a los demás proveedores quedan byte a byte iguales; lo prueba
     `llm::other_providers_get_exactly_the_body_they_got_before`.
   - **Suscripción ChatGPT**: `prompt_cache_key` con el id de la conversación (`eureka-<sesión>`).
4. **Pase de memoria en una sola llamada: no lo hice.** Hoy son dos tareas forzadas, cada una con su prompt, su
   esquema, su validación y su reintento. `extract` además alimenta el perfil del aprendiz y lo usan otros flujos
   (apuntes, la re-extracción de la pantalla). Fusionarlas exige un prompt y una validación nuevos, y un fallo de una
   obligaría a reintentar las dos. El ahorro es chico en términos absolutos (~1 k tokens por sesión que pasa, dos
   veces por sesión de estudio como mucho), y el riesgo para la calidad del grafo no se puede medir sin un modelo
   real. Queda para cuando haya una evaluación con modelo.
5. **Un solo prefijo para todas las fases: no se hizo, a propósito.** Cambia cómo enseña el profesor y necesita su
   propia evaluación.

## Las optimizaciones estimadas (informe inicial)

Estado: la 1, la 2 y la 4 están aplicadas (ver arriba); la 3 y la 5 no.

Estimaciones con los números de arriba. «Sin caché» = tokens que el proveedor cobra a precio lleno. Lo que cuesta
leer del caché, según la documentación de OpenRouter (consultada el 4/11/2026): DeepSeek y Claude 0,1× el precio de
entrada, Gemini 0,25×, OpenAI 0,25× o 0,5× según el modelo. OpenAI y DeepSeek cachean solos (OpenAI desde 1 024
tokens); Gemini 2.5+ en forma implícita; **Claude no cachea si no se le pide** (`cache_control`, y escribir en el caché
cuesta algo más que la entrada normal). Por el endpoint de Anthropic compatible con OpenAI el caché **no está
disponible** (lo dice su documentación) y `prompt_tokens_details` llega vacío, así que ahí el «% en caché» queda en
«—».

1. **La ventana que se desliza por bloques (histéresis)**. Al pasar el 60 %, recortar hasta ~45 % de una vez y
   mantener el corte fijo hasta volver al 60 %, con el aviso «Se omitieron…» igual mientras no se mueve. Medido:
   hoy, en una sesión pasada la ventana, ~33 k tokens sin repetir por turno; con el corte fijo se repite el 99 %.
   Ahorro: **~32 k tokens sin caché por turno** en sesiones largas (con caché al 10 % del precio, ~29 k tokens-
   equivalentes por turno), a cambio de un recorte cada ~15 % del presupuesto.
2. **Dieta de tools por fase**. Sacar los siete `propose_*` y `app_status` de enseñar y cerrar (1 994 tokens) y
   acortar `ui_command` (808 → ~300, por ejemplo con un enum compacto y la descripción larga en el prompt de la
   charla). Por llamada: ~2,5 k menos en teach/done y ~0,5 k en el resto. En la sesión guionada (5 llamadas
   teach/done, 7 otras): **~16 k de 81 k (~19 %)**, y ayuda a cualquier proveedor, cachee o no.
3. **Un solo prefijo para las fases de aprendizaje**. Mismo sistema (`shared` + todos los fragmentos, ~3,6 k) y
   mismas tools para probe/plan/teach/done, con la fase y su consigna en el estado. Los cambios de fase dejan de
   romper el caché: hoy son 27 k de los 36 k tokens sin repetir de la sesión guionada. Costo: cada pedido de
   diagnóstico y plan crece ~2–4 k (en caché a partir del segundo). Ahorro neto: **~20 k tokens sin caché por sesión**
   (~25 %) con proveedores que cachean; con los que no, empeora. Conviene hacerlo después de la dieta (2).
4. **Caché explícito para Claude**. Con OpenRouter y modelos de Anthropic, el `cache_control` de nivel superior (o
   un punto de corte después de tools + sistema). Hoy esos pedidos pagan todo a precio lleno. Con el caché, los 45 k
   tokens que se repiten en la sesión guionada se leerían a 0,1×: ~40 k menos, menos el recargo de escribir los
   prefijos nuevos (~7 k) → **~33 k de 81 k tokens-equivalentes (~40 %)** para quien usa Claude. Para la suscripción
   de ChatGPT: mandar `prompt_cache_key` con el id de la sesión (mejora el enrutado; no cambia el conteo).
5. **Un solo pase de memoria por sesión**. `remember_session` y `extract` en una llamada forzada que devuelva las dos
   cosas: la transcripción viaja una vez. Por sesión que pasa: ~1 k tokens de 2,4 k (**~40 %**) y la mitad de las
   llamadas; con transcripciones largas, hasta ~15 k menos por pase.

Otras cosas medidas, más chicas: el prompt de la charla (1 755) es casi igual de grande que `shared` (1 854) y va en
cada llamada de la charla; y `context::estimate_tokens` (3,5 caracteres por token) sobreestima ~18 % frente a o200k
en la sesión larga, así que la ventana corta un poco antes de lo necesario.

## Uso real (lo que informan los proveedores)

Desde AC-186 cada llamada se cuenta en `usage.jsonl` (en la carpeta de datos, 90 días, nunca sale de la PC) con lo
que el proveedor informa: entrada, salida, en caché (`prompt_tokens_details.cached_tokens`, o
`prompt_cache_hit_tokens` en DeepSeek, o `input_tokens_details.cached_tokens` en la Responses API), razonamiento y
costo (OpenRouter `usage.cost`). Se ve en Ajustes → Avanzado → **Uso**. Comparar ese «% en caché» con el «prefijo
repetido» de este benchmark dice cuánto del techo está aprovechando cada proveedor.

## Fotos del chat: OCR local primero (AC-188)

Una foto adjunta en el chat se leía siempre con el modelo de visión: una llamada aparte (`read_images`, propósito
`notes`) con la imagen (≤ 2000 px de lado, JPEG), las reglas de transcripción y la instrucción, más el texto que
devuelve. La imagen sola cuesta según el proveedor: con el tileado de GPT-4o una foto de 2000×1500 en detalle alto son
~1,1 k tokens de entrada, y Claude cobra ~1,6 k por una imagen de 1,15 MP; sumadas las reglas y la salida (una página
de apuntes son unos 300–600 tokens), cada foto rondaba **1,5–2,5 k tokens**, en una llamada que además no aprovecha la
caché del profesor. Desde AC-188 la foto pasa antes por el OCR de esta PC; si leyó 20 letras o más con confianza media
≥ 0,9 (texto impreso, que es lo común en una foto de apuntes o de una fotocopia), esa llamada **no se hace: 0 tokens
de visión**. El texto leído sigue viajando en el mensaje como antes, así que lo que ve el profesor no cambia. Las fotos
de manuscritos, diagramas o borrosas siguen yendo al modelo de visión, y el horario, el plan de estudios y los
problemas propios también (ahí importa la estructura). No hay número medido por proveedor todavía: Ajustes → Avanzado
→ Uso muestra cuántas llamadas «lectura de fotos» quedan.

## Reformular en la biblioteca (AC-189)

`library_search` agrega **una línea (~10 tokens)** solo cuando el resultado es débil: le pide al profesor otra búsqueda con sinónimos, y la segunda vez del mismo turno, que lo diga y siga. La descripción de la tool y los prompts no cambiaron, y la sesión guionada no tiene biblioteca, así que **`token_budget` no se movió (delta 0) y la línea base no se actualizó**. El costo real es la búsqueda extra: en el benchmark de la biblioteca ([metricas-biblioteca.md](metricas-biblioteca.md)) se pide en 0 de 36 búsquedas que andan y en 6 de 12 paráfrasis, que pasan de ~1.150 a ~1.800 tokens por pregunta de promedio, a cambio de subir la sección correcta en 1.º lugar de 50 % a 92 % (simulado).

## Línea base y presupuesto

`token_budget` compara cada número (por turno, por llamada, por tool y por prompt) con
`src-tauri/bench/token_baseline.json` y falla si alguno crece **más de 10 %** (con 8 tokens de margen para que la
fecha en el estado no haga ruido). Si el crecimiento es a propósito:

```
TOKEN_BASELINE_UPDATE=1 cargo test --lib token_budget -- --nocapture
```

y se commitea la línea base nueva junto con el cambio que la explica.

## Memoria del estudiante (AC-195..AC-200)

La línea base se actualizó al mergear la memoria nueva: `recall` suma el parámetro opcional `id` (pedir el registro entero de una vista previa), **+22 tokens de herramientas** y −5 de sistema por llamada del profesor (≈ +17 netos, +0,2 %), y aparece el prompt nuevo `memory_conflict` (55 tokens), que solo usa la pasada en segundo plano para contradicciones ambiguas (hasta 3 por pasada). La pasada de memoria en segundo plano no cambia (2439).

## Un solo prefijo para el método (AC-201)

La propuesta 3, hecha después de medirla en vivo (OpenCode Go, `deepseek-v4.1-flash`, 5/11/2026). En esa sesión real
la caché iba al 85–95 % dentro de una fase pero caía a **2 048 tokens** en cada cambio de fase: el proveedor arma el
prefijo con las **tools primero**, después el sistema y el historial, y las tools y el fragmento de cada fase cambiaban.

Ahora probe, plan, teach y done mandan **las mismas tools** (las de enseñar) y **el mismo sistema** (`shared` + los
cuatro fragmentos, con la consigna de seguir solo el de la fase actual, que dice el estado). El chat queda aparte. Lo
que la app deja hacer en cada fase no cambió: antes también ejecutaba cualquier tool en cualquier fase del método; solo
cambió lo que se le muestra al modelo.

Benchmark (turnos 03–08, diagnóstico a cierre):

| | Antes | Ahora |
|---|---|---|
| Tokens mandados | 45 218 | 67 665 (+50 %) |
| Sin caché (lo que no repite el prefijo) | 19 707 | 3 346 (−83 %) |
| Costo de entrada con OpenCode Go (caché a $0,003 contra $0,15 por M, 2 %) | ≈ 20 200 equivalentes | ≈ 4 600 (−77 %) |

En vivo, la primera llamada de enseñar pasó de **7,8 k sin caché a 1,5 k**. Cuánto conviene depende del precio de
la caché del proveedor: con la caché al 2 % (OpenCode Go) o al 10 % (Anthropic, DeepSeek) gana claro; cerca del
50 % queda parejo; con un proveedor que no cachea empeora (+20–30 % de tokens). Costo fijo: la primera llamada de
diagnóstico, después del chat, manda ~2,4 k más sin caché, y cada llamada de enseñar ~1,1 k más (en caché).

Ojo con los prompts editados (Ajustes → Prompts): ahora cada fragmento viaja en todas las fases del método, así que
uno que diga «estás en el diagnóstico» también se lee mientras se enseña.
