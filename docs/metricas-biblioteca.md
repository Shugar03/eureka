# Métricas de la biblioteca (NF-22)

> Lo que no se mide no se mejora. Este documento registra cómo se midió la
> biblioteca y qué dio. Se regenera con `npm run bench:library`.

## Qué se mide

El benchmark usa un libro **inventado**, *Fermentación en la cocina andina* (Editorial Marea). Así sus datos (el «índice de Quispe», la «levadura Tolar-7», la «regla 4-2-1») no existen en ningún otro lado, y una respuesta correcta solo puede salir del libro.

- 28 páginas, 2 capítulos y 10 secciones, con encabezado repetido y números de página. **Sin marcadores**, así los títulos se detectan por tamaño de letra, que es el camino difícil.
- Lo genera `tests/fixtures/make-editorial-pdf.py`, que también escribe `libro-editorial.questions.json` con la sección y la página donde está impresa cada respuesta.
- Tres juegos de preguntas:
  - **search** (18): cómo buscaría el profesor, con palabras clave.
  - **question** (18): cómo pregunta el alumno.
  - **hard** (12): paráfrasis que **evitan las palabras del libro**, como «mandioca» por «yuca», «cántaro» por «tinaja» o «se echó a perder» por «contaminación».
- 2 preguntas **negativas** que el libro no responde.

El benchmark tiene dos mitades:

1. **Conversión** (`src/lib/bookText.bench.test.ts`): el PDF pasa por el pdf.js real y se verifica la estructura. Escribe `libro-editorial.md` y `libro-editorial.convert.json`.
2. **Recuperación** (`agent::tests::editorial_benchmark`): indexa ese Markdown con el BM25 real y hace cada pregunta. Mide si vuelve la sección correcta y si **el texto de la respuesta está en lo que recibe el profesor**, con su página. Mide también cuántos tokens agrega cada consulta. Escribe `libro-editorial.retrieval.json`.

## Resultados (27/10/2026, PC del desarrollo, build debug)

### Indexar

| Métrica | Valor |
|---|---|
| Conversión PDF → Markdown (pdf.js en Node) | **0,56 s** para 28 páginas |
| Conversión en la app, primera vez (incluye cargar pdf.js) | 4,7 s |
| Conversión en la app, desde el segundo documento | **0,4 s** |
| Guardar + indexar (Rust) | 7 ms + 35 ms |
| Libro de 500 páginas sintético (importar + indexar + buscar) | 0,19 s |
| 50 libros de 40 páginas: índice entero (primera búsqueda) | 0,54 s |
| Agregar un libro más (guardar + indexar solo ese, AC-190) | **13 ms** (antes: guardar + rearmar los 51, ~0,55 s) |
| Quitar un libro | 1 ms |
| **Tokens del modelo gastados al indexar** | **0** |
| Tamaño del libro en tokens (si se mandara entero) | ~13.979 |
| Títulos detectados | 12/12 (2 capítulos + 10 secciones) |

### Preguntar

| Juego | Sección correcta 1.º | Sección en el top 4 | MRR | Respuesta dentro de lo enviado | Página correcta | Tokens por consulta | Tiempo |
|---|---|---|---|---|---|---|---|
| search (palabras clave) | 100 % | 100 % | 1,00 | 100 % | 100 % | ~1.150 | 2 ms |
| question (como pregunta el alumno) | 100 % | 100 % | 1,00 | 100 % | 100 % | ~950 | 1 ms |
| **hard (paráfrasis)** | **50 %** | **83 %** | **0,64** | **75 %** | **75 %** | ~1.150 | 2 ms |
| **hard + 1 reformulación (AC-189, simulada)** | **92 %** | **92 %** | — | **92 %** | — | ~1.800 | 2 ms × 1,5 |

**Ahorro:** cada consulta manda ~1.000 tokens en vez de ~14.000 (el libro entero), unas **13 veces menos**. Con un libro de 300 páginas la diferencia pasa de 100 veces.

