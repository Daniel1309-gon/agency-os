# Matriz de requisitos — corte de Entrega 1

Fecha del corte: 2026-08-20. Catálogo verificable: [`requirements-catalog.json`](requirements-catalog.json).

Fuente auditada: `agency-os-requerimientos.md` v2.2, ubicada en
`../../FREELANCE/AGENCIA CAROL/documentos/agency-os-requerimientos.md` y fijada al SHA-256
`E4A7BBA8962C08D4685E65677BB42E695638C7D4B91C2D4868CA6AE30361E0AE`.

Estados canónicos: `COMPLIANT` (aceptación demostrada), `PARTIAL` (implementación o evidencia
incompleta), `BLOCKED` (depende de una entrada externa identificada) y `N/A` (fuera de alcance por
decisión explícita). Una pregunta abierta nunca convierte un requisito en completo.

## Requisitos funcionales

| ID | Requisito | Estado | Entrega | Tareas | Evidencia actual / brecha |
|---|---|---|---|---|---|
| FR-01 | Login, JWT, refresh y scrypt | `PARTIAL` | E1 | SEC-03, SEC-04, SEC-06 | [`auth.int.spec.ts`](../backend/src/test/integration/auth.int.spec.ts); falta cerrar todo el contrato de sesión/turno. |
| FR-02 | RBAC y RLS | `PARTIAL` | E1 | FND-04, SEC-01, SEC-02 | [`rls.int.spec.ts`](../backend/src/test/integration/rls.int.spec.ts); falta runtime DB no propietario y matriz Director/Coordinador. |
| FR-03 | IP de oficina | `PARTIAL` | E1 | SEC-03 | [`guards.int.spec.ts`](../backend/src/test/integration/guards.int.spec.ts); falta cerrar topología real de proxies. |
| FR-04 | Operador dentro de turno | `PARTIAL` | E1 | SEC-06, OPS-05 | [`shifts-and-crews.int.spec.ts`](../backend/src/test/integration/shifts-and-crews.int.spec.ts); falta materialización completa. |
| FR-05 | Auditoría inmutable | `PARTIAL` | E1 | SEC-07, SEC-08 | [`audit.service.ts`](../backend/src/common/audit/audit.service.ts); faltan inmutabilidad DB, partición y retención. |
| FR-06 | CRUD de perfiles | `PARTIAL` | E1 | OPS-01 | [`profiles.controller.ts`](../backend/src/modules/profiles/profiles.controller.ts); faltan scope, ETag y auditoría completa. |
| FR-07 | Vault cifrado | `PARTIAL` | E1 | SEC-09, SEC-10, INT-01 | [`vault.int.spec.ts`](../backend/src/test/integration/vault.int.spec.ts); falta rotación operativa y E2E con extensión. |
| FR-08 | Asignación sin sesiones simultáneas | `PARTIAL` | E1 | OPS-02, OPS-03 | [`assignments.int.spec.ts`](../backend/src/test/integration/assignments.int.spec.ts); falta relevo transaccional completo. |
| FR-09 | Historial operador/perfil/turno | `PARTIAL` | E1 | OPS-02, OPS-07 | [`schema-invariants.int.spec.ts`](../backend/src/test/integration/schema-invariants.int.spec.ts); falta proyección histórica integrada. |
| FR-10 | Panel de perfiles/estado | `PARTIAL` | E1 | OPS-04, ASY-03 | [`operator-status.int.spec.ts`](../backend/src/test/integration/operator-status.int.spec.ts); falta snapshot por perfil y WebSocket HA. |
| FR-11 | Extensión obtiene credencial | `BLOCKED` | E1 | SEC-05, SEC-09, INT-01 | Backend grant/redeem probado en [`vault.int.spec.ts`](../backend/src/test/integration/vault.int.spec.ts); bloqueado por PC y credenciales autorizadas. |
| FR-12 | Perfiles nativos aislados | `BLOCKED` | E1 | INT-01 | Diseño registrado en [`agents.md`](../agents.md); falta prueba con 5/8 perfiles en PC objetivo. |
| FR-13 | Detección automática de caída | `N/A` | E1 | N/A | Fuera de alcance por decisión explícita en [`agents.md`](../agents.md); se conserva heartbeat/estado manual. |
| FR-14 | Métricas de extensión | `PARTIAL` | E1 | MET-01, SEC-05, SEC-06, OPS-03 | [`metrics.int.spec.ts`](../backend/src/test/integration/metrics.int.spec.ts); faltan límites y validación semántica completa. |
| FR-15 | Inicio/fin de turno | `PARTIAL` | E1 | OPS-03, OPS-05 | [`shifts-and-crews.int.spec.ts`](../backend/src/test/integration/shifts-and-crews.int.spec.ts); falta materialización idempotente total. |
| FR-16 | Breaks y aviso | `PARTIAL` | E1 | OPS-06, ASY-02 | [`breaks.service.ts`](../backend/src/modules/breaks/breaks.service.ts); falta aviso durable y autocierre. |
| FR-17 | Tiempo efectivo | `PARTIAL` | E1 | OPS-07 | [`shifts.service.ts`](../backend/src/modules/shifts/shifts.service.ts); falta fórmula final por intersecciones y scope. |
| FR-18 | Dashboard de perfil | `PARTIAL` | E2 | MET-07 | Lecturas base en [`metrics.int.spec.ts`](../backend/src/test/integration/metrics.int.spec.ts); fuera de prioridad de E1. |
| FR-19 | Tableau y caché | `PARTIAL` | E2 | MET-03…MET-06 | Discovery conservado en [`tasks/evidence/tableau`](evidence/tableau/README.md); falta worksheet horaria. |
| FR-20 | Visibilidad por rol | `PARTIAL` | E1/E2 | FND-04, SEC-02, PAY-04 | Clasificación base en [`route-policy.architecture.spec.ts`](../backend/src/common/auth/route-policy.architecture.spec.ts); faltan DTO por audiencia y scope. |
| FR-21 | Workflow de icebreakers | `PARTIAL` | E2 | ICE-01, ICE-04 | Superficie base en [`icebreakers.controller.ts`](../backend/src/modules/icebreakers/icebreakers.controller.ts); fuera de prioridad de E1. |
| FR-22 | Reglas locales e IA | `PARTIAL` | E2 | ICE-02 | Cliente aislado probado en [`ai-engine.client.spec.ts`](../backend/src/modules/icebreakers/ai-engine.client.spec.ts); falta motor autoritativo. |
| FR-23 | Score multidimensional | `PARTIAL` | E2 | ICE-01, ICE-02 | Esquemas preliminares en [`icebreakers.schemas.ts`](../backend/src/modules/icebreakers/icebreakers.schemas.ts). |
| FR-24 | Tips y reevaluación | `PARTIAL` | E2 | ICE-03 | Flujo preliminar en [`icebreakers.service.ts`](../backend/src/modules/icebreakers/icebreakers.service.ts). |
| FR-25 | Trazabilidad de bloqueos | `PARTIAL` | E2 | ICE-01, ICE-04, ICE-05 | Modelo preliminar en [`icebreakers.schemas.ts`](../backend/src/modules/icebreakers/icebreakers.schemas.ts). |
| FR-26 | Feedback real | `PARTIAL` | E2 | ICE-06 | Brecha y aceptación documentadas en [`plan.md`](plan.md). |
| FR-27 | Historial de icebreakers | `PARTIAL` | E2 | ICE-01, ICE-05 | Modelo preliminar en [`icebreakers.schemas.ts`](../backend/src/modules/icebreakers/icebreakers.schemas.ts). |
| FR-28 | Puntos/COP y DTO operador | `PARTIAL` | E2 | PAY-01, PAY-03, PAY-04 | Cálculo base probado en [`payroll.int.spec.ts`](../backend/src/test/integration/payroll.int.spec.ts); faltan reglas firmadas. |
| FR-29 | Compensación y eventos | `PARTIAL` | E2 | PAY-02 | Base en [`payroll.service.ts`](../backend/src/modules/payroll/payroll.service.ts); depende de OQ-09. |
| FR-30 | Metas y bonos | `PARTIAL` | E2 | PAY-02 | Base en [`payroll.service.ts`](../backend/src/modules/payroll/payroll.service.ts); depende de OQ-09. |
| FR-31 | Exportación XLSX | `PARTIAL` | E2 | PAY-05 | Contrato pendiente documentado en [`plan.md`](plan.md). |
| FR-32 | Productos cafetería | `PARTIAL` | E2 | CAF-01 | Base probada en [`cafeteria.int.spec.ts`](../backend/src/test/integration/cafeteria.int.spec.ts). |
| FR-33 | Pedidos | `PARTIAL` | E2 | CAF-01 | Idempotencia base en [`cafeteria.int.spec.ts`](../backend/src/test/integration/cafeteria.int.spec.ts). |
| FR-34 | KDS | `PARTIAL` | E2 | CAF-02, ASY-03 | Servicio base en [`cafeteria.service.ts`](../backend/src/modules/cafeteria/cafeteria.service.ts); falta CAS/WebSocket. |
| FR-35 | Débito de nómina | `PARTIAL` | E2 | CAF-03, CAF-04, PAY-03 | Flujo preliminar en [`cafeteria.service.ts`](../backend/src/modules/cafeteria/cafeteria.service.ts). |
| FR-36 | Canales Rocket.Chat | `PARTIAL` | E0/E1 | COM-01 | Integración base en [`communication.int.spec.ts`](../backend/src/test/integration/communication.int.spec.ts); credencial verificada contra el servidor real y reglas fijadas en [ADR 0010](../docs/decisions/0010-rocketchat-channels-membership-and-routing.md). Falta vincular canal y escaneo de deriva; la sincronización de miembros sale del criterio por decisión del cliente. |
| FR-37 | Mensajes y alertas | `PARTIAL` | E0/E1 | COM-02, ASY-02 | Outbox y entrega base en [`communication.int.spec.ts`](../backend/src/test/integration/communication.int.spec.ts); falta worker durable. |
| FR-38 | Semáforo y bot | `PARTIAL` | E1 | COM-03, ASY-03 | Estado derivado en [`operator-status.int.spec.ts`](../backend/src/test/integration/operator-status.int.spec.ts); falta realtime HA. |
| FR-39 | Interacciones por país | `BLOCKED` | E3 | INT-03 | Feature flag apagada y gate externo registrados en [`agents.md`](../agents.md). |

