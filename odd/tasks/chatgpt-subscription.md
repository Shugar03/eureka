# chatgpt-subscription

## Specs

- S1: OAuth de ChatGPT (Codex) en Rust nativo, sin sidecar.
  - `GET https://auth.openai.com/oauth/authorize` con `response_type=code`, `client_id=app_EMoamEEZ73f0CkXaXp7hrann`, `redirect_uri=http://localhost:1455/auth/callback`, `scope=openid profile email offline_access`, `code_challenge`, `code_challenge_method=S256`, `state`, `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=eureka`.
  - El puerto 1455 es fijo: el `client_id` está registrado con ese redirect exacto. Si 1455 está ocupado, el error dice: `El puerto 1455 está ocupado. Cerrá la otra app (Codex/OpenCode) y reintentá.`
  - `state` inválido o ausente ⇒ error explícito, nunca canje. `error` del callback se propaga tal cual.
  - Acceptance: con una cuenta Plus/Pro real el canje devuelve `access_token`, `refresh_token`, `id_token`, `expires_in`.
  - Checks: test unitario de `authorize_url` (params presentes, sin `resource`, sin `nonce`); test del callback (state ok / state roto / error).

- S2: Canje y refresh.
  - Canje: `POST https://auth.openai.com/oauth/token`, `application/x-www-form-urlencoded`, campos `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`. **Sin `resource`.**
  - Refresh: mismo endpoint, `grant_type=refresh_token`, `refresh_token`, `client_id`.
  - `account_id` sale del `id_token`: `chatgpt_account_id` o `["https://api.openai.com/auth"]["chatgpt_account_id"]`.
  - Acceptance: refresh devuelve 200 y reemplaza `access`/`refresh`/`expires`.
  - Checks: test del parseo de claims con los tres shapes; test de que el form del canje no incluye `resource`.

- S3: Tokens fuera de `auth.json`.
  - `auth.json` es `HashMap<String,String>` y `SettingsStore::save` poda las claves que no son proveedores (settings.rs:369), así que las cuentas van a `accounts.json` en el mismo directorio de datos.
  - Shape: `{ "<provider_id>": { "kind": "chatgpt", "account_id": "...", "email": null, "access": "...", "refresh": "...", "expires": 0, "originator": "eureka" } }`.
  - Acceptance: conectar y reiniciar la app conserva la cuenta; borrar `accounts.json` equivale a desconectar.
  - Checks: roundtrip del store (save → load); `auth.json` no se toca al conectar.
  - Fuera de alcance: cifrado del archivo con el keystore del SO (se documenta como deuda).

- S4: Modelos de la cuenta.
  - `GET https://chatgpt.com/backend-api/codex/models?client_version=0.0.0`, headers `Authorization: Bearer`, `chatgpt-account-id`, `originator`, `user-agent`, `session-id`.
  - Respuesta `{models:[{slug, display_name, visibility, supported_in_api, context_window, input_modalities}]}`; se filtran `visibility=="list"` y `supported_in_api==true`. No es el shape `data[]` de `parse_models`.
  - Acceptance: la lista de la cuenta aparece en Ajustes; una cuenta sin modelos elegibles muestra `Tu cuenta no tiene modelos disponibles para la API.`

- S5: Wire Responses.
  - `POST https://chatgpt.com/backend-api/codex/responses`, body `{model, instructions, input, tools, tool_choice, parallel_tool_calls, stream:true, store:false}`.
  - Traducción: system → `instructions`; user → `{role:"user",content:[{type:"input_text",text}]}`; assistant texto → `{type:"message",role:"assistant",content:[{type:"output_text",text}]}`; assistant tool_calls → `{type:"function_call",call_id,name,arguments}`; tool → `{type:"function_call_output",call_id,output}`; tools chat-completions → `{type:"function",name,description,parameters}`; `tool_choice` `"auto"|"none"|"required"` o `{type:"function",name}`.
  - Eventos: `response.output_text.delta{delta}` → texto; `response.output_item.added` con `item.type=="function_call"` → `call_id`+`name`; `response.function_call_arguments.delta{delta}` → acumula; `response.function_call_arguments.done{arguments}` y `response.output_item.done.item.arguments` → fija; `response.completed` → fin. No hay `[DONE]`.
  - Acceptance: `Completion` con el mismo shape que `chat/completions` (texto + `Vec<ToolCall>`), así `agent.rs` no cambia de contrato.
  - Checks: parser con chunks partidos a la mitad de una línea y de un UTF-8 multibyte; tool call fragmentada en 3 deltas; `finish()` rellena `id` y `arguments:"{}"`.

