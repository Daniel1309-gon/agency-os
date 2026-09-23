# Matriz de cierre de Entrega 1 — corte 2026-09-21

Fecha: 2026-09-21; actualización de correcciones: 2026-09-22. Origen: [`plan-cierre-entrega-1-despliegue-2026-09-20.md`](plan-cierre-entrega-1-despliegue-2026-09-20.md) §2 A1.
Base anterior: [`plan-cierre-entrega-1-2026-09-08.md`](plan-cierre-entrega-1-2026-09-08.md) y su checklist en [`todo.md`](todo.md).
Estados: `CERRADO` (aceptación demostrada en el árbol de trabajo), `PARCIAL` (implementación o evidencia incompleta), `PENDIENTE` (sin construir), `A REHACER` (lo construido contradice el plan vigente), `EXTERNO` (bloqueado por una entrada externa ya identificada).

Este documento no cierra casillas: clasifica cada una y nombra la prueba que falta. No añade alcance: Tableau, nómina, IA y cafetería de E2 quedan fuera salvo lo ya listado como soporte de E1.

## 1. Autenticación, roles, RLS, auditoría y vault

| Requisito | Estado | Evidencia actual | Brecha concreta | Prueba necesaria |
|---|---|---|---|---|
| SEC-03 allowlist de IP y proxies confiables | `EXTERNO` (código listo) | `backend/src/common/auth/guards.ts`, `ip.ts`; `guards.int.spec.ts`; ADR 0014 | Faltan CIDR reales del proxy/túnel del entorno contratado. El acceso con certificado de dispositivo ya no depende de la allowlist (ADR 0014) | Gate E1-16 sobre infraestructura real |
| SEC-04 login/refresh/scrypt/rotación | `PARCIAL` | `auth.service.ts` (rotación, reuse, bloqueo, refresh atado al dispositivo); `auth.int.spec.ts`; ADR 0004 | Límites actuales (5/15 por cuenta) cubiertos por C2; queda medir con la cuadrilla real | Prueba de 30 logins simultáneos (plan §3) |
| SEC-05 principal y lifecycle del dispositivo | `CERRADO` (2026-09-21): identidad por huella SHA-256 del certificado mTLS, inventario `devices` con estado/vencimiento, enrolamiento con certificado no registrado y código de un solo uso, revocación que corta sockets y refresh tokens | `client-cert.ts`, `devices.service.ts`, migración `0020`; `guards.int.spec.ts`, `device-enroll.int.spec.ts`, `devices.int.spec.ts` | — | Conservar como regresión |
| SEC-06 turno y overrides | `CERRADO` | `shift-access.service*`, migración `0011`, `shift-access.int.spec.ts` | — | Conservar como regresión |
| SEC-07 escritor central de auditoría | `CERRADO` (2026-09-23) | `common/audit/audit.service.ts` (whitelist fail-closed); atomicidad vía `TransactionInterceptor`; caminos sin JWT cerrados con transacción propia (SEC-07b: login, refresh, enroll, webhook y rutas de estación) con prueba de auditoría que falla → no queda la escritura; catálogo cerrado por acción (SEC-07a) en `packages/shared/src/contracts/audit-actions.ts`: `AuditService.record` y `recordSecurityDenial` tipan `action` con él (una acción fuera de catálogo no compila) y la web toma de ahí filtro y etiquetas | El filtro web ofrecía `auth.login.succeeded`/`denied`, que el backend nunca escribió (usa `auth.login` + resultado); corregido con el catálogo | Conservar como regresión |
| SEC-08 partición, inmutabilidad y retención | `PARCIAL` | Migración `0016`, `schema-invariants.int.spec.ts`; `audit.retention_months=2` (migración `0023`, ~59–92 días); `GET /admin/audit-log` con cursor (`admin.service.ts:103-107`) | El cursor existe pero ninguna prueba lo cubre | Prueba del cursor (E1-07a) |
| SEC-09 vault (grant/redeem/rotación) | `PARCIAL` | `vault.int.spec.ts` (incluye binding de operador/estación, ventana de 60 s y redeem único de B2), `vault.crypto.ts`, DEK versionadas; reenvoltura de la KEK (`vault-rewrap-kek.mjs`, ensayo en [`e1-09a`](evidence/e1-09a-kek-rewrap-2026-09-23.md)) y `rotateKey` concurrente → 409 con `isPgError` | El recifrado de credenciales a la DEK nueva sigue sin existir (las credenciales viejas quedan en su versión): es SEC-09b, movido a E2 | E1-09b (E2) |
| SEC-10 abuso y revocación del vault | `CERRADO` (2026-09-23) | Límite 30/h por (operador, perfil); alertas durables por `RATE_LIMITED`, reuso, estación distinta y operador distinto (fila en `notifications` para admins + outbox al canal `ALERTS`), dedupe `SET NX EX` por gravedad y política de revocación probada. Evidencia [`e1-10`](evidence/e1-10-vault-abuse-2026-09-23.md) | Falta registrar el canal `ALERTS` en el Rocket.Chat real y medir el SLA <1 s (gate externo de E1-14) | Registrar el canal en producción |
| SEC-11 guard 500 ≠ 401 | `CERRADO` | `guards.ts:66-80` corregido; `guards.spec.ts`, `api-client.test.ts`; `e1-01-2026-09-08.md` | — | Conservar como regresión |
| E1-02 restauración web recuperable | `CERRADO` | `web-app/src/auth/AuthProvider.tsx:20-22,52-74`; `e1-02-2026-09-08.md` | — | Conservar como regresión |
| RLS y rol runtime | `CERRADO` | Migraciones `0004/0008/0009/0014`; `rls.int.spec.ts`, `database-roles.int.spec.ts` | — | Conservar como regresión |