**Negativas:**
- «mundial fútbol 1986» no devuelve nada.
- «derivada polinomio regla potencia» devuelve 4 fragmentos que solo comparten la palabra «regla». Los 4 llegan marcados como **coincidencia débil**, y el profesor recibe el aviso de que la biblioteca probablemente no trata el tema.

## Reformular una vez (AC-189, 5/11/2026)

Cuando el resultado es débil, `library_search` le pide al profesor **una** búsqueda más con otras palabras. Se probaron dos disparadores, los dos con lo que el profesor ve (nunca con la respuesta):

| Disparador | Pide reformular: search / question / hard | hard: sección 1.º | hard: top 4 | Respuesta dentro de lo enviado |
|---|---|---|---|---|
| Sin reformular (antes) | — | 50 % | 83 % | 75 % |
| Solo «todas débiles» o nada (de una corrida de diagnóstico; `bench:library` no lo regenera) | 0 % / 0 % / 25 % | 67 % | 92 % | — |
| **Todas débiles, nada, o el 1.º comparte menos de la mitad de las palabras (elegido)** | **0 % / 0 % / 50 %** | **92 %** | **92 %** | **92 %** |

- **Cómo se simula el modelo:** `tests/fixtures/libro-editorial.retry.json` tiene una reformulación fija por paráfrasis y por negativa, escrita como la escribiría el profesor: sinónimos y conocimiento general («mandioca» → «yuca», «cántaro» → «tinaja vasija barro»), **nunca** los nombres inventados del libro (Quispe, Tolar-7, Condori…). El benchmark la usa solo si el primer resultado trae el aviso, y cuenta como acierto si la sección está en cualquiera de las dos búsquedas (el profesor ve las dos); el 1.º es el de la segunda.
- **Es un techo, no una medición con modelo:** las reformulaciones las escribió alguien que conoce el libro y las respuestas. Un modelo real puede reformular peor, o no hacerlo. Lo que sí está medido sin trampa es **cuándo** se pide: 6 de 12 paráfrasis y 0 de 36 preguntas que ya andaban.
- **Lo que no se arregla:** «¿Cuánto tiempo pasa la papa en el agua corriente?» comparte 4 de 6 palabras con otra sección (no dispara el aviso) y la sección correcta no aparece. Se pensó que para eso hacía falta buscar por significado (ver [plan-embeddings-estaticos.md](plan-embeddings-estaticos.md)), pero en la fase 0 tampoco la encontró ningún embedding estático (sección «Embeddings estáticos, fase 0»).
- **El 0 de 36 es optimista:** esas búsquedas usan el vocabulario del libro. Las 12 reformulaciones, que son listas de sinónimos, piden reformular **2 de 12 (17 %)** si se las hace solas: coinciden en menos de la mitad de sus palabras aunque traigan la sección. Por eso la segunda búsqueda del turno solo dice «no trata esto» si no encontró nada o todo es débil; el benchmark exige que nunca lo diga cuando la sección está entre lo enviado (0 de 12).
- **Negativas:** reformuladas siguen llegando todas débiles (lo exige el benchmark).
- **Tokens:** el aviso son ~10 tokens y solo aparece cuando hace falta (0 en las búsquedas que andan). La reformulación es otra búsqueda: en el juego hard, de ~1.150 a **~1.800 tokens por pregunta** de promedio (+650, porque la mitad reformula). Las tools y los prompts no cambiaron: `token_budget` da igual.
- **Por qué no reformula el backend solo:** un diccionario de sinónimos armado a mano solo «aprendería» este libro, y expandir la búsqueda con las palabras de los primeros fragmentos (*pseudo-relevance feedback*) parte de fragmentos que justo son los equivocados. El modelo ya sabe sinónimos; pedírselo una vez cuesta una línea.

## pdf.js contra pdf-inspector (5/11/2026, solo comparación)

