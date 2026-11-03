# language: es
Característica: Sonidos y recordatorios de salud
  Como estudiante que pasa horas sentado
  Quiero un pomodoro que suene como un reloj de cocina y avisos para pararme y tomar agua
  Para estudiar mejor sin olvidarme de mi cuerpo

  @AC-97
  Escenario: El pomodoro suena y se puede silenciar
    Cuando termina un bloque de foco con el sonido activo
    Entonces suena el tic-tac del final y la campanita
    Cuando apago el sonido
    Entonces el siguiente bloque termina en silencio y se recuerda mi elección

  @AC-98
  Escenario: Pararme y tomar agua
    Dado que activé los dos avisos con 10 minutos
    Cuando pasa ese tiempo
    Entonces veo «Hora de pararte» y «Hora de tomar agua»