- S6: UI.
  - Tarjeta "ChatGPT Plus/Pro" en `ConnectionTab`: botón Conectar, estado (email si viene, si no `Cuenta conectada`), Desconectar. Nunca muestra tokens.
  - `api_key` del proveedor `openai` sigue funcionando en paralelo; conectar no borra la key.
  - Acceptance: conectar abre el navegador y al volver la tarjeta queda conectada sin recargar.

- S7: Fuera de alcance por decisión.
  - Gemini: sólo clave API (no se agrega botón OAuth).
  - Claude: no se envía OAuth de Claude Code (Anthropic lo prohíbe; OpenCode lo quitó en 1.3.0). Queda clave API o proxy local del usuario, documentado.

## Tasks

- T1 — S3 — `src-tauri/src/accounts.rs` nuevo: `Account`, `AccountsStore` (load/save/get/put/remove) + tests. **hecho, 6/6 verde**
- T2 — S1,S2 — `src-tauri/src/oauth.rs` nuevo: PKCE, authorize_url, listener loopback 1455, callback parse, exchange, refresh, claims. + tests puros. **hecho, 8 tests**
- T3 — S5 — `llm.rs`: campo `Endpoint.subscription: Option<Subscription>` (el `Some` es el discriminador, no hace falta enum), `responses_body`, `ResponsesParser`, `pump` compartido. **hecho, 8 tests**
- T4 — S4 — `llm.rs`: `list_chatgpt_models` + `parse_subscription_models`. **hecho**
- T5 — S1,S2,S3 — `agent.rs`: `endpoint_for` async + `valid_account` (refresh on expiry); call sites actualizados (agent, exam, practice, research, language, companion, vision, memory, lib, setup). **hecho**
- T6 — S6 — `lib.rs` comandos `chatgpt_status`, `chatgpt_connect`, `chatgpt_disconnect`, `chatgpt_models` + registro. **hecho**
- T7 — S6 — `src/components/ChatGptCard.tsx` nuevo; `Settings.tsx` (estado `chatgpt`, sin pedir clave cuando hay cuenta, modelos desde la cuenta), `api.ts`, `types.ts`. **hecho, `tsc --noEmit` limpio**
- T8 — S5 — `agent_tests.rs`: proveedor falso que habla Responses. **hecho, 2 tests nuevos (subscription_reply_ends_turn_and_persists, subscription_question_pauses_turn_until_the_learner_answers), ambos verdes**

## Log

- L1: Pedido original (reconstruido del checkpoint; no tengo el texto literal): "agregar conexiones de cuenta por suscripción con mínima fricción, empezando por ChatGPT Plus/Pro (Codex) OAuth; Gemini sólo clave API; Claude sin OAuth; arquitectura Rust nativa, sin sidecar de OpenCode; no exponer tokens en la UI".
- L2: El flujo planeado (`dynamic_agent_client`, token sharing) falla con `400 invalid_grant` en todos los intentos. Causa: es código de `dev`, no está desplegado. Evidencia: el binario de opencode 2.2.5 instalado no contiene `dynamic_agent_client`.
- L3: Flujo validado contra una cuenta real: canje 200, refresh 200, `/models` 200 (gpt-5.6-terra, gpt-5.6-luna), `/responses` 200 con texto y con tools. `api.openai.com/v1/chat/completions` con el mismo token: 401.
- L4: `originator=eureka` fue aceptado por el authorize y por la API; no hace falta usar el nombre de otro cliente.
- L5: Decisión del usuario: implementación completa nativa (no por fases).
