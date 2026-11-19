# language: es
Característica: Eureka se adapta y aprende de la persona (AC-111 … AC-113)

  Escenario: El agente usa lo que sabe en todas las fases (AC-111)
    Dado que la persona se confundió con la derivada en una sesión anterior
    Cuando charla o aprende otra cosa
    Entonces el agente recibe «Le cuesta: Derivada» con la evidencia
    Y acertar en práctica marca esa confusión como reparada

  Escenario: Un plan para hoy con sus razones (AC-112)
    Dado que tiene un parcial en 3 días, tarjetas para hoy y un pendiente de una sesión
    Cuando abre el inicio
    Entonces ve hasta tres sugerencias, cada una con su porqué y un botón que la lleva
    Y si anotó algo en segundo plano, ve «Desde la última vez anoté lo de …»

  Escenario: Ver y corregir lo que Eureka aprendió (AC-113)
    Cuando abre «Mi progreso»
    Entonces ve sus temas en Te cuesta, Quedó pendiente, Practicando y Ya lo dominás, con la evidencia
    Y puede marcar «Esto ya lo sé», repasar o retomar

  @AC-210
  Escenario: Un coach, los números y un camino por sesión (AC-210)
    Dado que estudió varios días, tiene sesiones con plan, tarjetas para hoy y un parcial en 4 días
    Cuando abre «Mi progreso»
    Entonces el coach le dice cómo viene, qué es lo que más se repite y qué le conviene hoy, con un botón para cada cosa
    Y ve su racha, sus temas por estado y su semana
    Y cada sesión es un camino de ideas con el próximo paso marcado y «Seguir desde acá»
    Y lo que ningún camino muestra queda abajo, sin repetirse
    Y la memoria para corregir queda plegada al final
