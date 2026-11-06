# Cambios

Lo que cambia en cada versión de Eureka, de la más nueva a la más vieja. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/). Entre paréntesis, el criterio de aceptación de [docs/spec.md](docs/spec.md).

## Sin publicar

### Nuevo
- **Preguntas en siete formatos:** además de responder con tus palabras, verdadero o falso, ordenar, unir con flechas, completar huecos y opción múltiple de una o varias. Nunca dos seguidas del mismo tipo, la confianza se pide solo cuando importa y «pensando en voz alta» queda plegado (AC-204).
- **La investigación consigue la bibliografía:** busca de a un autor o tema, descarta perfiles y fichas de empresas, lee más texto de las mejores fuentes y, si encuentra PDFs abiertos, los podés **sumar a tu biblioteca** con un botón (con OCR si son escaneados). Si le pasás un programa, investiga lo que falta sin que se lo pidas (AC-206).

### Mejorado
- **Actualizar ya no muestra un instalador:** la descarga se ve en una barra dentro de Eureka, se reinstala sola en segundos y al abrirse te cuenta las novedades de la versión nueva, una vez. La primera instalación tiene un instalador con la cara de Eureka, en español (AC-202).

### Corregido
- **El profesor lee la página que cita:** en un PDF escaneado sin títulos, leer un fragmento de la página 16 devolvía la página 1 (AC-205).
- **Una sesión ya no queda trabada con «429 overloaded»:** cuando el proveedor dice que está saturado, Eureka reintenta sola por otro camino (OpenCode Go ataba la conversación a un servidor lleno). Si sigue saturado, el error lo explica en castellano (AC-203).

## [0.6.0] - 2026-11-05

### Nuevo
- **Word, PowerPoint, EPUB y OpenDocument a la biblioteca** (y al «+» del chat): se convierten en tu PC, con los títulos como secciones, y el profesor los busca y los cita como a un PDF (AC-191).
- **PDFs escaneados y fotocopias se leen en tu PC** con OCR (PaddleOCR), sin red ni tokens. Hasta 10 páginas arranca solo; si son más, te dice cuánto va a tardar y pregunta. El libro aparece con las primeras páginas y se completa mientras seguís usando Eureka; las líneas dudosas quedan marcadas con «revisar» (AC-187).
- **Las fotos de texto impreso que adjuntás en el chat se leen primero en tu PC**; el modelo de visión se usa solo si el OCR no alcanza (AC-188).
- **«Lo que Eureka sabe de vos»** en Mi progreso: lo que Eureka anotó de vos por tipo (lo que te cuesta, lo que dominás, confusiones, pendientes, cómo aprendés, ideas), con su evidencia. Lo podés corregir —queda así y no se pisa— o borrar, y exportar como páginas enlazadas para abrir en Obsidian (AC-199, AC-200).
- **Vista «Uso»** en Ajustes → Avanzado: cuántos tokens gastó cada sesión, fase y modelo, contados en tu PC (AC-186).

### Mejorado
- **Cambiar de fase ya no tira la caché del proveedor:** diagnóstico, plan, enseñar y cierre comparten herramientas y prompt de sistema. Con OpenCode Go, la entrada de diagnóstico a cierre cuesta ~77 % menos; con un proveedor sin caché se mandan más tokens (AC-201).
- **Agregar un documento a una biblioteca grande es instantáneo:** el índice de búsqueda se actualiza solo para ese libro, también mientras el OCR le suma páginas (AC-190).
- **El profesor busca mejor en tu biblioteca:** si lo que encontró coincide poco con lo que buscaba, prueba una vez más con otras palabras antes de decirte que no está (AC-189).
- **Cada turno manda menos tokens:** el historial se recorta por bloques para aprovechar la caché del proveedor, enseñar y cerrar llevan menos herramientas, y Claude (por OpenRouter) y ChatGPT reciben pistas de caché. En una sesión típica, de ~81k a ~70k tokens; detalle en [docs/tokens.md](docs/tokens.md) (AC-186).
- **La memoria no se repite ni se contradice:** cada tema queda una sola vez aunque aparezca en varias sesiones, y si algo nuevo contradice a algo viejo gana lo verificado y más reciente (AC-196, AC-197).
- **El profesor encuentra mejor lo que viste antes:** busca por raíces de las palabras (plurales, palabras de la misma familia) y lee primero un resumen corto de cada recuerdo (AC-198).

