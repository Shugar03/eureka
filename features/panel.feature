# language: es
Característica: Panel de hoy y racha amable
  Como estudiante que abre Eureka cada día
  Quiero ver de un vistazo mis clases, lo que se viene, mis notas y mi racha
  Para saber qué me toca hoy y sostener el hábito sin culpa

  @AC-140 @AC-142 @AC-143
  Escenario: El panel con la cursada cargada
    Dado que tengo una materia con clase hoy, una entrega mañana, un parcial en 3 días y dos notas
    Cuando abro el inicio
    Entonces veo la clase de hoy con su aula y cuál sigue
    Y veo la entrega y el parcial con los días que faltan
    Y veo las notas de la materia con su promedio «7,5»
    Y al tocar la entrega se abre Mi cursada

  @AC-141
  Escenario: El día libre no corta la racha y hoy suma
    Dado que estudié los últimos 6 días salvo uno
    Cuando abro el inicio
    Entonces la racha dice «6 días» y que lo que haga hoy suma uno más
    Cuando empiezo una charla con el profesor y vuelvo al inicio
    Entonces la racha dice «7 días con estudio. Hoy ya sumaste.»

  @AC-140 @AC-141
  Escenario: Sin nada cargado
    Cuando abro el inicio por primera vez
    Entonces la racha dice «Hoy puede ser el día uno.»
    Y cada tarjeta invita a cargar lo suyo, con un botón a Mi cursada
