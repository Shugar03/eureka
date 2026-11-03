# language: es
# Cubre: AC-49 (docs/spec.md, Fase 6)
# Automatización: tests/e2e/pomodoro.e2e.ts (web, ?fastPomodoro: 1 minuto dura 1 segundo)

Característica: Pomodoro y tiempo de estudio
  Como estudiante
  Quiero estudiar en bloques de foco con descansos y ver cuánto estudié
  Para sostener el ritmo y saber a qué le dedico el tiempo

  Escenario: AC-49 Un bloque de foco se anota con lo que estaba estudiando
    Dado que configuro el foco en 3 minutos y el descanso en 2
    Y que estoy en el mazo "Python"
    Cuando empiezo el pomodoro y termina el bloque de foco
    Entonces suena un aviso, se anotan 3 minutos y arranca el descanso
    Y al terminar el descanso puedo empezar otro bloque
    Y en el inicio veo "Hoy: 3 min" y "Python" entre los temas

  Escenario: AC-49 Controles
    Cuando salto al descanso o reinicio
    Entonces el pomodoro cambia de fase o vuelve al primer bloque
