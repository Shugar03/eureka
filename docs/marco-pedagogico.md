# Marco pedagógico — Eureka

> La "constitución" pedagógica de la app: cada función, prompt y actividad nueva se diseña y se revisa contra estos principios. Solo entran prácticas con **evidencia empírica replicada**. Lo que la evidencia no respalda queda explícitamente afuera (sección 3).

Fuentes verificadas el 27/10/2026 (sección 5). Las magnitudes de efecto son orientativas: dependen del dominio, del diseño y del aprendiz.

## 1. Principios

| # | Principio | Qué dice la evidencia | Cómo se traduce en la app |
|---|---|---|---|
| P1 | **Práctica de recuperación** | Evocar de memoria fija más que releer (Roediger y Karpicke, 2006). Dunlosky et al. (2013) la califican de **alta utilidad**. | Preguntas de predicción y de verificación en cada nodo, práctica, simulacros, tarjetas. El aprendiz **produce** antes de recibir. |
| P2 | **Práctica espaciada** | Repartir el estudio rinde más que concentrarlo, y el intervalo óptimo crece con el tiempo que hay que recordar (Cepeda et al., 2006: 317 experimentos). **Alta utilidad** (Dunlosky). | SM-2 en tarjetas y en el repaso de falladas, el plan con fecha distribuido por semanas, y recuperar al principio de cada sesión lo de sesiones anteriores. |
| P3 | **Práctica intercalada** | Mezclar tipos de problema obliga a **elegir** el método, no solo a ejecutarlo (Rohrer y Taylor, 2007). **Utilidad moderada**; el efecto depende del diseño y es mayor cuando los problemas se parecen. | Práctica y simulacros mezclan ideas y dominios. Nunca bloques de "10 problemas de lo mismo". |
| P4 | **Elaboración y autoexplicación** | Preguntarse "¿por qué?" y explicarse cada paso mejora la comprensión. **Utilidad moderada** (Dunlosky, 2013). | El campo "pensando en voz alta", y verificaciones que piden **explicar por qué**, no solo dar el resultado. |
| P5 | **Aprendizaje activo y constructivo** | El aprendizaje activo supera a la clase expositiva: +0,47 DE en exámenes y menos aplazos (Freeman et al., 2014: 225 estudios). ICAP: interactivo > constructivo > activo > pasivo (Chi y Wylie, 2014). | Cada actividad busca el nivel **constructivo o interactivo**: generar, predecir, explicar, dialogar con el profesor. Leer o mirar solo, nunca como actividad principal. |
| P6 | **Guía para principiantes, retirada con la pericia** | La instrucción con poca guía rinde peor en principiantes (Kirschner, Sweller y Clark, 2006). La guía que ayuda al novato estorba al experto: efecto de **inversión de la pericia** (Kalyuga, 2007). | Si el diagnóstico da `missing`, se usa un ejemplo resuelto y pasos chicos. Si da `solid` o `partial`, se va a problemas con menos andamiaje. Las pistas son graduales (de sutil a directa). |
| P7 | **Construir sobre lo que ya sabe** | El conocimiento previo es la variable que más condiciona qué se aprende (base de Rosenshine, 2012, y de la teoría de la carga cognitiva). | Medir → planificar → enseñar; árbol de prerrequisitos; "Ya en el grafo". |
| P8 | **Dominio antes de avanzar** | Asegurar el dominio de cada paso y reparar antes de seguir es la lógica del *mastery learning* y de la tutoría. Rosenshine: tasa de éxito alta y verificación frecuente. | Un nodo no queda `understood` sin una verificación por transferencia; si falla, va a `repair`. |
| P9 | **Retroalimentación sobre la tarea y el proceso** | El feedback es de los factores más potentes, pero puede ser **positivo o negativo**: sirve el que habla de la tarea, el proceso y la autorregulación, no de la persona (Hattie y Timperley, 2007). | Las correcciones hablan del **razonamiento** y dicen dónde se desvió, sin regalar la solución. Nada de elogios vacíos ni juicios sobre la persona. |
| P10 | **Metacognición y calibración** | Juzgar bien lo que uno sabe guía qué estudiar. Los errores cometidos **con alta confianza**, corregidos, se recuerdan especialmente bien (el efecto de "hipercorrección" de la literatura de Metcalfe). | Confianza 1–5 en cada respuesta. Un error con confianza 4–5 se trata como prioridad: se nombra la idea equivocada y se contrasta. El "¿Estoy listo?" compara la nota estimada con la real. |
| P11 | **Pasos chicos y modelos** | Presentar el material nuevo en pasos chicos, con modelos y práctica guiada (Rosenshine, 2012). | Una idea por nodo; ejemplos concretos; mensajes cortos. |
| P12 | **Dificultad deseable, no frustración** | Lo que hace más lento el aprendizaje en el momento (recuperar, espaciar, intercalar) suele mejorar la retención; pero tiene que poder resolverse (Bjork). | Desafíos en el borde de lo que sabe, con pistas disponibles. Si falla dos veces, se baja un escalón (P6). |