## 2. Perfiles, cuadrillas, asignaciones, turnos, breaks y semáforo

| Requisito | Estado | Evidencia actual | Brecha concreta | Prueba necesaria |
|---|---|---|---|---|
| OPS-01 CRUD de perfiles | `PARCIAL` | `profiles.controller.ts`, `profiles.service.ts`: versión optimista en el cuerpo (`WHERE version = $n`, no ETag) y auditoría de alta/cambio/baja; 409 ejercitado en `assignments.int.spec.ts:135` | Falta una prueba directa de versión vieja → 409 en el CRUD de perfiles | Prueba de conflicto de versión |
| OPS-02 asignaciones y relevo `[)` | `CERRADO` (2026-09-23) | `assignments.service.ts`; `GET /assignments` como historial paginado y filtrable por operador/perfil, con prueba en `assignments.int.spec.ts:283-293`; la vista web (`AssignmentManagement.tsx`) ya mostraba el historial completo agrupado por serie (activas, finalizadas y relevos) y ahora filtra por operador y perfil en el servidor | La revisión del 2026-09-21 no vio que la vista ya existía; faltaban solo los filtros | Conservar como regresión |
| OPS-03 sesiones, CAS, reaper | `PARCIAL` | `assignments.service.ts`; `0012`; pruebas de CAS y STALE; el reaper corre en el scheduler durable (`job_runs` con lease, sin lock Redis) | Solo queda el ensayo con dos workers | E1-04c sobre VPS |
| OPS-04 proyección de perfiles/estado | `PARCIAL` | `GET /agent/profiles/assigned`; `operator-status.int.spec.ts` | Snapshot WS monotónico y telemetría de error incompletos (Fase C1 los revalida) | E1-12 + C1 |
| OPS-05 materialización :05 y cruce de mes | `PARCIAL` (slice E1-04b verificado) | `jobs.service.ts:129-169`, `shift-schedule.ts`; `e1-04b-cierre-relevo-2026-09-09.md` | Falta reinicio real de API/worker con scheduler arrancando y overrides de fin de mes | E1-04b remate / E1-06 |
| OPS-06 breaks, aviso durable y semáforo | `CERRADO` (2026-09-23) | `breaks.service.ts`, `jobs.service.ts` (`breaks:auto-close`), panel del operador; ventanas de 4 h desde la hora programada, tope de 20 min y sin breaks programados. Evidencia [`e1-ops-06`](evidence/e1-ops-06-breaks-2026-09-23.md) | Queda la observación con la cuadrilla real (gate externo) | Conservar como regresión |
| OPS-07 tiempo efectivo | `CERRADO` | `effective-time.port.ts`; ADR 0011; `ops-07-effective-time-2026-09-08.md` | — | Conservar como regresión |
| WEB-01 frontend E1 | `CERRADO` | `frontend-delivery-1-2026-08-26.md`; componentes citados en `todo.md` | — | Conservar |

## 3. Scheduler, sesiones abandonadas, outbox, reintentos y recuperación

