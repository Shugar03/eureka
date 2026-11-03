# language: es
Característica: Biblioteca local de bibliografía
  Como estudiante con PDFs y apuntes para estudiar
  Quiero que la app los digiera en mi PC y los deje buscables
  Para que el profesor responda con mi bibliografía y la cite antes que la web

  @AC-69
  Escenario: Agregar un PDF
    Cuando agrego "apuntes-fisica.pdf" a la biblioteca
    Entonces veo "quedó en la biblioteca (3 secciones"
    Y el índice tiene "Capítulo 1: Energía", "1.1 Trabajo" y "Capítulo 2: Calor" con sus páginas
    Y el lector no muestra el encabezado repetido ni los números de página
    Y las palabras cortadas con guion están unidas

  @AC-69
  Escenario: Un PDF escaneado no entra
    Cuando agrego un PDF sin texto
    Entonces veo que "parece escaneado"

  @AC-70
  Escenario: Buscar en la biblioteca
    Dado que la biblioteca tiene "apuntes-fisica.pdf"
    Cuando busco "temperatura del calor"
    Entonces el primer resultado es "Capítulo 2: Calor · p. 3"
    Y al tocarlo se abre esa sección

  @AC-71
  Escenario: Estudiar una sección de un .txt
    Dado que agregué "resumen-historia.txt"
    Cuando abro "CAPÍTULO 2 La Independencia" y toco "Estudiar esta sección"
    Entonces se abre una sesión "Entender «CAPÍTULO 2 La Independencia» del libro «resumen historia»"

  @AC-72
  Escenario: El profesor cita la bibliografía
    Dado que la biblioteca tiene un libro sobre derivadas
    Cuando el profesor busca "pendiente tangente" en la biblioteca
    Entonces recibe fragmentos numerados [L1] con libro, sección y página
    Y en el chat la cita [L1] se ve como el libro, la sección y la página
    Y un número que la biblioteca no devolvió se ve como "[cita no verificada]"

  @NF-22
  Escenario: Medir un libro de 28 páginas
    Cuando agrego "libro-editorial.pdf"
    Entonces se indexa en segundos con "0 tokens del modelo"
    Y en el benchmark la sección correcta está en el top 4 en al menos el 80 % de las paráfrasis
