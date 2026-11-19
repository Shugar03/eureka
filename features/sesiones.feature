# language: es
# Cubre: AC-08 (docs/spec.md)
# Automatización: tests/e2e/sesiones.e2e.ts

Característica: Historial de sesiones
  Como aprendiz
  Quiero volver a mis sesiones anteriores
  Para retomar donde dejé

  @AC-08
  Escenario: Una sesión aparece en el inicio con su fase y progreso
    Dado que empecé una sesión "qué es una derivada" y respondí el diagnóstico
    Cuando vuelvo al inicio
    Entonces veo la sesión "qué es una derivada" en "Sesiones"
    Y muestra la fase "Enseñar" y "0/3 pasos"

  @AC-08
  Escenario: Reabrir una sesión conserva la pregunta pendiente
    Dado que tengo una sesión con una pregunta pendiente
    Cuando vuelvo al inicio y la abro de nuevo
    Entonces veo la misma pregunta lista para responder

  @AC-08
  Escenario: Borrar una sesión pide confirmación
    Dado que tengo una sesión "tema a borrar"
    Cuando presiono "Borrar" una vez
    Entonces el botón pide confirmación y la sesión sigue en la lista
    Cuando presiono "¿Seguro? Borrar"
    Entonces la sesión desaparece de la lista

  @AC-211
  Escenario: Releer mientras el profesor escribe
    Dado que el profesor está escribiendo una respuesta
    Cuando subo para releer algo de antes
    Entonces la pantalla se queda donde la dejé y aparece «Ir al final»
    Cuando toco «Ir al final»
    Entonces vuelvo al final de la conversación

  @AC-212
  Escenario: El profesor contesta sin hacerme esperar
    Dado que el profesor usa un modelo que razona antes de contestar
    Cuando le escribo o respondo una pregunta
    Entonces la respuesta empieza a aparecer en unos segundos, sin razonamiento oculto
    Y lo que corre en segundo plano sigue razonando como antes

  @AC-213
  Escenario: Hablar más de un minuto con la voz local
    Dado que la Voz corre en esta PC
    Cuando grabo más de 60 segundos
    Entonces la grabación se corta sola en los silencios y queda escrita entera
