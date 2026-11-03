# language: es
# Cubre: invariantes de dominio y de layout (AC-02…AC-08, AC-14, AC-15, NF-04, NF-09)
# Automatización: tests/e2e/walk.ts → tests/e2e/caminos.e2e.ts (web) y tests/desktop/caminos.e2e.ts (app real)

Característica: Caminos aleatorios con semilla
  Para encontrar combinaciones de uso que nadie escribió a mano

  Esquema del escenario: Un camino aleatorio respeta las invariantes
    Dada la semilla <semilla>
    Cuando fast-check genera 18 acciones entre: responder (cualquier opción y confianza), mensaje libre,
      salir y reabrir la sesión, cambiar el tema, abrir y cerrar la paleta, ir a Ajustes y volver
    Entonces después de CADA acción:
      | invariante                                                  |
      | hay a lo sumo una pregunta pendiente                        |
      | hay exactamente una fase actual                             |
      | hay a lo sumo un nodo "ahora" y todos los estados son válidos |
      | no hay hallazgos duplicados                                 |
      | no hay errores en pantalla                                  |
      | el composer coincide con si hay una pregunta pendiente      |
      | no aparecen caracteres corruptos (U+FFFD)                   |
      | el shell no se desplaza y el encabezado sigue en pantalla   |
      | reabrir una sesión conserva su pregunta pendiente           |

    Ejemplos:
      | semilla |
      | 101     |
      | 202     |
      | 303     |
      | 404     |
      | 505     |
      | 707     |
      | 808     |

  # Reproducir un fallo: $env:WALK_SEEDS="<semilla>"; npx e2e run tests/e2e/caminos.e2e.ts --headed
