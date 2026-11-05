# Plan: memoria del estudiante estilo Engram, exportable en OKF

> Estado: **decidido** (5/11/2026), planificado después del OCR, la documentación
> y el experimento de embeddings estáticos (`docs/plan-embeddings-estaticos.md`).
> Los criterios de aceptación se numeran cuando se implemente.

## 1. Decisión

- **Por dentro, estilo Engram:** la memoria vive en SQLite (ya incluido con `rusqlite`), como un motor con reglas: temas estables, conflictos, búsqueda de texto completo y limpieza. Se copia el patrón en Rust; no se incluye el binario de Engram.
- **Por fuera, OKF:** «Lo que Eureka sabe de vos» se muestra y se exporta como páginas Markdown con metadatos y enlaces (Open Knowledge Format), compatibles con Obsidian. El formato es nuevo (v0.2), así que es salida, no la fuente de verdad.

## 2. Problemas que resuelve

| Hoy | Con el diseño nuevo |
|---|---|
| La misma idea aparece repetida en el grafo | Un tema estable por concepto: guardar de nuevo actualiza, no duplica |
| «Le cuesta» y «Ya lo domina» a la vez | Una idea nueva que contradice a otra se marca y se resuelve (gana la evidencia más reciente y verificada) |
| `memory::recall` busca por palabras exactas | Texto completo (FTS5) con raíces, más embeddings estáticos si el experimento sale bien |
| El profesor recibe recuerdos enteros | Lectura progresiva: primero vistas previas cortas, el registro entero solo si lo pide |
| No hay forma de ver ni corregir la memoria | Páginas legibles y editables, y exportación |

## 3. Modelo de datos (borrador)

- **observación**: `id`, `tema` (clave estable, p. ej. `concepto:derivada`), `tipo` (domina / le cuesta / confusión / preferencia / pendiente), `título`, `contenido`, `evidencia` (sesión, práctica o examen que lo muestra), `confianza`, `creada`, `actualizada`, `verificada` (sí cuando una práctica o examen lo confirmó), `vence` (para repasar).
- **relación**: `de`, `a`, `tipo` (reemplaza / contradice / relacionada / prerrequisito), `decidida_por` (regla o modelo), `motivo`.
- **sesión**: el resumen que ya existe (`SessionMemory`), enlazado a sus observaciones.
- **fts**: tabla FTS5 sobre título y contenido. Verificar que el SQLite incluido con `rusqlite` trae FTS5 habilitado.

## 4. Reglas

- **Guardar:** el extractor (modelo barato, como hoy) propone observaciones con su tema. Si el tema ya existe, se actualiza la observación y se agrega la evidencia.
- **Conflictos:** si una observación nueva contradice a otra del mismo tema (p. ej. «domina» contra «le cuesta»), una regla decide cuando alcanza (gana la verificada y más reciente). Solo si es ambiguo se le pregunta al modelo barato. Los tokens se gastan solo en conflictos.
- **Higiene:** una pasada diaria (ya existe la limpieza diaria, sin modelo) marca lo vencido para repasar y une duplicados evidentes.
- **El estudiante manda:** lo que el estudiante corrige a mano queda como verificado y el proceso de fondo no lo pisa.

## 5. Migración

Una sola vez, al actualizar: el registro actual (`graph/extractions.jsonl`), las memorias de sesión y el perfil del estudiante se cargan en las tablas nuevas, sin borrar los archivos viejos hasta confirmar que todo funciona. Debe ser reanudable y probado con datos reales copiados.

## 6. Requisitos para el usuario

| | Valor esperado |
|---|---|
| Disco | KB a pocos MB, incluso con cientos de sesiones |
| RAM y CPU | Mínimas: consultas SQLite de milisegundos |
| Tokens | Los de hoy (extracción en segundo plano con el modelo barato), más poco en conflictos ambiguos; la lectura progresiva debería bajar lo que entra en cada prompt |
| PC | Cualquiera |

## 7. Fases

1. Tablas, migración y lectura/escritura con temas estables (sin cambiar lo que ve el profesor).
2. Conflictos y relaciones; el profesor lee con vista previa.
3. Vista «Lo que Eureka sabe de vos» editable y exportación OKF.
4. Búsqueda con embeddings estáticos, si el experimento se aprobó.

## 8. Medición

- Ideas duplicadas y contradicciones sobre un conjunto de sesiones guionadas (antes y después).
- Tokens por pasada de memoria y por turno, con el benchmark de tokens (`token_budget`).
- Acierto del recall con preguntas sobre sesiones pasadas, incluida una paráfrasis.
