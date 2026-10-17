# Piloto del bot de Rocket.Chat — 2026-09-07

Estado: **PASS contra el servidor real del cliente** (`chat.globalcompany.company`), con el
backend corriendo en local y publicado por un túnel temporal de Cloudflare.

## Lo que quedó demostrado

- Cuenta de servicio `agency.bot` con rol `bot` y un PAT propio. Identidad verificada por
  `backend/scripts/rocketchat-readonly-check.mjs`: `GET /api/v1/me` confirma que el `USER_ID`
  corresponde al token y que la cuenta está activa, sin mutar nada.
- Canal privado `#ayuda-bot` registrado como `GROUP` / `BOT` mediante
  `POST /api/v1/rocketchat/channels`, y `dan.iel13` vinculado a `operador@agency.test` mediante
  `PATCH /api/v1/users/:id`. Ambas por API y con actor administrador, no por SQL: quedaron
  `rocketchat.channel.created` y `user.updated` en `audit_log`.
- Cinco artículos de FAQ importados con `pnpm bot:knowledge:import`; segunda ejecución
  `0 imported, 5 unchanged`, confirmando idempotencia.
- Ciclo completo funcionando: mensaje en el canal → webhook entrante → respuesta encolada en
  `outbox_events` → entregada por `CommunicationWorker` → visible en Rocket.Chat.
- Respuestas dentro del hilo del mensaje que las provoca, de modo que la duda de una persona no
  notifica al canal entero.
- Las filas de auditoría del piloto cayeron en `audit_log_2026_09`, o sea que el particionado
  mensual de `0016_partition_audit_log.sql` funciona con la aplicación en marcha y no solo en
  las pruebas de integración.

## Dos defectos que el piloto destapó

**El validador del webhook rechazaba el payload real.** `botWebhookSchema` estaba declarado
`.strict()`, y Rocket.Chat envía campos que no declarábamos (`channel_name`, `user_name`, `bot`,
`siteUrl`, `isEdited`). Zod invalidaba el payload entero, la normalización devolvía `undefined` y
el endpoint respondía `200` — el `200` es deliberado para no provocar tormentas de reintentos, y
por eso el fallo era invisible desde Rocket.Chat. Las métricas de cloudflared fueron lo que
permitió ver que las peticiones sí llegaban. Corregido en `a34d38d`, con una prueba que usa un
payload realista.

**El worker de entrega no arranca dentro del proceso de API.** `CommunicationWorker` solo se
inicia con `DATABASE_RUNTIME_ROLE=worker`. Sin un proceso worker aparte las respuestas se acumulan
en el outbox y no salen nunca. Es el comportamiento correcto y coincide con la topología de
producción de ADR 0009, pero no estaba escrito en el runbook del piloto.

## Lo que este piloto no cierra

- No demuestra COM-01: no hay vinculación automática de canales ni escaneo de deriva.
- No demuestra COM-02: no hay dispatcher de mensajes programados ni medición del p95 <1 s de la
  alerta urgente, y `users.rocketchat_direct_room_id` está vacío para todos los coordinadores.
- No demuestra COM-03: el semáforo no se publica en el chat.
- La integración saliente apunta a un túnel temporal; su URL muere al reiniciar `cloudflared`.
- `DATABASE_WORKER_URL` se apuntó a la misma conexión que la API para no bloquear el piloto. En
  producción va con `agency_worker_runtime`, que no alcanza nómina, credenciales ni auditoría.
