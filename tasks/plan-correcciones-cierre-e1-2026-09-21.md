# Plan de correcciones — Cierre Entrega 1 (post-revisión 2026-09-21)

Fecha: 2026-09-21. Origen: revisión integral de [`plan-cierre-entrega-1-despliegue-2026-09-20.md`](plan-cierre-entrega-1-despliegue-2026-09-20.md). Alcance aprobado por Daniel: los 9 fixes de la revisión + corrección de evidencias/docs + gates. Sin commits salvo pedido.

Estado al cerrar la ejecución (2026-09-21): **tandas 1–3 completas y gates verdes**; sin commits, como se pidió.

## Decisiones confirmadas

- Huérfanos de Chrome: **Job Object de Windows** (`KILL_ON_JOB_CLOSE`) sobre chromedriver; mantener `cleanup_orphans()` como red de seguridad.
- Red: **`egress` dedicada** en compose para `worker` y `backup` (no `edge`).
- Lifetime de sockets: override por env (`SOCKET_LIFETIME_MIN_MS` / `SOCKET_LIFETIME_JITTER_MS`) solo para pruebas de integración; default 45–60 s sin cambios.

## Tanda 1 — bloqueantes

| # | Fix | Archivos | Estado |
|---|---|---|---|
| 1 | Reconexión WS tras `io server disconnect` (socket.io no auto-reconecta con esa razón) | `web-app/src/realtime/server-close-reconnect.ts`, `web-app/src/realtime/server-close-reconnect.test.ts`, `use-operator-statuses.ts`, `CafeteriaKds.tsx`, `backend/src/test/integration/realtime-server-close.int.spec.ts`, `backend/src/modules/realtime/realtime.gateway.ts` | ✅ código y tests |
| 2 | Red `egress` para `worker` (Rocket.Chat) y `backup` (B2, heartbeat); sin acceso a Postgres/Redis | `compose.production.yml` | ✅ |
| 3 | `--check` falla salvo `result=SUCCESS` y edad desde `startedAt`/`finishedAt` de éxito; un fallo no pisa el manifiesto de éxito | `deploy/production/backup/backup-postgres.sh` | ✅ probado contra Postgres real (fallo → `last-failure.json`) |
| 4 | `logging: max-size 10m` / `max-file 5` en todos los servicios | `compose.production.yml` | ✅ |
| 5 | `pg_dumpall --globals-only` cifrado + pasos de restore de roles | `backup-postgres.sh`, `deploy/production/backup/Dockerfile`, `deploy/production/backup/README.md` | ✅ (Dockerfile no requirió cambios: `postgres:16-alpine` ya trae `pg_dumpall`) |
| 6 | Documentar excepción WAF: `GET /health/*` (y ready/live) accesibles sin certificado de cliente para monitoreo externo | `deploy/mtls-pilot/CERTIFICATES.md` | ✅ |

## Tanda 2 — antes de PC reales

| # | Fix | Archivos | Estado |
|---|---|---|---|
| 7 | Job Object con `KILL_ON_JOB_CLOSE` al lanzar chromedriver (y hijos) para que no queden huérfanos al morir el agente | `tools/agency-os-local-agent.py` | ✅ probado con `tools/test-agent-job-object.py` |
| 8 | Instalador: entrada propia de `AutoSelectCertificateForUrls` (no pisar `\1`), filtro CN/dominio del certificado, borrado condicional en uninstall; nota en RUNBOOK | `deploy/production/station/install-station.ps1`, `uninstall-station.ps1`, `RUNBOOK.md` | ✅ (falta prueba física, fuera de este plan) |
| 10 | Actualizar matriz: fila D2 → estado coherente con instalador/huérfanos (no marcar `IMPLEMENTADO` si PyInstaller/Inno Setup siguen fuera) | `tasks/cierre-e1-matriz-2026-09-21.md` | ✅ D2 = `PARCIAL` |

## Tanda 3 — evidencia y docs

