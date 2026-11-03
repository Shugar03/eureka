# language: es
# Cubre: AC-53 … AC-55, NF-16 (docs/spec.md, Fase 7)
# Automatización: tests/e2e/codigo.e2e.ts (web, intérprete simulado) y src-tauri/src/runner.rs (intérpretes reales)

Característica: Aprender a programar con una consola
  Como aprendiz de Python, JavaScript, TypeScript y Rust
  Quiero escribir, ejecutar y depurar código sin salir de la app
  Para practicar lo que aprendo y entender mis errores

  Escenario: AC-53 Ejecutar y leer la salida
    Cuando escribo un programa que imprime "hola mundo" y lo ejecuto
    Entonces veo "hola mundo" y que terminó bien
    Cuando divido por cero en la línea 2
    Entonces veo el error y que apunta a la línea 2, marcada en el editor
    Y si el programa lee la entrada, uso lo que escribí en "Entrada (stdin)"
    Y un bucle infinito se corta por tiempo

  Escenario: AC-53 Compilar, tipos e intérpretes
    Cuando ejecuto Rust que no compila
    Entonces veo "No compila" con el error de rustc
    Cuando ejecuto TypeScript con un error de tipos
    Entonces veo el error de tipos con su línea y columna
    Y si un lenguaje no está instalado, no puedo ejecutarlo y me dice que falta

  Escenario: AC-54 Explicar este error
    Dado un error al ejecutar
    Cuando elijo "Explicar este error"
    Entonces el profesor me explica qué dice, dónde está y por qué

  Escenario: AC-55 Ejercicio con pruebas ocultas
    Cuando pido un ejercicio de "listas"
    Entonces veo la consigna y el código inicial
    Y "Probar" me dice si pasa las pruebas, con pistas y la solución si las pido

  Escenario: AC-58 Revisar mi código
    Cuando pido revisar mi código con foco en "estilo"
    Entonces veo hallazgos por línea con su etiqueta y un ejercicio

  Escenario: AC-61 Ruta de programación
    Cuando armo una ruta de Rust de nivel medio
    Entonces veo sus módulos, y cada tema tiene Estudiar y Ejercicio
    Y un ejercicio aprobado se cuenta en su tema

  Escenario: AC-64 Proyecto de varios archivos
    Cuando creo un proyecto desde la plantilla y pruebo
    Entonces pasan los tests; un proyecto guiado empieza fallando hasta que lo arreglo
    Y un archivo con ruta insegura se rechaza

  # AC-171, AC-172
  Escenario: Programar en C, C++, Java, C#, Go o SQL
    Dado que abro Código
    Cuando elijo "C++", "Java", "Go" o "C#"
    Entonces veo el compilador que encontró en mi PC
    Y si no está instalado me dice cómo instalarlo y no puedo ejecutar
    Cuando elijo "SQL"
    Entonces funciona sin instalar nada y las consultas salen como tabla

  Escenario: Un ejercicio de Java con sus pruebas
    Dado un ejercicio de Java con pruebas ocultas
    Cuando escribo la solución y toco "Probar"
    Entonces las pruebas corren antes que mi clase y me dice si pasó
    Y si no compila, me marca la línea de mi código, no la de las pruebas

  Escenario: Un proyecto de C con pruebas
    Dado un proyecto de C desde la plantilla
    Cuando toco "Probar"
    Entonces se compilan los test_*.c sin main.c y veo qué prueba falló
