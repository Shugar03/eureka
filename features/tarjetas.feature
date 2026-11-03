# language: es
# Cubre: AC-47, AC-48 (docs/spec.md, Fase 6)
# Automatización: tests/e2e/tarjetas.e2e.ts (web)

Característica: Tarjetas de memoria con repetición espaciada
  Como aprendiz
  Quiero repasar lo que tengo que memorizar justo antes de olvidarlo
  Para recordarlo el día del examen con pocos minutos por día

  Escenario: AC-47 Mazo escrito a mano
    Dado que estoy en la pantalla "Tarjetas"
    Cuando creo el mazo "Puertos" y agrego la tarjeta "¿Puerto de HTTPS?" / "443"
    Entonces la tarjeta aparece como nueva y para hoy
    Y puedo editarla y borrarla

  Escenario: AC-47 Mazo generado de apuntes o de un examen
    Cuando genero un mazo de mis apuntes con dos ítems
    Entonces tiene una tarjeta por ítem
    Cuando elijo "Crear tarjetas" en un examen
    Entonces se abre un mazo con los temas del examen

  Escenario: AC-48 Sesión de estudio
    Dado un mazo con 2 tarjetas nuevas
    Cuando estudio, veo la respuesta y califico "Otra vez" la primera
    Entonces la tarjeta vuelve al final de la sesión
    Y cada botón dice cuándo vuelve la tarjeta
    Y al terminar, el mazo queda al día y cada tarjeta dice cuándo vuelve

  Escenario: AC-57 Lo fallado se vuelve tarjeta
    Cuando entrego un simulacro en blanco
    Entonces aparece el mazo "Falladas: <examen>" con una tarjeta por pregunta
    Y un error de la consola explicado por el profesor se guarda en "Errores de Python"

  Escenario: AC-60 Anki y respaldo
    Cuando importo un archivo "Notas en texto plano" de Anki
    Entonces se crea un mazo con sus tarjetas, y puedo exportarlo igual
    Y en Ajustes creo un respaldo y restauro uno después de confirmar
