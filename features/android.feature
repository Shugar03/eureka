# language: es
Característica: Eureka en el celular
  Como estudiante que lleva el celular a todos lados
  Quiero la misma Eureka en Android
  Para estudiar y recibir mis avisos aunque no esté en la computadora

  @AC-177
  Escenario: Navegar con el menú
    Dado que abro Eureka en el celular
    Cuando toco «Menú» y elijo «Tarjetas»
    Entonces veo Tarjetas y el menú se cierra

  @AC-178
  Escenario: El botón atrás vuelve
    Dado que fui de Tarjetas a Biblioteca
    Cuando toco atrás dos veces
    Entonces vuelvo a Tarjetas y después al inicio
    Cuando toco atrás otra vez
    Entonces se cierra la app

  @AC-179
  Escenario: Guardar un respaldo donde elijo
    Cuando creo un respaldo desde Ajustes
    Entonces se abre «Guardar como» de Android
    Y al guardar en Descargas veo «Respaldo guardado en Eureka-respaldo-….zip»

  @AC-180
  Escenario: Abrir un mazo que me pasaron
    Dado que tengo «prueba.eureka» en Descargas
    Cuando lo abro desde Archivos
    Entonces Eureka abre Tarjetas con la vista previa «Capitales de prueba»

  @AC-181
  Escenario: Solo SQL en la consola
    Cuando abro Código
    Entonces la consola está en SQL y Python dice «disponible en la versión de escritorio»

  @AC-182
  Escenario: Un aviso de clase con la app cerrada
    Dado que tengo una clase hoy a las 18:00 y aviso 15 minutos antes
    Cuando salgo de Eureka
    Entonces a las 17:45 el celular me avisa «Clase de …»
