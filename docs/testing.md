# Pruebas: la superficie completa

Objetivo: la **máxima superficie de testeo** sin gastar tokens. Cada capa ataca un riesgo distinto.

```
   app real (Rust + WebView2) + proveedor falso    tests/desktop/*.e2e.ts       ← el loop de verdad
   caminos aleatorios con semilla (fast-check)     tests/e2e/caminos, desktop   ← combinaciones raras
   e2e de flujos BDD + casos borde                 tests/e2e/*.e2e.ts           ← lo que pide la spec
   accesibilidad (axe, WCAG 2.1 AA) y visual       tests/e2e/a11y, visual       ← cómo se ve y se usa
   integración Rust: loop vs servidor SSE falso    src-tauri/src/agent_tests.rs ← cables internos
   integración UI: App entera en jsdom             src/App.test.tsx
   contrato IPC (JSON UI ⇄ Rust)                   lib.rs contract_tests, view.test.ts
   unitarios Rust + Vitest                         src-tauri/src/*.rs, src/**/*.test.ts(x)
```

## Comandos

| Comando | Qué corre | Ventana |
|---|---|---|
| `npm test` | tipos (app y tests) + Vitest + `cargo test` | — |
| `npm run test:coverage` | cobertura: `coverage/frontend/index.html` y `coverage/rust/html/index.html` | — |
| `npm run test:e2e` | e2e web: flujos, bordes, tema, caminos, a11y, visual | **visible** |
| `npm run build:debug` | compila `eureka.exe` (hace falta antes del siguiente) | — |
| `npm run test:e2e:desktop` | e2e sobre la **app real** con el proveedor falso | **visible** |
| `npm run test:all` | todo lo anterior | visible |
| `npm run test:e2e:ci` | los dos e2e sin ventana | — |
| `npm run test:visual:update` | regenera las capturas después de un cambio de diseño buscado | — |

Ninguna prueba llama a un modelo real. La única excepción es opcional: `tests/e2e/agentic.e2e.ts` (`agent.act`), que se saltea si no hay `OPENROUTER_API_KEY`.

## 1. Unitarios (TDD)

La regla: **la lógica de dominio no hace IO**, así se puede testear primero y rápido.

- **Rust** (`cargo test`):
  - `llm`: el `SseParser`, alimentado de 1 a 7 bytes por vez, reconstruye `¿ñ→` aunque queden partidos entre paquetes; también tool calls fragmentadas, `[DONE]`, ruido y errores.
  - `tools`: ciclos, dependencias inexistentes, un solo nodo `current`, una pregunta por turno, la respuesta como tool result.
  - `prompts`: los overrides, la protección contra path traversal y la composición por fase.
  - `session` y `settings`: ida y vuelta a disco, orden, archivos corruptos, compatibilidad con archivos viejos, keys recortadas, conservadas, quitadas o podadas, y que nunca terminen en `settings.json`.
  - `exam`: temario y pesos, reparto por peso, validación de preguntas (también "Elegí N"), corrección todo o nada, repaso (2 aciertos seguidos), reporte y verificación a ciegas, foco de simulacros dirigidos, meta y horario, hoja de repaso, y que los exámenes guardados con formatos viejos sigan cargando.
  - `cards` (SM-2 con intervalos 1, 3 y por facilidad), `study` (registro de estudio) y `runner`: este último ejecuta **de verdad** Python, Node (JS y TS) y `rustc` si están instalados (si no, se saltea): entrada, acentos, errores, bucle infinito cortado por tiempo, salida recortada, Rust que no compila, carpeta borrada al terminar, y un ejercicio que falla con el inicio y pasa con la solución.
- **Frontend** (Vitest + Testing Library):
  - Lógica pura: `transcript`, `planLayout`, `theme`, `teacherScript`, `exam` (estado, preparación, veredicto, fechas locales), `cards` (espejo de SM-2, cola del día), `pomodoro` (máquina de estados sobre timestamps), `study`, `plan` (plan con fecha y agenda), `code` (líneas de error) y `tsCheck` (revisión de tipos real de TypeScript).
  - Componentes: `QuestionCard`, `CommandMenu` (filtro, flechas, Enter, Escape, clic afuera, foco), `Sidebar` y `Settings` (modelos, keys, proveedores, prompts).

