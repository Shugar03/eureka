# Eureka como sistema operativo agéntico de estudio

> **Principio (AC-124):** todo lo que la persona puede hacer en una pantalla de Eureka tiene que poder
> pedirlo también por el chat, con sus palabras. Las pantallas siguen existiendo —ver, editar a mano, repasar—
> pero ninguna función es una isla: el asistente es la forma principal de usar la app.

## Cómo se expone una función al asistente

| Tipo de acción | Cómo | Ejemplo |
|---|---|---|
| **Leer** | Herramienta que se ejecuta y devuelve texto al modelo | `app_status`, `library_search`, `recall` |
| **Controlar la pantalla** (reversible, la persona lo pidió) | `ui_command`: se valida en el backend y la pantalla lo ejecuta al instante | pausar el pomodoro, cambiar el tema |
| **Crear o cambiar datos** (cuesta modelo o es difícil de deshacer) | `propose_*`: el asistente arma la propuesta, la persona la **confirma** con un botón | `propose_exam`, `propose_timetable` |
| **Sugerir** (lo propone el asistente, no lo pidió la persona) | `propose_action`: un botón que dice qué va a hacer | abrir una pantalla, empezar un pomodoro |
| **Secretos** (API keys) | **Nunca por chat**; el asistente manda a Ajustes con un botón | claves de proveedores y de búsqueda |

Reglas:
1. **Pidió = se hace; sugerí = se ofrece.** Si la persona lo pide con sus palabras, se ejecuta (`ui_command`). Si lo sugiere el asistente, va como botón.
2. **Nada irreversible ni caro sin confirmación.** Crear exámenes, importar horarios o gastar modelo pasa por una tarjeta.
3. **El asistente nunca dice que algo está hecho si no lo hizo.** Los resultados de las herramientas lo dicen y el prompt lo exige.
4. **Una función nueva no está terminada sin su puerta de entrada al asistente** (o una razón escrita acá de por qué no).
5. **El asistente ve la app:** «La app ahora» (pomodoro, tema, recordatorios, accesibilidad) viaja en cada turno, y `app_status` lee exámenes, tarjetas y estudio.

## Estado por función

✅ por chat · 🟡 solo con botón que abre la pantalla (`propose_action`) · ❌ solo pantalla (pendiente)

| Área | Función | Estado | Cómo |
|---|---|---|---|
| **Aprender** | Empezar a aprender un tema (uno o varios) | ✅ | `begin_learning` |
| | Responder una pregunta del diagnóstico escribiendo libre | ✅ | el chat siempre está disponible (AC-121) |
| | Mostrar un diagrama, una demo o código | ✅ | `show_diagram`, `show_demo`, `show_code` |
| | Buscar en la web con fuentes | ✅ | `research` |
| | Guardar lo aprendido en el grafo | ❌ | botón «Guardar lo aprendido» en la sesión |
| **Biblioteca** | Buscar y citar en los libros | ✅ | `library_search`, `library_read` |
| | Agregar o quitar un libro | 🟡 | abre la pantalla (hay que elegir un archivo) |
| **Grafo** | Ver, importar notas, olvidar una fuente | 🟡 | abre la pantalla |
| **Práctica** | Crear una práctica de ideas del grafo y corregirla | ✅ | `propose_practice` (AC-162); se corrige en la pantalla |
| **Exámenes** | Crear la preparación (nombre, fecha, horas, guía o búsqueda de la guía) y ver su ruta | ✅ | `propose_exam` (AC-120) |
| | Simulacros, hoja de repaso, repaso de falladas | 🟡 | `propose_action` `open_exam` abre la preparación por su nombre (AC-164) |
| | Ruta de programación | 🟡 | abre la pantalla |
| **Tarjetas** | Crear tarjetas de lo que se acaba de entender | ✅ | `make_cards` |
| | Crear un mazo pedido, editable antes de crearlo | ✅ | `propose_deck` (AC-161) |
| | Estudiar un mazo | ✅ | `propose_action` `open_deck` (AC-164) |
| | Importar de Anki (.apkg), compartir (.eureka) | 🟡 | abre la pantalla (los archivos los elige la persona) |
| **Mi cursada / Agenda** | Períodos, materias, horario y fechas importantes | ✅ | `propose_timetable` (AC-99…103) |
| | Mi carrera: la malla, aprobadas y promedio | 🟡 | la **conoce** (AC-157) y abre Mi cursada; cargar el plan y marcar notas, desde la pantalla |
| **Código** | Abrir un ejemplo o ejercicio en la consola | ✅ | `show_code` |
| | Ejercicios | ✅ | `propose_code` (AC-163) |
| | Ejecutar y proyectos | 🟡 | abre la pantalla |
| **Idiomas** | Listening y speaking | 🟡 | abre la pantalla |
| **Acompañamiento** | Hablar y llevar el diario | 🟡 | abre la pantalla; el modo tiene su propio asistente |
| **Pomodoro** | Empezar, pausar, retomar, saltar, reiniciar | ✅ | `ui_command` (AC-122) |
| | Cambiar las duraciones | ✅ | `ui_command` `set_pomodoro` (AC-160) |
| | Sonido y tic-tac | ✅ | `ui_command` |
| **Recordatorios** | Pararse y tomar agua | ✅ | `ui_command`, `propose_action` |
| **Aspecto** | Tema, fondo, color de acento | ✅ | `ui_command` |
| **Accesibilidad** | Tamaño de texto, espaciado, animaciones, lectura fácil, lenguaje literal, pasos cortos, dictado, voz | ✅ | `ui_command` |
| **Perfil** | Nombre, estudios, trato | ✅ | `ui_command` `set_profile` (AC-160) |
| **Estado** | «¿Cómo vengo?», «¿qué tengo hoy?» | ✅ | `app_status` + «La app ahora» (AC-123) |
| **Ajustes** | Modelos, proveedores, claves, búsqueda web | 🟡 | **solo con botón**: las claves nunca pasan por el chat |
| | Prompts, respaldo, copias | 🟡 | abre la pantalla |

## Lo que sigue (por orden de uso)

Hecho en la Ola 4 (AC-160…165): duraciones del pomodoro y perfil, mazos, práctica, ejercicios, abrir exámenes y mazos por nombre, y tarjetas de examen y horario editables.

1. **Exámenes**: que `open_exam` arranque el simulacro (hoy abre la preparación).
2. **Grafo**: «Guardar lo aprendido» desde el chat.
3. **Idiomas** y **Acompañamiento** (check-in desde el chat, con el cuidado de ese modo).

## Qué falta comprobar

Todo esto corre hoy con respuestas de guion en las pruebas. Con un modelo real hay que mirar: que elija bien entre ejecutar (`ui_command`) y ofrecer (`propose_action`), que no ofrezca botones de más, que arme bien los datos de `propose_exam` y que no cuente como hecho lo que no hizo.
