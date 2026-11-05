# Plan: memoria del estudiante estilo Engram, exportable en OKF

> Estado: **fases 1 a 3 implementadas** (AC-195..AC-200 en `docs/spec.md`, código en
> `src-tauri/src/memdb.rs`); la fase 4 (embeddings estáticos, `docs/plan-embeddings-estaticos.md`)
> sigue pendiente de su experimento.

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

### Resultados (fases 1 a 3)

Medido con los tests `memdb::tests::measure_*` (sesiones guionadas) y `token_budget`:

| | Antes | Después |
|---|---|---|
| Entradas repetidas (mismo concepto y tipo), 19 anotaciones de 5 sesiones | 6 | 1 (dos ideas con verbos distintos, «deriva»/«derivan») |
| Conceptos con «domina» y «le cuesta» a la vez | 3 | 1, esperando al modelo (verificada vieja contra nueva sin verificar) |
| Recall: sesión correcta primero, 10 preguntas con plurales y paráfrasis | 7 | 10 |
| Tokens del pase de memoria en segundo plano | 2439 | 2439 (sin llamadas nuevas) |
| Tokens por llamada del profesor (herramienta `recall` con `id`) | — | +22 |

La migración sobre una copia de datos reales (3 extracciones, 3 sesiones recordadas, el perfil) dejó 47 observaciones en 47 temas, 26 relaciones, sin duplicados ni contradicciones; la segunda corrida no agregó nada.
