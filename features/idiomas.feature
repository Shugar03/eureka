# language: es
# Cubre: AC-65 (docs/spec.md, Fase 8)
# Automatización: tests/e2e/idiomas.e2e.ts (web)

Característica: Listening y speaking para exámenes de idiomas

  Escenario: AC-65 Listening
      Cuando genero un listening B1 y lo escucho
      Entonces respondo las preguntas y al corregir veo el puntaje y la transcripción
  
    Escenario: AC-65 Speaking
      Dado una consigna de speaking
      Cuando subo el audio de mi respuesta
      Entonces veo la transcripción y, al corregir, la devolución con una versión mejorada
      Y sin modelo de voz configurado me dice que lo configure en Ajustes → Voz
