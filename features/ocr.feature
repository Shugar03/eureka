# language: es
Característica: PDFs escaneados y fotos leídos en esta PC
  Como estudiante con fotocopias escaneadas y fotos de apuntes impresos
  Quiero que Eureka los lea en mi PC, sin internet ni tokens
  Para buscarlos y estudiarlos como cualquier otro libro

  @AC-187
  Escenario: Un PDF escaneado corto se lee solo
    Cuando agrego "fotocopia-celula.pdf" (3 páginas sin texto) a la biblioteca
    Entonces el libro queda en la biblioteca con las primeras páginas y dice "Leído con OCR: puede tener errores"
    Y el resto se lee en segundo plano hasta "terminé de leerlo con OCR."
    Y la página con líneas dudosas dice "revisar"
    Y buscar "ribosoma proteínas" cita "p. 3"

  @AC-187
  Escenario: Con más de 10 páginas escaneadas, primero la estimación
    Cuando agrego "fotocopia-larga.pdf" (12 páginas sin texto)
    Entonces veo "Son 12 páginas escaneadas: leerlas lleva …" y no empieza hasta que toco "Leer con OCR"
    Y veo "Leyendo página N de 12 · faltan …" con una barra y "Cancelar"

  @AC-187
  Escenario: Cancelar y seguir donde quedó
    Dado que cancelé la lectura de "fotocopia-larga.pdf"
    Entonces el libro dice cuántas páginas faltan
    Cuando agrego el mismo PDF otra vez
    Entonces sigue en el mismo libro sin releer lo leído, y la biblioteca tiene un solo libro

  @AC-187
  Escenario: El «+» del chat también lee un PDF escaneado
    Cuando adjunto "fotocopia-celula.pdf" en el chat
    Entonces el adjunto dice "en tu biblioteca · leyendo con OCR"

  @AC-187
  Escenario: Sin OCR (como en el celular)
    Cuando agrego un PDF sin texto en una versión sin OCR
    Entonces veo que "parece escaneado"

  @AC-188
  Escenario: Una foto de texto impreso no gasta el modelo de visión
    Cuando adjunto una foto de apuntes impresos en el chat
    Y el OCR la lee con confianza media de 0,9 o más y al menos 20 letras
    Entonces el adjunto dice "texto leído en esta PC" y no se llama al modelo de visión

  @AC-188
  Escenario: Si el OCR duda, la lee el modelo de visión
    Cuando adjunto una foto que el OCR lee con poca confianza (manuscrito, diagrama, borrosa)
    Entonces la lee el modelo de visión como antes y el adjunto dice "texto leído de la imagen"