## 2. Contrato e integración

- **`contract_tests`** (`lib.rs`) toman el JSON exacto que manda la UI (`SettingsInput` con `api_key: ""`, `LearnerInput`) y verifican:
  - que se deserializa bien;
  - que una key vacía no borra la guardada;
  - que la key nunca vuelve en `SettingsView`;
  - que cada `AgentEvent` tiene la forma de la unión en `types.ts`.
- **`view.test.ts`** verifica que el proveedor falso entienda el bloque de estado del prompt y el formato de las respuestas que genera Rust. Si cambia el formato en Rust, falla.
- **`agent_tests.rs`** corre el **loop real** contra un servidor HTTP/SSE falso dentro del mismo proceso y cubre:
  - texto solo;
  - pausa en `ask_question` y la respuesta como tool result (sin `meta` en el cable);
  - el cambio de fase, que cambia el prompt **y** el modelo dentro del mismo turno;
  - el tope de 12 pasos;
  - argumentos inválidos devueltos al modelo;
  - un 401 y un error SSE a mitad del stream;
  - la falta de key antes de llamar, la cancelación y la respuesta vacía.
- **`App.test.tsx`** renderiza la app entera en jsdom contra el backend simulado: sesión hasta el plan, paleta con Ctrl+K, ruteo a Ajustes y borrado.

## 3. e2e web (backend simulado)

`vite --mode e2e` (puerto 1430) instala `mockIPC` ([`src/e2e/mockBackend.ts`](../src/e2e/mockBackend.ts)) con el **profesor guionado** compartido ([`teacherScript.ts`](../src/e2e/teacherScript.ts)). Flags en la URL: `?unconfigured`, `?fail`, `?failExtract`, `?failGradeOnce`, `?noSearch`, `?failMockOnce`, `?shortTime` (simulacro: 3 s por "minuto"), `?disputeOne` (el verificador descarta una pregunta), `?fastPomodoro` (1 minuto del pomodoro = 1 s) y `?noRust`.

| Archivo | Qué cubre |
|---|---|
| `aprender`, `sesiones`, `ajustes`, `apariencia` | los escenarios de la spec (AC-01…14) |
| `bordes` | 12 casos borde: objetivo vacío, paleta (teclado, flechas, Escape, clic afuera, sesiones), sesiones independientes, cambiar de opción, Shift+Enter, proveedores personalizados, quitar la key, prompt sin cambios, cancelar un borrado |
| `grafo`, `practica`, `visuales` | Fases 2–4 (AC-17…31) |
| `examenes` | Fase 5: guía pegada, PDF real, búsqueda web, ruta, sesiones por tema, simulacros con y sin tiempo, "Elegí 2", repaso, meta y evolución, simulacro dirigido, hoja de repaso, "¿por qué no la B?", verificación y reporte (AC-32…46) |
| `tarjetas`, `pomodoro`, `agenda` | Fase 6: mazos y estudio con SM-2, pomodoro con registro, materias, horario, agenda y plan con fecha (AC-47…52) |
| `codigo` | Fase 7: consola, errores con línea, stdin, tiempo límite, Rust que no compila, tipos de TS, intérprete faltante, explicar errores y ejercicios (AC-53…55) |
| `caminos` | caminos aleatorios (sección 5) |
| `a11y` | axe-core WCAG 2.0/2.1 A+AA en los estados de pantalla de todas las fases, en los dos temas |
| `visual` | 12 capturas de referencia en `visual.e2e.ts-snapshots/` |

## 4. e2e sobre la app real

[`e2e.desktop.config.ts`](../e2e.desktop.config.ts) maneja `eureka.exe` por **CDP**, a través de WebView2. Cada intento:

1. [`launch.ts`](../tests/desktop/launch.ts) cierra la instancia anterior.
2. Crea una carpeta de datos nueva (`LA_DATA_DIR`) y un perfil de WebView2 propio (`WEBVIEW2_USER_DATA_FOLDER`).
3. Abre la app con `--remote-debugging-port` y espera a que la página de Tauri esté cargada.

