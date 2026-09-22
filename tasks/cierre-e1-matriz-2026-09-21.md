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
| SEC-07 escritor central de auditoría | `PARCIAL` | `common/audit/audit.service.ts` (whitelist fail-closed); atomicidad vía `TransactionInterceptor` | Faltan catálogo por acción y prueba de atomicidad en rutas sin JWT (login, station) | E1-07a/07b |
| SEC-08 partición, inmutabilidad y retención | `PARCIAL` | Migración `0016`, `schema-invariants.int.spec.ts`; `retention_months=0` | Cursor de consulta y decisión de retención OQ-08 pendientes | E1-08; OQ-08 es externa |
| SEC-09 vault (grant/redeem/rotación) | `PARCIAL` | `vault.int.spec.ts`, `vault.crypto.ts`, DEK versionadas | Concurrencia de rotación, recifrado reanudable, restore de KEK sin evidencia; handoff sin binding de operador/dispositivo (Fase B2) | E1-09a/b/c + pruebas de B2 |
| SEC-10 abuso y revocación del vault | `PENDIENTE` | Límite 30/h por (operador, perfil) `vault.service.ts:132-136` | Sin alertas durables ni política de revocación probada | E1-10 |
| SEC-11 guard 500 ≠ 401 | `CERRADO` | `guards.ts:66-80` corregido; `guards.spec.ts`, `api-client.test.ts`; `e1-01-2026-09-08.md` | — | Conservar como regresión |
| E1-02 restauración web recuperable | `CERRADO` | `web-app/src/auth/AuthProvider.tsx:20-22,52-74`; `e1-02-2026-09-08.md` | — | Conservar como regresión |
| RLS y rol runtime | `CERRADO` | Migraciones `0004/0008/0009/0014`; `rls.int.spec.ts`, `database-roles.int.spec.ts` | — | Conservar como regresión |

## 2. Perfiles, cuadrillas, asignaciones, turnos, breaks y semáforo

| Requisito | Estado | Evidencia actual | Brecha concreta | Prueba necesaria |
|---|---|---|---|---|
| OPS-01 CRUD de perfiles | `PARCIAL` | `profiles.controller.ts`, `profiles.service.ts` | ETag/versionado y auditoría completa sin evidencia | E1-11 (solo brecha reproducible) |
| OPS-02 asignaciones y relevo `[)` | `PARCIAL` | `assignments.service.ts:11-14,79-103,136-156`; `assignments.int.spec.ts` | Historial por cursor e interfaz del coordinador sin prueba integrada | E1-11/02 historial |
| OPS-03 sesiones, CAS, reaper | `PARCIAL` | `assignments.service.ts:241-435`; `0012`; pruebas de CAS y STALE | Reaper aún es timer con lock Redis 55 s (ver §3) | E1-04c |
| OPS-04 proyección de perfiles/estado | `PARCIAL` | `GET /agent/profiles/assigned`; `operator-status.int.spec.ts` | Snapshot WS monotónico y telemetría de error incompletos (Fase C1 los revalida) | E1-12 + C1 |
| OPS-05 materialización :05 y cruce de mes | `PARCIAL` (slice E1-04b verificado) | `jobs.service.ts:129-169`, `shift-schedule.ts`; `e1-04b-cierre-relevo-2026-09-09.md` | Falta reinicio real de API/worker con scheduler arrancando y overrides de fin de mes | E1-04b remate / E1-06 |
| OPS-06 breaks, aviso durable y semáforo | `PARCIAL` (OQ-03) | `breaks.service.ts`, aviso por outbox `jobs.service.ts:171-196` | Autocierre por duración y reglas OQ-03 | Decisión externa + E1-11 |
| OPS-07 tiempo efectivo | `CERRADO` | `effective-time.port.ts`; ADR 0011; `ops-07-effective-time-2026-09-08.md` | — | Conservar como regresión |
| WEB-01 frontend E1 | `CERRADO` | `frontend-delivery-1-2026-08-26.md`; componentes citados en `todo.md` | — | Conservar |

## 3. Scheduler, sesiones abandonadas, outbox, reintentos y recuperación

