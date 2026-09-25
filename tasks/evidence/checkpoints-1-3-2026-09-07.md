# Checkpoints 1, 2 y 3 — 2026-09-07

Ejecución: `TEST_DB_RECREATE=1 pnpm vitest run --config vitest.integration.config.ts`, base
`agency_os_test` reconstruida desde cero, PostgreSQL 16.14 y Redis 7.4.8 reales.
**203 pruebas en 17 archivos, todas verdes**, 146 s. Commit base `94d66e7`.

Cada exigencia se mapea abajo a la prueba nombrada que la demuestra. Las que no tienen prueba se
declaran como brecha y **no** se dan por cumplidas: la existencia de código no cuenta.

## Checkpoint 1 — seguridad de Entrega 1 · **CUMPLIDO**

| Exigencia | Prueba que la demuestra |
|---|---|
| Matriz RBAC/RLS con el rol runtime real | `rls.int.spec.ts` — 14 pruebas bajo `SET LOCAL ROLE agency_app`, con `FORCE ROW LEVEL SECURITY`; incluye «shows a coordinator only the current members of their crew». Complementada por `database-roles.int.spec.ts` |
| Rutas públicas sometidas a IP | `http-security` «fails closed when the request IP is not allowlisted» y «keeps the IP exception exclusive to health endpoints»; `guards` «fails closed without an active office allowlist and accepts only a matching CIDR» |
| Negativos de dispositivo | `http-security` «rejects both revoked and expired devices» |
| Negativos de turno | `http-security` «rejects an operator outside an approved shift before device access» |
| Concurrencia del vault | `vault.int.spec.ts` «delivers the secret exactly once», más límite de 30 grants/hora y ausencia del secreto en logs a nivel debug |
| Auditoría inmutable | `schema-invariants` «keeps UPDATE and DELETE rejected after partitioning» y «rejects TRUNCATE on a partition, not only on the parent» |

Ninguna funcionalidad nueva quedó habilitada por feature flag: las cuatro banderas siguen en
`false`.

## Checkpoint 2 — flujo operativo local · **NO CUMPLIDO**

Lo que sí quedó demostrado, con reloj controlado:

| Tramo | Prueba |
|---|---|
| Arranque en el borde del turno | `JobsService` «closes a shift exactly at its upper boundary and finalizes its breaks»; `ShiftsService` «does not let an operator start a future shift early» |
| Sesiones y heartbeat | `assignments` «records a heartbeat and an error state», «marks an ACTIVE session STALE after its heartbeat deadline» |
| Break y aviso durable | `BreaksService` «measures the break from start to end»; «emits one durable reminder for an upcoming scheduled break» |
| Relevo sin 409 espurio | `assignments` «allows the handover: the next shift starts where the previous one ends» y «closes the previous assignment and session at an exact contiguous handoff» |
| Historial | `assignments` «lets a different authorized actor end an assignment and exposes paginated history» |
| Dos requests concurrentes | `assignments` «rejects a stale session version after another heartbeat wins the CAS»; `auth` «allows only one concurrent refresh to win» |

**Las dos brechas que impiden darlo por cumplido:**

1. **Ninguna prueba reinicia la API a mitad del recorrido.** El checkpoint lo pide de forma
   explícita («repetir con dos requests concurrentes y una API reiniciada»). La concurrencia sí
   está cubierta; el reinicio no.
2. **El tiempo efectivo se calcula mal.** «records the effective minutes when the shift closes»
   pasa, pero lo que verifica es `fin − inicio`: ni `jobs.service.ts` ni `shifts.service.ts`
   restan los breaks. FR-17 pide intersección de intervalos. La prueba está verde porque afirma
   la fórmula equivocada. Es la brecha OPS-07 y hay que arreglarla antes de reclamar este
   checkpoint.

## Checkpoint 3 — plataforma asíncrona · **NO CUMPLIDO**

| Exigencia | Estado |
|---|---|
| Encolar durante caída del worker y procesar una sola vez | Demostrado: `communication` «survives a worker restart and delivers each outbox message once» |
| Evento cruzando dos instancias | Demostrado: `realtime-redis` «propagates in under 500 ms and recovers through snapshots after reconnecting» |
| Configuración del balanceador documentada | Demostrado: [ADR 0009](../../docs/decisions/0009-rbac-and-production-topology.md) |
| Reinicio de Redis | **Sin cubrir.** Ninguna prueba lo ejerce |
| DLQ visible y métricas de cola | **Sin construir.** ASY-04 sigue abierta; el outbox tiene estado `DEAD` y backoff, pero no hay superficie para observarla ni reprocesar |
| Scheduler durable | **Sin construir.** ASY-01 sigue abierta: los jobs son `setInterval` con lock de Redis y no persisten las ejecuciones perdidas tras un reinicio |

Este checkpoint no puede cerrarse con trabajo de verificación: depende de dos tareas de
construcción que no existen.

## Conclusión

Se ejecutaron los tres. **Solo el Checkpoint 1 queda cumplido.** El 2 necesita el arreglo de
OPS-07 y una prueba con reinicio de API; el 3 necesita ASY-01 y ASY-04 construidas.

La lectura útil: la fase de seguridad de la Entrega 1 está verificada de punta a punta contra
infraestructura real, y lo que falta ya no es evidencia sino código.

---

**Seguimiento (2026-09-08).** Las dos brechas del Checkpoint 2 quedaron cerradas: el cálculo del
tiempo efectivo en [`ops-07-effective-time-2026-09-08.md`](ops-07-effective-time-2026-09-08.md) y
el reinicio de API en [`checkpoint-2-restart-2026-09-08.md`](checkpoint-2-restart-2026-09-08.md).
Este documento se conserva como el registro de la corrida del 2026-09-07 y no se reescribe.
