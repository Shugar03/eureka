# language: es
# Cubre: AC-56 (docs/spec.md, Fase 8)
# Automatización: tests/e2e/hoy.e2e.ts (web)

Característica: Lo de hoy en un solo lugar

  Escenario: AC-56 La tarjeta Hoy
      Dado un mazo con tarjetas nuevas y un examen con fecha en 10 días
      Cuando abro el inicio
      Entonces veo las tarjetas para repasar y el examen con "10 d" y qué estudiar hoy
      Y "Estudiar" abre la sesión de ese tema
