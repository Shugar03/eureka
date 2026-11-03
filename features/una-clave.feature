# language: es
Característica: Empezar con una sola clave
  Como persona que quiere estudiar sin configurar nada
  Quiero pegar la clave de mi servicio de IA y que Eureka haga el resto
  Para empezar enseguida y sin pagar de más

  @AC-158 @AC-159
  Escenario: Pegar la clave en el inicio
    Dado que todavía no configuré ningún modelo
    Cuando pego mi clave de OpenCode Go y toco «Conectar»
    Entonces Eureka reconoce el servicio por el formato de la clave
    Y elige un modelo de chat, lo prueba con una consulta real y lo usa para todo
    Y me dice cuánto contexto usa, y si no lo sabe, que usa un valor seguro
    Y mi Voz y lo que elegí en Avanzado no cambian

  @AC-158
  Escenario: Una clave que puede ser de dos servicios
    Cuando pego una clave que empieza con «sk-»
    Entonces me pregunta de qué servicio es, sin probarla en ninguno
    Y la uso solo con el que elijo

  @AC-158
  Escenario: Una clave que no anda
    Cuando el servicio rechaza mi clave
    Entonces me lo dice en palabras simples y puedo elegir otro servicio
