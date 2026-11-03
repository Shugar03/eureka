# language: es
Característica: Acompañamiento
  Como estudiante que a veces se abruma o necesita que lo escuchen
  Quiero un lugar para hablar y anotar cómo estoy, sin que me enseñen nada
  Para sentirme acompañado, sabiendo qué se guarda, dónde y quién lo ve

  @AC-82
  Escenario: Antes de empezar
    Cuando abro "Acompañamiento" por primera vez
    Entonces veo que acá no se estudia, que no es terapia ni para emergencias
    Y veo que mis mensajes viajan a mi proveedor del modelo y que el profesor no lee nada
    Y no puedo escribir hasta aceptar

  @AC-82
  Escenario: Si falla el envío no se pierde lo que escribí
    Cuando envío un mensaje y el proveedor falla
    Entonces veo el error y mi mensaje sigue en la caja

  @AC-84
  Escenario: Señales de riesgo
    Cuando escribo que pienso en quitarme la vida
    Entonces la app responde sola, me pregunta con cuidado si pienso en hacerme daño
    Y veo líneas de ayuda que se quedan mientras dure la charla

  @AC-83
  Escenario: Guardar la charla en el diario
    Dado que conversé al menos dos mensajes
    Cuando elijo "Guardar esta charla en mi diario"
    Entonces veo un borrador en primera persona que puedo editar
    Y solo se guarda si lo apruebo

  @AC-83
  Escenario: Check-in de diez segundos
    Cuando elijo cómo estoy y una emoción
    Entonces queda anotado bajo "Hoy"

  @AC-85
  Escenario: PIN
    Dado que puse un PIN
    Cuando salgo de la pantalla y vuelvo
    Entonces el diario está bloqueado y un PIN incorrecto no lo abre

  @AC-86
  Escenario: Olvidé mi PIN
    Cuando uso "Olvidé mi PIN" y confirmo
    Entonces se borra todo y vuelvo al aviso inicial

  @AC-87
  Escenario: Herramientas
    Cuando uso la respiración guiada y el 5-4-3-2-1
    Entonces me guían paso a paso, sin conexión y sin guardar nada
