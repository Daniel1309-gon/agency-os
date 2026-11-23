# Chain follow-ups (PR #31)

Objective: close the non-blocking follow-ups left after merging chain #5→#30, plus unblock PR #4.
Branch: `fix/scope-27-followups` (base `main` b3abae0). Delivery: single PR, one commit per task. Runner: vitest (`test:integration:run`), web `pnpm --filter agency-os-web test`.

## Specs

- S1 — "Un operador puede cancelar los pedidos de cafetería de otro." `POST /cafeteria/orders/:id/cancel`: without `cafeteria.manage` (or `*`) the actor may cancel only their own order and only while `PLACED`; kitchen roles keep the current transitions.
- S2 — "CAFETERIA puede crear canales globales de Rocket.Chat." Only global roles create global (no `crewId`) channels; CAFETERIA is refused.
- S3 — "En el KDS, el snapshot por WebSocket usa `mergeOrders` en vez de `applyOrderSnapshot`, así que los pedidos cerrados se quedan en pantalla."
- S4 — "`freshness()` de Tableau carga todo el historial de corridas" → bounded: latest run per view plus the run of each view's expected date.
- S5 — "las corridas del ETL no tienen lease que impida ejecutarlas dos veces." A worker whose claim was taken over (stale reclaim / reprocess) must not write the run's result or promote points.
- S6 — "El PR #4 sigue abierto y con el CI en rojo." Cause: zod advisory GHSA-mrhx-c7xc-m3w5, fixed on main by #8 → update the branch with main.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1 | inline | done (RED: method missing; GREEN 23/23) | dba9fa8 |
| T2 | S2 | inline | done (RED CAFETERIA created ALERTS → GREEN 21/21) | 273bd3a |
| T3 | S3 | inline | done (no runnable RED: no component test infra; helper already unit-tested) | 45fa983 |
| T4 | S4 | inline | done (behavior pinned first, then refactor; 16/16) | 42e0561 |
| T5 | S5 | inline | done (RED superseded worker wrote result → GREEN 17/17) | 4690a06 |
| T6 | S6 | inline | done (update-branch → CI green → merged) | PR #4 merged |

Route evidence: each unit < 100 changed lines → inline. Risk: item 2 (T1, T2 authz), item 4 (T5 concurrency) → independent verifier at feature end.

## Log

- L1 (2026-11-23, user): "dale, resuelvelo" — answering the list: "1. CAFETERIA puede crear canales globales de Rocket.Chat. 2. Un operador puede cancelar los pedidos de cafetería de otro. 3. En el KDS, el snapshot por WebSocket usa `mergeOrders` en vez de `applyOrderSnapshot`, así que los pedidos cerrados se quedan en pantalla. 4. `freshness()` de Tableau carga todo el historial de corridas, y las corridas del ETL no tienen lease que impida ejecutarlas dos veces. 5. El PR #4 sigue abierto y con el CI en rojo."
- L2 (T5): lease = claim `started_at`, compared with `date_trunc('milliseconds', …)` because JS Date drops Postgres microseconds; processQueued now stamps ms-truncated `now()`. Superseded workers return `SUPERSEDED` and write nothing.
- L4 (checks): `pnpm ci:quality` exit 0; `TEST_DB_RECREATE=1 pnpm ci:database` exit 0, 30 files / 370 tests. Independent verifier: S1–S5 met; probes added (stale-lease execute writes nothing, per-view timezone expected date, wildcard cancel without reason). Not done: clearing raw_csv on claim (would drop the reprocessable artifact of a previous attempt; current effect benign). Residual: no test exercises the in-transaction FOR UPDATE fence directly (needs a hook between raw CSV write and promotion).
- L3 (T6): PR #4 failed only on zod advisory GHSA-mrhx-c7xc-m3w5 (fixed on main by #8). Branch updated, CI green, docs-only diff checked for secrets (only variable names, loopback IP), merged with merge commit.
