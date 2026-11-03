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

**Ahorro:** cada consulta manda ~1.000 tokens en vez de ~14.000 (el libro entero), unas **13 veces menos**. Con un libro de 300 páginas la diferencia pasa de 100 veces.

**Negativas:**
- «mundial fútbol 1986» no devuelve nada.
- «derivada polinomio regla potencia» devuelve 4 fragmentos que solo comparten la palabra «regla». Los 4 llegan marcados como **coincidencia débil**, y el profesor recibe el aviso de que la biblioteca probablemente no trata el tema.

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

- **La paráfrasis sin palabras en común sigue siendo el punto débil**: 1 de cada 4 respuestas no llega. Lo mitiga que el profesor escriba la búsqueda con sinónimos, como le pide el prompt. Ese efecto **no está medido**, porque requiere un modelo real.
- El juego hard tiene 12 preguntas: sirve para comparar variantes, no para afirmar un porcentaje general.
- La búsqueda dentro de la app en los e2e usa el backend simulado, no el BM25. La calidad real la mide la mitad Rust.
- Falta medir los tokens **reales** que reporta el proveedor en cada turno (`usage`). Hoy se estima con 3,5 caracteres por token.

## Próximas mediciones

1. Un turno real del profesor con un modelo, que registre `usage` (tokens de entrada y de salida) y si cita bien.
2. Libros reales de distintos formatos: escaneados, a dos columnas, con fórmulas.
3. Varias obras a la vez, para ver cómo baja la precisión cuando la biblioteca crece.
