# language: es
# Cubre: NF-06 (accesibilidad), NF-08 (WCAG AA), NF-10 (estabilidad visual)
# Automatización: tests/e2e/a11y.e2e.ts, tests/e2e/visual.e2e.ts

Característica: Calidad de interfaz
  Para que la app sea usable con lector de pantalla y teclado, legible en ambos temas,
  y para que un cambio visual no pase desapercibido

  @NF-08
  Esquema del escenario: Cada pantalla cumple WCAG 2.1 AA
    Dado el tema "<tema>"
    Cuando axe-core audita <pantalla>
    Entonces no hay ninguna violación

    Ejemplos:
      | tema   | pantalla                                         |
      | oscuro | inicio, ajustes (modelos y prompts), paleta        |
      | oscuro | pregunta abierta, pregunta con opciones, plan, inicio con sesiones |
      | claro  | inicio, ajustes (modelos y prompts), paleta        |
      | claro  | pregunta abierta, pregunta con opciones, plan, inicio con sesiones |
      | oscuro | error del proveedor                              |

  @NF-10
  Esquema del escenario: Las pantallas no cambian sin querer
    Dado el tema "<tema>"
    Entonces <pantalla> coincide con su captura de referencia (≤ 1% de píxeles distintos)

    Ejemplos:
      | tema   | pantalla                          |
      | oscuro | inicio, sesión enseñando, plan, ajustes, paleta |
      | claro  | inicio, sesión enseñando, plan, ajustes, paleta |
      | oscuro | pregunta respondida, pregunta con opciones      |
