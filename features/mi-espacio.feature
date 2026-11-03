# language: es
Característica: Mi espacio
  Como estudiante que necesita sentirse tranquilo y en un lugar propio
  Quiero elegir el fondo, el color y cómo me saluda la app
  Para que sea mi espacio, pensado para mí

  @AC-78
  Escenario: Elegir un fondo sugiere su color
    Dado que abro "Mi espacio" desde la barra lateral
    Cuando elijo el fondo "Atardecer"
    Entonces veo "Este fondo se ve sobre todo rojo"
    Y toda la app toma ese acento

  @AC-79
  Escenario: Una imagen propia
    Cuando elijo una imagen mía, mayormente roja con un poco de azul
    Entonces la imagen queda de fondo
    Y se sugiere el rojo, y el azul queda como otra opción

  @AC-80
  Escenario: Elegir otro color
    Dado que elegí un color propio
    Cuando cambio de fondo
    Entonces mi color se mantiene
    Y al marcar "Tomar el color del fondo" el acento vuelve a seguir al fondo

  @AC-81
  Escenario: Es mío y se recuerda
    Cuando escribo mi nombre, elijo un fondo y el tema claro
    Y vuelvo a abrir la app
    Entonces el inicio me saluda por mi nombre y conserva mi fondo y mi color