## 2. Reglas de diseño que salen de los principios

1. **Producir antes de recibir** (P1, P5): toda explicación va precedida de una predicción o un intento.
2. **Verificar por transferencia** (P8): las preguntas de verificación no se pueden responder repitiendo la explicación.
3. **Mezclar, no bloquear** (P3): la práctica combina ideas distintas y no las nombra.
4. **Volver a lo viejo** (P2): las sesiones abren recuperando algo de antes, y lo aprendido termina en tarjetas o repaso.
5. **Errores con confianza alta = prioridad** (P10).
6. **El andamiaje se adapta al nivel** (P6): ejemplo resuelto al novato y problema abierto al que ya sabe.
7. **El feedback habla del proceso** (P9).

## 3. Lo que queda afuera

| Idea | Por qué no |
|---|---|
| **Estilos de aprendizaje** (visual, auditivo, kinestésico) | No hay evidencia adecuada para adaptar la enseñanza al "estilo" de cada persona (Pashler et al., 2008). La app **no** pregunta ni adapta por estilo. Sí usa diagramas, demos y código cuando el **contenido** los pide (por ejemplo, una estructura se entiende mejor dibujada). |
| **Releer y subrayar** como estrategia de estudio | Baja utilidad (Dunlosky, 2013). La app no propone "releé la explicación": propone recuperarla. |
| **Resumir** como estrategia principal | Baja utilidad (Dunlosky, 2013). La hoja de repaso es un apoyo para el final, no el método de estudio. |
| **Descubrimiento sin guía** para principiantes | Rinde peor (Kirschner et al., 2006). |
| **Neuromitos** ("usamos el 10% del cerebro", "hemisferio izquierdo o derecho") | Sin base. |
| **Rankings de efecto tomados al pie de la letra** (como las listas de Hattie) | Sirven de orientación, pero tienen críticas metodológicas. No se usan como criterio único. |

## 4. Auditoría de la app contra el marco

| Función | Principios que cumple | Hueco detectado | Cambio |
|---|---|---|---|
| Sesión: medir → planificar → enseñar | P1, P4, P5, P7, P8, P11 | No recupera lo de sesiones anteriores al empezar (P2). El andamiaje no se ajusta explícito al nivel (P6). No prioriza errores con confianza alta (P10). | ✅ `shared.md`, `probe.md`, `teach.md` |
| Práctica | P1, P3, P9, P12 | Pedía variar el formato, pero no **mezclar** ideas a propósito (P3). | ✅ `practice_generate.md` |
| Corrector de práctica | P9 | No pedía explícito feedback de proceso sin elogios vacíos, ni usar la confianza para calibrar (P10). | ✅ `practice_grade.md` |
| Tarjetas (SM-2) | P1, P2 | Las tarjetas eran solo de hechos sueltos; faltaban las de "por qué" (P4). | ✅ `cards_generate.md` |
| Simulacros y repaso de falladas | P1, P2, P3, P9 | — | — |
| Plan con fecha | P2 | — | — |
| Consola de código y ejercicios | P1, P5, P6, P9 | — | — |
| Hoja de repaso | (apoyo) | No es un método de estudio (sección 3). Ya se presenta como repaso final. | — |
| Confianza 1–5 | P10 | Se pide en cada respuesta, pero no se muestra la calibración (acierto contra confianza). | Pendiente: una vista "¿qué tan bien sabés lo que sabés?" |
| Fin de sesión | P2 | Lo entendido va al grafo, pero no se programa un repaso espaciado de la sesión. | Pendiente: tarjetas automáticas al terminar una sesión (en línea con la herramienta `make_cards` de [auditoria-harness.md](auditoria-harness.md)). |

