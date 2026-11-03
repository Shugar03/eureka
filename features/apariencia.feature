# language: es
# Cubre: AC-14 (docs/spec.md)
# Automatización: tests/e2e/apariencia.e2e.ts

Característica: Tema oscuro
  Como aprendiz
  Quiero la interfaz en modo oscuro por defecto y poder cambiarla
  Para estudiar cómodo a cualquier hora

  @AC-14
  Escenario: La app arranca en modo oscuro aunque el sistema esté en claro
    Dado que el sistema operativo usa tema claro
    Cuando abro la app por primera vez
    Entonces la interfaz está en modo oscuro

  @AC-14
  Escenario: Cambiar el tema se recuerda
    Cuando elijo "Tema claro" en la barra lateral
    Entonces la interfaz pasa a modo claro
    Cuando recargo la app
    Entonces sigue en modo claro
    Cuando elijo "Tema oscuro"
    Entonces vuelve a modo oscuro
