# Plan: embeddings estáticos para buscar por significado

> Estado: **planificado**, después del OCR (AC-187/188) y de la documentación.
> Los criterios de aceptación se numeran cuando se implemente (el próximo libre).

## 1. Por qué

La biblioteca busca con BM25 (`src-tauri/src/library.rs`): es gratis, tarda 1–2 ms y cita la página exacta, pero solo encuentra **palabras**. En el benchmark de biblioteca (`docs/metricas-biblioteca.md`) las preguntas con palabras del libro aciertan el 100 %, y las **paráfrasis** («mandioca» por «yuca») solo el 50 % en el primer lugar y el 83 % entre los cuatro primeros. Tampoco puede encontrar un párrafo en inglés con una pregunta en español.

La memoria tiene el mismo límite: `memory::recall` busca sesiones por palabras exactas y el grafo junta ideas por texto, así que la misma idea aparece repetida («Le cuesta» y «Ya lo domina», ver `docs/tasks.md`).

Un **embedding estático** resuelve el parecido de significado sin correr una red neuronal: es una tabla con un vector por cada pedazo de palabra, calculada de antemano a partir de un modelo grande. Una frase es el promedio de los vectores de sus pedazos. No gasta tokens, no usa internet y tarda microsegundos.

No reemplaza a BM25: los dos se combinan. BM25 aporta la precisión por palabra exacta; el embedding, los sinónimos y el cruce de idiomas.

## 2. Qué se gana y qué cuesta

| | Antes (BM25) | Con BM25 + estático (meta) |
|---|---|---|
| Paráfrasis, primer lugar | 50 % | ≥ 75 % |
| Paráfrasis, top 4 | 83 % | ≥ 95 % |
| Palabras clave y preguntas del alumno | 100 % | 100 % (no puede bajar) |
| Negativas (falsos positivos) | 2 de 2 sin respuesta falsa fuerte | igual o mejor |
| Pregunta en español, texto en inglés (juego nuevo) | ~0 % | ≥ 80 % en el top 4 |
| Tiempo por consulta | 1–2 ms | ≤ 7 ms |
| Tokens del modelo | 0 al indexar | 0 al indexar |

Costos: el modelo en disco y RAM (sección 5), una segunda señal de búsqueda que hay que combinar bien, recalcular vectores de los libros ya importados, y el riesgo de «se parece en el tema pero no responde». Si el experimento (sección 7, fase 0) no mueve los números, **se descarta**.

## 3. Diseño técnico

### 3.1 Modelo

Candidatos (a elegir por benchmark, no por fama):

| Modelo | Origen | Dimensiones | Idiomas | Nota |
|---|---|---|---|---|
| `minishlab/potion-multilingual-128M` | Model2Vec, destilado de BAAI/bge-m3 | 256 | 101 | ~91 % de LaBSE en MMTEB; más flojo en búsqueda que el siguiente |
| `sentence-transformers/static-similarity-mrl-multilingual-v1` | Sentence Transformers (estático) | hasta 1024, recortable (Matryoshka) | multilingüe | pensado para similitud y búsqueda |

Verificar antes de elegir: licencia exacta de cada modelo (debe ser compatible con AGPL-3.0; Model2Vec es MIT), que el español esté en el vocabulario y el resultado en nuestros juegos de preguntas.

Achicarlo:
- **Recortar el vocabulario** a los pedazos que aparecen en español, inglés y portugués: la tabla multilingüe completa (~128 M valores, ~512 MB en f32) baja mucho porque la mayoría de filas son de otros idiomas.
- **Cuantizar a 8 bits** con una escala por fila: ×4 más chico, pérdida de calidad despreciable para coseno.
- **Recortar dimensiones** (si el modelo es Matryoshka): 256 suele alcanzar.

Objetivo de tamaño: **≤ 100 MB** en disco.

### 3.2 Cómo se calcula un vector

1. Tokenizar con el tokenizador del modelo (crate `tokenizers`; ya llega por Candle en escritorio).
2. Buscar la fila de cada pedazo en la tabla (la tabla se abre con `mmap`, no se copia entera a RAM).
3. Promediar con los pesos que trae el modelo (Model2Vec los incluye) y normalizar a largo 1.

Es puro Rust: sin ONNX Runtime ni código nativo. Opciones: el crate `model2vec-rs` o una implementación propia de ~150 líneas (tokenizar + promediar), que es fácil de verificar contra la versión de Python.

### 3.3 Índice

- Un vector por fragmento (`library::Chunk`), guardado aparte del libro en `library/<id>.vec` (binario: versión del modelo, cantidad, dimensiones, y los vectores en 8 bits con su escala).
- Búsqueda por fuerza bruta (coseno con SIMD) sobre todos los fragmentos: 50 mil fragmentos × 256 dimensiones son ~13 millones de multiplicaciones, menos de 5 ms. No hace falta un índice aproximado (ANN) hasta cerca del millón de fragmentos.
- El archivo lleva el id y hash del modelo: si cambia el modelo, los vectores se recalculan en segundo plano.