| Requisito | Estado | Evidencia actual | Brecha concreta | Prueba necesaria |
|---|---|---|---|---|
| E1-03 contrato de recuperación | `CERRADO` | `e1-03-2026-09-08.md` | — | Conservar |
| E1-04a claim durable | `CERRADO` | `job_runs` (migración `0017`), `durable-job.repository.ts`, `durable-jobs.int.spec.ts`; `e1-04a-2026-09-08.md` | — | Conservar |
| E1-04b materialización/cierre | `CERRADO` (slice) | `e1-04b-cierre-relevo-2026-09-09.md`; `checkpoint2-restart.int.spec.ts` | — | Conservar |
| E1-04c reaper/avisos/particiones | `PARCIAL` (2026-09-22): el scheduler encola y reclama `job_runs` con lease (sin lock Redis), renueva durante la ejecución y registra fallo con backoff/DEAD; `durable-scheduler.int.spec.ts` | `jobs.service.ts`, `durable-job.*` | Falta el ensayo con dos workers sobre el VPS y la política de expiración de avisos | E1-04c sobre VPS + dos workers |
| E1-05 superficie de outbox y reproceso | `CERRADO` (2026-09-23) | `GET /ops/outbox` (sin `payload`), `GET /ops/outbox/summary` (estados + `job_runs` fallidos), `POST /ops/outbox/:id/requeue` auditado, permiso `outbox.manage` (ADMIN) y ruta web «Entregas». Evidencia [`e1-05`](evidence/e1-05-outbox-ops-2026-09-23.md) | Sin métricas exportadas (el resumen cubre la inspección) | Conservar como regresión |
| E1-06 checkpoint 3 | `CERRADO` en local (2026-09-23) | `checkpoints-1-3-2026-09-07.md`; scheduler durable en `durable-scheduler.int.spec.ts`; reinicio de API en `checkpoint2-restart.int.spec.ts`; caída de Redis con dos APIs vivas en `realtime-redis.int.spec.ts` (evidencia `e1-c`); reproceso real de un DEAD sintético hasta `SENT` en `communication.int.spec.ts` ([`e1-05`](evidence/e1-05-outbox-ops-2026-09-23.md)) | El mismo ensayo sobre la infraestructura real queda en los gates externos | Conservar como regresión |
| E1-13 canales/identidades/deriva | `PARCIAL` | Piloto en `rocketchat-bot-pilot-2026-09-07.md`; ADR 0010 | Escaneo de deriva y vinculación de canales sin implementar | E1-13 |
| E1-14 programación/alerta urgente | `PARCIAL` (2026-09-23): recurrencia y formulario web cerrados | `communication.worker.ts` (`advanceSeries`), `jobs/shift-schedule.ts` (`nextOccurrenceAt`/`occurrencesUpTo`), migración `0024`, `ScheduledMessagesPanel.tsx`; evidencia `e1-14-recurrence-2026-09-23.md` | Falta la medición del SLA <1 s contra el Rocket.Chat real | E1-14 sobre VPS |
| E1-15 bot permanente | `PARCIAL` | `bot.service.ts`, webhook con dedupe; piloto | Webhook/worker permanente y rotación de PAT sin runbook ejecutado | E1-15 smoke autorizado |

## 4. Retención de auditoría, claves y recuperación del vault

| Requisito | Estado | Evidencia | Brecha | Prueba |
|---|---|---|---|---|
| Retención OQ-08 | `PARCIAL` | Migración `0023` y seed: `audit.retention_months = 2` (~59–92 días, garantiza los 30 días pedidos); prueba en `schema-invariants.int.spec.ts` | Queda la retención de los datos raw de Tableau (MET-03, E2) | Activación ya hecha; sin gate propio |
| Rotación de claves | `PARCIAL` | `vault.service.ts` rotate/rotateEncryptionKey; reenvoltura de KEK con runbook y ensayo local ([`e1-09a`](evidence/e1-09a-kek-rewrap-2026-09-23.md)); concurrencia de `rotateKey` → 409 | El recifrado a la DEK vigente (SEC-09b) pasa a E2 | E1-09b (E2) |
| Recuperación del vault | `CERRADO` en local (2026-09-23) | Ensayo con esquema real en `e1-e-backups-2026-09-21.md`: backup del script real, restore en PostgreSQL vacío sin errores, credencial sintética abierta con la KEK custodiada y fallo cerrado con otra KEK (`backend/scripts/vault-restore-check.mjs`) | El mismo ensayo sobre VPS/B2 queda en E; la reenvoltura de KEK sigue en SEC-09 | `open` tras cada restore (README de backup) |

