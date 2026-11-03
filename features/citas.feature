# language: es
Característica: Citas
  Como estudiante que quiere empezar el día con una idea que acompañe
  Quiero una cita de un autor o un filósofo cada día, con su fuente
  Para encontrar algo que me inspire, y quedarme con las que me hablan

  @AC-130
  Escenario: La cita del día
    Cuando abro el inicio
    Entonces veo la cita de hoy, con su autor y su obra
    Y es la misma todo el día, y todos los años en esta fecha

  @AC-131
  Escenario: Otra, favorita, no mostrar más
    Cuando toco "Otra cita"
    Entonces veo otra que no salió todavía
    Cuando la guardo como favorita
    Entonces queda marcada
    Cuando toco "No mostrar más"
    Entonces desaparece y puedo deshacerlo

  @AC-132
  Escenario: Mis favoritas y mis frases
    Dado que guardé una favorita
    Cuando abro Mi espacio
    Entonces la veo en "Mis favoritas"
    Cuando agrego "Paso a paso, que se llega." de "mi abuela"
    Entonces queda en "Mis frases", también al volver a abrir la app

  @AC-133
  Escenario: Bienvenida al abrir
    Cuando abro Eureka
    Entonces veo la cita del día en una pantalla tranquila
    Y "Entrar" o Esc la cierran, y no vuelve hasta la próxima vez que abro la app
