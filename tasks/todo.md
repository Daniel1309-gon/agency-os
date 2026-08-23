# Checklist de ejecución — remediación backend Agency OS

Plan detallado: [`tasks/plan.md`](plan.md). Marcar una tarea solo cuando sus criterios de aceptación **y** verificación estén adjuntos como evidencia. La existencia de código, tabla o test no ejecutado no cuenta como completado.

## Reglas de trabajo

- `[ ]` pendiente; `[x]` completada con evidencia enlazada. Si está bloqueada, mantener `[ ]` y anotar `BLOCKED: OQ-xx`.
- Una tarea = un PR pequeño/mediano o una serie mínima de PRs verticales; evitar mezclar fases no dependientes.
- Antes de merge: build, lint, typecheck, unit, integración real, tests del task y casos de abuso.
- Después de cada 2–3 tareas: ejecutar el checkpoint indicado y registrar resultado/fecha.
- Nunca habilitar un feature flag por tener schema preliminar.

## Alcance activo — Entrega 1

El camino crítico actual es la Entrega 1 de `agency-os-propuesta-comercial-v3.md`:
autenticación/RBAC/IP, vault, perfiles/asignaciones, sesiones por turno, breaks, semáforo y
bot/estado de Rocket.Chat. Tableau, ETL, nómina, icebreakers avanzados, cafetería completa y
FR-39 quedan fuera de prioridad en este ciclo; sus tareas permanecen pendientes o bloqueadas y
no deben consumir trabajo del hito de semanas 1–9. Ver `tasks/requirements-matrix.md`.