## 5. Prueba física y aceptación final

| Requisito | Estado | Evidencia | Brecha | Prueba |
|---|---|---|---|---|
| INT-01 5/8 perfiles, cookies aisladas, outage | `EXTERNO` | Diseño en `agents.md` §5.2; `e1-chrome-automated-2026-09-10.md` | PC y credenciales autorizadas | Prueba física (plan §3) |
| E1-16 gate de seguridad del entorno | `PENDIENTE` | — | Requiere VPS/túnel contratados | Fase B/E del plan vigente |
| E1-17 capacidad | `PENDIENTE` | `ha-local-game-day-2026-08-26.md` (local parcial) | Sin VPS | Prueba de 30 logins (plan §3) |
| E1-18 HA/restore/rollback | `PENDIENTE` (HA aplazada por decisión) | — | Backups y restore siguen obligatorios | Fase E |
| E1-19 acta y candidato | `PENDIENTE` | — | Todo lo anterior | Cierre |

## 6. Delta del plan de despliegue 2026-09-20 (no existía en el corte anterior)

| Fase | Estado actual en el repo | Trabajo de este plan |
|---|---|---|
| B1 identidad de equipo mTLS | `IMPLEMENTADO` (2026-09-21): guard de identidad por huella SHA-256 desde proxy confiable, inventario `devices` con certificado autorizado y tipo estación/administrativo. Pendiente: aplicar reglas en Cloudflare (Daniel) | Guard de identidad, migración `0020`, pruebas de suplantación. Evidencia `e1-b-mtls-identity-2026-09-21.md` |
| B2 sesión vinculada a operador y certificado | `IMPLEMENTADO` (2026-09-21): `prepare` exige equipo y vincula desde su creación; grant/redeem/handoff repiten la comprobación; token, archivos y pantallas retirados | Retiro de `x-device-token`, binding, expiración 60 s, redeem único |
| C1 WebSockets | `IMPLEMENTADO` (2026-09-22): vida 45–60 s, revalidación por conexión, `users.auth_version` en HTTP y WS, desconexión por usuario/equipo/rol, snapshot al reconectar, cliente con backoff, **renovación antes de reconectar cuando vence el JWT** y **puente Redis para los eventos del worker** | Evidencia `e1-c-realtime-and-limits-2026-09-21.md` (`realtime-server-close.int.spec.ts`, `realtime-device-access.int.spec.ts`, `realtime.service.spec.ts`); la prueba de carga de 30 sockets queda para el VPS |
| C2 límites de autenticación | `IMPLEMENTADO` (2026-09-21): 5/cuenta, 30/certificado, 300/IP, refresh 60/sesión y 1.200/IP | Pruebas de 30 logins con un certificado incluidas |
| D1 certificado en almacén Windows | `IMPLEMENTADO` (2026-09-22): transporte WinHTTP con selección explícita por huella SHA-256 del almacén Windows (sin exportar la clave), **redirecciones desactivadas con las constantes correctas del SDK (63/2)**, timeouts y errores saneados; CSR no exportable documentada en `CERTIFICATES.md`. Pendiente: prueba física Chrome+agente con la misma clave | `tools/test-winhttp-selection.py` cubre selección por huella y que un 302 local no se siga |
| D2 instalador y operación | `PARCIAL` (2026-09-21): scripts de alta/baja de estación en `deploy/production/station/` (arranque automático, instancia única, `AutoSelectCertificateForUrls` con entrada propia y filtro por CN), Job Object `KILL_ON_JOB_CLOSE` del agente probado en `tools/test-agent-job-object.py`, y `cleanup_orphans()` como respaldo. Empaquetado listo (2026-09-22): `tools/agent-build/` (PyInstaller `agent.spec`, Inno Setup `installer.iss`) genera `agency-os-station-setup.exe`. Pendiente: prueba física | Validación del instalador en PC de oficina (Defender/políticas Chrome) |
| E VPS, backups B2 y restore | `ARTEFACTOS LISTOS` (2026-09-22): compose sin puertos públicos con `cloudflared` + worker + scheduler durable, redes `egress`/`internal` y límites de log, worker con `agency_worker_runtime` y grants del scheduler (migración `0022`), backup cifrado a B2 con Object Lock, globals para roles, manifiesto en B2 y `daily/` una vez por día, restore fiel como superusuario ensayado con el esquema real y el vault con KEK (2026-09-23) y `--check` que exige `SUCCESS`. Pendiente: VPS, B2, RTO/RPO reales y restore sobre PostgreSQL gestionado | Evidencia `e1-e-backups-2026-09-21.md` |

