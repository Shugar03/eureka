# language: es
Característica: Mi carrera: la malla, las correlativas y el promedio
  Como estudiante universitaria o universitario
  Quiero tener mi plan de estudios con lo que aprobé
  Para saber mi promedio y qué puedo cursar o rendir según las correlativas

  @AC-155
  Escenario: Cargar el plan desde una foto o un PDF
    Cuando abro «Mi carrera» en Mi cursada y elijo una foto del plan
    Entonces el modelo la transcribe materia por materia y puedo corregir el texto
    Cuando lo leo
    Entonces veo las materias por año con sus correlativas antes de guardar nada
    Y se guarda recién cuando lo confirmo

  @AC-156
  Escenario: Marcar aprobadas, regulares y aplazos
    Dado que cargué mi plan
    Cuando marco una materia aprobada con su nota y un aplazo
    Entonces veo mi promedio, y el promedio con aplazos
    Cuando marco otra como regular
    Entonces me dice qué finales puedo rendir y qué materias puedo cursar
    Y las que no, dicen qué correlativa me falta
    Y si vuelvo a cargar el plan, lo que marqué se conserva

  @AC-157
  Escenario: El asistente conoce mi carrera
    Dado que cargué mi plan y marqué lo aprobado
    Cuando le pregunto al asistente qué curso el cuatrimestre que viene
    Entonces sabe cuántas aprobé, mi promedio, qué estoy cursando y qué puedo cursar o rendir
