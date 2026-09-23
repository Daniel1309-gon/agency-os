# Plan — trabajo interno restante de la Entrega 1 (2026-09-23, ejecutado)

## Estado (2026-09-23)

Los nueve puntos están hechos en local, cada uno con su evidencia y su fila en
`tasks/cierre-e1-matriz-2026-09-21.md`.

| Punto | Commits | Notas |
|---|---|---|
| 1. Retención (OQ-08 parcial) | `c2bbc4b`, `57b637c` | `blocks` de OQ-08 → MET-03 |
| 2. Breaks (OPS-06) | `70ab4b7`, `1b5b35d` | Corrección: el tope de 20 min también vale en el fin manual tardío y en ambos cierres de turno |
| 3. Recurrentes (E1-14) | `a471d8d`, `c5bd547`, `388c327` | Corrección: la primera ocurrencia debe caer en un día elegido y no después de `until` (API y web) |
| 4. E1-05 outbox | `17b8dd7`, `5c8aa97` | Cierra también E1-06. Se omitió «DEAD de las últimas 24 h» del resumen: `outbox_events` no guarda cuándo murió el evento |
| 5. SEC-09a | `017f8ff`, `82f3eda` | Corrección: el script bloquea las filas mientras reenvuelve; enlaces del runbook |
| 5b. SEC-10 | `3f6a43c`, `e3f4235`, `65d21ee` | Corrección: las consultas de la alerta pasan por el repositorio del vault (sin excepciones nuevas de arquitectura) |
| 6. SEC-07b | `f57c47f`, `e49c7e7` | Prueba de auditoría fallida en login y enroll; webhook y estación sin prueba propia |
| 7. SEC-07a | `516fcbb` | Catálogo en `@agency-os/shared`; la web ya no ofrece acciones inexistentes |
| 8. OPS-02 | `8003e57` | La vista del historial ya existía; faltaban los filtros por operador y perfil |
| 9. Pruebas A' | `bcc75c3` | Cursor de auditoría y 409 por versión vieja en perfiles |

Pendiente fuera del código: push y CI del PR #1, y los gates externos (Rocket.Chat real, VPS/B2).

## Contexto

La revisión de la matriz de cierre (`tasks/cierre-e1-matriz-2026-09-21.md` §10) dejó trabajo interno
abierto y decisiones de la clienta. Daniel confirmó el 2026-09-23:

- Auditoría: **al menos 30 días**, con `audit.retention_months = 2` sobre la retención mensual ya
  construida (conserva ~59–92 días). Se eligió por simplicidad frente a un corte por días.
- OQ-08 queda `PARTIAL`: auditoría resuelta, retención de datos raw abierta.
- Breaks: el operador los inicia cuando quiere; **máx. 20 min con cierre automático**; uno en las
  primeras 4 h del turno y otro en las 4 h siguientes; **si no lo toma, lo pierde**; turnos de 8 h;
  **sin breaks programados**; el tiempo extra no tiene break.
- Mensajes programados: puntuales **y recurrentes**, entregados por **Rocket.Chat**.
- Alcance E1: OPS-02 (vista de historial), SEC-07a (catálogo), SEC-09a (reenvoltura de la KEK),
  E1-05 (outbox), formulario web de mensajes programados. OPS-04 y SEC-09b pasan a E2.
- Ventanas de break desde la hora **programada** del turno.
- SEC-10: alertas al canal privado de administración en Rocket.Chat + registro en la web.

Rama subida hasta `e0213ba` (incluye la caída de Redis de E1-06 y el registro de decisiones).

## Orden de trabajo (un commit por punto, gates en cada uno)

### 1. Retención de auditoría (OQ-08 parcial)
- `audit_log_maintain` ya borra particiones completas con `month < mes_actual - retention_months`.
  Con `retention_months = 1` el piso real sería la duración del mes siguiente (28 días con febrero),
  por eso se usa **`retention_months = 2`**: piso ~59 días, máximo ~92. Sin cambios en la función.
- Migración `0023`: `UPDATE app_settings SET value = '2' WHERE key = 'audit.retention_months'`
  (el seed usa `onConflictDoNothing`, no cambiaría bases existentes). Seed: default `2`.
- `tasks/requirements-catalog.json` y `tasks/requirements-matrix.md`: OQ-08 → `PARTIAL`, pregunta
  reducida a la retención de datos raw y `blocks` movido de SEC-08 a la tarea de almacenamiento raw
  del ETL de Tableau (FR-19, E2; confirmar cuál de MET-03…06). `pnpm test:requirements` en verde.

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
- Semántica (Bogotá, UTC−5 fijo, sin horario de verano; reusar `businessDateInBogota`,
  `shiftBusinessDate` y `weekdayForBusinessDate` de `jobs/shift-schedule.ts`): DAILY cada día local;
  WEEKLY solo en los días elegidos; `until` es fecha local **inclusiva**.
- **Ocurrencias vencidas sin encolar** (worker caído): solo existe una fila `PENDING` por serie, así
  que nunca hay ráfagas. Al procesarla con retraso, en una transacción:
  1. esa fila pasa a `SKIPPED` con motivo en `last_error`, p. ej. «3 ocurrencias omitidas
     (20–22 sep) por caída del worker» — **una sola fila**, no una por ocurrencia perdida;
  2. si la ocurrencia **más reciente** ya vencida está dentro de la gracia (60 min), se crea **una**
     fila para ella y se encola (el conteo del motivo la excluye);
  3. se crea la siguiente ocurrencia **futura** como `PENDING`.
  Fuera de la gracia no se envía nada vencido.
- Los mensajes **puntuales** se envían aunque lleguen tarde (comportamiento actual); lo ya encolado
  en el outbox siempre se reintenta hasta `DEAD`.
- Pruebas: serie DAILY con worker detenido 3 días (fuera de gracia) → una sola fila `SKIPPED` con
  el conteo y el rango en el motivo, ningún envío y la siguiente ocurrencia futura `PENDING`; retraso
  de 20 min → se envía esa ocurrencia; WEEKLY respeta días; `until` incluye su último día y no se
  crea ocurrencia después de él.
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
  con `SET NX EX` en Redis, ventana por gravedad: **60 min** para `RATE_LIMITED` (igual al límite de
  grants) y **15 min** para reuso de grant y grant/handoff desde otra estación. La primera alerta sale
  al instante; auditoría y `credential_access_log` siguen registrando cada denegación, la alerta
  remite al panel de Seguridad.
- Revocación: la política es la baja de dispositivo y la desactivación de usuario ya existentes;
  se documenta y se prueba que cortan grants, sockets y refresh.
- Prueba de integración: 31.º y 32.º grant → una sola alerta; reuso → alerta, segundo reuso dentro
  de 15 min → sin alerta nueva; otro operador o perfil → alerta propia.

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