## Requisitos no funcionales

| ID | Grupo | Estado | Tareas | Evidencia actual / brecha |
|---|---|---|---|---|
| NFR-SECURITY | Seguridad | `PARTIAL` | QUA-01 | [`http-security.int.spec.ts`](../backend/src/test/integration/http-security.int.spec.ts); faltan roles DB, RLS total y E2E. |
| NFR-PERFORMANCE | Rendimiento | `PARTIAL` | QUA-02 | Scrypt tiene pruebas en [`crypto.spec.ts`](../backend/src/common/auth/crypto.spec.ts); falta carga en infraestructura objetivo. |
| NFR-COMPATIBILITY | Compatibilidad | `PARTIAL` | FND-04, INT-01 | Contratos iniciales en [`packages/shared`](../packages/shared/src/contracts/agency.ts); falta snapshot OpenAPI y extensión real. |
| NFR-AVAILABILITY_HA | Disponibilidad/HA | `PARTIAL` | ASY-01, ASY-03, QUA-03 | Redis real probado en [`realtime-redis.int.spec.ts`](../backend/src/test/integration/realtime-redis.int.spec.ts); dos APIs y restore local PASS en [`ha-local-game-day-2026-08-26.md`](evidence/ha-local-game-day-2026-08-26.md); falta failover HA gestionado y RPO/RTO. |
| NFR-MAINTAINABILITY | Mantenibilidad | `PARTIAL` | FND-05, QUA-04 | Toolchain reproducible documentado en [`CLAUDE.md`](../CLAUDE.md); faltan boundaries y repository/port. |

