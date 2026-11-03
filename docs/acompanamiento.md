# Acompañamiento: diseño y límites

> Una idea para estudiantes que se abruman: un lugar donde ser escuchados y anotar cómo están.
> Esto es **acompañamiento**, no atención psicológica. Este documento fija lo que hace, lo que no, y por qué.

## Lo que es
- Una conversación de **escucha activa** (reflejar, una pregunta abierta por vez, validar, no aconsejar si no piden).
- Un **diario** local: check-ins y entradas que escribe la persona o que el modelo **propone y ella aprueba**.
- **Herramientas** chicas que no usan modelo ni red: respiración, 5-4-3-2-1, **registro de pensamientos** y **rueda de emociones**.
- **Lo que noté**: patrones de lo que la persona anotó, que ella confirma o descarta.

## Para conocerse un poco mejor (v2)
- **Registro de pensamientos** (AC-93): un ejercicio cognitivo-conductual en cinco pasos (qué pasó, qué pensé, cuánto me pegó, qué apoya y qué no encaja, otra mirada). **Lo escribe la persona**; la app solo ordena las preguntas, y el modelo nunca propone uno. Sirve para mirar un pensamiento con más aire, no para decidir quién tiene razón.
- **Rueda de emociones** (AC-94): seis familias y la palabra justa dentro de cada una. Ponerle nombre a lo que se siente ayuda por sí solo.
- **Lo que noté** (AC-95, AC-96): se calcula **en la PC** y no se envía a ningún lado.
  - Mira: semana contra semana, días y momentos del día que se destacan, emociones que acompañan los momentos bajos, lo que la persona dijo que le ayuda y el efecto de volver a mirar un pensamiento.
  - Habla solo con **al menos 8 anotaciones con ánimo** y diferencias claras (casi 1 punto contra el promedio y al menos 2 anotaciones); si faltan, dice cuántas.
  - **Describe, no explica**: nunca «porque», nunca nombres de trastornos, siempre con los números a la vista.
  - La persona responde **«Me suena»** o **«No es así»**: lo confirmado queda como lo que sabe de sí, lo descartado se esconde y puede volver.

## Lo que NO es
- No es terapia, no diagnostica, no interpreta, no medica. No se presenta como amigo ni como profesional.
- No es para emergencias. Ante señales de riesgo muestra líneas de ayuda y anima a hablar con una persona.
- No enseña: no hay planes ni fases. Si piden estudiar, les dice que lo hagan en una sesión.

## Qué sale de la PC (y qué no)
| Dato | Dónde queda |
|---|---|
| Diario, check-ins, conversación | Solo en esta PC (`companion/`), sin cifrar |
| Lo que se escribe en la charla | **Se envía al proveedor del modelo** para recibir la respuesta |
| Lo que el profesor y el extractor leen | **Nada** de lo anterior |
| Copias de seguridad | No incluyen el diario (se descarga aparte) |

La app es local; el modelo no. Por eso el aviso inicial lo dice con el nombre del proveedor. Con un modelo local (pendiente) este modo podría ser privado de punta a punta.

## Seguridad ante riesgo
1. **Detector local**, antes del modelo: si salta, responde la app (no depende de red ni de modelo).
2. **El modelo también puede alertar** con `[[RIESGO]]`; la app lo quita.
3. Con alerta: líneas de ayuda visibles hasta empezar otra charla, y el modelo recibe una nota de cuidado.
4. Sesgo a la precaución: una falsa alarma cuesta una pregunta cuidadosa («un trabajo sobre el suicidio» la dispara); no detectar cuesta mucho más. Las expresiones hechas («me quiero morir de vergüenza») se dejan pasar.
5. Las líneas de ayuda son **editables** y vienen las de Argentina. Fuentes: Centro de Asistencia al Suicida (asistenciaalsuicida.org.ar). **Hay que verificar los números y el horario antes de difundir la app**; las fuentes no coincidían en si atienden 24 h y en un 0800 adicional.

## Privacidad
- PIN con sal y hash; los comandos se rechazan bloqueado; se bloquea al salir. **No cifra los archivos.**
- Descargar todo y **Borrar todo** siempre disponibles; olvidar el PIN nunca atrapa los datos.
- Las entradas que propone el modelo: primera persona, solo lo que la persona dijo, sin datos de salud ni nombres de terceros, y nada se guarda sin su OK.

## Pendiente antes de abrirlo a otras personas
- **Revisión de una psicóloga o un psicólogo** del prompt, del detector y de los textos.
- **Probar con un modelo real** que el prompt escucha (no aconseja de más) y levanta `[[RIESGO]]`; hoy solo se probó con respuestas guionadas.
- Cifrado en reposo del diario, y modelo local para este modo.
- Menores: solo con un adulto a cargo (ver accesibilidad).
- **Opcional y con consentimiento**: que lo confirmado en «Lo que noté» llegue a la charla («me suele costar el domingo a la noche»). Implica **enviarlo al proveedor del modelo**, así que tiene que ser una decisión explícita de la persona y decirlo con claridad. Y el puente opcional al estudio («hoy estás cansado, ¿achicamos el plan?»).
- Revisar con una psicóloga o un psicólogo los umbrales y la redacción de «Lo que noté».
