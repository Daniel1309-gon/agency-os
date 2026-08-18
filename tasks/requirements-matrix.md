# Matriz de requisitos — corte de Entrega 1

Fecha del corte: 2026-08-17. Fuente comercial: `agency-os-propuesta-comercial-v3.md`, Entrega 1 (semanas 1–9). Tableau y el resto de Entrega 2/3 se conservan como trazabilidad, pero no son prioridad de implementación en este corte.

Estados según `tasks/plan.md`: `Parcial`, `No cumple`, `Gate externo`, `Descartado`.

| Requisito | Estado al corte | Entrega | Evidencia o siguiente acción |
|---|---|---|---|
| FR-01 Login, JWT, refresh, scrypt | Parcial | E1 | Rotación atómica, reuse detection, rate limit y rehash en `backend/src/modules/auth/`; falta cerrar política de turno en login/refresh y pruebas HTTP/cookies. |
| FR-02 RBAC y RLS | Parcial crítico | E1 | Guards y RLS base existen; falta runtime con rol DB no propietario, matriz Director/Coordinador y cobertura completa. |
| FR-03 IP de oficina | Parcial avanzado | E1 | `IpAllowlistGuard` fail-closed, health explícito y `TRUSTED_PROXY_CIDRS`; pruebas reales en `guards.int.spec.ts`. |
| FR-04 Operador dentro de turno | Parcial avanzado | E1 | `ShiftWindowGuard` protege vault, sesiones, métricas, pedidos, breaks y estado; falta enforcement en login/refresh y materialización completa de turnos. |
| FR-05 Auditoría inmutable | Parcial | E1 | `AuditService` y sanitización allowlist instrumentan vault; faltan trigger/particiones/retención y más dominios. |
| FR-06 CRUD de perfiles | Parcial | E1 | CRUD y desactivación existen; faltan auditoría de cambios, ETag/carrera y scope de cuadrilla. |
| FR-07 Vault cifrado | Parcial avanzado | E1 | Device principal validado, grant/redeem con binding y consumo atómico; falta rotación operativa de claves y E2E con extensión. |
| FR-08 Asignación sin sesiones simultáneas | Parcial avanzado | E1 | Rangos `[)`, exclusiones, 409, reaper de `LAUNCHING`/asignación vencida; falta relevo transaccional completo con sesión saliente. |
| FR-09 Historial operador/perfil/turno | Parcial | E1 | Tablas y constraints existen; falta proyección histórica integrada con puntos/assignment. |
| FR-10 Panel de perfiles/estado | Parcial | E1 | Proyección de estado derivado `ALERT > BREAK > ONLINE > OFFLINE`; falta snapshot HTTP completo por perfil y WebSocket. |
| FR-11 Extensión obtiene credencial | Gate externo | E1 | Backend listo para grant/redeem; el spike aún usa `credenciales.json`. Requiere PC, helper, credenciales de prueba y E2E autorizado. |
| FR-12 Perfiles nativos aislados | Gate externo | E1 | Mapping lógico existe; aislamiento de cookies requiere validación en PC con 5/8 perfiles. |
| FR-13 Detección automática de caída | Descartado | E1 | No crear polling encubierto; conservar heartbeat y estados requeridos. |
| FR-14 Métricas de extensión | Parcial | E1 | Endpoint autenticado por device y turno, deduplicación base; falta validar sesión/perfil/device y límites semánticos. |
| FR-15 Inicio/fin de turno | Parcial | E1 | Endpoints y job de cierre existen; falta materialización idempotente y coordinación completa con sesiones. |
| FR-16 Breaks y aviso | Parcial | E1 | Start/end y guardia de turno existen; falta generación desde plantilla, aviso durable y autocierre. |
| FR-17 Tiempo efectivo | Parcial | E1 | Endpoint y campos existen; falta fórmula por intersección de sesiones/breaks/overrides y scope de crew. |
| FR-18 Dashboard de perfil | Parcial | E2 | No se prioriza en este corte; requiere agregación y rendimiento. |
| FR-19 Tableau y caché | Parcial / fuera de prioridad | E2 | Se conserva el discovery; no se implementa en este ciclo. |
| FR-20 Visibilidad por rol | Parcial | E1/E2 | Permisos base existen; falta DTO por audiencia y scope de cuadrilla consistente. |
| FR-21 Icebreakers workflow | Parcial / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-22 Reglas locales + IA | No cumple / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-23 Score multidimensional | No cumple / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-24 Tips y reevaluación | Parcial / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-25 Trazabilidad de bloqueos | Parcial / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-26 Feedback real | No cumple / fuera de prioridad | E2 | Depende de métricas confiables. |
| FR-27 Historial icebreakers | Parcial / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-28 Puntos/COP y DTO operador | No cumple / fuera de prioridad | E2 | No se implementa en este corte; no alterar reglas monetarias por suposición. |
| FR-29 Compensación y eventos | Parcial / fuera de prioridad | E2 | Requiere decisiones de negocio OQ-09. |
| FR-30 Metas y bonos | Parcial / fuera de prioridad | E2 | Requiere decisiones de negocio OQ-09. |
| FR-31 Exportación XLSX | No cumple / fuera de prioridad | E2 | No se implementa en este corte. |
| FR-32 Productos cafetería | Parcial / fuera de prioridad | E2 | Existe base; no es camino crítico de E1. |
| FR-33 Pedidos | Parcial / fuera de prioridad | E2 | Existe idempotencia base; no se amplía en este corte. |
| FR-34 KDS | Parcial / fuera de prioridad | E2 | WebSocket/CAS quedan fuera de este corte. |
| FR-35 Débito de nómina | Parcial / fuera de prioridad | E2 | Integración económica queda fuera de este corte. |
| FR-36 Canales Rocket.Chat | Parcial | E0/E1 | Rocket.Chat operativo es Entrega 0; reconciliación backend requiere OQ-10. |
| FR-37 Mensajes/alertas | Parcial | E0/E1 | Outbox base existe; dispatcher durable y SLA requieren ASY/credenciales Rocket.Chat. |
| FR-38 Semáforo y bot | Parcial | E1 | Semáforo derivado implementado; WebSocket y bot allowlisted integrado requieren realtime/Rocket.Chat. |
| FR-39 Interacciones por país | Gate externo | E3 | Feature flag permanece apagada; requiere spike TalkyTimes y decisión explícita. |

