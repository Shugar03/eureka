# Distribución y actualizaciones

Eureka se instala como cualquier app de Windows (instalador NSIS, sin pedir administrador) y se actualiza sola: al abrirse (y cada 6 horas si queda abierta) busca una versión nueva, muestra **«Eureka X está lista»** y con **Actualizar ahora** la baja (con una barra de progreso dentro de Eureka), verifica la firma, la instala sin mostrar ninguna ventana (`plugins.updater.windows.installMode: "quiet"`) y se vuelve a abrir; esa primera vez muestra **«Novedades de Eureka X»** con las notas del release (AC-202). El instalador de la primera vez usa `src-tauri/windows/installer-sidebar.bmp` (164×314) y `installer-header.bmp` (150×57), regenerables desde el ícono. Los datos (`AppData\Roaming\lat.eureka.app`) no se tocan. En Ajustes → Conexión, **Acerca de Eureka** muestra la versión y **Buscar actualizaciones**.

## Cómo funciona

- Los releases son **públicos** en GitHub (`Shugar03/eureka`): el instalador y `latest.json`. La app consulta el último release por la API pública, sin ninguna credencial adentro.
- El repo se compila adentro (`EUREKA_UPDATE_REPO`) solo en los releases. Una compilación sin él (desarrollo, `Actualizar-Eureka.bat`, e2e) dice «es de desarrollo» y nunca busca.
- **Firma**: el instalador se firma con una clave privada que vive **fuera del repo**, en la PC de quien publica (`%USERPROFILE%\.tauri\eureka.key`); la clave pública está en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). La app rechaza cualquier instalador que no esté firmado con esa clave, aunque venga del repo.
- Código: `src-tauri/src/update.rs` (buscar e instalar), `src/components/UpdateNotice.tsx` (aviso y Acerca de), `scripts/release.cjs` (publicar).

## La clave de firma

Nunca va al repo (`*.key` está en `.gitignore`). Si se pierde, las copias instaladas **no aceptan más actualizaciones** y hay que reinstalar a mano con una clave nueva: guardá una copia en un gestor de contraseñas o un pendrive.

## Publicar una versión

Con todo commiteado:

```bash
npm run release -- patch "Qué trae esta versión"
```

(`minor`, `major` o un número `1.2.3` en vez de `patch`.) El script sube la versión en `package.json`, `Cargo.toml` y `tauri.conf.json`, pasa la sección «Sin publicar» del [CHANGELOG](../CHANGELOG.md) a «## [X] - fecha» (deja una «Sin publicar» vacía arriba y suma el link al release), compila el instalador firmado (en `D:\dev-cache\eureka-release-target`, para no trabar el `target` de los tests), commitea `Eureka X`, crea el tag `vX`, hace push y publica el release con el instalador y `latest.json`. Sin el texto entre comillas, las notas del release son esa sección del CHANGELOG.

Si la compilación falla, la versión queda subida en esos archivos sin commitear: descartá esos cambios (`git checkout -- package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock CHANGELOG.md`) y volvé a correrlo.

## La primera instalación

Bajá `Eureka_X_x64-setup.exe` del último release. Windows SmartScreen avisa «editor desconocido» (no hay certificado de firma de código, que es pago): *Más información → Ejecutar de todas formas*. Desde ahí, las versiones siguientes llegan solas.
