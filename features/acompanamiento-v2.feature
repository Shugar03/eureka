# language: es
Característica: Acompañamiento — conocerme un poco mejor
  Como estudiante que quiere entender cómo se siente y qué le pasa
  Quiero herramientas para ponerle nombre a lo que siento, mirar mis pensamientos y notar patrones
  Para conocerme mejor, sin que nadie me diga cómo soy

  @AC-93
  Escenario: Un registro de pensamientos
    Dado que abro "Herramientas" y empiezo un registro
    Cuando cuento qué pasó y qué pensé, elijo la emoción y su fuerza, anoto qué apoya y qué no encaja, y escribo otra mirada
    Y vuelvo a medir cuánto me pega ahora
    Entonces queda en mi diario, con el texto legible y la intensidad "80 → 40"
    Y todo lo escribí yo, sin modelo

  @AC-93
  Escenario: Cancelar sin guardar
    Dado que empecé un registro
    Cuando cancelo en cualquier paso
    Entonces no se guarda nada

  @AC-94
  Escenario: Ponerle nombre a lo que siento
    Cuando elijo la familia "Tristeza" y la palabra "desanimado", y la familia "Agobio" y "cansado"
    Y guardo como check-in con un ánimo
    Entonces ambas palabras aparecen en mi diario

  @AC-94
  Escenario: Cuando falta la palabra, en el check-in
    Cuando abro "No encuentro la palabra" y elijo "frustrado"
    Entonces queda elegida entre las emociones del check-in

  @AC-95
  Escenario: Sin datos no se inventa nada
    Dado que anoté pocas veces mi ánimo
    Entonces veo cuántas anotaciones faltan, y ningún patrón

  @AC-95
  @AC-96
  Escenario: Lo que noté es una suposición que decido yo
    Dado que anoté mi ánimo durante tres semanas y los domingos fueron difíciles
    Entonces veo "Los domingos suelen costarte más", con los números y un aviso de que no es un diagnóstico
    Cuando toco "Me suena"
    Entonces pasa a "Lo que ya confirmé", y puedo quitarlo
    Cuando toco "No es así" en otra
    Entonces se esconde, y puedo volver a mostrarla
