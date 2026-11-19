# Cambios

Lo que cambia en cada versión de Eureka, de la más nueva a la más vieja. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/). Entre paréntesis, el criterio de aceptación de [docs/spec.md](docs/spec.md).

## Sin publicar

### Corregido
- **El código se lee bien en el tema oscuro:** los textos entre comillas ya no salen en un rojo oscuro casi invisible; los colores del editor siguen al tema.
- **El error del micrófono dice qué pasó:** distingue si no hay micrófono, si está ocupado o no responde o si falta el permiso, y dónde activarlo en Windows.

## [0.10.0] - 2026-11-18

### Nuevo
- **Rutas de aprendizaje:** pedile al profesor «quiero aprender Machine Learning, armame un roadmap» y te arma un curso de varias clases. Antes de proponerlo investiga cómo lo enseñan universidades y cursos conocidos, y te muestra en qué fuentes se basa. Lo editás (sacar clases, marcar lo que ya sabés, elegir el ritmo) y ves cuándo terminás. Cada clase es una sesión que sabe dónde está, empieza repasando la anterior y al terminar te lleva a la siguiente. Todo se sigue desde «Mis rutas», el inicio y Mi progreso (AC-214..AC-217).

### Corregido
- **Las novedades de cada versión se leen bien:** vienen por secciones (nuevo, mejorado, corregido) y cada cambio con su nombre arriba, en vez de un solo bloque de texto.
- Las etiquetas de las flechas en los diagramas oscuros ahora se leen bien, y con el tema «Sistema» en modo claro el diagrama ya no sale oscuro.

## [0.9.0] - 2026-11-18

### Mejorado
- **El profesor contesta mucho más rápido:** ya no se queda pensando en silencio antes de responder. La primera palabra aparece en unos 2 segundos en vez de 15 a 25, y la respuesta entera tarda menos de la mitad (AC-212).
- **Podés releer mientras escribe:** si subís en la conversación, ya no te tira para abajo con cada palabra nueva, y aparece «Ir al final» para volver de un toque (AC-211).
- **Mi progreso, renovado:** arriba un coach te dice cómo venís y qué te conviene hoy (con un botón para cada cosa); debajo, tu racha, tus temas por estado y tu semana; y cada sesión es un **camino de ideas** al estilo Duolingo, con lo que ya sabés, lo que te cuesta y el próximo paso marcado. Los textos ya no se cortan a la mitad y lo repetido no aparece dos veces (AC-210).
- **Acompañamiento tiene micrófono**, y el clip y el micrófono de todas las cajas se ven más limpios (AC-209).
- **Logo nuevo:** el elefante ahora es macizo, relleno de violeta, en el ícono de la app, el instalador y la barra lateral.

### Corregido
- **Hablar más de un minuto ya funciona:** con la voz en esta PC, una grabación larga se corta sola en los silencios y se transcribe entera, en vez de pedirte que la hagas de a partes (AC-213).
- Ya no aparece el cartel «Controles de la ventana» al pasar el mouse por la barra de arriba (AC-207).

## [0.8.0] - 2026-11-11

### Nuevo
- **Sabés al toque si acertaste:** en las preguntas de fichas, «Comprobar» corrige en el momento con una franja verde o roja (con la respuesta correcta), y el profesor llega después con el porqué. Ordenar, unir y completar se responden tocando fichas. Una idea se da por entendida recién cuando la explicás con tus palabras (AC-208).

### Mejorado
- **La barra de arriba de la ventana es parte de Eureka:** ya no está la franja gris de Windows; el costado y el fondo llegan hasta arriba y los botones de minimizar, maximizar y cerrar quedan integrados. En Windows 11 sigue apareciendo el menú para acomodar ventanas al pasar por maximizar (AC-207).

## [0.7.0] - 2026-11-06

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

[0.10.0]: https://github.com/Shugar03/eureka/releases/tag/v0.10.0
[0.9.0]: https://github.com/Shugar03/eureka/releases/tag/v0.9.0
[0.8.0]: https://github.com/Shugar03/eureka/releases/tag/v0.8.0
[0.7.0]: https://github.com/Shugar03/eureka/releases/tag/v0.7.0
[0.6.0]: https://github.com/Shugar03/eureka/releases/tag/v0.6.0
[0.5.0]: https://github.com/Shugar03/eureka/releases/tag/v0.5.0
[0.4.0]: https://github.com/Shugar03/eureka/releases/tag/v0.4.0
[0.3.0]: https://github.com/Shugar03/eureka/releases/tag/v0.3.0
[0.2.1]: https://github.com/Shugar03/eureka/releases/tag/v0.2.1
[0.2.0]: https://github.com/Shugar03/eureka/releases/tag/v0.2.0
