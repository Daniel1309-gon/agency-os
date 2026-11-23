# Close project scope — batch 10 (A9: Tableau daily schedule, freshness/alerts, raw CSV artifact & offline reprocess)

Objective: close the unblocked A9 scope from `odd/tasks/HANDOFF-2026-11-22.md`: configurable per-view daily schedule (default `09:15 America/Bogota`), freshness endpoint (`GET /tableau/freshness`) & deduplicated `ALERTS` outbox notifications, plus raw CSV artifact persistence and offline reprocessing (`POST /tableau/runs/:id/reprocess`) without touching client-blocked hourly worksheet/5-55 attribution items. Base: `feat/scope-21-web-profile-dashboard` (PR #25). Delivery: `stacked-to-main`, continuing the #5–#25 chain (slice 22 `feat/scope-22-tableau-schedule-freshness`, slice 23 `feat/scope-23-tableau-csv-reprocess`; never push or open PR without user OK).

## Specs

- **S1 (Migration 0030 & per-view 09:15 schedule)** Add `schedule_time` (default `'09:15'`), `schedule_timezone` (default `'America/Bogota'`), `freshness_sla_minutes` (default `120`) to `tableau_views` and `raw_csv`, `raw_csv_bytes`, `alerted_at` to `etl_runs` via migration `0030_tableau_schedule_artifacts.sql` (+ `_journal.json` idx 30). Add `PATCH /tableau/views/:id` and `TableauService.enqueueScheduledRuns(now)` (invoked by `TableauWorker`) queueing yesterday's calendar date once per active view at/after its configured schedule time.
- **S2 (Freshness endpoint & deduplicated `ALERTS` outbox notifications)** Add `GET /tableau/freshness` reporting per-view latest run, `expectedBusinessDate`, `isStale`, and `staleReason`; enqueue deduplicated `rocketchat.message.send` alerts to active `ALERTS` channels on `FAILED`/`PARTIAL` runs (stamped via `etl_runs.alerted_at`) and missed freshness SLAs; bound `GET /tableau/runs` (`BOUNDED_FILTER`, default 100 max 500) and refresh OpenAPI + route policy matrix.
- **S3 (Raw CSV artifact persistence & offline reprocess)** Persist `raw_csv`, `raw_csv_bytes`, and `checksum` on `etl_runs` as soon as Tableau download completes (even when mapping/validation later fails), and add `POST /tableau/runs/:id/reprocess` to re-run parse/stage/promote strictly from the stored `raw_csv` without calling `TableauClient`.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | Migration `0030_tableau_schedule_artifacts.sql` (+ `_journal.json` idx 30), per-view 09:15 schedule + `PATCH /tableau/views/:id`, `enqueueScheduledRuns`, `GET /tableau/freshness`, deduplicated `ALERTS` outbox notifications on `FAILED`/`PARTIAL`/SLA miss, `BOUNDED_FILTER` OpenAPI + matrix refreshed; `drizzle-kit check`, backend lint/typecheck/243 unit/7 arch/10 contracts, live `tableau.int` 12/12 (incl. `agency_worker`) pass. Risk: none |
| T2 | S3 | inline | done | Raw CSV persisted immediately on download (`rawCsv`, `rawCsvBytes`, `checksum`) even on mapping failure; `POST /tableau/runs/:id/reprocess` claims run via CAS and reprocesses offline with zero `TableauClient` calls; `runs()` omits `rawCsv` payload; OpenAPI + matrix refreshed; backend lint/typecheck/243 unit/7 arch/10 contracts and live `tableau.int` 13/13 pass. Risk: none |

## Log

- **L1** (2026-11-23) User: "si" (PRs #24 and #25 opened; continuing immediately with A9).
- **L2** (2026-11-23) Slice 22 (`feat/scope-22-tableau-schedule-freshness`, `75d3dc4`) verified (`drizzle-kit check`, 243 unit, 10 contracts, live `tableau.int` 12/12). Proceeding to Slice 23 (`feat/scope-23-tableau-csv-reprocess`, T2).
- **L3** (2026-11-23) Slice 23 (`feat/scope-23-tableau-csv-reprocess`) verified (243 unit, 10 contracts, live `tableau.int` 13/13). All unblocked A9 scope closed locally; ready for user decision on pushing/PRs #26–#27 and proceeding to A10 (last unblocked item).
