# language: es
# Cubre: AC-22 … AC-26, NF-13 (docs/spec.md, Fase 3)
# Automatización: tests/e2e/practica.e2e.ts (web) y tests/desktop/practica.e2e.ts (app real)

Característica: Práctica a partir del grafo
  Como aprendiz
  Quiero resolver problemas que me obliguen a usar lo que entendí sin que me lo nombren
  Para que ese conocimiento me venga a la cabeza cuando lo necesito

  Antecedentes:
    Dado que el grafo tiene las ideas de la sesión "qué es una derivada"

  @AC-22
  Escenario: Crear una práctica eligiendo ideas
    Cuando abro "Práctica", elijo "La derivada es la pendiente de la recta tangente" y pido 3 problemas
    Entonces veo el problema 1 de 3

  @AC-22
  Escenario: Sin ideas no hay práctica
    Dado que el grafo está vacío
    Cuando abro "Práctica"
    Entonces la pantalla explica que primero hay que terminar una sesión o importar notas

  @AC-23 @AC-24
  Escenario: Pistas graduales
    Dado un problema abierto
    Cuando pido una pista
    Entonces veo la pista 1/3
    Cuando pido otra
    Entonces veo la pista 2/3

  @AC-25
  Escenario: Corrección del razonamiento
    Cuando respondo "6" con confianza 4
    Entonces veo el veredicto "Correcto" y una devolución
    Cuando respondo mal otro problema
    Entonces veo "Incorrecto", puedo ver la solución y reintentar

  @AC-26
  Escenario: Resumen y retomar
    Cuando termino los 3 problemas
    Entonces veo el resumen con un veredicto por problema y las pistas usadas
    Y la práctica aparece en la lista con "3/3"

  @NF-13
  Escenario: Si el corrector falla no se pierde la respuesta
    Dado que el corrector falla una vez
    Cuando respondo
    Entonces veo el error con "Reintentar"
    Cuando reintento
    Entonces se corrige la misma respuesta