## 5. Fuentes (verificadas)

- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J. y Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1), 4–58. https://doi.org/10.1177/1529100612453266 — [resumen de la APS](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html)
- Roediger, H. L. y Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*, 17(3), 249–255. [PDF](https://psychology.ecu.edu/wp-content/pv-uploads/sites/216/2019/03/Roediger-Karpicke-2006.pdf)
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T. y Rohrer, D. (2006). Distributed practice in verbal recall tasks. *Psychological Bulletin*, 132(3), 354–380. [PubMed](https://pubmed.ncbi.nlm.nih.gov/16719566/)
- Rohrer, D. y Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35(6), 481–498. [USF](https://digitalcommons.usf.edu/psy_facpub/1767/) — matiz: los efectos dependen del diseño ([Frontiers, 2019](https://www.frontiersin.org/articles/10.3389/fpsyg.2019.02296/full)).
- Freeman, S. et al. (2014). Active learning increases student performance in science, engineering, and mathematics. *PNAS*, 111(23). https://doi.org/10.1073/pnas.1319030111 — [PDF](https://www.bu.edu/eng/files/2025/01/Active-learning-increases-student-performance-in-science-engineering-and-mathematics.pdf)
- Chi, M. T. H. y Wylie, R. (2014). The ICAP framework. *Educational Psychologist*, 49(4), 219–243. [ASU ICAP](https://icap.education.asu.edu/team)
- Kirschner, P. A., Sweller, J. y Clark, R. E. (2006). Why minimal guidance during instruction does not work. *Educational Psychologist*, 41(2), 75–86. [PDF](https://www.davidlewisphd.com/courses/EDD8121/readings/2006-Kirschner_et_al.pdf)
- Kalyuga, S. (2007). Expertise reversal effect and its implications for learner-tailored instruction. *Educational Psychology Review*, 19(4), 509–539. [PDF](https://www.uky.edu/~gmswan3/EDC608/Kalyuga2007_Article_ExpertiseReversalEffectAndItsI.pdf)
- Hattie, J. y Timperley, H. (2007). The power of feedback. *Review of Educational Research*, 77(1), 81–112. [PDF](https://www.uky.edu/~gmswan3/575/Hattie_Timperly_2007.pdf)
- Rosenshine, B. (2012). Principles of instruction. *American Educator*, 36(1), 12–19. [AISNSW](https://www.aisnsw.edu.au/teachers-and-staff/teaching-and-learning/literacy-and-numeracy/foundations-of-effective-instruction/principles-of-instruction) — con críticas ([TES, 2024](https://www.tes.com/magazine/teaching-learning/general/why-rosenshines-principles-arent-all-they-seem)).
- Pashler, H., McDaniel, M., Rohrer, D. y Bjork, R. (2008). Learning styles: Concepts and evidence. *Psychological Science in the Public Interest*, 9(3), 105–119. [USF](https://digitalcommons.usf.edu/psy_facpub/1765/)

Lecturas de divulgación recomendadas: *Make It Stick* (Brown, Roediger y McDaniel, 2014) y *How Learning Works* (Ambrose et al., 2010).
