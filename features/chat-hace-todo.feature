# language: es
Característica: El chat hace lo que hacen las pantallas
  Como estudiante que prefiere pedir las cosas con sus palabras
  Quiero que el asistente arme mazos, prácticas y ejercicios, y cambie mis ajustes
  Para no tener que buscar cada pantalla

  @AC-161 @AC-164
  Escenario: Pedir un mazo y estudiarlo
    Cuando le pido «haceme tarjetas de verbos irregulares»
    Entonces veo las tarjetas y las puedo editar o sacar antes de crear el mazo
    Y cuando después le pido estudiar ese mazo, me ofrece un botón que lo abre

  @AC-162
  Escenario: Practicar lo que ya entendí
    Dado que mi grafo tiene ideas de derivadas
    Cuando le pido practicar derivadas
    Entonces esas ideas vienen marcadas, elijo cuántos problemas y la práctica se genera al confirmar

  @AC-163
  Escenario: Un ejercicio de programación
    Cuando le pido un ejercicio de Python
    Entonces puedo cambiar el tema y el nivel y se genera en la consola de Código

  @AC-160
  Escenario: Pomodoro y perfil
    Cuando le pido el pomodoro de 50 y descanso de 10, o le cuento cómo me llamo
    Entonces se cambia y el chat muestra qué cambió

  @AC-165
  Escenario: Corregir lo que entendió
    Cuando me propone una preparación de examen o mi horario
    Entonces puedo corregir los datos, sacar materias o fechas y recién después guardar
