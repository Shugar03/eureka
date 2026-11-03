# language: es
# Cubre: AC-01, AC-02, AC-08, AC-09, AC-12, AC-13, AC-15, AC-16 (casos borde)
# Automatización: tests/e2e/bordes.e2e.ts

Característica: Casos borde de la interfaz
  Para que la app no se rompa con usos poco comunes

  @AC-01
  Escenario: No se puede empezar sin objetivo
    Cuando el objetivo está vacío o tiene solo espacios
    Entonces "Empezar" está deshabilitado

  @AC-15
  Escenario: La paleta de comandos se abre con Ctrl K y ejecuta con Enter
    Cuando presiono Ctrl K
    Entonces se abre la paleta de comandos
    Cuando escribo "ajustes" y presiono Enter
    Entonces veo la pantalla "Ajustes"

  @AC-15 @AC-14
  Escenario: La paleta se navega con flechas
    Cuando abro la paleta, escribo "tema", bajo una vez con la flecha y presiono Enter
    Entonces se aplica el tema claro

  @AC-15
  Escenario: La paleta se cierra con Escape o clic afuera y avisa sin resultados
    Cuando abro la paleta y escribo algo que no existe
    Entonces veo "Sin resultados"
    Cuando presiono Escape
    Entonces la paleta se cierra
    Cuando la abro de nuevo y hago clic afuera
    Entonces la paleta se cierra

  @AC-15
  Escenario: La paleta abre sesiones por nombre
    Dado que tengo una sesión "tema paleta"
    Cuando la busco en la paleta y presiono Enter
    Entonces se abre esa sesión

  @AC-16
  Escenario: Dos sesiones son independientes
    Dado que respondí una pregunta en la sesión "qué es una derivada"
    Cuando empiezo otra sesión "otro tema"
    Entonces la nueva sesión arranca sin hallazgos
    Cuando vuelvo a la primera desde la barra lateral
    Entonces sigue teniendo su hallazgo y queda marcada como actual

  @AC-02
  Escenario: Cambiar de opción antes de responder
    Dado una pregunta con opciones
    Cuando elijo una opción y después otra
    Entonces solo la última queda elegida

  @AC-13
  Escenario: Shift+Enter agrega una línea y Enter envía
    Dado que no hay pregunta pendiente
    Cuando escribo en el mensaje y presiono Shift+Enter
    Entonces el mensaje tiene una línea nueva y no se envió
    Cuando presiono Enter
    Entonces el mensaje aparece en el chat

  @AC-09
  Escenario: Agregar y quitar un proveedor personalizado
    Cuando agrego un proveedor, guardo y vuelvo a Ajustes
    Entonces el proveedor sigue ahí
    Cuando lo elimino y guardo
    Entonces ya no está

  @AC-09 @AC-10
  Escenario: Quitar la key del profesor vuelve a pedir configuración
    Cuando presiono "Quitar key" en OpenRouter y guardo
    Entonces el inicio vuelve a mostrar el aviso de configuración

  @AC-12
  Escenario: Guardar un prompt sin cambios está deshabilitado
    Cuando abro un prompt sin modificarlo
    Entonces "Guardar" está deshabilitado

  @AC-08
  Escenario: La confirmación de borrar se cancela al salir del botón
    Cuando presiono "Borrar" y después hago clic en otro lado
    Entonces el botón vuelve a decir "Borrar" y la sesión sigue
