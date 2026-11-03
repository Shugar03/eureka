# language: es
Característica: Chat agéntico
  Como estudiante que usa ChatGPT, Claude o Gemini
  Quiero escribirle a Eureka como a un chatbot normal
  Para que él decida con sus herramientas qué hacer, en vez de seguir un formulario

  @AC-89
  Escenario: Un saludo es solo una charla
    Cuando escribo "hola" en el inicio
    Entonces el asistente me saluda y me pregunta en qué ayudar
    Y no hay pregunta de diagnóstico ni panel de plan

  @AC-89
  Escenario: Pedir aprender arranca el método en la misma conversación
    Dado que estoy en una charla
    Cuando digo que quiero entender qué es una derivada
    Entonces veo "Empezó a aprender: qué es una derivada"
    Y el asistente me hace la primera pregunta de diagnóstico
    Y aparecen el plan y el diagnóstico

  @AC-90
  Escenario: El asistente ofrece botones y yo decido
    Cuando pido ayuda con un pomodoro
    Entonces veo un botón «Empezar un pomodoro de 25 min» que dice qué va a hacer
    Y el reloj no arranca hasta que lo toco
    Y puedo tocar «Abrir la biblioteca» para ir a esa pantalla

  @AC-120
  Escenario: Contar que quiero rendir un examen arma mi preparación
    Cuando escribo "quiero prepararme para rendir la certificación AWS el 15 de diciembre"
    Entonces veo una tarjeta con el examen, la fecha y que todavía no hay guía
    Y no se crea nada hasta que toco «Buscar la guía y crear mi preparación»
    Y al crearla veo la ruta de estudio y puedo abrirla

  @AC-121
  Escenario: Escribir libremente con una pregunta pendiente
    Dado que el asistente me hizo una pregunta de diagnóstico
    Cuando escribo en el chat "esperá, antes explicame qué es una pendiente"
    Entonces mi mensaje aparece como burbuja y la pregunta dice que respondí en el chat
    Y la conversación sigue sin repetirme la pregunta

  @AC-122
  Escenario: El asistente maneja la app
    Cuando le pido "empezá un pomodoro de 40 min"
    Entonces el pomodoro arranca y el chat dice "Empezó un pomodoro de 40 min"
    Cuando le pido "pausá el pomodoro", "poné el modo claro" y "apagá el sonido"
    Entonces el pomodoro queda en pausa, el tema pasa a claro y el sonido se apaga
