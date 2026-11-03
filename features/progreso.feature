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
    Entonces ve sus temas agrupados en Le cuesta, Quedó pendiente, Practicando y Ya lo domina, con la evidencia
    Y puede marcar «Esto ya lo sé», repasar o retomar
