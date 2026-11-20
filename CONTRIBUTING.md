# Contribuir a Eureka

¡Gracias por sumarte! Esta guía cuenta cómo preparar el entorno, cómo se trabaja y qué tiene que traer un *pull request* para entrar.

## Antes de empezar

- **Bugs:** abrí un *issue* con la plantilla «Algo anda mal». Si es de seguridad, seguí [SECURITY.md](SECURITY.md) en vez de abrir un *issue* público.
- **Ideas:** abrí un *issue* con la plantilla «Una idea» antes de escribir código, así charlamos el criterio de aceptación primero. Ahorra trabajo de los dos.
- **Cambios chicos** (un texto, un typo, un estilo): mandá el PR directo.

## Preparar el entorno

**Escritorio (Windows):** [Rust](https://rustup.rs) estable con MSVC, [Node](https://nodejs.org) 22.22+ o 24.8+ y `curl`. Hoy la app de escritorio se prueba en CI y se publica solo para Windows.

```bash
git clone https://github.com/Shugar03/eureka.git
cd eureka
npm install
npm run app
```

`npm run app` abre la app de escritorio con recarga en vivo. La primera compilación de Rust tarda varios minutos y baja los modelos de OCR (~18 MB, ver `src-tauri/build.rs`). Sin internet, poné los `.onnx` en una carpeta y apuntá `EUREKA_OCR_MODELS_FROM` ahí.

**Linux y macOS:** los builds nativos todavía no están soportados. El backend Rust falla al enlazar: `parakeet-rs` activa `directml` en todos los targets de escritorio, pero ONNX Runtime (`ort`) solo ofrece los binarios precompilados correspondientes para Windows. La corrección está pendiente. Podés trabajar en el frontend con Node y correr `npm run typecheck`, `npm run test:unit` (Vitest), `npm run test:scripts` y `npm run check:repo`, sin compilar Rust.

Para trabajar solo en la interfaz, `npm run dev:e2e` levanta una **demo en el navegador** en http://localhost:1430 con un backend simulado y un profesor con guion (`src/e2e/`): no necesita modelos ni secretos, ni gasta tokens. También funciona en Linux y macOS. `npm run dev` (puerto 1420) solo sirve el frontend de Tauri y no tiene backend en un navegador.

**Android:** hay rutas específicas con `cfg(target_os = "android")` y un proyecto en `src-tauri/gen/android`, pero es experimental, no se publica ni se compila en CI; el build no está verificado por esa vía. Ver los comandos y requisitos en [README](README.md#android-en-preparación). **iOS no está soportado:** no hay un proyecto `src-tauri/gen/apple`.

## Cómo se trabaja: spec, escenario, prueba, código

Eureka sigue **SDD + BDD + TDD**. Un cambio de comportamiento trae, en este orden:

1. **El criterio de aceptación** en [docs/spec.md](docs/spec.md), con el número libre siguiente (`AC-n`). Dice qué tiene que pasar, no cómo.
2. **El escenario** en el `.feature` del área, en [features/](features), en español.
3. **Las pruebas** que lo verifican: unitarias (Rust o Vitest) y, si se ve en la interfaz, un e2e en `tests/e2e/` cuyo nombre empieza con el `AC-n`.
4. **El código.**
5. **La fila de trazabilidad** en `spec.md`: qué pruebas cubren el criterio.

Los detalles de cada capa de pruebas están en [docs/testing.md](docs/testing.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Tipos + Vitest + tests de los scripts + `cargo test` (en Windows; incluye Rust) |
| `npm run test:e2e` | E2E web en un navegador visible, contra la demo |
| `npm run build:debug` y `npm run test:e2e:desktop` | E2E sobre la app real con un proveedor falso, solo en Windows (WebView2 por CDP; `e2e.desktop.config.ts`) |
| `npm run test:visual:update` | Regenera las capturas después de un cambio de diseño buscado |
| `npm run bench:library` | Benchmark de la biblioteca (velocidad y acierto) |
| `npm run check:repo` | Higiene del repo: secretos, nombre prohibido, trazabilidad de los `AC-n` y links rotos |

**CI:** los jobs de tipos, Vitest, tests de scripts, `cargo test --lib` y e2e web (opcional) corren en Windows; la detección de cambios y los chequeos de higiene y docs corren en Ubuntu. Los PR que solo cambian documentación saltean Rust, Vitest y e2e (detalle en [docs/testing.md](docs/testing.md#integración-continua)). Antes de mandarlo, corré `npm run typecheck`, `npm run test:unit`, `npm run test:scripts` y `npm run check:repo`; en Windows, también `npm run test:rust`.

Ninguna prueba llama a un modelo real. Si un cambio toca prompts o herramientas del agente, corré el test `token_budget` (`cargo test token_budget`): falla si una fase empieza a mandar más tokens. Si el aumento está justificado, actualizá la línea base con `TOKEN_BASELINE_UPDATE=1` y explicalo en el PR.

## Estilo

- **Textos de la interfaz en español rioplatense** («tenés», «elegí»), cortos y sin culpa. Nada de «Error:» frío: decí qué pasó y qué puede hacer la persona.
- **Comentarios del código en inglés**, explicando el porqué, no el qué.
- **No hay formateador automático:** no corras Prettier sobre archivos enteros, porque reformatea todo y ensucia el diff. Seguí el estilo del archivo que tocás.
- **Accesibilidad:** cada control tiene nombre accesible (`aria-label` o texto visible). Los e2e buscan por rol y nombre, y `tests/e2e/a11y.e2e.ts` corre axe.
- **Lo que hace la interfaz lo tiene que poder hacer el agente** ([docs/agente-paridad.md](docs/agente-paridad.md)).

## Commits y pull requests

- Mensajes de commit en español, en presente y diciendo qué cambia para quien usa la app. Con el criterio entre paréntesis: `Biblioteca: el aviso no queda viejo mientras el OCR lee (AC-187)`.
- Un PR por tema. Si crece mucho, partilo.
- **Nunca subas secretos ni datos personales:** API keys, `auth.json`, `*.key`, `.env`, ni documentos o apuntes reales. Los fixtures de prueba son inventados (ver `tests/fixtures/make-scanned-pdf.py`).
- Si el cambio se nota para quien usa la app, sumá una línea en la sección «Sin publicar» del [CHANGELOG](CHANGELOG.md).

La plantilla del PR trae la lista de chequeo.

## Licencia

Eureka es [AGPL-3.0](LICENSE). Al mandar un PR aceptás que tu aporte se publique con esa licencia. Si sumás código o modelos de terceros, agregá su licencia y su crédito en [NOTICE](NOTICE).

## Convivencia

Este proyecto sigue el [Código de conducta](CODE_OF_CONDUCT.md).
