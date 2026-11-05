## Qué cambia

<!-- Para quien usa la app, en una o dos frases. -->

## Por qué

<!-- El issue que resuelve (Closes #…) o el problema. -->

## Cómo lo probaste

<!-- Comandos que corriste y, si se ve en la interfaz, una captura. -->

## Lista de chequeo

- [ ] Si cambia el comportamiento: criterio en `docs/spec.md`, escenario en `features/` y su fila de trazabilidad.
- [ ] Pruebas nuevas o actualizadas, y `npm test` pasa.
- [ ] Si se ve en la interfaz: e2e en `tests/e2e/` y, si cambió el diseño a propósito, capturas regeneradas.
- [ ] Si toca prompts o herramientas del agente: `cargo test token_budget` pasa (o la línea base nueva está explicada).
- [ ] Una línea en «Sin publicar» del `CHANGELOG.md` si se nota para quien usa la app.
- [ ] Sin secretos, API keys ni datos personales en el diff.
