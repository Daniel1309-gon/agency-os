# Close project scope — batch 3 (unblocked internal work: block 1 of the remaining-scope list)

Objective: deliver the remaining-scope items that need no client answer, starting with A2 (FR-38 semáforo) and A4 (FR-34 KDS). Branch: `feat/scope-08-semaforo-kds` (based on `feat/scope-07-payroll-export-audit`, PR #11). Delivery: `stacked-to-main`, continuing the #5–#11 chain. Test runners: vitest (unit), `vitest.integration.config.ts` (Postgres + Redis), web vitest.

## Specs

- **S1 (A2, FR-38)** Requirements v2.2: "Vista en tiempo real del estado de cada operador: activo (verde), en break (amarillo), alerta (rojo). Se actualiza automáticamente." Remaining-scope item A2 said the status was set manually (`operator-status.service.ts:11`).
- **S2 (A4, FR-34 / CAF-02)** `tasks/plan.md:146`: "Máquina de estados con CAS, `pickupDeadlineAt` congelado, … dos entregas concurrentes producen una sola transición/débito." Plus "plazo de retiro por producto (hoy fijo en 30 min)". Assumption: an order with several products uses the shortest `pickupDeadlineMinutes` among its lines (the most perishable item decides).
- **S3 (A4 → FR-35)** The DELIVERED debit's `business_date` must be the calendar date in Bogota, not UTC (found while reading `updateStatus`: `now.toISOString().slice(0, 10)`).

- **S4 (A6, FR-35)** `tasks/plan.md:147`: "DELIVERED crea un débito exactamente una vez; corrección crea reversa enlazada; compute suma entradas del periodo; periodo cerrado rechaza mutaciones". Remaining-scope item A6: "Sumarlos como descuento; reversos; respetar el periodo cerrado". Assumptions: `net_cop` keeps its current meaning (earnings after commission) and the deduction is its own column `cafeteria_debit_cop`; the Excel "Total a Pagar" is net + adjustments − cafeteria; a negative total is shown as is until the client answers (question 2.6).
- **S5 (found during A6)** Under `agency_app`, the CAFETERIA role could not insert the delivery debit (RLS `account_system_write` admits only ADMIN and JOB), so every delivery failed with 42501 in production.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done (no change) | Already met: `realtime.service.ts:193-218` derives ALERT > BREAK > ONLINE > OFFLINE from the declared alert, in-progress breaks and active sessions; breaks, assignments, shifts and jobs publish every change (`publishOperatorChanged`); `operator-status.int.spec.ts:52` covers it. The scope map was wrong. |
| T2 | S2, S3 | inline | done | RED→GREEN: CAS race (deterministic with a row-lock blocker), product deadline 30→15 min, Bogota debit date `2026-08-04`→`2026-08-03`; web 409 notice. `pnpm ci:quality` exit 0 (239, web 86), `pnpm ci:database` exit 0 (314). Risk: item 4 (concurrent transitions) |

| T3 | S5 | inline | done | `66dd009`; migration 0027 policy; rls.int RED (kitchen debit refused) → GREEN 20/20. Risk: item 2 (RLS policy) |
| T4 | S4 | inline | done | migration 0028 `cafeteria_debit_cop`; payroll.int RED 4 → GREEN 23/23, unit 13/13; `pnpm ci:quality` exit 0, `pnpm ci:database` exit 0 (321, drizzle check clean). Risk: item 1 (new column on a money table, additive) |

## Log

- **L1** (2026-11-22) User: "dale" to the proposal "¿Arranco con el bloque 1? Te recomiendo empezar por A2 y A4".
- **L2** (2026-11-22) T1: FR-38 already met; remaining-scope item A2 was based on a wrong map entry. T2: also fixed the UTC business date of the cafeteria debit (S3), found while reading `updateStatus`.
- **L3** (2026-11-22) Independent verifier (gentle-ai-verify, Opus 5.5): S1, S2, S3 MET; the web 409 notice works. Nit: the DELIVERED/CANCELLED race was decided by the transition table (READY cannot go to CANCELLED), not by the CAS. Fixed by racing DELIVERED/DELIVERED and READY/CANCELLED from PREPARING. Pre-existing advisory: `account()` used a UTC month start; fixed RED→GREEN (end of August in Bogota). Still open (pre-existing advisory): the `cafeteria:expire-orders` job (`jobs.service.ts:153-155`) does not publish a realtime event, so a KDS drops an expired order only on its next reload. `pnpm ci:quality` exit 0, `pnpm ci:database` exit 0 (315). The verifier confirmed the expire job and DELIVERED serialize on `status = 'READY'`.
- **L4** (2026-11-22) A6 led to a pre-existing production blocker (S5): the kitchen could not mark orders DELIVERED under RLS. Fixed first, as its own commit. Lesson: the integration harness runs as superuser, so every service path that writes to a FORCE RLS table under a non-ADMIN role is untested; only `rls.int.spec.ts` exercises `agency_app`. Follow-up worth planning: run the service integration suites as `agency_app` with request context.
- **L5** (2026-11-22) A6 not covered and still open: linked reversal for a correction after delivery (no flow exists yet); a debit dated inside a LOCKED period after its compute is not picked up until the period is reopened (the closed-period trigger only blocks CLOSED/PAID).
- **L6** (2026-11-22) Independent verifier (gentle-ai-verify, Opus 5.5): S4 and S5 MET. RLS bypass probes as `agency_app` all rejected (another operator's order, a not-yet-delivered order, NULL amount, other roles, UPDATE/DELETE); a duplicate debit hits the unique index; the closed-period trigger still applies. The verifier ran the service end to end under `agency_app` and the parent kept it as a regression test. Advisory fixed RED→GREEN: a fully refunded consumption wrote an all-zero line. `pnpm ci:quality` exit 0, `pnpm ci:database` exit 0 (323).
