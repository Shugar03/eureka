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
  Escenario: Sin OCR (como en el celular) un PDF escaneado no entra
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

  @AC-189
  Escenario: El profesor reformula una vez antes de decir que no está
    Dado que la biblioteca tiene un libro sobre derivadas
    Cuando el profesor busca "derivada polinomio cociente exponente" y el mejor fragmento comparte una sola palabra
    Entonces el resultado le pide buscar una vez más con sinónimos o como lo diría un libro
    Y si la segunda búsqueda del mismo turno no encuentra nada o es toda débil, el resultado le dice que lo diga y use research
    Y si la segunda búsqueda solo coincide en parte, no le dice que se rinda
    Y una búsqueda que encuentra bien no agrega ningún aviso

  @AC-190
  Escenario: Agregar un libro no rearma toda la biblioteca
    Dado que la biblioteca tiene 50 libros y ya se buscó una vez
    Cuando agrego un libro, el OCR le suma páginas a otro y quito un tercero
    Entonces cada cambio actualiza solo ese libro en el índice
    Y buscar da lo mismo que con el índice rearmado entero
    Y después de restaurar un respaldo, la búsqueda siguiente rearma el índice

  @AC-191
  Escenario: Word, PowerPoint y EPUB entran con sus títulos como secciones
    Cuando agrego "apuntes-volcanes.docx" a la biblioteca
    Entonces veo "quedó en la biblioteca (3 secciones"
    Y el índice tiene "El cono de Tamberías"
    Cuando agrego "clase-volcanes.pptx"
    Entonces cada diapositiva es una sección y "La regla del semáforo" muestra "Rojo: evacuar"
    Cuando agrego "libro-volcanes.epub" y busco "cámara magmática"
    Entonces el primer resultado es "1.1 La cámara"

  @AC-191
  Escenario: El «+» del chat también acepta una presentación
    Cuando adjunto "clase-volcanes.pptx" con el «+» del chat
    Entonces queda "en tu biblioteca"

  @AC-205
  Escenario: El profesor lee la página del fragmento que encontró
    Dado un PDF escaneado sin títulos en mi biblioteca
    Cuando el profesor lee un fragmento de la página 16
    Entonces recibe el texto desde la página 16, no desde el principio del libro