## 7. Entradas externas que no bloquean la construcción

| Entrada | Responsable | Bloquea |
|---|---|---|
| Contratación del VPS y cuenta B2 | Daniel | Fases A2/E |
| CIDR del túnel y del proxy | Daniel/proveedor | Gate E1-16 |
| Certificados de ensayo y cuentas Cloudflare | Daniel | Fases B/D |
| PC de oficina y credenciales autorizadas | Operación/clienta | INT-01 y pruebas físicas |
| Decisión OQ-08 (retención de datos raw de Tableau) | Clienta | MET-03 (E2) |

## 8. Orden de ejecución adoptado

1. A2 comparación de VPS (documento, sin contratar).
2. B1+B2 (identidad mTLS, binding de sesión, retiro del token): es la base de C y D.
3. C1+C2 (sockets y límites): cierra el riesgo de revocación y el bloqueo del relevo.
4. D1+D2 (agente e instalador): depende de B1.
5. E (compose, backups, restore, alertas): depende de A2 contratado para los gates reales; los artefactos se preparan antes.

## 9. Actualización de correcciones del 2026-09-22

Esta sección prevalece sobre las descripciones anteriores de SEC-05, C1 y E en las tablas de arriba.

| Punto | Estado y evidencia actual | Pendiente |
|---|---|---|
| SEC-05, huella activa duplicada | `CERRADO`: enroll y registerCertificate traducen el 23505 envuelto por Drizzle a 409; `device-enroll.int.spec.ts` lo verificó con PostgreSQL real | Enrolar una PC fuera de oficina requiere allowlist temporal; ADR 0014 acepta que el access token emitido siga sirviendo desde otro equipo aprobado hasta 15 min tras revocar el original |
| C1, sesión y puente | `IMPLEMENTADO`: 401/403 de renovación detiene el socket y pasa la UI a anónimo; red/5xx/429 usa backoff con jitter hasta 15 s. El bridge Redis emite con `server.local.to(...)`; dos APIs entregan exactamente un evento por cliente y la suscripción inicial fallida reintenta con log | Prueba de carga de 30 sockets durante 30 min en el VPS |
| E, backup y restore | `ARTEFACTOS LISTOS`: el dump generado por `backup-postgres.sh` conservó GRANT y DEFAULT ACL en un restore PostgreSQL 16; cada dump y globals tiene su `.sha256` con igual Object Lock en `frequent/` y `daily/`; el manifiesto B2 es solo puntero | Object Lock y restore del vault/KEK reales en VPS/B2 |
| Retención de `job_runs` | `DEUDA ACEPTADA`: crece aprox. 7.200 filas/día; la migración `0008` niega `DELETE` al worker a propósito | Definir plazo y limpieza mediante función `SECURITY DEFINER` acotada; no ampliar grants del worker en E1 |
| Auditoría de dependencias de producción | `CERRADO`: los dos advisories moderados de Fastify (GHSA-w2qp-rph6-63g4 / CVE-2026-18504 y GHSA-3m5p-2c4r-xxw2 / CVE-2026-16732) se corrigieron subiendo Fastify a `5.12.5`: dependencia directa `^5.12.5` y override `'@nestjs/platform-fastify>fastify': 5.12.5`, porque el adaptador de Nest 11 (hasta 11.2.5) fija `5.11.3` exacto. `pnpm audit --prod`: sin vulnerabilidades conocidas. | Quitar el override al migrar a `@nestjs/platform-fastify` 12, que ya trae `5.12.5` |

Gates 2026-09-22 (con Fastify 5.12.5): `pnpm ci:verify` verde (205 unitarios backend,
251 integraciones, 67 web), `pnpm test:contracts` 10/10, `pnpm test:requirements` 34/34 y
`pnpm audit --prod` sin vulnerabilidades conocidas.

## 10. Revisión contra el código y clasificación propuesta (2026-09-22)