### 3.4 Combinar con BM25

- Cada consulta trae el top 50 de BM25 y el top 50 por coseno, y se combinan con **Reciprocal Rank Fusion** (RRF, k = 60): simple, sin calibrar escalas.
- Un fragmento que contiene las palabras exactas de la consulta conserva prioridad, para no perder el 100 % de las búsquedas por palabra clave.
- «Coincidencia débil» (ya existe) pasa a exigir que **las dos** señales sean bajas; así el profesor sigue recibiendo el aviso de que la biblioteca no tiene la respuesta.
- La reformulación de la consulta por el profesor (paso previo del plan) se mantiene: si con eso alcanza, este cambio puede no hacer falta.

### 3.5 Memoria del estudiante

- **Recall** de sesiones: misma búsqueda híbrida sobre las memorias de sesión, en vez de palabras exactas.
- **Ideas repetidas**: al extraer, una idea nueva con coseno ≥ umbral (calibrar, del orden de 0,85) contra una existente se trata como la misma (o como candidata a conflicto, según el diseño de memoria que se elija).

### 3.6 Distribución

- Descarga la primera vez que se necesita, con progreso y hash verificado (igual que Parakeet), para no agrandar el instalador; mientras no está, la búsqueda sigue siendo solo BM25.
- Los libros ya importados se vectorizan en segundo plano al bajar el modelo.
- Android: funciona (es Rust puro), pero se ofrece como opcional por el tamaño.

## 4. Integración en el código

| Dónde | Qué cambia |
|---|---|
| `src-tauri/src/library.rs` | `Index` suma los vectores; `search` combina BM25 y coseno; importar calcula los vectores |
| `src-tauri/src/embed.rs` (nuevo) | Cargar el modelo (mmap), tokenizar, promediar, normalizar, coseno |
| `src-tauri/src/memory.rs` | `recall` híbrido |
| `src-tauri/src/graph.rs` | Unir ideas por significado |
| Ajustes → Avanzado | Estado del modelo (descargado / descargar / borrar), como la voz local |
| `docs/metricas-biblioteca.md` | Nueva columna «híbrido» y el juego en dos idiomas |

## 5. Requisitos para el usuario

| | Valor esperado | Nota |
|---|---|---|
| Disco | ≤ 100 MB de modelo + ~260 B por fragmento | Un libro de 300 páginas son ~1.000 fragmentos: ~260 KB |
| RAM | Lo que se toque de la tabla (mmap) + los vectores | Decenas de MB en uso normal |
| CPU | Microsegundos por fragmento; un libro de 300 páginas en < 1 s | Sin GPU |
| Tokens | 0 | Todo local |
| PC mínima | Cualquiera de 4 núcleos y 8 GB de RAM | Menos exigente que la voz local (Parakeet) |

Los valores son estimaciones: se confirman en la fase 0 y en el benchmark.

## 6. Pruebas

- **Unidad:** tokenización y promedio deterministas, normalización, RRF, umbral de coincidencia débil.
- **Paridad:** vectores de 20 frases contra la implementación de Python de Model2Vec (coseno ≥ 0,999).
- **Benchmark de biblioteca:** modo híbrido sobre el libro inventado de siempre (`bench:library`), con los juegos search, question, hard y negativas, más un juego nuevo de preguntas en español sobre un texto en inglés (inventado, para que ningún modelo lo haya visto).
- **Presupuesto:** latencia por consulta e importación en el test de presupuesto, igual que `token_budget`.
- **E2E:** importar un libro y encontrar una respuesta con una paráfrasis.

## 7. Fases

0. **Experimento barato, antes de escribir Rust:** en Python (ya hay un entorno en `D:\dev-cache\ocr-venv`), correr los dos modelos sobre el benchmark de biblioteca y medir paráfrasis, palabras clave, negativas y el juego en dos idiomas. **Decisión: seguir solo si se acercan las metas de la sección 2.**
1. `embed.rs` + vectores al importar + búsqueda híbrida + benchmark.
2. Descarga del modelo, estado en Ajustes, vectorizar libros existentes.
3. Memoria: recall híbrido y unir ideas del grafo.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| No mejora lo suficiente en español | Fase 0 decide; si no, se descarta |
| Empeora las búsquedas por palabra clave | Prioridad a coincidencias exactas; el benchmark lo vigila |
| Falsos positivos por tema parecido | Coincidencia débil exige las dos señales bajas |
| Tamaño del modelo | Recorte de vocabulario y 8 bits; descarga a pedido |
| Licencia del modelo | Verificar antes de la fase 1 |
