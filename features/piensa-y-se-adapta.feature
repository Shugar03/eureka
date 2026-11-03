# language: es
# Cubre: AC-166 … AC-169 (docs/spec.md, «Pensar en voz alta y práctica que se adapta»)
# Automatización: tests/e2e/piensa-y-se-adapta.e2e.ts (web); AC-169 en tests/e2e/visuales.e2e.ts

Característica: Darle al profesor datos continuos de cómo pienso
  Como aprendiz
  Quiero que lo que voy pensando llegue al profesor y que la práctica se ajuste a cómo me va
  Para que las explicaciones, los problemas y las pistas partan de donde estoy

  @AC-166
  Escenario: Pensar mientras leo la explicación
    Dado que estoy en la fase de enseñanza
    Cuando escribo lo que voy pensando debajo de la última explicación y respondo la pregunta
    Entonces mi respuesta muestra "Mientras leías" con lo que escribí
    Y el campo queda vacío para la próxima explicación

  @AC-167
  Escenario: La práctica se escribe de a un problema según cómo me fue
    Dado que el grafo tiene las ideas de la sesión "qué es una derivada"
    Cuando pido una práctica de 3 problemas
    Entonces veo "Problema 1 de 3" con el nivel "Una idea · contexto conocido"
    Cuando lo resuelvo bien, seguro y sin pistas, y paso al siguiente
    Entonces veo "Problema 2 de 3" con el nivel "Una idea · contexto nuevo"

  @AC-168
  Escenario: Un empujón hecho para lo que vengo pensando
    Dado que estoy resolviendo un problema de práctica
    Entonces "Necesito un empujón" está deshabilitado hasta que escribo algo
    Cuando escribo lo que vengo pensando y pido un empujón
    Entonces aparece "Empujón 1" con una pista que parte de lo que escribí
    Cuando lo que pensé ya lo resuelve y pido otro
    Entonces me dice que lo mande como respuesta y no cuenta como pista

  @AC-169
  Escenario: La investigación no frena la clase
    Dado que la búsqueda web está configurada y terminé una sesión
    Cuando pregunto algo que el profesor manda a investigar
    Entonces la tarjeta dice "Investigando en segundo plano" y el profesor sigue hablando
    Y puedo seguir escribiendo
    Cuando termina la búsqueda
    Entonces la tarjeta muestra el resumen con sus fuentes sin borrar lo que estaba escribiendo
