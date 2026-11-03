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