| # | Fix | Archivos | Estado |
|---|---|---|---|
| 11 | Evidencia C1 §C1.5: dejar de afirmar reconexión no probada; referenciar helper unitario + `realtime-server-close.int.spec.ts` | `tasks/evidence/e1-c-realtime-and-limits-2026-09-21.md` | ✅ |
| 12 | Evidencia E: egress, límites de log, roles en backup, manifiesto no pisado por fallo | `tasks/evidence/e1-e-backups-2026-09-21.md` | ✅ |
| 13 | Matriz C1/filas afectadas solo si la evidencia nueva cierra la brecha real | `tasks/cierre-e1-matriz-2026-09-21.md` | ✅ |

## Gates finales (tras tandas 1–3)

Resultado 2026-09-21: backend `typecheck`/`lint` verdes, 198 unitarios + reglas de arquitectura verdes,
integración **233/233** sobre Postgres 16 + Redis 7 (una corrida previa falló por timing del entorno
Windows/Docker: 602 ms vs <500 ms en `realtime-redis.int.spec.ts`; la repetición pasó completa);
contratos 10/10; web-app `typecheck`/`lint` verdes y 61 tests; raíz `build`, `typecheck`, `lint` y
`test` verdes. Sin commits ni pushes.

1. `pnpm --dir backend typecheck` / `lint` / unit / **integration** (incluye `realtime-server-close.int.spec.ts`; requiere Postgres 16 + Redis 7).
2. `pnpm test:contracts:run`.
3. `web-app`: `typecheck`, `lint`, `test` (existentes + 4 nuevas de `server-close-reconnect`).
4. Root: `pnpm build` y typecheck/lint/test del workspace.
5. Sin commits ni pushes salvo instrucción explícita.

## Fuera de este plan (externos / Daniel)

- Pruebas físicas de estación (Defender y políticas Chrome), load test de 30 logins/WebSockets sobre VPS, gates con VPS/B2/Cloudflare reales.
- Contratación de infraestructura y reglas de zona Cloudflare (WAF mTLS + excepción `/health/*`).

## Orden de ejecución restante

1. Terminar fix 1: correr tests web + backend integration; corregir evidencia C1. — hecho
2. Tanda 1: fix 3 → fix 5 → fix 6. — hecho
3. Tanda 2: fix 7 → fix 8 → fix 10. — hecho
4. Tanda 3: evidencias 11–13. — hecho
5. Gates finales en el orden de arriba. — hechos

## Segunda revisión (2026-09-22) — bloqueos funcionales

| # | Hallazgo | Corrección | Estado |
|---|---|---|---|
| 1 | Enrolamiento circular: el guard exigía un dispositivo ya aprobado antes de registrar la PC | `@AllowUnregisteredClientCert` en `/devices/enroll`; el guard deja la huella y el vencimiento verificados en el request y el cuerpo solo puede confirmarlos; `device-enroll.int.spec.ts` cubre el alta completa | ✅ |
| 2 | WinHTTP no desactivaba redirecciones (109/1 en vez de 63/2 del SDK) | Constantes corregidas; `tools/test-winhttp-selection.py` falla con el par viejo y pasa con el nuevo (302 local no seguido) | ✅ |
| 3 | Worker sin configuración funcional: login `agency_worker` (NOLOGIN), sin `DATABASE_WORKER_PASSWORD` y sin grants de scheduler | `.env.production.example` usa `agency_worker_runtime` + password; migración `0022` (app_settings, shift_templates, shift_overrides, roles, crew_members, INSERT shifts, EXECUTE audit_log_maintain); `database-roles.int.spec.ts` ejecuta las sentencias como el rol real | ✅ |
| 4 | Reconexión en bucle con JWT vencido (el gateway cierra con `disconnect(true)`, no con `connect_error`) | El helper renueva la sesión antes de reconectar; prueba de extremo a extremo del ciclo cierre → token vencido → refresh → reconexión | ✅ |
| 5 | El restore perdía privilegios (`--no-privileges`) y los checksums vivían solo en el VPS | `pg_restore --no-owner --role=agency_owner` sin `--no-privileges` + `GRANT CREATE` al esquema; manifiesto en `manifest/last-backup.json` de B2; `daily/` una vez por día UTC | ✅ |
| 6 | Comandos de actualización/rollback tomaban el compose de desarrollo | Runbook con `--env-file deploy/production/.env.production -f compose.production.yml` en todos los comandos | ✅ |
| 7 | Revocar un dispositivo no invalidaba sus refresh tokens y el refresh no comparaba el equipo | `AuthService.revokeDeviceTokens` desde la baja + binding `deviceId` en `refresh()`; pruebas de servicio e integración | ✅ |
| Brecha | Jobs durables sin consumidor | Scheduler sobre `job_runs` (enqueue + claim con lease, renovación y backoff/DEAD); `durable-scheduler.int.spec.ts` | ✅ |
| Brecha | Eventos del worker sin servidor realtime | Puente Redis `agency:realtime:bridge`; cada API suscrita reemite a sus salas; `realtime.service.spec.ts` | ✅ |
| Brecha | `daily/` se subía en cada ciclo | Estado por fecha UTC en el volumen; manifiesto con `dailyUploaded` | ✅ |
| Brecha | Acceso mTLS dependiente de la allowlist de IP | `ClientCertGuard` antes de `IpAllowlistGuard`; dispositivo aprobado exime la IP (ADR 0014); pruebas HTTP y WebSocket | ✅ |

