# Plan — trabajo interno restante de la Entrega 1 (2026-09-23, pendiente de aprobación)

## Contexto

La revisión de la matriz de cierre (`tasks/cierre-e1-matriz-2026-09-21.md` §10) dejó trabajo interno
abierto y decisiones de la clienta. Daniel confirmó el 2026-09-23:

- Auditoría: **30 días** (aprovechar la retención mensual ya construida).
- Breaks: el operador los inicia cuando quiere; **máx. 20 min con cierre automático**; uno en las
  primeras 4 h del turno y otro en las 4 h siguientes; **si no lo toma, lo pierde**; turnos de 8 h;
  **sin breaks programados**; el tiempo extra no tiene break.
- Mensajes programados: puntuales **y recurrentes**, entregados por **Rocket.Chat**.
- Alcance E1: OPS-02 (vista de historial), SEC-07a (catálogo), SEC-09a (reenvoltura de la KEK),
  E1-05 (outbox), formulario web de mensajes programados. OPS-04 y SEC-09b pasan a E2.
- Ventanas de break desde la hora **programada** del turno.
- SEC-10: alertas al canal privado de administración en Rocket.Chat + registro en la web.

Commit local pendiente de push: `4f8e472` (caída de Redis, E1-06).

## Orden de trabajo (un commit por punto, gates en cada uno)

### 0. Push de `4f8e472`

### 1. Retención de auditoría a 30 días (OQ-08)
- `audit_log_maintain` ya borra particiones completas con `month < mes_actual - retention_months`.
  Con `retention_months = 1` se conservan el mes actual y el anterior: **mínimo 30 días**, hasta ~61.
- Migración `0023`: `UPDATE app_settings SET value = '1' WHERE key = 'audit.retention_months'`
  (el seed usa `onConflictDoNothing`, no cambiaría bases existentes). Seed: default `1`.
- Cerrar OQ-08 en el registro de preguntas abiertas y en la matriz.

### 2. Breaks por iniciativa del operador (OPS-06)
- `POST /breaks/start` (OPERADOR, `@RequireShift`): crea e inicia el break en el turno
  `IN_PROGRESS`. Reutiliza el lock `pg_advisory_xact_lock` por operador de `breaks.service.ts:start`.
  Reglas: ventana = `floor((now − lower(scheduled_range)) / 4 h)` ∈ {0, 1} — desde la hora
  **programada** del turno; llegar tarde no corre las ventanas; fuera de las primeras 8 h →
  409; ya hay break con `started_at` en esa ventana → 409; break activo → 409.
- Job `breaks:auto-close` (scheduler durable, cada minuto): `IN_PROGRESS` con
  `started_at + 20 min <= now()` → `COMPLETED`, `ended_at = started_at + 20 min`,
  `duration_minutes = 20`; publica el cambio de estado. El worker ya tiene `UPDATE` sobre `breaks`.
- `POST /breaks/:id/end` se conserva para terminar antes.
- Retirar lo programado: campo `breaks` de la creación de turnos (`shifts.schemas.ts`,
  `shifts.service.ts:39`), job `breaks:notify` y evento `break.reminder`
  (`communication.worker.ts`), formulario de break en `ShiftManagement.tsx`.
- Web: `OperatorShiftPanel.tsx` con botón «Iniciar break», ventana vigente y cuenta regresiva.
- Contrato: `pnpm --filter @agency-os/api openapi:update` (snapshot + matriz de rutas).
- Pruebas de integración: ventana 1 permitida; segundo break en ventana 1 → 409; ventana 2
  permitida; tras 8 h → 409; cierre automático exacto a 20 min; terminar antes funciona.

### 3. Mensajes recurrentes por Rocket.Chat (E1-14, parte interna)
- `scheduled_messages.recurrence_rule` ya existe; hoy el esquema lo rechaza con `z.never`.
- Regla estructurada y validada (no RRULE libre): `{ frequency: DAILY | WEEKLY, weekdays?, until? }`,
  hora tomada de `scheduledFor`, zona `America/Bogota` (reusar `shift-schedule.ts`).
- En `communication.worker.ts:enqueueDueScheduled`, al encolar una ocurrencia recurrente se inserta
  la siguiente como fila `PENDING` en la misma transacción: cada ocurrencia tiene su propio evento
  de outbox y su propia idempotencia. Endpoint para cancelar la serie.
- Web: formulario mínimo (coordinador/admin) para mensajes puntuales o recurrentes a un canal o a un
  operador, con lista de pendientes y cancelación. Reusa los contratos compartidos de `@agency-os/shared`.

### 4. E1-05 — Superficie de outbox y reproceso (cierra también E1-06)
- `GET /ops/outbox?status=&eventType=&cursor=`: lista con tipo, agregado, intentos, último error,
  próximo intento; sin `payload` completo (puede traer cuerpos de mensaje).
- `POST /ops/outbox/:id/requeue`: solo `FAILED`/`DEAD` → `PENDING`, `attempts = 0`,
  `next_attempt_at = now()`; si el agregado es `scheduled_message`, vuelve a `QUEUED`. Auditado
  (`outbox.requeued`). Permiso nuevo `outbox.manage` (ADMIN).
