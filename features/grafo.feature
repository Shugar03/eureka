# language: es
# Cubre: AC-17 … AC-21, NF-11, NF-12 (docs/spec.md, Fase 2), AC-170
# Automatización: tests/e2e/grafo.e2e.ts (web) y tests/desktop/grafo.e2e.ts (app real)

Característica: Grafo de conocimiento
  Como aprendiz
  Quiero que lo que entendí quede guardado como ideas y razonamientos conectados
  Para que las próximas sesiones partan de ahí y yo pueda ver cómo encaja todo

  @AC-17
  Escenario: Terminar una sesión la guarda en el grafo
    Dado que terminé la sesión "qué es una derivada"
    Entonces la sesión muestra "Guardado en el grafo" con la cantidad de ideas y cadenas
    Y la pantalla Grafo muestra la proposición "La derivada es la pendiente de la recta tangente"

  @AC-17 @NF-12
  Escenario: Volver a extraer no duplica
    Dado que la sesión ya está en el grafo
    Cuando presiono "Volver a extraer"
    Entonces el grafo tiene la misma cantidad de ideas

  @AC-18
  Escenario: La misma idea de dos fuentes es un solo nodo
    Dado que la sesión aportó "La pendiente mide cuánto sube una recta por cada paso"
    Cuando importo notas con "la pendiente mide cuanto sube una recta por cada paso."
    Entonces hay un solo nodo con esa idea y dos fuentes

  @AC-19
  Escenario: Ver una idea y sus razonamientos
    Dado que el grafo tiene ideas
    Cuando elijo "La derivada es la pendiente de la recta tangente"
    Entonces veo su fuente "qué es una derivada" y la cadena que la concluye
    Cuando presiono la fuente
    Entonces se abre esa sesión

  @AC-19
  Escenario: Filtrar el grafo
    Cuando filtro por "tangente"
    Entonces solo quedan las ideas que mencionan "tangente"

  @AC-19
  Escenario: Grafo vacío
    Dado que todavía no hay nada en el grafo
    Entonces la pantalla explica que se llena al terminar sesiones o importar notas

  @AC-20
  Escenario: El profesor no reenseña lo que ya está en el grafo
    Dado que el grafo tiene ideas sobre la derivada
    Cuando empiezo una sesión "derivada de x al cubo"
    Entonces el bloque de estado que recibe el profesor incluye esas ideas como "ya en el grafo"

  @AC-21
  Escenario: Importar notas
    Cuando importo notas "Apuntes de física" con un texto
    Entonces aparecen sus ideas con la fuente "notas: Apuntes de física"

  @AC-67
  Escenario: Olvidar una fuente
    Dado que terminé la sesión "qué es una derivada"
    Cuando abro una de sus ideas en el grafo
    Y toco "Olvidar esta fuente" y confirmo
    Entonces sus ideas salen del grafo

  @AC-68
  Escenario: Guardar lo aprendido antes de terminar
    Dado una sesión con al menos un nodo entendido
    Cuando toco "Guardar lo aprendido hasta acá"
    Entonces veo "Guardado · 4 ideas"
    Y el grafo tiene esas ideas

  @NF-11
  Escenario: Una extracción fallida no rompe el grafo
    Dado que el extractor falla
    Cuando termino una sesión
    Entonces veo el error con "Reintentar"
    Y el grafo queda como estaba

  @AC-170
  Escenario: Ver el grafo por profundidad de razonamiento
    Dado que terminé la sesión "qué es una derivada"
    Cuando abro el grafo
    Entonces la vista es "Por profundidad"
    Y "La pendiente mide cuánto sube…" dice "base" y está más abajo que "La derivada es la pendiente…", que dice "nivel 2"
    Cuando elijo "Libre"
    Entonces las ideas ya no muestran su nivel

  @AC-170
  Escenario: Ver dónde apareció una idea
    Dado que terminé la sesión "qué es una derivada"
    Cuando elijo "La derivada es la pendiente de la recta tangente" en el grafo y toco "Ver dónde apareció"
    Entonces se abre la sesión con el mensaje marcado y el aviso "Marcado el mensaje donde apareció"

  # AC-176
  Escenario: El grafo como neuronas
    Dado que tengo ideas en el grafo
    Cuando abro el grafo
    Entonces veo cada idea como un punto que brilla, más grande cuanto más se conecta
    Cuando elijo una idea
    Entonces se encienden sus conexiones, se apaga el resto y veo su detalle
