# language: es
Característica: Rutas de aprendizaje
  Para aprender un campo entero, Eureka arma un curso de varias clases a partir
  de cómo lo enseñan las universidades y los cursos conocidos, y lo sigue conmigo.

  @AC-214 @AC-215
  Escenario: Pedir un roadmap
    Cuando escribo "quiero aprender machine learning, armame un roadmap"
    Entonces el profesor me pregunta lo que le falta y me propone una ruta en una tarjeta
    Y la tarjeta dice en qué fuentes reales se basa
    Y marca como «ya la sabés» lo que Eureka sabe que domino
    Cuando saco una unidad, cambio el ritmo y toco "Crear la ruta"
    Entonces la ruta se crea con lo que dejé

  @AC-216
  Escenario: Cursar una clase de la ruta
    Dado que creé una ruta
    Cuando toco "Empezar la clase 1"
    Entonces se abre la clase con la franja "Clase 1 de N" y su unidad
    Y el profesor cubre solo los temas de esa clase y, desde la segunda, empieza repasando la anterior
    Cuando la clase termina
    Entonces veo "Clase 1 terminada" y el botón a la siguiente

  @AC-217
  Escenario: Seguir la ruta
    Dado que tengo una ruta empezada
    Cuando abro "Mis rutas"
    Entonces veo en qué clase voy, cuándo termino a mi ritmo y cada unidad como un camino de clases
    Y en el inicio veo mi próxima clase con un botón para empezarla