| Requisito | Estado | Evidencia actual | Brecha concreta | Prueba necesaria |
|---|---|---|---|---|
| E1-03 contrato de recuperación | `CERRADO` | `e1-03-2026-09-08.md` | — | Conservar |
| E1-04a claim durable | `CERRADO` | `job_runs` (migración `0017`), `durable-job.repository.ts`, `durable-jobs.int.spec.ts`; `e1-04a-2026-09-08.md` | — | Conservar |
| E1-04b materialización/cierre | `CERRADO` (slice) | `e1-04b-cierre-relevo-2026-09-09.md`; `checkpoint2-restart.int.spec.ts` | — | Conservar |
| E1-04c reaper/avisos/particiones | `PARCIAL` (2026-09-22): el scheduler encola y reclama `job_runs` con lease (sin lock Redis), renueva durante la ejecución y registra fallo con backoff/DEAD; `durable-scheduler.int.spec.ts` | `jobs.service.ts`, `durable-job.*` | Falta el ensayo con dos workers sobre el VPS y la política de expiración de avisos | E1-04c sobre VPS + dos workers |
| E1-05 superficie de outbox y reproceso | `PENDIENTE` | Claim/leases/backoff/DEAD en `outbox.service.ts:18-51`, `communication.worker.ts:86-118` | Sin endpoint ni UI de inspección/reproceso; sin métricas | E1-05a/b |
| E1-06 checkpoint 3 | `PARCIAL` | `checkpoints-1-3-2026-09-07.md` | Reinicio de Redis y scheduler durable sin ejercitar | E1-06 |
| E1-13 canales/identidades/deriva | `PARCIAL` | Piloto en `rocketchat-bot-pilot-2026-09-07.md`; ADR 0010 | Escaneo de deriva y vinculación de canales sin implementar | E1-13 |
| E1-14 programación/alerta urgente | `PARCIAL` | `communication.worker.ts:60-75`, `communication.int.spec.ts` | Recurrencia abierta en alcance; SLA <1 s sin medir | Decisión + E1-14 |
| E1-15 bot permanente | `PARCIAL` | `bot.service.ts`, webhook con dedupe; piloto | Webhook/worker permanente y rotación de PAT sin runbook ejecutado | E1-15 smoke autorizado |

## 4. Retención de auditoría, claves y recuperación del vault

| Requisito | Estado | Evidencia | Brecha | Prueba |
|---|---|---|---|---|
| Retención OQ-08 | `EXTERNO` | `audit.retention_months=0` conserva todo; migración `0016` | Decisión de la clienta | Propuesta de Daniel + setting |
| Rotación de claves | `PARCIAL` | `vault.service.ts` rotate/rotateEncryptionKey | Concurrencia y recifrado reanudable sin evidencia | E1-09a/b |
| Recuperación del vault | `PARCIAL` | `vault.int.spec.ts` | Restore con material de claves y reenvoltura de KEK sin ensayo | E1-09c |

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
| D2 instalador y operación | `PARCIAL` (2026-09-21): scripts de alta/baja de estación en `deploy/production/station/` (arranque automático, instancia única, `AutoSelectCertificateForUrls` con entrada propia y filtro por CN), Job Object `KILL_ON_JOB_CLOSE` del agente probado en `tools/test-agent-job-object.py`, y `cleanup_orphans()` como respaldo. Pendiente: empaquetado PyInstaller/Inno Setup y prueba física | Falta el paquete único por PC (`agency-os-station-setup.exe` con binarios `agency-os-helper.exe` y `agency-os-agent.exe`) y la validación en PC de oficina (Defender/políticas Chrome) |
| E VPS, backups B2 y restore | `ARTEFACTOS LISTOS` (2026-09-22): compose sin puertos públicos con `cloudflared` + worker + scheduler durable, redes `egress`/`internal` y límites de log, worker con `agency_worker_runtime` y grants del scheduler (migración `0022`), backup cifrado a B2 con Object Lock, globals para roles, manifiesto en B2 y `daily/` una vez por día, restore con privilegios (`--role=agency_owner`) y `--check` que exige `SUCCESS`. Pendiente: VPS, B2 y ensayo real | Evidencia `e1-e-backups-2026-09-21.md` |

## 7. Entradas externas que no bloquean la construcción

| Entrada | Responsable | Bloquea |
|---|---|---|
| Contratación del VPS y cuenta B2 | Daniel | Fases A2/E |
| CIDR del túnel y del proxy | Daniel/proveedor | Gate E1-16 |
| Certificados de ensayo y cuentas Cloudflare | Daniel | Fases B/D |
| PC de oficina y credenciales autorizadas | Operación/clienta | INT-01 y pruebas físicas |
| Decisión OQ-08 (retención de auditoría) | Clienta | Activación de borrado |

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
