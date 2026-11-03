# language: es
# Cubre: AC-173, AC-174 (docs/spec.md, «Pensar en voz alta y práctica que se adapta»)
# Automatización: tests/e2e/mis-problemas.e2e.ts (web)

Característica: Practicar mis propios problemas
  Como estudiante
  Quiero practicar los ejercicios de mi guía o de un parcial viejo
  Para practicar justo lo que me van a tomar, con empujones y corrección

  @AC-173
  Escenario: Pegar mi guía, revisarla y practicarla
    Dado que abro "Práctica", aunque mi grafo esté vacío
    Cuando pego tres ejercicios, uno con su respuesta, y toco "Leer los ejercicios"
    Entonces veo los tres, uno con "Respuesta de tu guía" y dos con "Solución de Eureka: verificala"
    Cuando corrijo un enunciado, saco otro y toco "Practicar (2)"
    Entonces resuelvo "Problema 1 de 2" como cualquier práctica, con el enunciado corregido

  @AC-173
  Escenario: La solución de Eureka se puede pedir revisar
    Dado que practico un ejercicio cuya solución escribió Eureka
    Cuando mi respuesta sale "Incorrecto" y toco "Creo que mi respuesta está bien"
    Entonces el corrector revisa la referencia y puede decir que tenía un error

  @AC-173
  Escenario: Desde una foto
    Cuando elijo una foto de mi guía
    Entonces el texto aparece para revisar, con el aviso "Lo leí de una imagen"
    Y al leerlo veo sus ejercicios

  @AC-173
  Escenario: Sin texto no hay nada para leer
    Entonces "Leer los ejercicios" está deshabilitado hasta que pego algo o elijo un archivo

  @AC-174
  Escenario: Desde el chat, pegando los ejercicios
    Cuando escribo en el chat "Quiero practicar estos ejercicios:" y pego dos ejercicios
    Entonces aparece la tarjeta "Practicar mis problemas" con mis ejercicios cargados
    Y recién cuando toco "Leer los ejercicios" los separa para revisarlos y practicarlos

  @AC-174
  Escenario: Desde el chat, con la guía que adjunté
    Cuando adjunto mi guía en PDF y pido practicarla
    Entonces la tarjeta dice "Los ejercicios de «Guía 2 de Física», de tu biblioteca" y los lee al tocar "Leer los ejercicios"
