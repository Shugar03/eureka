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
| Solo «todas débiles» o nada | 0 % / 0 % / 25 % | 67 % | 92 % | — |
| **Todas débiles, nada, o el 1.º comparte menos de la mitad de las palabras (elegido)** | **0 % / 0 % / 50 %** | **92 %** | **92 %** | **92 %** |

- **Cómo se simula el modelo:** `tests/fixtures/libro-editorial.retry.json` tiene una reformulación fija por paráfrasis y por negativa, escrita como la escribiría el profesor: sinónimos y conocimiento general («mandioca» → «yuca», «cántaro» → «tinaja vasija barro»), **nunca** los nombres inventados del libro (Quispe, Tolar-7, Condori…). El benchmark la usa solo si el primer resultado trae el aviso, y cuenta como acierto si la sección está en cualquiera de las dos búsquedas (el profesor ve las dos); el 1.º es el de la segunda.
- **Es un techo, no una medición con modelo:** las reformulaciones las escribió alguien que conoce el libro y las respuestas. Un modelo real puede reformular peor, o no hacerlo. Lo que sí está medido sin trampa es **cuándo** se pide: 6 de 12 paráfrasis y 0 de 36 preguntas que ya andaban.
- **Lo que no se arregla:** «¿Cuánto tiempo pasa la papa en el agua corriente?» comparte 4 de 6 palabras con otra sección (no dispara el aviso) y la sección correcta no aparece. Para eso hace falta buscar por significado (ver [plan-embeddings-estaticos.md](plan-embeddings-estaticos.md)).
- **Negativas:** reformuladas siguen llegando todas débiles (lo exige el benchmark).
- **Tokens:** el aviso son ~10 tokens y solo aparece cuando hace falta (0 en las búsquedas que andan). La reformulación es otra búsqueda: en el juego hard, de ~1.150 a **~1.800 tokens por pregunta** de promedio (+650, porque la mitad reformula). Las tools y los prompts no cambiaron: `token_budget` da igual.
- **Por qué no reformula el backend solo:** un diccionario de sinónimos armado a mano solo «aprendería» este libro, y expandir la búsqueda con las palabras de los primeros fragmentos (*pseudo-relevance feedback*) parte de fragmentos que justo son los equivocados. El modelo ya sabe sinónimos; pedírselo una vez cuesta una línea.

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
