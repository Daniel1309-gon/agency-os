# Close project scope — batch 11 (A10: E1-13 Rocket.Chat drift/lifecycle, OPS-03/OPS-05 local proofs, E1-15 bot observability & runbook)

Objective: close the final unblocked internal scope item (A10) from `odd/tasks/HANDOFF-2026-11-22.md`: E1-13 (read-only paginated Rocket.Chat `groups.members`, channel update/unlink lifecycle, and detect-only membership drift scan per ADR 0010), OPS-03 (2-worker concurrent contention proof), OPS-05 (month-end/leap-day/midnight-crossing `:05` materialization & recovery proofs), and E1-15 (sanitized discarded-webhook observability + production Rocket.Chat bot & PAT rotation runbook). Base: `feat/scope-23-tableau-csv-reprocess` (PR #27). Delivery: `stacked-to-main`, continuing the #5–#27 chain (slice 24 `feat/scope-24-rocketchat-drift-lifecycle`, slice 25 `feat/scope-25-ops03-ops05-e115-closure`; never push or open PR without user OK).

## Specs

- **S1 (E1-13 — Read-only Rocket.Chat member pagination)** `RocketChatClient.listRoomMembers(roomId, roomType)` reads `groups.members` (`GROUP`) or `channels.members` (`CHANNEL`) with pagination and strictly zero write/invite/kick calls (ADR 0010 #1–#3).
- **S2 (E1-13 — Channel lifecycle & detect-only drift scan)** Add `PATCH /rocketchat/channels/:id` (crew-scoped update/unlink/deactivate, audited as `rocketchat.channel.updated`) and `GET /rocketchat/channels/:id/drift` (crew-scoped, detect-only comparison of active `crew_members` vs Rocket.Chat members reporting `missingInRocketChat`, `unlinkedCrewMembers`, `unexpectedInRocketChat`, `inSyncCount`, excluding the crew coordinator and `agency.bot`, audited as `rocketchat.channel.drift_scanned`).
- **S3 (E1-15 — Sanitized bot discard observability & production runbook)** `BotService.handle` logs sanitized discard reasons (never secret tokens or message bodies), and `deploy/production/README.md` documents permanent HTTPS webhook setup, minimal PAT scopes (ADR 0010), PAT/webhook-secret rotation, and recovery.
- **S4 (OPS-03 & OPS-05 — Local durability/boundary integration proofs)** Prove 2 concurrent `JobsService` instances never double-execute or double-reap expired sessions (OPS-03), and prove `:05` shift materialization handles month-end, leap-day, and `22:05→06:05` month-crossing windows idempotently across restart recovery (OPS-05).

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S2 | inline | done | Slice 24 (`feat/scope-24-rocketchat-drift-lifecycle`): `listRoomMembers`, `PATCH /rocketchat/channels/:id`, `GET /rocketchat/channels/:id/drift`, OpenAPI/contracts (10/10), unit (244/244) + `communication.int.spec.ts` (18/18) |
| T2 | S3, S4 | inline | in_progress | Slice 25 (`feat/scope-25-ops03-ops05-e115-closure`) |

## Log

- **L1** (2026-11-23) User: "si" (PRs #26 and #27 opened; starting final unblocked item A10).
- **L2** (2026-11-23) Completed T1 (E1-13): read-only paginated Rocket.Chat `groups.members`/`channels.members`, crew-scoped channel update/unlink/deactivate, and detect-only membership drift scan per ADR 0010. All checks + live Postgres integration tests passed.
