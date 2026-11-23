# Close project scope — batch 6 (A5 remaining: cafeteria Ventas & Inventario)

Objective: close the remaining unblocked A5 scope from `odd/tasks/HANDOFF-2026-11-22.md`: bounded cafeteria sales history & product catalog audit trail on backend/shared, plus active `/app/ventas` and `/app/inventario` pages in `web-app` replacing `PendingWorkspacePage`. Base: `feat/scope-12-web-payroll-export` (PR #16). Delivery: `stacked-to-main`, continuing the #5–#16 chain (slice 13 `feat/scope-13-cafeteria-sales-audit`, slice 14 `feat/scope-14-web-cafeteria-pages`; never push or open PR without user OK). Test runners: vitest (unit + web), `vitest.integration.config.ts` (Postgres + Redis), `pnpm --filter @agency-os/api test:contracts`.

## Specs

- **S1 (A5a — Bounded cafeteria sales query & operator metadata)** `GET /cafeteria/orders` accepts validated query params `status`, `from`, `to` (`YYYY-MM-DD`, Bogota calendar boundaries), and `limit` (`1..500`, default `200`, rejecting `from > to` with 400); joins `users` to return `operatorName` alongside `cancelledAt`/`cancelReason` without breaking KDS realtime shapes; updates `route-contracts.ts` from `UNBOUNDED` to `BOUNDED_FILTER` and refreshes OpenAPI + route policy matrix.
- **S2 (A5a — Cafeteria product catalog audit trail)** Add `cafeteria.product.created` and `cafeteria.product.updated` to `AUDIT_ACTIONS` in `@agency-os/shared`; record audit entries in `CafeteriaService.createProduct` and `CafeteriaService.updateProduct` with authenticated actor ID and sanitized metadata.
- **S3 (A5b — Web Cafeteria Inventario `/app/inventario`)** Implement `CafeteriaInventory` backed by `GET/POST/PATCH /cafeteria/products` (list catalog, create product, edit price/category/prep/pickup deadline, toggle `isAvailable`) with shared schema parsing and unit-tested payload/view helpers.
- **S4 (A5b — Web Cafeteria Ventas `/app/ventas`)** Implement `CafeteriaSales` backed by `GET /cafeteria/orders` with Bogota date range & status filters, closure KPIs (delivered revenue, order count, average ticket, cancelled/expired count, top items), and order history table.
- **S6 (A5 review fixes)** The KDS loads only kitchen-flow orders (`GET /cafeteria/orders?active=true`), so newer delivered history cannot push an active order past the limit; Ventas closure KPIs come from a new server aggregate `GET /cafeteria/sales/summary?from&to` (totals over the whole Bogota range), the history table warns when it hits its 500-row limit, and the status filter includes `ACCEPTED`.
- **S5 (A5b — Navigation & placeholder cleanup)** Remove `pending: true` and add `permission: 'cafeteria.manage'` on `cafeteriaSales` and `cafeteriaInventory` in `workspace-navigation.ts`, wire both routes in `DashboardPage.tsx`, and remove dead `PendingWorkspacePage`.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | `GET /cafeteria/orders` validated via `orderListQuerySchema` (Bogota day bounds, `limit` 1..500, `operatorName`, `cancelledAt`/`cancelReason`), `route-contracts.ts` `BOUNDED_FILTER`, OpenAPI + route-policy-matrix updated, `cafeteria.product.created`/`updated` audit trail added; shared build/lint/typecheck, backend lint/typecheck/241 unit/7 arch/10 contracts, live `cafeteria.int` 20/20, web 91/91 pass. Risk: none |
| T2 | S3, S4, S5 | inline | done | Added `CafeteriaInventory` (`/app/inventario`), `CafeteriaSales` (`/app/ventas`), `cafeteria-management-view.ts` + tests, gated routes with `cafeteria.manage`, removed `pending: true` & `PendingWorkspacePage`; `web-app` lint, typecheck, `vite build`, vitest 16/16 (94/94 tests) pass. Risk: none |
| T3 | S6 | inline | done | `active` filter + `salesSummary` (Postgres `count/sum/avg filter`, top 5 items), shared `cafeteriaSalesSummarySchema`, route contract `BOUNDED_FILTER`, OpenAPI + matrix regenerated; KDS uses `active=true&limit=500`; `CafeteriaSales` KPIs from the summary, truncation notice. backend typecheck/lint/243 unit/7 arch/10 contracts, live `cafeteria.int` 22/22, web lint/typecheck/build/94 tests pass. Risk: none |

## Log

- **L1** (2026-11-22) User: "git push, pr y luego seguimos con el bloque" (PRs #15 and #16 opened; continuing with Batch 6 — A5 Ventas & Inventario).
- **L2** (2026-11-22) Read-only explorer mapped all remaining unblocked Block 1 items (A5 Ventas/Inventario, A7, A8, A9, A10) and verified A5 is 100% unblocked and removes the last `pending: true` placeholders in `web-app`.
- **L3** (2026-11-22) Slice 13 (`feat/scope-13-cafeteria-sales-audit`, `23a459a`) verified and committed. Proceeding to Slice 14 (`feat/scope-14-web-cafeteria-pages`, T2).
- **L4** (2026-11-22) Slice 14 (`feat/scope-14-web-cafeteria-pages`) verified (`web-app` lint/typecheck/build/94 tests). Batch 6 (A5 Ventas & Inventario) complete locally; ready for user decision on pushing/opening PRs #17–#18 or continuing with A7–A10.
- **L5** (2026-11-22) Review of Batch 6 found two limit defects (KDS could drop active orders past 200 rows; Ventas KPIs computed client-side from at most 500 rows). User: "si, dale" — fixed as T3 on slice 14.
