# Seguridad

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/Shugar03/eureka/releases) recibe arreglos. Las instalaciones se actualizan solas, así que el arreglo llega a todos con la versión siguiente.

## Cómo reportar una vulnerabilidad

**No abras un *issue* público.** Usá el reporte privado de GitHub: pestaña **Security → Report a vulnerability** del repositorio. Si no aparece, abrí un *issue* que diga solo «necesito un canal privado para un reporte de seguridad», sin detalles, y te contactamos.

Contá:
- qué versión usás y en qué sistema;
- qué puede hacer alguien que lo aproveche;
- los pasos para reproducirlo.

Respondemos en unos días. Eureka lo mantiene una sola persona en su tiempo libre: no hay recompensas ni plazos garantizados, pero cada reporte se lee y se agradece en el CHANGELOG si querés.

## Qué protege Eureka

| Qué | Cómo |
|---|---|
| API keys | Se guardan en `auth.json`, aparte de los ajustes, y **nunca** entran en los respaldos ni se mandan a otro lugar que al proveedor que elegiste |
| Cuentas de suscripción (ChatGPT) | Los tokens van al almacén de claves del sistema (Administrador de credenciales en Windows) |
| Actualizaciones | Cada instalador está firmado; la app rechaza cualquiera que no tenga la firma de la clave del proyecto, aunque venga del mismo repo |
| Demos interactivas | Corren en un `iframe` con `sandbox="allow-scripts"` (origen opaco) y una CSP que bloquea la red |
| Tus documentos | La biblioteca y el OCR trabajan en tu PC, sin red |

## Lo que no protege (a propósito)

- **El código de la consola corre con tus permisos.** No está aislado: se ejecuta solo cuando tocás **Ejecutar**, igual que si lo corrieras en una terminal. No ejecutes código que no entendés.
- **Lo que le escribís al profesor va al proveedor de modelos que configuraste**, con su política de privacidad.
- **Los datos locales no están cifrados**: quedan en la carpeta de datos de la app, protegidos por tu cuenta del sistema.

Un reporte sobre estos puntos es bienvenido si encontrás una forma de saltar lo que sí promete la tabla de arriba (por ejemplo, que una demo llegue a la red o que un modelo ejecute código sin que toques Ejecutar).
