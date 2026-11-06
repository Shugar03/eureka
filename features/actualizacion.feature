# language: es
# Cubre: AC-202, AC-203 (docs/spec.md)
# Automatización: tests/e2e/actualizacion.e2e.ts; AC-203 en src-tauri/src/agent_tests.rs

Característica: Actualizar Eureka sin salir de Eureka
  Como aprendiz que usa Eureka todos los días
  Quiero que las versiones nuevas lleguen solas y se vean bien
  Para no pelearme con instaladores ni con errores del proveedor

  @AC-202
  Escenario: La actualización se baja dentro de Eureka
    Dado que hay una versión nueva de Eureka
    Cuando toco «Actualizar ahora»
    Entonces veo una barra con los MB descargados, sin ventana de instalador
    Y después «Instalando…», y Eureka se vuelve a abrir sola

  @AC-202
  Escenario: Las novedades aparecen una vez al abrir la versión nueva
    Dado que Eureka se acaba de actualizar
    Cuando se abre
    Entonces veo «Novedades de Eureka» con lo que trae y la versión que tenía antes
    Y al tocar «Listo» no vuelve a aparecer

  @AC-203
  Escenario: Un proveedor saturado no traba la sesión
    Dado que el proveedor contesta «overloaded» para esta conversación
    Cuando el profesor responde
    Entonces Eureka reintenta por otro camino y la respuesta llega
    Y si sigue saturado después de tres intentos, el error lo dice y propone qué hacer
