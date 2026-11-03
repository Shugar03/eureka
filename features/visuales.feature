# language: es
# Cubre: AC-27 … AC-31, NF-14 (docs/spec.md, Fase 4)
# Automatización: tests/e2e/visuales.e2e.ts (web) y tests/desktop/visuales.e2e.ts (app real)

Característica: Diagramas, demos e investigación
  Como aprendiz
  Quiero ver la idea dibujada, tocarla y saber de dónde sale la información
  Para entender con más de un canal y poder confiar en lo que leo

  @AC-27
  Escenario: Un diagrama en la explicación
    Dado que el profesor explica la recta tangente
    Entonces veo el diagrama "De la secante a la tangente" dibujado

  @AC-27
  Escenario: Un diagrama inválido no rompe el chat
    Dado que el profesor manda un diagrama con errores
    Entonces veo su código con el aviso "No se pudo dibujar"

  @AC-28 @NF-14
  Escenario: Una demo interactiva aislada
    Dado que el profesor muestra la demo "Acercá los puntos"
    Entonces la demo corre en un iframe con sandbox "allow-scripts" y sin acceso a la red
    Cuando muevo su control
    Entonces la demo responde

  @AC-29
  Escenario: Investigar con fuentes
    Dado que terminé la sesión
    Cuando pregunto "¿para qué sirve?"
    Entonces veo una tarjeta de investigación con un resumen y sus fuentes
    Y el profesor responde usando lo investigado

  @AC-30
  Escenario: Sin búsqueda configurada
    Dado que no hay búsqueda web configurada
    Cuando el profesor intenta investigar
    Entonces la tarjeta dice que la búsqueda no está configurada y la sesión sigue

  @AC-31
  Escenario: Configurar la búsqueda
    Cuando cargo la URL y la API key de búsqueda en Ajustes y guardo
    Entonces la búsqueda queda configurada sin mostrar la key

  @AC-175
  Escenario: Invertir los colores de una demo
    Dado que el profesor me mostró una demo interactiva
    Cuando toco "Invertir colores"
    Entonces la demo se ve con los colores invertidos y sigue en el estado en que la dejé
    Y la próxima demo ya se muestra invertida
