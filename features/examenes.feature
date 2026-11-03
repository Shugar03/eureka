# language: es
# Cubre: AC-32 … AC-46, NF-15 (docs/spec.md, Fase 5)
# Automatización: tests/e2e/examenes.e2e.ts (web)

Característica: Preparar un examen o certificación
  Como aprendiz que va a rendir una certificación (AWS, Google Cloud, Oracle, IBM, inglés…)
  Quiero convertir la guía oficial del examen en una ruta de estudio y medirme con simulacros
  Para llegar al examen sabiendo qué domino y qué me falta

  Escenario: AC-32 La guía oficial se convierte en dominios con peso y temas
    Dado que estoy en la pantalla "Exámenes"
    Cuando creo el examen "AWS Cloud Practitioner" pegando su guía oficial
    Entonces veo sus dominios ordenados por peso, con el porcentaje de cada uno
    Y cada dominio lista sus temas con sus objetivos

  Escenario: AC-33 AC-34 Estudiar un tema abre una sesión vinculada al examen
    Dado un examen con su ruta de estudio
    Cuando elijo "Estudiar" en un tema
    Entonces se abre una sesión cuyo objetivo es ese tema
    Y al volver al examen el tema figura "En curso"
    Y elegir "Continuar" retoma la misma sesión

  Escenario: AC-35 AC-36 Un simulacro se corrige sin modelo y señala el dominio más flojo
    Dado un examen con su ruta de estudio
    Cuando genero un simulacro de 10 preguntas
    Y respondo todas y lo entrego
    Entonces veo el puntaje total y el de cada dominio
    Y cada pregunta muestra la respuesta correcta y su explicación
    Y se me recomienda repasar los temas del dominio más flojo

  Escenario: AC-37 La guía se importa desde un PDF
    Dado que estoy en la pantalla "Exámenes"
    Cuando cargo el PDF de la guía oficial
    Entonces el campo de la guía muestra su texto, con dominios, temas y objetivos
    Y al armar la ruta veo los dominios del PDF

  Escenario: AC-38 La guía oficial se busca en la web por el nombre del examen
    Dado que la búsqueda web está configurada
    Cuando escribo el nombre del examen y elijo "Buscar la guía en la web"
    Entonces el campo de la guía se llena con el temario oficial
    Y veo las fuentes de donde salió, como enlaces

  Escenario: AC-38 Sin búsqueda configurada
    Dado que la búsqueda web no está configurada
    Y que ya escribí algo en el campo de la guía
    Cuando elijo "Buscar la guía en la web"
    Entonces veo un aviso que me manda a Ajustes → Búsqueda web
    Y mi texto sigue en el campo

  Escenario: AC-39 Simulacro con tiempo límite, como el examen real
    Dado un examen con su ruta de estudio
    Cuando genero un simulacro "Con tiempo" de pocos minutos
    Entonces veo el reloj con el tiempo restante y los números de las preguntas
    Y puedo marcar una pregunta para revisar y verla marcada en la navegación
    Y cuando el reloj llega a cero el simulacro se entrega solo con lo que respondí
    Y el resultado muestra el tiempo usado

  Escenario: AC-39 Las respuestas sin entregar no se pierden
    Dado un simulacro empezado y sin entregar
    Cuando salgo al examen y vuelvo a abrirlo
    Entonces mis respuestas siguen marcadas

  Escenario: AC-40 Repaso de falladas hasta dominarlas
    Dado que entregué un simulacro con 3 preguntas falladas
    Cuando las repaso y acierto las 3
    Entonces siguen en el repaso, porque hace falta acertarlas 2 veces seguidas
    Cuando las repaso de nuevo, acierto 2 y fallo 1
    Entonces las 2 acertadas salen del repaso
    Y la fallada vuelve a empezar su cuenta, con un enlace para estudiar su tema

  Escenario: AC-41 Preguntas de respuesta múltiple
    Dado un simulacro con una pregunta de "Elegí 2"
    Cuando marco 2 casillas
    Entonces no puedo marcar una tercera
    Y la pregunta cuenta como correcta solo si elegí las 2 correctas

  Escenario: AC-42 Meta, evolución y "¿Estoy listo?"
    Dado un examen con nota para aprobar 70% y fecha
    Cuando hago un simulacro y saco 70%
    Entonces veo cuántos días faltan
    Y el gráfico de evolución con la línea de aprobación
    Y "¿Estoy listo? Cerca", con los dominios por debajo de la nota

  Escenario: AC-43 Simulacro dirigido
    Dado un examen con un simulacro completo donde fallé "Seguridad y cumplimiento"
    Cuando genero un simulacro de "Mi dominio más flojo"
    Entonces todas sus preguntas son de "Seguridad y cumplimiento"
    Y queda rotulado como dirigido y no cambia mi evolución

  Escenario: AC-44 Hoja de repaso final
    Dado un examen con preguntas falladas
    Cuando genero la hoja de repaso
    Entonces veo una sección por dominio, de mayor a menor peso
    Y una sección de trampas frecuentes con lo que vengo fallando
    Y puedo descargarla o imprimirla

  Escenario: AC-45 "¿Por qué no la B?"
    Dado una pregunta corregida que respondí mal
    Cuando elijo "Preguntar al profesor"
    Entonces la duda viene precargada con la letra que elegí
    Y el profesor responde en un hilo donde puedo seguir preguntando

  Escenario: AC-46 Verificación y reporte de preguntas
    Dado que el verificador no coincide con la clave de una pregunta
    Cuando genero el simulacro
    Entonces esa pregunta se descarta y se me avisa
    Cuando reporto otra pregunta como mal hecha
    Entonces el puntaje se recalcula sin ella y sale del repaso

  Escenario: NF-15 Una guía sin contenido útil no crea un examen
    Dado que estoy en la pantalla "Exámenes"
    Cuando creo un examen con una guía que no tiene dominios reconocibles
    Entonces veo un error que lo explica
    Y no se agrega ningún examen a la lista

  Escenario: AC-63 Guía desde una foto o un PDF escaneado
    Cuando cargo una foto de la guía o un PDF sin texto
    Entonces el modelo la transcribe y la guía queda lista para revisar
