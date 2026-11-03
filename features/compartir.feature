# language: es
Característica: Compartir mazos y traerlos de Anki
  Como estudiante que arma tarjetas con su grupo o ya usaba Anki
  Quiero importar mis mazos de Anki y mandar los míos por WhatsApp o mail
  Para no empezar de cero ni depender de un servidor

  @AC-152
  Escenario: Importar un .apkg de Anki
    Cuando elijo un archivo .apkg en Tarjetas
    Entonces veo cuántas tarjetas trae, las primeras, y qué notas quedaron afuera y por qué
    Y puedo cambiarle el nombre antes de importarlo
    Cuando lo importo
    Entonces se crea un mazo nuevo con todas las tarjetas como nuevas

  @AC-153
  Escenario: Exportar un mazo a Anki
    Dado un mazo con tarjetas
    Cuando toco «Exportar a Anki (.apkg)»
    Entonces queda un .apkg en Descargas listo para Archivo → Importar en Anki

  @AC-154
  Escenario: Compartir un mazo y recibir uno
    Cuando toco «Compartir» en un mazo
    Entonces queda un archivo .eureka en Descargas para mandar, sin mi progreso
    Cuando otra persona lo abre con Eureka (doble clic o «Importar un mazo»)
    Entonces ve la vista previa, avisada de que viene de otra persona, y lo importa si quiere
    Y si lo cancela no se le vuelve a ofrecer