[pdf-inspector](https://github.com/firecrawl/pdf-inspector) (Firecrawl, MIT) llega con anydoc (AC-191), compilado sin PDFium ni OCR. Se pasaron por él los mismos PDFs (`office::tests::pdf_inspector_on_the_benchmark_pdfs`, `#[ignore]`) y su Markdown por la mitad de recuperación (`EUREKA_BENCH_MD=… cargo test editorial_benchmark`).

| | pdf.js (lo que usa Eureka) | pdf-inspector |
|---|---|---|
| Títulos de `libro-editorial.pdf` | 12/12 | 12/12 |
| Encabezado repetido «… — Editorial Marea» | se quita | queda 1 vez, como primer párrafo |
| Números de página sueltos | se quitan | se quitan |
| Marcas de página `<!-- p:N -->` | 28 | **0** |
| `apuntes-fisica.pdf` (títulos, guiones) | 3 títulos, guiones unidos | 3 títulos, guiones unidos |
| `guia-examen.pdf` (viñetas) | (fuera del benchmark de pdf.js) | junta los «Dominio N» con la viñeta anterior, sin títulos |
| Tiempo, libro de 28 páginas | 0,6–1,3 s (Node, con pdf.js cargado) | 0,24 s (Rust, build debug) |
| search / question: sección en el top 4 | 100 % / 100 % | 100 % / 100 % |
| hard: sección 1.º / top 4 | 50 % / 83 % | 67 % / 83 % |
| **Página correcta** | **100 %** | **0 %** |

**Veredicto: no se adopta.** Detecta la misma estructura y es más rápido, pero no marca dónde empieza cada página, así que el profesor perdería la página en cada cita (AC-72), y además habría que mudar la conversión de PDFs al backend, lejos de donde se detectan las páginas escaneadas y corre el OCR (AC-187). La diferencia en hard (8 contra 6 de 12 primeros) viene de que, sin marcas, los párrafos se agrupan distinto en fragmentos; con 12 preguntas no alcanza para decir que recupera mejor. Los PDFs del benchmark no tienen tablas ni dos columnas, así que eso queda sin medir.

## Embeddings estáticos, fase 0 (5/11/2026, solo medición)

La fase 0 de [plan-embeddings-estaticos.md](plan-embeddings-estaticos.md): ¿buscar también por significado mejora lo que ya da BM25 con una reformulación? Se midió en Python, sin tocar la app, con [`bench/embeddings-fase0/embeddings_fase0.py`](../bench/embeddings-fase0/embeddings_fase0.py).

**Cómo se midió**

- **El mismo BM25:** el script reimplementa el de `library.rs` (secciones, fragmentos de 1000 bytes, palabra + raíz de 4 letras, títulos ×2, coincidencia débil) y la cuenta de `editorial_benchmark`, con la reformulación simulada de `libro-editorial.retry.json`. Antes de comparar exige que salgan los mismos números que `libro-editorial.retrieval.json`. Salen todos: search, question, hard, hard + reformulación y negativas.
- **Modelos:** `minishlab/potion-multilingual-128M` (256 dimensiones) y `sentence-transformers/static-similarity-mrl-multilingual-v1`, entero (1024) y recortado a 256. Cada vector es el promedio de las filas de sus tokens, sin tokens especiales, normalizado. Así funcionan model2vec y `StaticEmbedding`. Contra `model2vec.encode` da un coseno mínimo de 0,99999994 en 20 frases, así que la prueba de paridad de la fase 1 ya tiene referencia. Cada fragmento se vectoriza con su ruta de sección delante, que es lo mismo que ve BM25.
- **Híbrido:** el top 50 de BM25 (puntaje > 0) más el top 50 por coseno, combinados con RRF (k = 60). El libro tiene **36 fragmentos**, así que el top 50 es el libro entero. Se probaron tres formas de dar prioridad a la coincidencia exacta:
  - **sin prioridad;**
  - **todas las palabras:** primero los fragmentos que tienen todas las palabras de la consulta;
  - **fuerte:** primero los que BM25 no marca débiles y comparten al menos la mitad de las palabras. Es la que se usa abajo salvo que se diga otra cosa.
- **Débil:** BM25 la marca débil (o no comparte ninguna palabra) **y** el coseno queda bajo el umbral. El umbral es el coseno de la negativa original más alta + 0,01: 0,258 para potion, 0,184 para mrl-1024 y 0,18 para mrl-256. **Se ajustó con estos mismos datos.**
- **Reformulación en el híbrido:** el aviso de AC-189, salvo que un 1.º parecido en significado (coseno ≥ umbral) no cuenta como «comparte pocas palabras». Como eso hace que se pida reformular menos veces, también se midió con el aviso exacto de hoy, calculado sobre el resultado de BM25 («aviso de BM25»).
- **Juegos nuevos** (en `bench/embeddings-fase0/cross-language.json`, escritos antes de medir):
  - **en dos idiomas:** 12 preguntas en español sobre un texto en inglés inventado, *Field Notes on Kelp Curing in the Orrin Isles* (6 secciones, 6 fragmentos). Ese texto se indexa junto con el libro, así que compite con él. Cada pregunta trae una reformulación en inglés con palabras generales, que simula al profesor buscando en el idioma del libro. Igual que `retry.json`, es un techo;
  - **5 negativas cercanas:** kimchi, masa madre, kombucha, yogur y vino. Son del mismo tema, pero el libro no las responde.

**Resultados** (sección correcta en el 1.º / en el top 4)

| Modo | search | question | hard | hard + 1 reformulación | inglés | inglés + reformulación en inglés |
|---|---|---|---|---|---|---|
| **BM25 (hoy)** | 100 / 100 | 100 / 100 | 50 / 83 | **92 / 92** | **0 / 0** | 50 / 58 |
| potion, solo coseno | 89 / 100 | 89 / 100 | 33 / 42 | 50 / 50 | 33 / 58 | 50 / 75 |
| potion, híbrido sin prioridad | 94 / 100 | 89 / 100 | 17 / 75 | 50 / 83 | 0 / 17 | 58 / 67 |
| potion, híbrido fuerte | 94 / 100 | 89 / 100 | 50 / 83 | 58 / 83 (aviso de BM25: 83 / 92) | 0 / 17 | 50 / 58 |
| mrl-1024, solo coseno | 94 / 100 | 78 / 89 | 17 / 50 | 50 / 67 | 17 / 42 | 50 / 67 |
| mrl-1024, híbrido sin prioridad | 100 / 100 | 83 / 94 | 50 / 83 | 67 / 92 | 0 / 17 | 58 / 67 |
| mrl-1024, híbrido fuerte | 100 / 100 | 89 / 94 | 67 / 83 | 75 / 92 (aviso de BM25: 83 / 92) | 0 / 17 | 50 / 58 |
| mrl-256, solo coseno | 100 / 100 | 72 / 89 | 17 / 42 | 42 / 58 | 33 / 50 | 50 / 67 |
| mrl-256, híbrido sin prioridad | 100 / 100 | 89 / 100 | 42 / 83 | 50 / 83 | 0 / 17 | 50 / 50 |
| mrl-256, híbrido fuerte | 100 / 100 | 89 / 100 | 67 / 83 | 75 / 83 (aviso de BM25: 83 / 92) | 0 / 17 | 42 / 42 (aviso de BM25: 50 / 58) |

Todos los valores son porcentajes. La prioridad «todas las palabras» da lo mismo que «sin prioridad», salvo question, que sube a 94 / 100 con potion y mrl-256, y a 89 / 100 con mrl-1024. Con la tabla cuantizada a 8 bits (escala por fila) los números son los mismos, salvo una pregunta en una celda de mrl-1024 solo coseno y una positiva más marcada débil en mrl-1024 híbrido.

**Lo que se ve:**

- **No le gana a la reformulación.**
  - El mejor híbrido sin reformular, mrl fuerte, llega a 67 / 83. Gana 2 preguntas en el 1.º («montaña» y «papa deshidratada»), pero no pasa del 83 % en el top 4.
  - Con la misma reformulación y el mismo aviso, el híbrido da 83 / 92, por debajo de BM25 + reformulación (92 / 92).
  - «¿Cuánto tiempo pasa la papa en el agua corriente?», la que la reformulación no arregla, tampoco la encuentra ningún modelo: queda fuera del top 4 en todas las variantes.
- **En dos idiomas no llega.**
  - La meta era ≥ 80 % en el top 4; el híbrido da 17 % y el coseno solo, 42–58 %.
  - Sobre el texto en inglés solo, el coseno acierta la sección en el 1.º el 75–92 % de las veces (con 6 fragmentos el top 4 no dice mucho), así que la alineación entre idiomas existe.
  - Con el libro en español al lado, ganan los párrafos en español de un tema parecido (secar, salar, guardar): con estos vectores, el mismo idioma pesa más que el significado.
  - Reformular en inglés lleva a BM25 solo a 50 / 58. El híbrido suma a lo sumo una pregunta (58 / 67), y solo sin prioridad, que es la variante que baja hard al 17 % (potion) o al 50 % (mrl-1024) en el 1.º. Además, la idea de que «la reformulación no ayuda entre idiomas» es falsa en parte.
- **Empeora lo que andaba.**
  - question baja del 100 % al 89 % en el 1.º en todas las variantes con prioridad fuerte. Son dos preguntas. «¿Por qué las levaduras de altura aguantan las heladas?» pasa al 2.º puesto. «¿Cómo se fermenta la tunta?» pasa al 4.º con potion y mrl-256, y con mrl-1024 sale del top 4.
  - Con potion, search también baja, al 94 %.
- **Las negativas no mejoran.**
  - El coseno no separa lo que está de lo que no: la negativa cercana más alta («masa madre», 0,42–0,47) supera la mediana de las positivas (0,20–0,30).
  - Con el umbral elegido, las 2 negativas originales siguen llegando débiles.
  - De las 5 cercanas, quedan débiles 1 (potion) o 3 (mrl), contra 4 con BM25 solo.
  - Subir el umbral hasta recuperar 4 de 5 (≥ 0,45–0,55) marca como débiles las mismas 8 positivas (de 60) que ya marca BM25. Ningún umbral queda mejor que BM25 en las dos cosas a la vez.

| Negativas y umbral | BM25 | potion (0,258) | mrl-1024 (0,184) | mrl-256 (0,18) |
|---|---|---|---|---|
| 2 negativas originales: todas débiles | 2 | 2 | 2 | 2 |
| … reformuladas: todas débiles | 2 | 1 | 2 | 2 |
| 5 negativas cercanas: todas débiles | 4 | 1 | 3 | 3 |
| Positivas (60) que llegan todas débiles | 8 (3 hard, 5 inglés) | 4 (0, 4) | 7 (3, 4) | 6 (2, 4) |

**Costo** (Ryzen 5 4500, Python 3.14 con numpy; Rust debería ser igual o más rápido)

| | potion-multilingual-128M | mrl-1024 | mrl-256 |
|---|---|---|---|
| Tabla | 500.353 × 256 | 105.879 × 1024 | 105.879 × 256 |
| Disco, f32 | 512 MB | 434 MB | 108 MB |
| Disco, 8 bits con escala por fila | 130 MB | 109 MB | 27,5 MB |
| Solo tokens de escritura latina (cota superior de es/en/pt) | 276.320 filas: 72 MB en 8 bits | 58.816 filas: 60 MB | 58.816 filas: 15 MB |
| `tokenizer.json` | 18,6 MB | 2,6 MB | 2,6 MB |
| RAM en Python (tabla entera en memoria; en Rust iría con mmap) | +976 MB | +427 MB | +115 MB |
| Vectorizar el libro (36 fragmentos) | 15–18 ms (134 ms en frío) | 30–35 ms | 13–18 ms |
| Vector de una consulta | 0,08 ms | 0,08 ms | 0,07 ms |
| Consulta híbrida completa, 36 fragmentos (BM25 solo: 0,12–0,18 ms) | 0,33–0,43 ms | 0,32–0,41 ms | 0,31–0,49 ms |
| Coseno contra 50.000 fragmentos | 2,4–6,5 ms | 7,1–7,8 ms | 2,2–2,7 ms |

Las cuentas se hacen en Python sobre la versión con todas las filas, salvo la de 8 bits. Las filas de escritura latina incluyen también francés, alemán y otros idiomas, así que recortar a es/en/pt dejaría menos. El costo entra en la meta (≤ 100 MB, ≤ 7 ms) con mrl-256 sin recortar y con potion recortado.

**Licencias:**

- `potion-multilingual-128M`: MIT. Es un destilado de `BAAI/bge-m3`, que también es MIT.
- `static-similarity-mrl-multilingual-v1`: Apache-2.0. No tiene modelo base: se entrenó de cero con conjuntos públicos, como OpenSubtitles, Europarl o Tatoeba.

Las dos licencias son compatibles con AGPL-3.0.

**Cuánto depende de pocas preguntas:** en hard, una pregunta son 8 puntos. La ventaja del híbrido sin reformular son 2 preguntas, y la diferencia con BM25 + reformulación es 1, para el otro lado. El veredicto no cuelga de eso:

- en dos idiomas faltan 7 u 8 preguntas de 12 para la meta;
- la caída de question son 2 preguntas en un juego donde la meta es no perder ninguna.

**Veredicto: no se adopta (NO-GO).** Los estáticos no mejoran lo que ya da una reformulación, no resuelven el cruce de idiomas con una biblioteca mezclada y bajan el 1.º en las preguntas del alumno. El costo no es el problema. Detalle por pregunta: lo imprime el script.

## Qué se cambió por estas mediciones

| Cambio | Juego hard: top 4 | MRR | Negativas |
|---|---|---|---|
| Plural y -mente (inicial) | 50 % | 0,34 | 4 falsos |
| + género (-a/-o) | 58 % | 0,38 | 4 falsos |
| Recortar palabras a 5 letras | 67 % | 0,51 | 4 falsos |
| Recortar a 4 letras | 83 % | 0,64 | 4 falsos |
| **Palabra + raíz de 4 letras (elegido)** | **83 %** | **0,64** | 4 falsos |
| + exigir 2 palabras en común | 67 % | 0,51 | 0 falsos |
| **+ marcar coincidencias débiles (elegido)** | **83 %** | **0,64** | 4, marcados como débiles |

Se eligió indexar **la palabra y su raíz**: una coincidencia exacta suma dos veces y una de la misma familia, una. En este libro rinde igual que recortar, y en una biblioteca grande debería confundir menos palabras parecidas.

Filtrar los fragmentos débiles evitaba los falsos positivos, pero perdía 2 de cada 12 paráfrasis. Por eso se los **etiqueta** en vez de esconderlos: el profesor ve «coincide: …» o «coincidencia débil (solo: regla)» y decide.

## Límites conocidos

- **La paráfrasis sin palabras en común sigue siendo el punto débil**: sin reformular, 1 de cada 4 respuestas no llega. Con una reformulación (AC-189) llegan 11 de 12 en la simulación, pero eso **es un techo**: el efecto con un modelo real no está medido.
- El juego hard tiene 12 preguntas: sirve para comparar variantes, no para afirmar un porcentaje general.
- La búsqueda dentro de la app en los e2e usa el backend simulado, no el BM25. La calidad real la mide la mitad Rust.
- Falta medir los tokens **reales** que reporta el proveedor en cada turno (`usage`). Hoy se estima con 3,5 caracteres por token.

## Próximas mediciones

1. Un turno real del profesor con un modelo, que registre `usage` (tokens de entrada y de salida) y si cita bien.
2. Libros reales de distintos formatos: escaneados, a dos columnas, con fórmulas.
3. Varias obras a la vez, para ver cómo baja la precisión cuando la biblioteca crece.