## NFR

| Grupo | Estado al corte | Evidencia o siguiente acción |
|---|---|---|
| Seguridad | Parcial avanzado | Auth, IP, device, shift, vault y auditoría base tienen pruebas unitarias/integración; faltan roles DB runtime, RLS completo, retención y E2E de extensión. |
| Rendimiento | No medido | No ejecutar carga de Tableau/E2; medir scrypt y rutas E1 en infraestructura objetivo. |
| Compatibilidad | Parcial | API valida Zod y Swagger existe; falta contrato compartido estable con web/extensión. |
| Disponibilidad/HA | Parcial | PostgreSQL/Redis Docker validan integración; falta worker/WS HA, despliegue de dos APIs y failover. |
| Mantenibilidad | Parcial | Toolchain raíz reproducible y commits incrementales; falta enforcement AST de boundaries y repositories/ports. |

## Gates externos que siguen abiertos

- `INT-01`: PC Windows de prueba, helper, extensión forcelist, credenciales TalkyTimes autorizadas y prueba con 8 perfiles.
- `INT-02`/`INT-03`: spike de conversación/interacciones TalkyTimes; no bloquean la seguridad de E1, pero mantienen Feature #9/FR-39 apagados.
- `OQ-01`/`OQ-02`: matriz definitiva de Director Operativo y alcance de Coordinador.
- `OQ-03`: reglas finales de breaks, aprobación y score.
- `OQ-10`: cuenta de servicio y reglas de Rocket.Chat para cerrar bot/dispatcher.