## Registro de decisiones abiertas

Las fechas son objetivos internos de resolución para evitar que una OQ quede indefinida; no se
interpretan como aprobación de negocio. `PARTIAL` significa que existe evidencia parcial, pero la
pregunta continúa abierta.

| ID | Estado | Responsable | Fecha límite | Bloquea | Pregunta pendiente |
|---|---|---|---|---|---|
| OQ-01 | `RESOLVED` | Daniel documenta la matriz | 2026-08-24 | — | ADMIN conserva usuarios, RBAC, seguridad, configuración y vault; Director Operativo opera globalmente sin esas facultades. |
| OQ-02 | `RESOLVED` | Daniel documenta la matriz | 2026-08-24 | — | Coordinador queda limitado a su cuadrilla vigente y revisa sus icebreakers; Director/ADMIN revisan globalmente; Operador solo los propios. |
| OQ-03 | `OPEN` | Clienta decide; Daniel coordina | 2026-08-31 | OPS-06, ICE-04 | Reglas de breaks, score y aprobación. |
| OQ-04 | `PARTIAL` | Daniel + responsable Tableau | 2026-09-18 | MET-03 | PAT/inventario confirmados; queda cerrar el insumo temporal. |
| OQ-05 | `OPEN` | Responsable Tableau del cliente | 2026-09-18 | MET-04, MET-05 | Data contract de worksheet plana horaria. |
| OQ-06 | `OPEN` | Responsable Tableau del cliente | 2026-09-18 | MET-04, MET-05 | Zona horaria de las marcas Tableau. |
| OQ-07 | `OPEN` | Clienta decide; Daniel modela | 2026-09-25 | MET-05, PAY-04 | Frontera nocturna y pertenencia al periodo. |
| OQ-08 | `OPEN` | Clienta decide; Daniel propone | 2026-08-31 | SEC-08 | Retención legal/operativa de auditoría y raw. |
| OQ-09 | `OPEN` | Clienta decide; Daniel modela | 2026-10-02 | PAY-02, PAY-04 | Fórmulas exactas de pago, metas, bonos y eventos. |
| OQ-10 | `RESOLVED` | Clienta decidio; Daniel documenta | 2026-08-28 | — | Canales de cuadrilla privados; membresia manual del coordinador con deteccion de deriva; salir quita el historial; alerta urgente por DM al coordinador. Ver [ADR 0010](../docs/decisions/0010-rocketchat-channels-membership-and-routing.md). |
| OQ-11 | `OPEN` | Clienta autoriza; Daniel ejecuta spike | 2026-09-11 | INT-02, INT-03 | Gates Feature #9/FR-39 y límites permitidos. |
| OQ-12 | `RESOLVED` | Daniel: baseline de producción | 2026-08-28 | — | Dos API stateless + LB gestionado, worker separado con leases, PostgreSQL/Redis HA, storage privado, backup/PITR, RPO 5 min, RTO 30 min y CIDR del proxy obligatorio al desplegar. |
| OQ-13 | `OPEN` | Daniel mide; clienta facilita PC | 2026-09-11 | INT-01, QUA-02 | Máximo real de perfiles concurrentes. |

## Gates externos activos de Entrega 1

- `INT-01`: PC Windows de prueba, helper, extensión forcelist, credenciales TalkyTimes autorizadas y prueba con ocho perfiles.
- `OQ-01`/`OQ-02`: resueltas en la matriz y ADR 0009; SEC-02 conserva la ejecución de pruebas RLS.
- `OQ-10`: resuelta en [ADR 0010](../docs/decisions/0010-rocketchat-channels-membership-and-routing.md); COM-01 y COM-02 quedan desbloqueadas para construir.
- Las OQ de Tableau no bloquean cerrar SEC/OPS/ASY de Entrega 1.