- `GET /ops/outbox/summary`: conteo por estado, antigüedad del pendiente más viejo y DEAD de las
  últimas 24 h, más `job_runs` FAILED/DEAD. Los runs de jobs no se reencolan: la siguiente ventana
  ya los repite.
- Web: panel para admin con filtro por estado y botón «Reintentar».
- Prueba de integración: evento sintético DEAD → requeue → `CommunicationWorker.tick` con cliente
  Rocket.Chat falso → `SENT` y fila de auditoría. Es el «reproceso real de un DEAD sintético» de E1-06.

### 5. SEC-09 — Reenvoltura de la KEK (el recifrado a la DEK nueva pasa a E2)
- Script `backend/scripts/vault-rewrap-kek.mjs` (servicio `ops`) con `VAULT_KEK_PREVIOUS` y
  `VAULT_KEK`: en una transacción desenvuelve cada fila de `encryption_keys` con la anterior y la
  envuelve con la nueva (misma lógica que `wrap`/`unwrap` de `vault.crypto.ts`); aborta sin cambios
  si alguna no abre.
- Runbook en `deploy/production/backup/README.md`: detener API/worker, correr, arrancar con la KEK
  nueva, validar con `vault-restore-check.mjs open`, custodiar la KEK vieja 30 días (los backups
  retenidos en B2 siguen envueltos con ella).
- Ensayo local como el de E1-09c: la credencial abre con la KEK nueva y no con la vieja.
- `rotateKey` concurrente → 409 con `isPgError` (hoy 500).

### 5b. SEC-10 — Alertas por abuso del vault
- Disparadores (ya se registran como denegaciones en `vault.service.ts` → `deny`): `RATE_LIMITED`,
  reuso de un grant ya canjeado y grant/handoff desde una estación distinta a la preparada.
- Acción: evento de outbox `rocketchat.message.send` al canal privado de administración
  (registrado con el endpoint existente de canales, con propósito de seguridad) + fila en
  `notifications` para verla en Seguridad de la web. Deduplicación por (operador, perfil, motivo)
  en una ventana corta para no inundar el canal.
- Revocación: la política es la baja de dispositivo y la desactivación de usuario ya existentes;
  se documenta y se prueba que cortan grants, sockets y refresh.
- Prueba de integración: 31.º grant → alerta encolada una sola vez; reuso → alerta.

### 6. SEC-07b — Atomicidad de auditoría en rutas sin JWT
- Rutas: `auth/login`, `auth/refresh`, `devices/enroll`, `communication/events` (webhook) y las de
  estación (`assignments.controller.ts` con `@StationAuthenticated`/`@RequireStationDevice`).
- No en el interceptor: el login fallido **debe** persistir el conteo de fallos y el bloqueo aunque
  la petición termine en error. Transacciones explícitas (`DatabaseService.transaction`) solo
  alrededor de cada camino de éxito (escritura de negocio + auditoría).
- Prueba: auditoría que falla → la escritura de negocio no queda.

### 7. SEC-07a — Catálogo de acciones de auditoría
- `common/audit/audit-actions.ts`: lista cerrada de acciones con su entidad y metadatos;
  `AuditService.record` tipa `action` con esa unión, así el compilador impide acciones fuera de
  catálogo. Documento generado o tabla en `docs/`.

### 8. OPS-02 — Vista web del historial de asignaciones
- `GET /assignments` ya pagina el historial (`assignments.int.spec.ts:283`). Vista en
  `AssignmentManagement.tsx` con filtros por operador/perfil y paginación.

### 9. Arreglos baratos (A')
- Prueba del cursor de `GET /admin/audit-log`; prueba de 409 por versión vieja en perfiles.

### Fuera de este plan
- E2: OPS-04 (snapshot monotónico) y SEC-09b (recifrado a la DEK vigente).
- Externos: Cloudflare, VPS/B2, PG gestionado, capacidad, prueba física, E1-13/14 SLA/15 en
  Rocket.Chat real.

## Rocket.Chat: qué información necesito y cómo pasarla
- **Secretos, nunca por chat**: `ROCKETCHAT_TOKEN`, `ROCKETCHAT_USER_ID`, `ROCKETCHAT_WEBHOOK_SECRET`
  en `backend/.env` (y luego en `.env.production`). El PAT de `agency.bot` del piloto se verifica
  sin mutar nada con `scripts/rocketchat-readonly-check.mjs`.
- **Por chat**: canal de prueba donde el bot puede escribir (para medir la alerta urgente <1 s),
  nombres de los canales por cuadrilla y usuarios de coordinadores/operadores a vincular (E1-13;
  `scripts/rocketchat-room-ids.mjs` saca los ids), y autorización explícita antes de escribir en
  canales reales.
- E1-15 (webhook permanente) necesita el dominio final del VPS.

## Verificación
- Por punto: `pnpm typecheck`, `pnpm lint`, `pnpm test`, specs de integración tocados con
  `backend/.env` cargado; cambios de contrato con `pnpm test:contracts`.
- Al final: `pnpm ci:verify` completo, `pnpm test:requirements`, CI del PR #1 en verde; matriz y
  evidencias actualizadas.
