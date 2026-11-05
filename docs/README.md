# Documentación de Eureka

Elegí según lo que vengas a hacer. Si algo de acá no coincide con lo que hace la app, es un bug de la documentación: abrí un *issue*.

## Para usar Eureka

| Doc | Qué vas a encontrar |
|---|---|
| [README](../README.md) | Qué es, qué trae, cómo instalarlo y cómo elegir modelos |
| [distribucion.md](distribucion.md) | Instalar, actualizaciones automáticas, el aviso de SmartScreen |
| [claude-proxy-recipe.md](claude-proxy-recipe.md) | Usar Claude a través de un proxy local |
| [acompanamiento.md](acompanamiento.md) | El modo Acompañamiento: qué hace y sus límites |
| [CHANGELOG](../CHANGELOG.md) | Qué cambió en cada versión |

## Para contribuir

| Doc | Qué vas a encontrar |
|---|---|
| [CONTRIBUTING](../CONTRIBUTING.md) | Preparar el entorno, el flujo de trabajo y qué tiene que traer un PR |
| [spec.md](spec.md) | **Qué** hace el sistema: criterios de aceptación (AC-n) y trazabilidad |
| [design.md](design.md) | **Cómo** lo hace: arquitectura, loop del agente, datos e IPC |
| [tasks.md](tasks.md) | El orden de trabajo y lo pendiente |
| [testing.md](testing.md) | Todas las capas de pruebas y cómo correrlas |
| [../features/](../features) | Escenarios BDD en español, uno por área |
| [SECURITY](../SECURITY.md) | Cómo reportar una vulnerabilidad |

## Decisiones y mediciones

| Doc | Qué vas a encontrar |
|---|---|
| [marco-pedagogico.md](marco-pedagogico.md) | Los principios con evidencia contra los que se revisa cada función |
| [agente-paridad.md](agente-paridad.md) | Todo lo que hace la interfaz lo puede hacer el agente |
| [auditoria-harness.md](auditoria-harness.md) | Auditoría de memoria, contexto y herramientas del agente |
| [tokens.md](tokens.md) | Cuántos tokens manda Eureka por fase y qué se optimizó |
| [metricas-biblioteca.md](metricas-biblioteca.md) | Cómo se mide la biblioteca (velocidad y acierto de la búsqueda) |
| [citas.md](citas.md) | El banco de citas de la bienvenida |

## Planes (todavía no implementados)

| Doc | Estado |
|---|---|
| [plan-embeddings-estaticos.md](plan-embeddings-estaticos.md) | Experimento planificado: búsqueda por significado sin red |
| [plan-memoria-estudiante.md](plan-memoria-estudiante.md) | Decidido: memoria con temas estables y exportación OKF |

## Cómo se mantiene al día

- Un cambio de comportamiento entra con su criterio en `spec.md`, su escenario en `features/` y su prueba (ver [CONTRIBUTING](../CONTRIBUTING.md)).
- Cada versión suma su entrada al [CHANGELOG](../CHANGELOG.md) antes de publicarse.
- Los planes pasan a `design.md` cuando se implementan, y su archivo se borra o se marca como hecho.
