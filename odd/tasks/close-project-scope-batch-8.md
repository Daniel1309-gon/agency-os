# Close project scope — batch 8 (A8 remaining: icebreaker moderation & rules management)

Objective: close the remaining unblocked A8 scope from `odd/tasks/HANDOFF-2026-11-22.md` (FR-25 to FR-27): enrich and bound the reviewer violations queue, mark violations reviewed atomically during review, allow toggling and auditing rules, and add the reviewer moderation & admin rules UI in `web-app`. Base: `feat/scope-17-icebreaker-ui` (`22e3bdf`). Delivery: `stacked-to-main`, continuing the #5–#17 chain (slice 18 `feat/scope-18-icebreaker-review-rules` backend+shared, slice 19 `feat/scope-19-web-icebreaker-moderation` web; never push or open PR without user OK).

## Specs

- **S1 (FR-25 / FR-27 — Enriched bounded violations queue)** `GET /icebreakers/violations` validates `from`/`to` (Bogota calendar dates, `from <= to`), `operatorId` (UUID), `status` (`OPEN | REVIEWED`), and `limit` (`1..200`, default `100`), returns enriched rows (`icebreakerText`, `icebreakerStatus`, `operatorId`, `operatorName`, `profileId`, `profileName`, `ruleCode`, `ruleName`, `severity`, `status`, `reviewedBy`, `reviewedAt`, `createdAt`) newest-first within `reviewerScope(actor)`, and updates `route-contracts.ts` to `BOUNDED_FILTER` + OpenAPI snapshots.
- **S2 (FR-25 — Transactional review resolution)** `IcebreakersService.review` atomically records the `icebreaker_reviews` verdict, marks `OPEN` `icebreaker_violations` for that icebreaker as `REVIEWED` (`reviewedBy`, `reviewedAt`), and on `OVERRIDDEN_ALLOW` promotes non-`PUBLISHED` icebreakers to `APPROVED` (never downgrading `PUBLISHED`).
- **S3 (FR-26 — Rule toggle & audit)** `PATCH /icebreaker-rules/:id` accepts `isActive?: boolean`, increments optimistic `version`, and records `icebreaker.rule.updated` in `audit_log`.
- **S4 (Web — Reviewer moderation & admin rules UI)** Route `/app/icebreakers-revision` (`permission: 'icebreaker.review'`) for `COORDINADOR`, `DIRECTOR_OPERATIVO`, and `ADMIN` lets reviewers filter and resolve violations (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `OVERRIDDEN_ALLOW` + reason) and lets users with `icebreaker.rules.manage` / `*` create, edit, and activate/pause rules.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2, S3 | inline | done | Enriched bounded `GET /icebreakers/violations` (Bogota dates, crew scope, `BOUNDED_FILTER`, OpenAPI + matrix refreshed), transactional `review()` marking `OPEN` violations `REVIEWED` + safe `OVERRIDDEN_ALLOW`, `isActive` toggle + `icebreaker.rule.updated` audit, shared schemas; shared build/lint/typecheck, backend lint/typecheck/243 unit/7 arch/10 contracts, live `icebreakers.int` 13/13 + `rls-service-writes.int` 7/7 pass. Risk: none |
| T2 | S4 | inline | in_progress | Slice 19 (`feat/scope-19-web-icebreaker-moderation`) |

## Log

- **L1** (2026-11-23) User: "continua donde lo dejo claude". Finished Batch 7 verifier follow-ups on `feat/scope-17-icebreaker-ui` (`22e3bdf`: `publish` active-assignment guard + clean AI approval copy) and started Batch 8 to finish the remaining unblocked A8 scope (reviewer queue + rules UI).
- **L2** (2026-11-23) Slice 18 (`feat/scope-18-icebreaker-review-rules`) verified and ready to commit. Proceeding to Slice 19 (`feat/scope-19-web-icebreaker-moderation`, T2).
