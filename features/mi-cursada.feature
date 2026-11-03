# language: es
Característica: Mi cursada
  Como estudiante con materias, horarios y fechas que no me puedo olvidar
  Quiero tener mi vida académica dentro de Eureka
  Para planificar mis clases y llegar a cada parcial y entrega

  @AC-99
  Escenario: Armarla a mano
    Dado que abro "Mi cursada" por primera vez
    Cuando cargo el período "2.º cuatrimestre 2026" y la materia "Análisis I" los lunes y miércoles de 10 a 12
    Entonces veo mi semana en una grilla con un bloque por clase
    Y un horario que termina antes de empezar se rechaza junto al campo

  @AC-100
  Escenario: Fechas importantes
    Dado que tengo la materia "Física I"
    Cuando agrego el "Primer parcial" dentro de 3 días
    Entonces lo veo con "En 3 días" y la materia muestra su próxima fecha
    Y al marcarlo como hecho pasa a "Hechas"

  @AC-101
  Escenario: Pegar el horario
    Cuando pego mi horario y elijo "Leer mi horario"
    Entonces veo qué entendió antes de guardar nada
    Y al confirmar queda en Mi cursada
    Y si lo importo otra vez, no se duplica nada

  @AC-101
  Escenario: Contárselo al asistente
    Cuando le escribo mi horario en el chat
    Entonces el asistente me ofrece una tarjeta con "Guardar en Mi cursada"
    Y no se guarda hasta que la confirmo

  @AC-102
  Escenario: El asistente sabe qué tengo
    Dado que cargué mi cursada
    Cuando le pregunto qué tengo mañana
    Entonces conoce la fecha de hoy, mis clases y mis fechas próximas

  @AC-103
  Escenario: Agenda y avisos
    Dado que cargué clases y fechas
    Entonces la Agenda las muestra junto a mis materias y exámenes
    Y me avisan antes de cada clase y de cada fecha

  @AC-151
  Escenario: El horario desde una foto o un PDF
    Cuando subo una foto de mi horario en «Pegar mi horario»
    Entonces el modelo la transcribe bloque por bloque (día, hora, materia, aula) en el cuadro de texto
    Y la reviso y la leo como si la hubiera pegado
