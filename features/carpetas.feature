# language: es
Característica: Carpetas de trabajo
  El profesor puede trabajar sobre carpetas de mi PC que yo elijo: mirarlas,
  ordenarlas y crear documentos adentro, siempre con un plan que yo aplico.

  @AC-219
  Escenario: Compartir una carpeta
    Cuando toco "Compartir una carpeta" y elijo mi carpeta de apuntes
    Entonces la caja del mensaje dice "Te compartí la carpeta «Apuntes»."
    Y en Ajustes → Carpetas la veo con su permiso, que puedo cambiar a "Solo leer"
    Y el profesor no puede llegar a nada fuera de esa carpeta ni leer archivos ocultos o secretos

  @AC-220
  Escenario: Ordenar mis apuntes
    Dado que compartí mi carpeta de apuntes
    Cuando le pido "ordená mis apuntes"
    Entonces el profesor mira la carpeta y me muestra un plan por tipo de cambio
    Y nada cambia hasta que toco "Aplicar"
    Cuando toco "Deshacer"
    Entonces la carpeta queda exactamente como estaba

  @AC-221 @AC-222
  Escenario: Crear un Excel o un Word
    Cuando le pido "armame un Excel con mis notas y el promedio"
    Entonces me propone crear el archivo en la carpeta, con encabezado, filtro y fórmulas
    Y lo crea recién cuando aplico el plan
