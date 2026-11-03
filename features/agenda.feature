# language: es
# Cubre: AC-50 … AC-52 (docs/spec.md, Fase 6)
# Automatización: tests/e2e/agenda.e2e.ts (web)

Característica: Materias, horario de clases y plan con fecha
  Como estudiante que cursa materias y rinde exámenes
  Quiero organizar mis clases, mis horas de estudio y lo que tengo que estudiar cada semana
  Para llegar a cada parcial o examen con todo visto

  Escenario: AC-50 AC-51 Una materia con su programa y su horario
    Cuando creo la materia "Análisis Matemático II" pegando su programa
    Entonces veo sus unidades como ruta de estudio
    Cuando cargo una clase los martes de 18:00 a 20:00 en el Aula 5
    Entonces aparece en su horario y en la semana de la Agenda
    Y un horario con fin antes del inicio se rechaza con un aviso

  Escenario: AC-52 Plan hasta la fecha del parcial
    Dado una materia con fecha en 20 días y 6 horas por semana
    Entonces el plan me dice qué estudiar hoy y lo reparte por semanas
    Y la última semana es de simulacros, repaso y hoja de repaso
    Y veo las horas de esta semana contra la meta
    Y la Agenda muestra "En 20 días" en las próximas fechas

  Escenario: AC-51 Agenda vacía
    Cuando abro la Agenda sin nada cargado
    Entonces me explica qué cargar

  Escenario: AC-59 Exportar a calendario
    Cuando exporto la agenda
    Entonces descargo un .ics con las clases semanales hasta la fecha y el examen como día completo

  Escenario: AC-62 Recordatorios
    Dado una clase que empieza en 5 minutos
    Entonces veo un recordatorio con la materia, cuánto falta y el lugar
