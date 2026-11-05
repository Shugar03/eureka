# Cambios

Lo que cambia en cada versión de Eureka, de la más nueva a la más vieja. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/). Entre paréntesis, el criterio de aceptación de [docs/spec.md](docs/spec.md).

## Sin publicar

### Nuevo
- **PDFs escaneados y fotocopias se leen en tu PC** con OCR (PaddleOCR), sin red ni tokens. Hasta 10 páginas arranca solo; si son más, te dice cuánto va a tardar y pregunta. El libro aparece con las primeras páginas y se completa mientras seguís usando Eureka; las líneas dudosas quedan marcadas con «revisar» (AC-187).
- **Las fotos de texto impreso que adjuntás en el chat se leen primero en tu PC**; el modelo de visión se usa solo si el OCR no alcanza (AC-188).
- **Vista «Uso»** en Ajustes → Avanzado: cuántos tokens gastó cada sesión, fase y modelo, contados en tu PC (AC-186).

### Mejorado
- **Cada turno manda menos tokens:** el historial se recorta por bloques para aprovechar la caché del proveedor, enseñar y cerrar llevan menos herramientas, y Claude (por OpenRouter) y ChatGPT reciben pistas de caché. En una sesión típica, de ~81k a ~70k tokens; detalle en [docs/tokens.md](docs/tokens.md) (AC-186).

### Cambiado
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

[0.5.0]: https://github.com/Shugar03/eureka/releases/tag/v0.5.0
[0.4.0]: https://github.com/Shugar03/eureka/releases/tag/v0.4.0
[0.3.0]: https://github.com/Shugar03/eureka/releases/tag/v0.3.0
[0.2.1]: https://github.com/Shugar03/eureka/releases/tag/v0.2.1
[0.2.0]: https://github.com/Shugar03/eureka/releases/tag/v0.2.0
