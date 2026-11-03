# language: es
Característica: Feriados y días sin clases
  Como estudiante con feriados, recesos y semanas de parciales
  Quiero marcar los días sin clases y tener mi cursada en el calendario
  Para que el inicio, la agenda y mi calendario no me muestren clases que no hay

  @AC-145
  Escenario: Un día sin clases y los feriados nacionales
    Dado que tengo una materia con clase hoy
    Cuando en Mi cursada marco hoy sin clases por «Paro docente»
    Y sumo los feriados nacionales dos veces
    Entonces la segunda vez me dice que ya están todos
    Y el inicio dice «Hoy no hay clases: Paro docente.»
    Cuando borro ese día
    Entonces deja de aparecer en la lista

  @AC-144 @AC-145
  Escenario: La cursada en el calendario
    Dado que tengo clases los lunes y un parcial con hora
    Cuando exporto la agenda a calendario
    Entonces las clases se repiten hasta el fin del período, sin los días sin clases
    Y el parcial trae un aviso el día anterior