Gates 2026-09-22: backend `typecheck`/`lint` verdes, 202 unitarios; integración **249/249** (Postgres 16 + Redis 7);
contratos 10/10; web-app 63; raíz `build`/`typecheck`/`lint`/`test` verdes; `test:requirements` 34/34. Sin commits.

Pendiente externo sin cambio: PC física, VPS/B2/Cloudflare y sus ensayos (dos workers, load test, restore real).

## Tercera revisión (2026-09-22) — correcciones A–D

El estado «sin commits» anterior corresponde al corte histórico previo a esta revisión.
Daniel autorizó un commit por bloque.

| Bloque | Resultado verificado |
|---|---|
| A — backup | `pg_dump --format=custom` sin `--no-owner` ni `--no-privileges`; cada dump/globals lleva su `.sha256` con la misma retención en `frequent/` y `daily/`. Restore del archivo producido por el script en un segundo PostgreSQL 16: dueño `agency_owner`, GRANT a `agency_app` y DEFAULT ACL presentes. Subida fallida del sidecar deja `FAILED_UPLOAD_FREQUENT` sin pisar el manifiesto exitoso. |
| B — sesión web | Un 401/403 al renovar corta la reconexión y pasa `AuthProvider` a anónimo; errores transitorios usan backoff con jitter, máximo 15 s. `connect_error` sigue la misma regla. |
| C — puente realtime | Emisiones del bridge con `server.local.to(...)`; dos APIs y dos clientes reciben exactamente un evento cada uno. Suscripción inicial fallida se registra y reintenta de 5 a 60 s; el duplicado Redis fallido se descarta. |
| D — menores | Huella de certificado ya activa devuelve 409 en enroll y registerCertificate (PostgreSQL real); runbook y ADR 0014 aclaran allowlist de enrolamiento externo y riesgo residual del access token. |

**Deuda aceptada — `job_runs`:** unas 7.200 filas diarias sin retención. La migración
`0008` niega `DELETE` al worker a propósito; no se amplían sus privilegios en E1.
Cuando se defina plazo de retención, hacer la limpieza con una función
`SECURITY DEFINER` acotada, como `audit_log_maintain`, y probarla con el rol real.

Gates del 2026-09-22: `pnpm ci:verify` verde (205 unitarios backend, 251 integraciones,
66 web, 8 shared), `pnpm test:contracts` 10/10, `pnpm test:requirements` 34/34
y `pnpm --dir web-app test` 66/66. La auditoría `--audit-level high` pasó,
pero informó cuatro vulnerabilidades moderadas que deben triagearse antes del despliegue.
Siguen pendientes los ensayos externos de PC física, VPS/B2/Cloudflare y carga real.