Los datos sembrados traen el perfil ya completo (`identity.onboarded`), así no aparece la bienvenida de primera vez. Conectado por CDP, WebView2 no se marca como automatizado, así que la config agrega un `initScripts` que define `navigator.webdriver`: si no, la cita del día (AC-133) tapa la pantalla.

El profesor apunta al **proveedor falso** ([`tests/fake-provider/server.ts`](../tests/fake-provider/server.ts)):

- Habla `/v1/chat/completions` con SSE como OpenRouter.
- Corta el stream cada 7 bytes, partiendo caracteres multibyte, y fragmenta las tool calls.
- Se controla desde los tests: `/__control` con los modos `fail-http`, `fail-sse`, `slow` y `runaway`; `/__requests` y `/__reset`.

Acá no hay nada simulado dentro de la app: IPC, loop, SSE, herramientas y disco corren de verdad. Los escenarios D-01…D-10 están en [`escritorio.feature`](../features/escritorio.feature). Los tests también leen lo que la app escribió en disco.

## 5. Caminos aleatorios con semilla

[`walk.ts`](../tests/e2e/walk.ts) usa fast-check para generar 18 acciones por semilla:

- responder (cualquier opción y confianza);
- escribir un mensaje libre;
- salir y reabrir la sesión;
- cambiar el tema;
- abrir y cerrar la paleta;
- ir a Ajustes y volver.

Después de **cada** acción se verifican las invariantes de [`caminos.feature`](../features/caminos.feature). Corre sobre la web simulada (5 semillas) y sobre la app real (2 semillas). Un fallo muestra la semilla y el paso. Para reproducirlo:

```bash
$env:WALK_SEEDS="404"; $env:WALK_STEPS="30"; npx e2e run tests/e2e/caminos.e2e.ts --headed
```

## 6. Lo que encontraron estas pruebas

| Bug | Lo encontró | Corrección |
|---|---|---|
| UTF-8 corrupto cuando un carácter llega partido entre dos paquetes de red | revisión + `llm` tests | `SseParser` decodifica solo líneas completas |
| Con una conversación larga, la sesión crecía más que la ventana y el composer quedaba fuera de pantalla | captura visual + invariante de los caminos | `min-height: 0` y filas `minmax(0, 1fr)` |
| El autoscroll desplazaba el shell (`overflow: hidden`) | captura visual | `scrollTo` solo sobre el transcript |
| Contraste < 4.5:1 en textos secundarios y en los colores de estado del tema claro | axe | tokens `--dim`, `--muted`, `--warn`, `--ok`, `--purple` |
| El breadcrumb decía "Sesiones" pero se anunciaba "Volver al inicio" | axe | nombre accesible "Volver a Sesiones" |
| La lista de la paleta no tenía nombre accesible | axe | patrón combobox: `aria-controls` + `aria-activedescendant` |
| Un clic dentro de la paleta le sacaba el foco al input y Escape dejaba de funcionar | `CommandMenu.test` | foco retenido + Escape a nivel ventana |

## Detalles de tester-army

- `toContainText` distingue mayúsculas y lee el resultado de `text-transform`: usar `/…/i`.
- KaTeX duplica el texto de las fórmulas: no buscar texto matemático.
- No se puede leer un `type="password"`, ni su valor ni sus atributos (`POLICY_DENIED`): verificar lo que se ve.
- `selectOption` busca por la etiqueta visible. `getByText` también encuentra el texto escrito dentro de un textarea.
- Para conectarse a Tauri por CDP hacen falta `reconnectEndpoint`, que activa el modo persistente y usa la pestaña propia de la app (una pestaña nueva no tiene el protocolo de Tauri), y esperar a que cargue `http://tauri.localhost`.

## Mutation testing (opcional, lento)

`npm run test:mutants:frontend` (Stryker) y `npm run test:mutants` (cargo-mutants). No forman parte de `npm test`: cada uno tarda alrededor de una hora. Última corrida completa (antes de las Fases 5b–7): Rust 93 % (194 detectados + 15 por tiempo de 225 viables; 16 sobrevivientes, la mayoría ya cubiertos después con tests dirigidos); frontend 40 % (los sobrevivientes son sobre todo textos y clases CSS de componentes que cubren los e2e, no los unitarios).