Evidencia ejecutada el 2026-08-21: [CI run 32536754293](https://github.com/Daniel1309-gon/agency-os/actions/runs/32536754293)
verde desde checkout limpio; instalación frozen, migraciones, seed idempotente, build, lint, typecheck,
unitarias, contratos API y pruebas de integración contra PostgreSQL 16 y Redis 7. La trazabilidad vive
en `tasks/requirements-catalog.json` y se verifica con `pnpm test:requirements`.

## Fase 0 — baseline y contratos

- [x] **FND-01** Trazabilidad FR-01…FR-39/NFR y registro de decisiones. Evidencia: `tasks/requirements-catalog.json`, `tasks/requirements-matrix.md`, `pnpm test:requirements`.
- [x] **FND-02** Toolchain reproducible: install/build/lint/typecheck/unit verdes. Evidencia: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- [x] **FND-03** CI unificado con PostgreSQL/Redis/migraciones/integración. Evidencia: [CI #3](https://github.com/Daniel1309-gon/agency-os/actions/runs/32436187602), commit `4e534cd`.
- [x] **FND-04** DTO compartidos, OpenAPI y matriz ruta×política. Evidencia: `packages/shared/test/operator-contracts.test.mjs`, `backend/openapi.snapshot.json`, `tasks/route-policy-matrix.md`, `pnpm test:contracts`, [CI #6](https://github.com/Daniel1309-gon/agency-os/actions/runs/32520285060).
- [x] **FND-05** Boundaries repository/port y slice piloto. Evidencia: `backend/scripts/architecture-rules.mjs`, `backend/architecture-baseline.json`, `backend/test/architecture-rules.test.mjs`, `backend/src/modules/vault/vault.repository.port.ts`, `backend/src/modules/vault/vault.drizzle-repository.ts`, [ADR 0001](../docs/decisions/0001-module-boundaries-and-domain-repositories.md), [CI run 32535144446](https://github.com/Daniel1309-gon/agency-os/actions/runs/32535144446).
- [x] **Checkpoint 0:** clon limpio y CI verde; ninguna ruta sin clasificación. Evidencia: [CI run 32535144446](https://github.com/Daniel1309-gon/agency-os/actions/runs/32535144446), commits `c9add13`, `bb456d0` y `ebf4af1`.

## Fase 1 — seguridad

- [x] **SEC-01** Roles DB owner/app/worker/readonly y grants mínimos. Evidencia: `backend/src/database/migrations/0008_database_deployment_roles.sql`, `backend/src/test/integration/database-roles.int.spec.ts`, `backend/scripts/db-bootstrap-runtime.mjs`, `backend/scripts/db-bootstrap-worker.mjs`, `docs/decisions/0002-postgresql-deployment-roles.md`, [CI run 32536754293](https://github.com/Daniel1309-gon/agency-os/actions/runs/32536754293).
- [ ] **SEC-02** RLS real por rol/cuadrilla/operación. Depende de SEC-01/FND-04. BLOCKED parcial: OQ-01/OQ-02. Subavance verificado: `0009_force_sensitive_rls.sql`, pruebas con `agency_app`/`agency_owner` real y [CI run 32537769188](https://github.com/Daniel1309-gon/agency-os/actions/runs/32537769188); falta cerrar la matriz de coordinador/cuadrilla cuando se resuelvan OQ-01/OQ-02.
- [ ] **SEC-03** IP allowlist fail-closed y proxies confiables. BLOCKED final de despliegue: OQ-12 debe fijar los CIDR reales del LB/proxy. Subavance de código verificado: `SkipIpAllowlist` exclusivo para health, allowlist aplicada también a rutas públicas y WebSocket, CIDR validado/canonicalizado, resolución trusted-proxy IPv4/IPv6 y auditoría acotada; pruebas focales 51/51, typecheck/lint verdes y [CI run 32664100833](https://github.com/Daniel1309-gon/agency-os/actions/runs/32664100833), commits `d3cd670` y `851ab65`, [ADR 0003](../docs/decisions/0003-ip-allowlist-and-trusted-proxy.md).
- [ ] **SEC-04** Refresh atómico, reuse detection, cookies/rate limit/scrypt. Depende de SEC-03.
- [ ] **SEC-05** Principal y lifecycle de dispositivo. Depende de SEC-01/FND-04.
- [ ] **SEC-06** Guardia/política de turno y overrides. Depende de SEC-02; se completa con OPS-05.
- [ ] **SEC-07** Escritor central de auditoría y catálogo de eventos. Depende de SEC-01/FND-05.
- [ ] **SEC-08** Inmutabilidad, partición, cursor y retención audit. Depende de SEC-07/OQ-08.
- [ ] **SEC-09** Vault grant/redeem/binding/rotación de claves. Depende de SEC-02/03/05/06/07.
- [ ] **SEC-10** Alertas/revocación por abuso del vault. Depende de SEC-09/ASY-02.
- [ ] **Checkpoint 1:** matriz RBAC/RLS con rol runtime, IP/device/shift negativos, vault concurrente y audit inmutable.

## Fase 2 — operación de perfiles y turnos

- [ ] **OPS-01** CRUD de perfiles scoped, versionado y auditado.
- [ ] **OPS-02** Asignaciones/relevos `[)` e historial.
- [ ] **OPS-03** Máquina de sesión, CAS, reaper y gracia 0.
- [ ] **OPS-04** Proyección de perfiles/estados/errores.
- [ ] **OPS-05** Materialización de turnos :05, overrides y cruce de mes.
- [ ] **OPS-06** Descansos, aviso durable y semáforo. BLOCKED parcial: OQ-03.
- [ ] **OPS-07** Tiempo efectivo por intervalos y scope de crew.
- [ ] **Checkpoint 2:** recorrido 06:05→break→relevo 14:05 con concurrencia y reinicio.

## Fase 3 — jobs y realtime

- [ ] **ASY-01** BullMQ y proceso worker durable.
- [ ] **ASY-02** Relay outbox y dispatchers idempotentes.
- [ ] **ASY-03** WebSocket Redis HA, rooms y reconnect. Depende de OQ-12.
- [ ] **ASY-04** Scheduler, leases, retries, DLQ y métricas.
- [ ] **Checkpoint 3:** job sobrevive restart y evento cruza dos instancias sin duplicarse.

## Fase 4 — métricas y Tableau

- [ ] **MET-01** Ingesta de métricas autenticada/acotada/idempotente.
- [ ] **MET-02** Agregación diaria reconstruible.
- [ ] **MET-03** Cliente Tableau seguro y artefacto crudo. BLOCKED real: OQ-04/OQ-05.
- [ ] **MET-04** Parser/staging/timezone/promoción. BLOCKED: OQ-05/OQ-06.
- [ ] **MET-05** Atribución vf-range o 5/55 y points ledger. BLOCKED: OQ-04/OQ-06/OQ-07.
- [ ] **MET-06** Reconciliación/cuarentena/reproceso.
- [ ] **MET-07** Dashboard/ranking scoped y p95 <3 s.
- [ ] **Checkpoint 4:** Tableau artifact→ledger→dashboard reproducible y reconciliación cero.

## Fase 5 — icebreakers

- [ ] **ICE-01** Modelo versionado de texto/evaluación/score/violación/review.
- [ ] **ICE-02** Reglas locales autoritativas y regex segura.
- [ ] **ICE-03** IA validada, cuatro scores, tips y reevaluaciones.
- [ ] **ICE-04** State machine publish/review/notificación/audit. BLOCKED parcial: OQ-02/OQ-03.
- [ ] **ICE-05** Historial por perfil, violations y efectividad.
- [ ] **ICE-06** Job feedback/calibración/drift.
- [ ] **Checkpoint 5:** corpus adversarial + IA hostil/caída + revisión jerárquica + feedback.

## Fase 6 — nómina

- [ ] **PAY-01** Ledgers append-only, reversas e idempotencia.
- [ ] **PAY-02** Compensación efectiva, días, metas, bonos y competencias. BLOCKED: OQ-09.
- [ ] **PAY-03** Compute decimal completo con control totals. Depende de CAF-04/MET-06.
- [ ] **PAY-04** DTO por audiencia y lifecycle de periodo. BLOCKED parcial: OQ-07/OQ-09.
- [ ] **PAY-05** Export XLSX privado/idempotente/firmado. Depende de OQ-12.

## Fase 7 — cafetería

- [ ] **CAF-01** Catálogo y pedido atómico con snapshot/idempotencia.
- [ ] **CAF-02** KDS CAS + WebSocket p95 <500 ms.
- [ ] **CAF-03** Entrega/débito/reversa/expiración transaccionales.
- [ ] **CAF-04** Consumo reconciliado como input de nómina.

## Fase 8 — Rocket.Chat y estado

- [ ] **COM-01** Reconciliación de canales/membresías. BLOCKED real: OQ-10.
- [ ] **COM-02** Mensajes recurrentes/urgentes, retry y SLA <1 s.
- [ ] **COM-03** Semáforo derivado y bot allowlisted.
- [ ] **Checkpoint 6:** periodo dorado completo + comunicación/status con worker reiniciado.

## Fase 9 — gates externos

- [ ] **INT-01** E2E PC real extensión/helper/vault/8 perfiles/outage. BLOCKED real: PC y credenciales autorizadas.
- [ ] **INT-02** Spike conversación Feature #9 y decisión. BLOCKED real: acceso TalkyTimes/OQ-11.
- [ ] **INT-03** Spike FR-39 y plan condicional; flag permanece off. BLOCKED real: INT-01/OQ-11.

## Fase 10 — producción

- [ ] **QUA-01** Suite de seguridad, dependencias, secrets y logs.
- [ ] **QUA-02** Carga/capacidad y decisión scrypt en 1 GB.
- [ ] **QUA-03** Dos instancias, rolling deploy, failover y backup/restore.
- [ ] **QUA-04** Sincronizar PLAN/agents/CLAUDE/OpenAPI/runbooks/matriz.
- [ ] **Cierre global:** ocho criterios de `tasks/plan.md` §14 demostrados.

## Decisiones externas pendientes

- [ ] **OQ-01** Matriz de Director Operativo.
- [ ] **OQ-02** Alcance/coordinación/jerarquía de reviews.
- [ ] **OQ-03** Reglas/score/aprobación/descansos.
- [ ] **OQ-04** PAT, vista y prueba `vf_` Tableau.
- [ ] **OQ-05** Data contract Tableau.
- [ ] **OQ-06** Timezone Tableau.
- [ ] **OQ-07** Frontera nocturna/periodo.
- [ ] **OQ-08** Retención de auditoría/raw.
- [ ] **OQ-09** Fórmulas de pago/bonos/eventos.
- [ ] **OQ-10** Cuenta de servicio y reglas Rocket.Chat.
- [ ] **OQ-11** Gates Feature #9/FR-39.
- [ ] **OQ-12** Topología HA/storage/RPO/RTO/proxies.
- [ ] **OQ-13** Máximo de perfiles por PC/operador.

## Primera secuencia recomendada de PRs

1. FND-01 + FND-02.
2. FND-03 + FND-04.
3. FND-05 (slice vault) + SEC-01.
4. SEC-03 + sus casos de abuso.
5. SEC-05 + lifecycle de device.
6. Resolver OQ-01/OQ-02 y ejecutar SEC-02.
7. SEC-06 + SEC-07.
8. SEC-09 + suite concurrente del vault.
9. ASY-01 + ASY-02.
10. OPS-01 + OPS-02; después OPS-03.

Esta secuencia cierra primero los bypasses que hoy hacen inseguro construir encima y deja una plataforma durable antes de ETL, nómina o Rocket.Chat.
