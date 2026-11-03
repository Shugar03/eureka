# language: es
# Cubre: AC-09, AC-10, AC-11, AC-12 (docs/spec.md)
# Automatización: tests/e2e/ajustes.e2e.ts

Característica: Configurar modelos, keys y prompts
  Como aprendiz que usa sus propias API keys
  Quiero elegir proveedor y modelo por rol y editar los prompts
  Para controlar calidad, costo y comportamiento del agente

  @AC-10
  Escenario: Sin configuración el inicio avisa y lleva a Ajustes
    Dado que no hay modelo ni API key configurados
    Cuando abro la app
    Entonces veo el aviso "Para empezar, configurá un proveedor"
    Cuando presiono "Ir a Ajustes"
    Entonces veo la pantalla "Ajustes"

  @AC-09
  Escenario: Guardar una API key nunca la vuelve a mostrar
    Dado que estoy en Ajustes sin configuración
    Cuando escribo una API key para "OpenRouter" y guardo
    Entonces veo "Guardado."
    Y el campo de la key queda vacío con el texto "•••••• guardada"

  @AC-09
  Escenario: Elegir modelo del profesor desde la lista del proveedor
    Dado que "OpenRouter" tiene una API key guardada
    Cuando elijo "OpenRouter" como proveedor del Profesor y presiono "Listar modelos"
    Entonces veo "3 modelos encontrados."
    Cuando escribo "demo/profesor" como modelo del Profesor y guardo
    Entonces al volver al inicio ya no aparece el aviso de configuración

  @AC-12
  Escenario: Editar y restaurar un prompt
    Dado que estoy en la pestaña "Prompts"
    Cuando cambio el prompt "Fase Enseñar" y guardo
    Entonces aparece el botón "Restaurar original"
    Cuando presiono "Restaurar original"
    Entonces veo "Restaurado al original."

  @AC-11
  Escenario: Un error del proveedor se muestra con salida
    Dado que el proveedor falla por falta de API key
    Cuando empiezo una sesión
    Entonces veo el error "Falta la API key"
    Y puedo presionar "Abrir ajustes"

  @NF-21
  Escenario: Guardar el tamaño de contexto del profesor
    Cuando pongo 200 en "Contexto del modelo" del Profesor y guardo
    Entonces al volver a Ajustes sigue en 200

  @AC-134
  Escenario: Elegir servicio, clave y modelo en un solo lugar
    Cuando abro Ajustes
    Entonces estoy en "Conexión" con servicio, clave de acceso y modelo
    Cuando elijo un servicio, pego la clave, escribo un modelo y guardo
    Entonces veo "Conectado: <servicio> · <modelo>"
    Y los modelos por tarea siguen en "Avanzado"

