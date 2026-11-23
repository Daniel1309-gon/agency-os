# Fix chain review blockers (PR #30)

Objective: fix the 6 merge blockers found reviewing stacked PRs #5→#29, as one PR on top of #29.
Branch: `fix/scope-26-chain-review-blockers` (base `feat/scope-25-ops03-ops05-e115-closure`). Delivery: single PR #30, one commit per task. Runner: vitest (`pnpm --filter @agency-os/api test`, `test:integration:run`), web `pnpm --filter agency-os-web test`.

## Specs

- S1 — Flaky test: "`tableau.int.spec.ts:252` lee el outbox sin `ORDER BY` y compara el orden exacto con `toEqual`." The assertion must be order-deterministic.
- S2 — "`enqueueAlertsChannel` (`tableau.service.ts:297-308`) pone el mismo `sourceMessageId` en cada fila y no usa `onConflictDoNothing`." With ≥2 active ALERTS channels every channel gets one alert, no `23505`; stale-alert dedup stays one alert per view/date per channel, also under concurrent workers.
- S3 — "`updateChannel` le permite cambiar `purpose` a `ALERTS` o `BOT` en el canal de su cuadrilla." A COORDINADOR may only create/update crew channels with `purpose = 'CREW'`. (Pre-existing CAFETERIA global `createChannel` hole is out of scope: follow-up.)
- S4 — "Si el regex no compila, el `catch` devuelve `true`. El schema tampoco valida que el patrón compile." Create/update of icebreaker rules rejects (400) a REGEX pattern that does not compile with flags `iu`, a REGEX/KEYWORD rule without pattern, and a MANUAL rule with pattern; switching to MANUAL clears `pattern`. Web rules editor can change `kind` and sends `pattern: null` for MANUAL.
- S5 — "`compute()` salta con `continue` a los operadores sin pago y solo actualiza o inserta líneas (upsert). Si se revierten los puntos y se recalcula, la línea vieja queda y sale en el Excel." On recompute, DRAFT lines of operators no longer computed are zeroed (agency_app has no DELETE).
- S6 — "Si se corrige el mapeo o la zona horaria y se reprocesa la corrida, las filas viejas de `tableau_hourly_points` de esa misma corrida no se borran." Re-ingesting a run neutralizes (points = 0) hourly points and staging rows it previously produced before promoting the new ones (no DELETE grant).

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done (RED 23505 → GREEN 14/14, ×3 stable) | 6ac4e13 |
| T2 | S3 | inline | done (RED resolved-instead-of-reject → GREEN 20/20) | 87c1fad |
| T3 | S4 | inline | done (RED schema accepted `([a-z` → GREEN api 14/14, web 36/36, contracts 10/10) | e6094a5 |
| T4 | S5 | inline | done (RED via stash → GREEN) | be9cacd |
| T5 | S6 | inline | done (RED via stash → GREEN; payroll+tableau 39/39) | 1057732 |

Route evidence: each unit is <100 changed lines; no Writer trigger reason → inline.
Risk: item 2 (T2 authz), item 1/money (T4 payroll lines, T5 hourly points) → independent verifier at feature end.

## Log

- L1 (2026-11-23, user): "La cadena completa PR #5 → PR #29 está lista para revisión y merge. revisa" → review verdict request-changes with 6 blockers; proposal "¿Preparo el PR #30 con los 6 bloqueantes?" → user: "si".
- L2 (T1 finding): `payload.sourceMessageId` is sent to Rocket.Chat as `tmid` (thread id, `communication.worker.ts:141`). Tableau alerts used it as dedupe key, so alerts would target a non-existent thread. S2 fix uses `alertKey` + new additive index `0031_outbox_alert_key_unique` instead of a per-channel `sourceMessageId`.
- L3: S4 keeps fail-closed evaluation for legacy invalid rows; ReDoS from admin regex remains a residual (admin-trusted) risk.
- L4 (env): OrbStack Docker API hung ~30 min mid-T4; recovered without intervention. RED for T4/T5 observed by stashing the service fixes.
- L5 (checks): `pnpm ci:quality` exit 0 (audit: 12 low/moderate, under the high gate); `TEST_DB_RECREATE=1 pnpm ci:database` exit 0, 30 files / 365 tests.
- L6 (independent verifier): S1–S6 met. Its 3 probes added as regression tests (payroll recompute idempotency, coordinator isActive/crewId on ALERTS channel, staging supersede with fewer rows + other run untouched); create-form pattern input disabled for MANUAL. Not done (out of scope): API-side trim of rule patterns.
- Next: push + PR #30 on base `feat/scope-25-ops03-ops05-e115-closure`.
