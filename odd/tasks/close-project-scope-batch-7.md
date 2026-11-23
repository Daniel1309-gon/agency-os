# Close project scope — batch 7 (A8: operator icebreaker workspace, FR-21 to FR-25)

Objective: give the operator a web workspace to write, evaluate, fix and publish icebreakers, and fix the API defects found while reading the flow. Branch: `feat/scope-17-icebreaker-ui` (stacked on `feat/scope-16-cafeteria-review-fixes`). Delivery: `stacked-to-main`, unpublished until the user approves. Test runners: vitest (unit), `vitest.integration.config.ts`, web vitest.

## Specs

- **S1 (FR-21)** Requirements v2.2: "El operador redacta el icebreaker en su panel, asociado a un perfil específico." The profile must be one the operator is currently assigned to; any other `profileId` is refused (403).
- **S2 (FR-22)** "Si incumple alguna, el icebreaker queda bloqueado y no puede publicarse. Se indica qué regla específica fue incumplida." The evaluation response names each broken rule (code, name, severity), not only its code.
- **S3 (FR-24)** "El operador puede editar y volver a evaluar sin límite de intentos." Draft, blocked and approved icebreakers can be re-evaluated; a published one cannot (409). Editing stays limited to DRAFT and BLOCKED (existing rule).
- **S4** Publishing increments `version` instead of resetting it to 1, so optimistic concurrency keeps working.
- **S5 (web)** An operator route `/app/icebreakers` ("Icebreakers") lists the operator's icebreakers with Spanish status labels. The operator can create one for an assigned profile, edit a draft or blocked one, evaluate it (showing the broken rules by name and, when present, the score), and publish an approved one.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1–S4 | inline | done | `75e9904`; icebreakers.int RED 4 → GREEN 10/10, rls-service-writes 7/7. Risk: item 2 (ownership guard on operator input) |
| T2 | S5 | inline | done | view-model tests 4/4 + navigation test; web 104/104, lint, build; `pnpm ci:quality` exit 0 (243 unit, 104 web); `pnpm ci:database` exit 0 (347). Not done: browser walkthrough of the page. |

## Log

- **L1** (2026-11-23) User: "revisa lo que ha hecho gemini, corrige lo que veas que es necesario y continua." After the review of batches 4–6, the next remaining-scope item chosen was A8 (icebreaker UI).
- **L2** (2026-11-23) Found while reading the API: `evaluate` has no status guard (a PUBLISHED icebreaker loses its status when re-evaluated), `publish` sets `version: 1`, `create`/`update` accept any `profileId`.
- **L3** (2026-11-23) OrbStack hung mid-run (every `docker` call blocked); restarted it, Postgres volumes intact, and the vault/icebreaker suites passed (41/41). It was the environment, not the code.
