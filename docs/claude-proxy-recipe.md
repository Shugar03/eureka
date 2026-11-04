# Receta: usar Claude (Anthropic) con Eureka vía proxy local

Anthropic prohíbe explícitamente que terceros usen el OAuth de Claude Code
(`claude.ai` / `claude.com`). OpenCode lo quitó en la v1.3.0 por eso mismo.
Eureka **no** envía OAuth de Claude ni lo hará: no es un bypass real, es
incumplimiento de los términos de Anthropic.

La única vía soportada para usar Claude desde Eureka es una **clave API
oficial** de Anthropic (console.anthropic.com), cargada en Ajustes como
proveedor `anthropic`.

Si igual querés usar tu suscripción Claude Code (no recomendado a largo
plazo), la única opción técnicamente viable es un **proxy local
OpenAI-compatible** que envuelve el OAuth de Claude Code por vos. Funciona
hoy, pero Anthropic puede bloquearlo en cualquier momento.

## Opción: proxy local con `claude-code-proxy`

### 1. Instalar y correr el proxy

```bash
# Clonar e instalar (ver repo del proxy para instrucciones actualizadas)
git clone https://github.com/.../claude-code-proxy
cd claude-code-proxy
npm install
npm start
```

El proxy queda escuchando en `http://localhost:PORT/v1` (el puerto depende
del proxy; anotalo).

### 2. Configurar Eureka

En Ajustes → Avanzado → Proveedores:

1. Agregá un proveedor nuevo:
   - **ID**: `claude-proxy`
   - **Etiqueta**: `Claude (proxy local)`
   - **Base URL**: `http://localhost:PORT/v1` (el puerto del proxy)
2. En "Clave de acceso" poné cualquier string no vacío (ej. `dummy`).
   El proxy local suele ignorar la clave, pero Eureka la requiere para no
   bloquear el guardado.
3. Elegí un modelo Claude (ej. `claude-sonnet-4-20250514`).
4. Guardá.

### 3. Verificar

Mandá un mensaje en Eureka. Si el proxy está corriendo y autenticado con
tu cuenta Claude Code, la respuesta llega normal.

### Riesgos a tener en cuenta

- **Anthropic puede bloquear** el flujo de Claude Code OAuth para terceros
  en cualquier momento (ya lo hizo una vez con OpenCode). Si eso pasa, el
  proxy deja de funcionar y la única vía vuelve a ser la clave API oficial.
- El proxy corre en tu máquina: si lo cerrás, Eureka no puede hablar con
  Claude hasta que lo vuelvas a abrir.
- Los datos pasan por el proxy local (no por Anthropic directamente), así
  que revisá el código del proxy si te importa la privacidad.
- **No es un bypass "oficial"**: es un hack local que depende de que
  Anthropic no bloquee el endpoint que usa Claude Code.

### Alternativa recomendada

Usá la **clave API oficial** de Anthropic (console.anthropic.com). Es la
única vía soportada, estable y sin riesgo de bloqueo. Eureka la carga como
proveedor `anthropic` igual que cualquier otro.
