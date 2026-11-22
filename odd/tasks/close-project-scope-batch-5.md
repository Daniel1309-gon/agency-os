# Close project scope — batch 5 (unblocked block 1: A3, A5 race, expire-orders realtime, A11, A12)

Objective: close the next unblocked internal items from `odd/tasks/HANDOFF-2026-11-22.md`: A3 (ownership check on extension metrics), A5 (cafeteria order-creation concurrency race + soft-deleted product guard), realtime event on `cafeteria:expire-orders`, A11 (break-ending notice before auto-close), and A12 (payroll `.xlsx` export UI in `web-app`). Base: `feat/scope-10-rls-write-sweep` (PR #14). Delivery: `stacked-to-main`, continuing the #5–#14 chain (slice 11 backend `feat/scope-11-metrics-cafeteria-breaks`, slice 12 web `feat/scope-12-web-payroll-export`; never push or open PR without user OK). Test runners: vitest (unit), `vitest.integration.config.ts` (Postgres + Redis), `pnpm ci:quality`, `TEST_DB_RECREATE=1 pnpm ci:database`.

## Specs

- **S1 (A3 — Extension metrics ownership)** `POST /agent/metrics/batch` must validate optional `x-session-id` as a UUID belonging to `operatorId` (400 if malformed, 403 if unknown or owned by another operator/profile) and verify that `operatorId` held an `ACTIVE` or `ENDED` `profile_assignments` row covering `occurredAt` (`validRange @> occurredAt`) for every distinct `(profileId, occurredAt)` in `events` (403 otherwise).
- **S2 (A5 — Cafeteria order-creation race & soft-delete guard)** `CafeteriaService.createOrder` must reject soft-deleted products (`isNull(cafeteriaProducts.deletedAt)`), return a consistent order shape across fresh and idempotent/concurrent paths, and have a deterministic concurrent race test (including inside `withRequestContext` savepoint) proving two concurrent calls with the same `idempotencyKey` create one order and both resolve cleanly.
- **S3 (`cafeteria:expire-orders` realtime event)** `JobsService.expireOrders()` must return expired order IDs and publish `cafeteria.order.changed` via `RealtimeService.publishCafeteriaOrderChanged(id)` for every expired order so KDS drops them immediately.
- **S4 (A11 — Break-ending notice, FR-16)** Implement a durable pre-expiry break warning (5 minutes before the 20-minute cap, stamping `breaks.notified_at` atomically so each break is notified at most once) inside the worker's break tick, delivering an operator notice via `outbox_events` (or `notifications` if worker-granted — verified against `agency_worker` grants) and covered by integration tests.
- **S5 (A12 — Payroll export button in web)** Add binary download (`requestBlob`) to `web-app/src/services/api-client.ts` (with Bearer auth, 401 refresh, and `Content-Disposition` filename extraction), add `/app/nomina` route in `workspace-navigation.ts`, and add `PayrollManagement` page in `DashboardPage.tsx` listing periods and triggering `GET /payroll/periods/:id/export` for users with `payroll.configure` / `*`.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `metrics.int` RED→GREEN 10/10 (`x-session-id` UUID/owner/profile check + `profile_assignments` ownership at `occurredAt` incl. buffered `ENDED`); `architecture-baseline.json` updated. Risk: item 2 (ingestion ownership guard) |
| T2 | S2, S3 | inline | done | `cafeteria.int` RED→GREEN 18/18 (soft-deleted product rejected, consistent shape across fresh/race, concurrent `withRequestContext` savepoint race); `jobs-realtime-breaks.int` RED→GREEN `expireOrders()` under `agency_worker`. Risk: item 4 (concurrent idempotency race) |
| T3 | S4 | inline | done | `jobs-realtime-breaks.int` RED→GREEN under `agency_worker`: atomic `breaks.notified_at` + single `rocketchat.message.send` DM 5 min before 20-min cap, idempotent on re-run |
| T4 | S1–S4 | delegated (verifier) | done | Independent verifier (`e1297a2`) found Blocker #1 (non-deterministic `23505` race), Major #2 (`notifyEndingBreaks` order & Node clock vs Postgres `now()`), Minor #3 (N+1 ownership query); all fixed in `70c73cb` and confirmed RESOLVED in focused recheck (`lint`, `typecheck`, 239 unit + 7 arch, 10 contracts, plus parent live integration 32/32: `cafeteria.int` 18/18, `metrics.int` 11/11, `jobs-realtime-breaks.int` 3/3). |
| T5 | S5 | inline | in_progress | A12 web payroll `.xlsx` export UI (`feat/scope-12-web-payroll-export`) |

## Log

- **L1** (2026-11-22) User: "abre el pr y luego sigues con el siguiente bloque" (PR #14 opened; continuing with next unblocked block from `odd/tasks/HANDOFF-2026-11-22.md`).
- **L2** (2026-11-22) Read-only explorer mapped A3, A5, `expire-orders`, A11 (`breaks.notified_at` exists in DB but is unused), and A12 (no web payroll UI or binary download in `api-client.ts`).
- **L3** (2026-11-22) Slice 11 (`feat/scope-11-metrics-cafeteria-breaks`, `70c73cb`) verified and closed locally after focused recheck resolved Blocker #1, Major #2, and Minor #3 (S1–S4 all met). Proceeding to Slice 12 (`feat/scope-12-web-payroll-export`, T5 / A12).