Se contrastó cada fila abierta con el código. Filas actualizadas por estar desfasadas: SEC-08
(el cursor ya existe), SEC-09 (el binding de B2 ya está probado; el recifrado y la reenvoltura de KEK
no existen), OPS-01, OPS-02 (historial ya expuesto y probado), OPS-03 (el reaper ya no usa lock
Redis), E1-06 y D2 (el empaquetado ya existe). La clasificación es una **propuesta**: el alcance del
acta (E1-19) lo deciden Daniel y la clienta.

| Grupo | Filas | Qué falta |
|---|---|---|
| **A. Internos, propuestos como mínimo del acta** | ~~E1-09c recuperación del vault~~ (cerrado en local el 2026-09-23); E1-06 checkpoint 3 (Redis cubierto el 2026-09-23; el reproceso de DEAD depende de E1-05); SEC-07b atomicidad sin JWT; SEC-10 abuso del vault | `TransactionInterceptor` hoy omite las rutas sin `request.user` (login, enroll, estación), así que la auditoría no es atómica con la escritura; disparadores y receptor de alertas del vault |
| **A'. Arreglos baratos** | SEC-09 `rotateKey` concurrente → 409; SEC-08 prueba del cursor; OPS-01 prueba de versión vieja | Una línea con `isPgError` y dos pruebas |
| **B. Internos, candidatos a E2 o a negociar** | E1-05 outbox (inspección/reproceso); OPS-02 vista web de historial; OPS-04 snapshot monotónico; SEC-07a catálogo de acciones; SEC-09 recifrado a la DEK nueva y reenvoltura de KEK | Construcción nueva. Riesgo de no hacer la reenvoltura: si la KEK se filtra no hay procedimiento de rotación |
| **C. Externos (VPS, Cloudflare, B2, PG gestionado, físico)** | SEC-03, SEC-04, E1-04c, OPS-05, C1 carga, D1, D2, INT-01, E1-16, E1-17, E1-18, E | Reglas mTLS y Transform Rule en Cloudflare, CIDR del túnel, 30 logins y 30 sockets, dos workers, restore real de B2 con KEK, prueba física en PCs de oficina |
| **D. Decisiones de la clienta** | OQ-08 (SEC-08), OQ-03 (OPS-06), recurrencia (E1-14) | Retención de auditoría, autocierre de breaks por duración, recurrencia de mensajes |
| **E. Rocket.Chat (servidor autorizado)** | E1-13, E1-14 SLA, E1-15 | Escaneo de deriva, medición <1 s y runbook del bot permanente; requieren el servidor del VPS de la clienta |

## 11. Decisiones y alcance confirmados (2026-09-23)

Confirmados por Daniel con la clienta; detalle en `agents.md` §6 y plan de ejecución en
[`plan-trabajo-interno-e1-2026-09-23.md`](plan-trabajo-interno-e1-2026-09-23.md) (pendiente de
aprobación para ejecutar).

| Punto | Decisión | Efecto en esta matriz |
|---|---|---|
| OQ-08 (auditoría) | Al menos 30 días: `audit.retention_months = 2` (~59–92 días; con `= 1` el piso sería 28 días) | SEC-08 deja de estar bloqueada por la clienta; OQ-08 pasa a `PARTIAL` porque la retención de datos raw sigue abierta |
| OQ-03 (breaks) | Sin breaks programados; el operador inicia, máx. 20 min con cierre automático, uno por ventana de 4 h desde la hora programada; si no lo toma, lo pierde; turnos de 8 h, extra sin break | OPS-06 pasa a construcción interna; score/aprobación de icebreakers siguen abiertos en OQ-03 |
| E1-14 (recurrencia) | Mensajes puntuales y recurrentes por Rocket.Chat, con formulario web | Recurrencia y formulario pasan a construcción interna; la medición del SLA sigue en el servidor real |
| Alcance E1 | Quedan: OPS-02, SEC-07a, SEC-09a, E1-05. Pasan a E2: OPS-04, SEC-09b | El grupo B de §10 queda resuelto |
| SEC-10 | Alertas al canal privado de administración en Rocket.Chat + registro en la web | Deja de estar bloqueada |

Hecho el 2026-09-23 (local): E1-09c (restore con KEK, `63b31a4`) y caída de Redis de E1-06
(`4f8e472`, sin push al momento de escribir esto).
