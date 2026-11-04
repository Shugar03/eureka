# language: es
# Cubre: AC-01 … AC-07, AC-13 (docs/spec.md)
# Automatización: tests/e2e/aprender.e2e.ts (backend simulado, profesor guionado)

Característica: Sesión de aprendizaje Medir → Planificar → Enseñar
  Como aprendiz
  Quiero que el agente primero mida lo que sé, después arme un plan y recién ahí me enseñe
  Para aprender exactamente en el borde de lo que ya entiendo

  Antecedentes:
    Dado que hay un modelo y una API key configurados
    Y estoy en la pantalla de inicio

  @AC-01
  Escenario: Empezar una sesión con un objetivo
    Cuando escribo "qué es una derivada" como objetivo y presiono "Empezar"
    Entonces veo la sesión con la fase "Medir" activa
    Y el agente me hace una pregunta de "Diagnóstico"

  @AC-184
  Escenario: El diagnóstico es corto y se puede cortar
    Dado que tengo una pregunta de diagnóstico pendiente
    Entonces la tarjeta dice "Pregunta 1 de ~2"
    Cuando toco "Con esto alcanza, empecemos"
    Entonces el profesor deja de preguntar y pasa a armar el plan con lo que ya midió

  @AC-02
  Escenario: Una respuesta necesita texto y confianza
    Dado que tengo una pregunta de diagnóstico pendiente
    Cuando escribo una respuesta pero no elijo confianza
    Entonces el botón "Responder" está deshabilitado
    Cuando elijo confianza 4
    Entonces el botón "Responder" se habilita

  @AC-02 @AC-03
  Escenario: Responder el diagnóstico registra hallazgos
    Dado que tengo una pregunta de diagnóstico pendiente
    Cuando respondo "por cada paso a la derecha sube 2" con confianza 4 y razonamiento "lo vi en el colegio"
    Entonces veo mi respuesta con "Confianza 4/5" debajo de la pregunta
    Y el panel de diagnóstico muestra "Pendiente" como "sólido"

  @AC-04
  Escenario: Al terminar el diagnóstico aparece el plan
    Dado que respondí las preguntas de diagnóstico
    Entonces la fase "Enseñar" está activa
    Y el árbol del plan muestra "Pendiente de una recta" como "ya lo sabés"
    Y el árbol del plan muestra "La derivada" como "pendiente"

  @AC-05 @AC-06 @AC-07
  Escenario: Enseñanza completa con una reparación
    Dado que el plan está armado y estoy en la fase "Enseñar"
    Cuando respondo la predicción
    Entonces el agente explica y me hace una pregunta de "Verificación"
    Cuando elijo una opción incorrecta
    Entonces el nodo "Recta tangente como límite de secantes" pasa a "a reparar"
    Y el agente me vuelve a preguntar antes de avanzar
    Cuando respondo bien las verificaciones restantes
    Entonces todos los pasos del plan quedan "entendido"
    Y la fase "Listo" está activa con un resumen de la cadena de razonamiento

  @AC-13
  Escenario: Hacer una pregunta libre al terminar
    Dado que terminé la sesión
    Cuando escribo "¿y para qué sirve?" en el mensaje y presiono Enter
    Entonces veo mi mensaje en el chat
    Y el agente responde
