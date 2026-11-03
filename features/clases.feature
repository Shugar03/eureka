# language: es
Característica: Clases grabadas, escuchar y rutas por materia
  Como estudiante que va a clase y rinde parciales
  Quiero grabar la clase, tener los apuntes y escucharlos, y que mi plan siga mis parciales y mis simulacros
  Para estudiar de lo que se dio sin depender de mis notas

  @AC-146 @AC-147 @AC-148
  Escenario: Grabar una clase y estudiar con sus apuntes
    Dado que tengo la Voz elegida
    Cuando grabo una clase de Análisis II
    Entonces se transcribe de a partes mientras grabo
    Cuando termino la clase y armo los apuntes
    Entonces veo las ideas clave, los apuntes, lo que quedó para repasar y las fechas anunciadas
    Y puedo escuchar el repaso con la voz del sistema
    Y agrego el parcial anunciado a Mi cursada con un toque
    Y hago tarjetas que también puedo escuchar

  @AC-146
  Escenario: Sin Voz elegida
    Cuando abro Clases sin haber elegido la Voz
    Entonces me explica qué falta y me lleva a Ajustes

  @AC-149
  Escenario: El plan se reajusta con el simulacro
    Dado que estudié los temas de un dominio
    Cuando en el último simulacro saco menos que la nota para aprobar en ese dominio
    Entonces esos temas vuelven al plan para repasar, con el porcentaje

  @AC-150
  Escenario: La materia arma su ruta
    Cuando en Mi cursada armo la ruta de Física I
    Entonces su fecha es su próximo parcial
    Cuando marco ese parcial como hecho y tiene un final después
    Entonces la ruta apunta al final
