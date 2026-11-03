# language: es
Característica: Bienvenida y perfil
  Como persona que abre Eureka por primera vez
  Quiero contarle lo básico de mí, si quiero, y elegir cómo me habla
  Para que se sienta como un lugar hecho para mí

  @AC-92
  Escenario: Los cinco pasos
    Dado que abro la app por primera vez
    Cuando completo nombre, estudios, trato y espacio, y dejo los cuidados como se sugieren
    Entonces el inicio me saluda por mi nombre según la hora
    Y los recordatorios de pararme y de tomar agua quedan activos
    Y la bienvenida no vuelve a aparecer

  @AC-92
  Escenario: Omitir todo
    Cuando elijo «Omitir todo»
    Entonces entro a la app sin haber contado nada

  @AC-92
  Escenario: Volver a verla
    Dado que cambié mis datos en Mi espacio
    Cuando elijo «Volver a ver la bienvenida»
    Entonces veo los pasos con lo que ya había cargado
