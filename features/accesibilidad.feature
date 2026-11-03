# language: es
Característica: Accesibilidad
  Como estudiante a quien le cuesta leer, concentrarse o seguir cambios inesperados
  Quiero ajustar cómo se ve la app, escucharla, dictarle y cómo me habla el profesor
  Para estudiar lo mismo que cualquiera, sin tener que dar un diagnóstico

  @AC-73
  Escenario: Los ajustes se aplican al instante y se recuerdan
    Dado que abro "Ajustes" y la pestaña "Accesibilidad"
    Entonces veo que "No hace falta ningún diagnóstico"
    Cuando elijo "Muy grande", "Más espacio entre letras, palabras y líneas" y "Sin animaciones"
    Entonces la app se agranda, sigue ocupando toda la ventana y deja de animarse
    Y al volver a Ajustes los ajustes siguen elegidos

  @AC-74
  Escenario: Escuchar la pregunta marca la palabra que se lee
    Dado que activé "Leeme en voz alta"
    Y el profesor me hizo una pregunta
    Cuando toco "Escuchar la pregunta"
    Entonces veo el texto que se lee, sin símbolos de Markdown, con la palabra actual marcada
    Y "Detener lectura" corta la lectura

  @AC-75
  Escenario: El profesor escribe según mis ajustes
    Dado que activé "Lenguaje literal y sin sorpresas" y "Pasos cortos con meta visible"
    Cuando el profesor mide, planifica o enseña
    Entonces recibe esos ajustes en cada paso y no me pregunta por diagnósticos

  @AC-76
  Escenario: Dictar una respuesta
    Dado que activé "Responder dictando" y tengo un modelo de Voz
    Cuando toco "Dictar", hablo y toco "Terminar de dictar"
    Entonces lo que dije queda escrito en "Tu respuesta"

  @AC-76
  Escenario: Dictar sin modelo de voz
    Dado que activé "Responder dictando" y no tengo modelo de Voz
    Entonces "Dictar" está desactivado y dice "Para dictar, elegí un modelo de Voz en Ajustes."