### Cambiado
- La memoria de Eureka pasa a una base SQLite en tu PC; la primera vez que abrís esta versión se copia sola lo que ya sabía de vos, sin borrar los archivos de antes. El respaldo la incluye, y al restaurar se usa la del respaldo (AC-195).
- El instalador pasa de ~15 MB a ~30 MB porque trae los modelos de OCR.

## [0.5.0] - 2026-11-04

### Nuevo
- **Voz local con Parakeet v3** (NVIDIA): mucho mejor en español y más rápida que Whisper. Se baja una vez (~670 MB); Whisper queda como opción liviana en Ajustes → Avanzado → Voz → En esta PC (AC-185).

### Arreglado
- El instalador trae el runtime de Visual C++ que necesita la voz local, para las PCs que no lo tienen.

## [0.4.0] - 2026-11-04

### Nuevo
- **Las demos interactivas se abren en un panel a la derecha**, en el lugar del plan, con ajuste a la ventana para verse enteras, invertir colores y maximizar (AC-183).
- **Respondé las preguntas con la voz**, también el «cómo lo pensaste».

### Mejorado
- **Diagnóstico más corto:** 2 o 3 preguntas, con tope de 4, contador «Pregunta n de ~m» y el botón «Con esto alcanza, empecemos» (AC-184).
- El card del grafo se lee mejor y el menú lateral ya no se comprime en pantallas bajas.

## [0.3.0] - 2026-11-04

### Nuevo
- **Iniciá sesión con tu cuenta ChatGPT Plus o Pro**; los tokens quedan en el almacén de claves del sistema.
- Grafo de neuronas y la lista completa de modelos de cada proveedor.
- Aviso debajo del chat: Eureka puede cometer errores.
- Base para Android: botón atrás, abrir mazos desde otras apps, consola SQL y recordatorios programados.

### Cambiado
- **Menú lateral más limpio:** la navegación se agrupa en Estudiar, Mi material y Más; el buscador pasa a un ícono y el tema, a Ajustes → Mi espacio.

## [0.2.1] - 2026-11-03

### Arreglado
- Versión de mantenimiento para confirmar que las actualizaciones automáticas llegan solas.

## [0.2.0] - 2026-11-03

Primera versión pública.

### Nuevo
- Sesiones que miden lo que sabés, arman un plan y te enseñan paso a paso, con confianza y razonamiento en cada respuesta.
- Grafo de conocimiento, perfil del aprendiz y memoria entre sesiones.
- Biblioteca local con búsqueda BM25 y citas a libro y página.
- Práctica que se adapta, exámenes y certificaciones con simulacros, tarjetas con repetición espaciada e intercambio con Anki.
- Mi cursada: materias, horarios, agenda y recordatorios.
- Consola de código en diez lenguajes.
- Actualizaciones automáticas firmadas.

[0.6.0]: https://github.com/Shugar03/eureka/releases/tag/v0.6.0
[0.5.0]: https://github.com/Shugar03/eureka/releases/tag/v0.5.0
[0.4.0]: https://github.com/Shugar03/eureka/releases/tag/v0.4.0
[0.3.0]: https://github.com/Shugar03/eureka/releases/tag/v0.3.0
[0.2.1]: https://github.com/Shugar03/eureka/releases/tag/v0.2.1
[0.2.0]: https://github.com/Shugar03/eureka/releases/tag/v0.2.0
