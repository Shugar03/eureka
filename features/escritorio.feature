# language: es
# Cubre: AC-01…AC-13, NF-01…NF-05 sobre la app REAL (Rust + WebView2)
# Automatización: tests/desktop/*.e2e.ts (proveedor falso: tests/fake-provider/server.ts)

Característica: La app de escritorio real con un proveedor falso
  Para probar de punta a punta el loop del agente en Rust, el parser SSE,
  las herramientas, la IPC y lo que se guarda en disco, sin gastar tokens

  Antecedentes:
    Dado que la app real arranca con una carpeta de datos nueva
    Y el profesor usa un proveedor falso compatible con OpenAI

  @D-01 @NF-04
  Escenario: El agente en Rust hace la primera pregunta
    Cuando empiezo una sesión "qué es una derivada"
    Entonces aparece la pregunta de diagnóstico, transmitida en pedazos que cortan caracteres como "¡" o "í"
    Y el proveedor recibió exactamente una llamada con el modelo "demo/profesor"

  @D-02 @AC-05 @AC-06 @AC-07 @AC-13
  Escenario: Arco completo hasta Listo
    Cuando respondo todo el diagnóstico y la enseñanza, con una verificación mal
    Entonces la sesión termina en "Listo" con todos los pasos entendidos
    Y el modelo recibió mis 6 respuestas como resultados de herramienta, con su confianza
    Y una pregunta libre después de terminar recibe respuesta

  @D-03 @AC-08 @NF-01
  Escenario: La sesión vive en disco
    Cuando respondo la primera pregunta
    Entonces el archivo de la sesión tiene fase, hallazgo y pregunta pendiente
    Cuando recargo la app
    Entonces la sesión vuelve igual desde el disco

  @D-04 @AC-11
  Escenario: Error HTTP y reintento
    Dado que el proveedor responde 503 una vez
    Cuando empiezo una sesión
    Entonces veo el error con el código y el mensaje del proveedor
    Cuando presiono "Reintentar"
    Entonces llega la pregunta

  @D-05 @AC-11
  Escenario: Error a mitad del streaming
    Dado que el proveedor corta la respuesta con un error
    Entonces veo ese error

  @D-06 @NF-02
  Escenario: Detener al agente
    Dado que el proveedor responde muy lento
    Cuando presiono "Detener" mientras escribe
    Entonces el agente para y no se ejecuta ninguna herramienta a medio recibir

  @D-07 @NF-02
  Escenario: Tope de pasos
    Dado un modelo que llama herramientas sin parar
    Entonces el turno se corta en 12 llamadas con un error claro

  @D-08 @AC-09 @NF-01
  Escenario: Ajustes reales
    Cuando listo modelos y guardo una API key nueva
    Entonces la key queda en auth.json, nunca en settings.json ni en pantalla
    Y la próxima sesión la usa

  @D-09 @AC-12
  Escenario: Un prompt editado llega al modelo
    Cuando edito el prompt base con un marcador y guardo
    Entonces el próximo system prompt que recibe el modelo contiene el marcador

  @D-10 @AC-08
  Escenario: Borrar elimina el archivo
    Cuando borro una sesión
    Entonces su archivo ya no existe
