# Close project scope — batch 9 (A7: per-profile dashboard & role audiences, FR-20 / MET-07)

Objective: close the unblocked A7 scope from `odd/tasks/HANDOFF-2026-11-22.md`: scope and bound every metrics read endpoint by role/crew audience, fix `ranking()` mixing `EXTENSION` + `TABLEAU` rows, add an operator-safe profile-activity endpoint, and upgrade `/app/metricas` into a per-profile dashboard with timeseries drilldown, ranking, reconciliation, and coordinator access. Base: `feat/scope-19-web-icebreaker-moderation` (`87b9994`). Delivery: `stacked-to-main`, continuing the #5–#23 chain (slice 20 `feat/scope-20-metrics-audience-scoping`, slice 21 `feat/scope-21-web-profile-dashboard`; never push or open PR without user OK).

## Specs

- **S1 (Audience scoping & bounded queries on metrics API)** `GET /metrics/profiles`, `GET /metrics/ranking`, `GET /metrics/profiles/:id/timeseries`, and `GET /metrics/reconciliation` validate calendar dates (`from <= to`) and `limit`, enforce role/crew scope (`ADMIN`/`DIRECTOR_OPERATIVO` global; `COORDINADOR` restricted to profiles held by active crew members; `403` on out-of-scope timeseries), keep `ranking()` strictly on `source = 'EXTENSION'` (no double-counting with Tableau), and update `route-contracts.ts` to `BOUNDED_FILTER` + OpenAPI/matrix snapshots.
- **S2 (Operator-safe profile activity endpoint)** `GET /metrics/me/profiles` (`@RequireRoles('OPERADOR')`) returns extension-only daily communication metrics (`messagesSent`, `responses`, `responseRate`, `icebreakersSent`, `icebreakersReplied`) for profiles currently assigned to the operator, never exposing raw `points` or other operators' data (FR-28).
- **S3 (Web per-profile dashboard & role audiences)** Upgrade `/app/metricas` (`ManagementOverview.tsx` + `metrics-view.ts` + tests) with Bogota date range filter, per-profile ranking/activity table, profile timeseries drilldown (`EXTENSION` vs `TABLEAU`), and reconciliation table for `ADMIN`/`DIRECTOR_OPERATIVO`; expose crew-scoped `/app/metricas` to `COORDINADOR` in `workspace-navigation.ts`.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | Role/crew audience scoping & bounded queries (`from`/`to`/`limit`) on `metrics/profiles`, `ranking` (fixed EXTENSION+TABLEAU double-count), `timeseries` (`403` out-of-scope), `reconciliation`, plus operator-safe `GET /metrics/me/profiles` (no raw `points`), shared contracts, `BOUNDED_FILTER` OpenAPI + matrix refreshed; shared build/lint/typecheck, backend lint/typecheck/243 unit/7 arch/10 contracts, live `metrics.int` 13/13 pass. Risk: item 2 (audience scoping on metrics reads) |
| T2 | S3 | inline | done | Upgraded `/app/metricas` (`ManagementOverview.tsx`, `metrics-view.ts` + tests) with Bogota date range, per-profile ranking table, daily timeseries drilldown (`EXTENSION` vs `TABLEAU`), global reconciliation for `ADMIN`/`DIRECTOR_OPERATIVO`, and crew-scoped `/app/metricas` for `COORDINADOR`; `web-app` lint, typecheck, `vite build`, vitest 19/19 (113/113 tests) pass. Risk: none |
| T3 | S1–S3 | delegated (verifier) | done | Independent verifier (`87b9994..20fda03`) found Blocker #1 (COORDINADOR `profileScope` missing Bogota day & crew range overlap), Major #2 (stale async response race), Major #3 (6-col table in 5-col grid), Minor #4 (operator prior-day history), Minor #5 (`timeseries` ordering & dual-source limit). Fixed on `feat/scope-20-metrics-audience-scoping` (`3fe85a4`) and `feat/scope-21-web-profile-dashboard` (`0451e43`); focused recheck confirmed #1, #2, #4, #5 RESOLVED and surfaced mobile `@media (max-width: 600px)` specificity line on #3 (`web-app/src/index.css:3791-3795`), now fixed. Live `metrics.int` 14/14 (incl. `agency_app`), backend 243 unit / 7 arch / 10 contracts, web lint/typecheck/`vite build`/114 tests all pass. |

## Log

- **L1** (2026-11-23) User: "si" (approved starting A7 right after PRs #17–#23 were published).
- **L2** (2026-11-23) Inspection of `metrics.service.ts` confirmed `profiles`, `ranking`, `timeseries`, and `reconciliation` were all unscoped and unbounded, and `ranking()` summed `EXTENSION` + `TABLEAU` rows together.
- **L3** (2026-11-23) Slice 20 (`feat/scope-20-metrics-audience-scoping`, `a3b4ca7`) verified and committed. Proceeding to Slice 21 (`feat/scope-21-web-profile-dashboard`, T2).
- **L4** (2026-11-23) Slice 21 (`feat/scope-21-web-profile-dashboard`) verified (`web-app` lint/typecheck/build/113 tests). Launching independent verifier (T3) over Batch 9 before reporting.
- **L5** (2026-11-23) All 5 verifier findings resolved (`3fe85a4` on `scope-20`, `0451e43` + mobile reset on `scope-21`), focused recheck confirmed S1–S2 met and #3 mobile reset closed. Batch 9 ready for user decision on pushing/PRs #24–#25.
