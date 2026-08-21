# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read agents.md and backend/PLAN.md first

[`agents.md`](agents.md) is the mandatory context document for this project — read it in full
before doing any non-trivial work here. It explains what Agency OS is, the business it serves, the
technical decisions already made (and why), open risks, and where the authoritative source
documents live.

[`backend/PLAN.md`](backend/PLAN.md) is the backend's own plan and the closest thing to a spec for
the code that exists today: decisions #10–#19, the data model module by module (§3), the invariants
that live in the database rather than in code (§4), the HTTP contract (§5), the security model and
the vault grant/redeem flow (§6), the testing criteria (§9), and the build sequence mapped to the
three delivery phases (§10).

Neither file's content is duplicated here; this file only adds orientation and the actual commands.

Key things to know before touching this repo:

- **Most source-of-truth documents live outside this repo.** The functional spec
  (`agency-os-requerimientos.md`, v2.2), the commercial proposal, and other reference docs live
  under `C:\Users\danig\Documents\FREELANCE\AGENCIA CAROL\documentos\`. A few documents (the phase
  reassignment addendum, the two JarvisBot-viability reports, `integraciones/`) still live in the
  JarvisBot repo (`C:\Users\danig\Documents\jarvisbot\jarvisbot-main\agency-os\`) because only
  `agents.md` was moved into this repo so far — see agents.md §3 and §3.1 for exact paths and which
  copy is current vs. frozen/stale.
- **JarvisBot is a separate, sibling project** (a different client's system, at
  `jarvisbot-main/`), not a dependency of this repo. It is referenced only as a design precedent
  (payroll-by-points logic, Tableau integration pattern, RocketChat deployment pattern, TalkyTimes
  API surface as a map) — see agents.md §4. Its code is not imported or built upon here.

## Repository layout

pnpm workspace (Node ≥22, pnpm 10.29.2). Members are declared in `pnpm-workspace.yaml`:

| Path | Package | State |
|---|---|---|
| `backend/` | `@agency-os/api` | NestJS on Fastify. Built out: 25 modules wired in `src/app.module.ts`, Drizzle schema + 4 migrations, seeds, unit and integration suites |
| `packages/shared/` | `@agency-os/shared` | Zod schemas shared with the other components (`configSchema` lives here) |
| `web-app/` | `agency-os-web` | React/Vite dashboard with build, lint, typecheck and unit-test gates |
| `extension/` | — | **Not** a workspace member. Spike code: Python launchers and an unpacked Chrome extension, kept as evidence for the pending technical spike |

## Commands

Infrastructure first — Postgres 16 on 5432 and Redis 7 on 6379:

```bash
docker compose up -d
```

Then copy `backend/.env.example` to `backend/.env`, install from the single workspace lockfile and
run the same gates as CI:

```bash
pnpm install --frozen-lockfile
pnpm ci:verify
```

Per task, from the root:

| Command | What it does |
|---|---|
| `pnpm dev` | Backend in watch mode (tsc + node --watch) |
| `pnpm build` | Builds shared contracts, backend and frontend |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Runs the corresponding workspace gate; `test` is unit-only |
| `pnpm test:integration` | Runs the backend integration suite against real PostgreSQL and Redis |
| `pnpm test:requirements` | Verifies FR-01…FR-39, five NFR groups, evidence links and the OQ register |
| `pnpm ci:quality` | Build, lint, typecheck, unit tests and production dependency audit |
| `pnpm ci:database` | Backend build, migrations, minimum seed twice (idempotence), schema check and real integration tests |
| `pnpm ci:verify` | Full local equivalent of unified CI; loads `backend/.env` and recreates the integration database |
| `pnpm db:generate` | drizzle-kit generate, after changing the schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:studio` | drizzle-kit studio |

Backend-only, via `pnpm --filter @agency-os/api <script>`:

| Script | What it does |
|---|---|
| `test` | Unit tests only (`src/**/*.spec.ts`). No infrastructure needed |
| `test:integration` | Integration tests (`src/test/integration/*.int.spec.ts`). **Requires Postgres and Redis running** |
| `test:all` | Both, in order |
| `db:seed` | Seeds roles, permissions, settings and feature flags. `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` also create the first admin |
| `start` | Runs the built `dist/main.js` |

`pnpm test` deliberately remains unit-only. Use `pnpm ci:verify` before merge so migrations, seed,
schema invariants and the PostgreSQL/Redis integration suite cannot be skipped.

## Conventions the tooling enforces

- **`lint` is a custom script**, not ESLint: [`backend/scripts/lint.mjs`](backend/scripts/lint.mjs)
  walks `backend/src` and fails on `SELECT *`, on `sql.raw(`, and on `console.log(`. It scans test
  files too. There is no ESLint or Prettier check wired into CI.
- **Two TypeScript configs.** `backend/tsconfig.json` is the typecheck config: `noEmit`, and it
  covers `src` plus the root `*.config.ts` files. `backend/tsconfig.build.json` is the one that
  emits, and it excludes `src/**/*.spec.ts` and `src/test` so no test code reaches `dist/`. Anything
  that emits (`build`, `dev`, `db:seed`) must use the build config.
- **Postgres error codes never arrive bare.** Drizzle wraps them and leaves the original in `cause`,
  so reading `error.code` returns `undefined`. Use `isPgError` from
  [`backend/src/database/pg-error.ts`](backend/src/database/pg-error.ts) to turn a constraint
  violation into the 409 the contract promises.
- **The database is the authority on the invariants of PLAN.md §4** (exclusion constraints over
  `tstzrange`, partial unique indexes, RLS policies, the closed-period trigger). With two backend
  instances the race is real, so validating only in application code is not enough.

## Tests

- Unit tests sit next to their subject as `*.spec.ts` and use doubles — see
  `backend/src/test/support/fake-db.ts`.
- Integration tests live in `backend/src/test/integration/*.int.spec.ts` and run against real
  Postgres and Redis. They create their own database, `agency_os_test`, derived from `DATABASE_URL`;
  the development database is never touched. The database is reused between runs because creating it
  is slow; `TEST_DB_RECREATE=1` forces a rebuild, which you need if you edit a migration in place
  instead of adding a new one.
- The abuse cases in PLAN.md §9 are delivery criteria, not optional coverage. If you touch the vault,
  auth, assignments or payroll, the corresponding `*.int.spec.ts` is part of the change.

## Architecture

Per agents.md §2 and §5, and PLAN.md:

- **`backend/`** — NestJS on the Fastify adapter (`@nestjs/platform-fastify`), chosen specifically
  to force modularity and avoid the "god controller" pattern found in JarvisBot's audit. Runs as 2
  instances behind HA PostgreSQL and Redis. Drizzle ORM with hand-writable SQL migrations
  (decision #11), because the model needs `EXCLUDE USING gist`, RLS, `citext` and column-level
  grants that Prisma cannot express.
- **`extension/`** — a Chrome extension + local helper that injects operator credentials into
  TalkyTimes via JS (no clipboard — TalkyTimes' password field blocks paste) and requires a real
  operator click on the sensitive step. Session isolation uses native Chrome profiles
  (`--profile-directory`), not Playwright `BrowserContext` or incognito (incognito windows within
  one Chrome instance share cookies — ruled out). What is in the directory today is spike code, not
  the product.
- **`web-app/`** — the React/Vite admin, coordination and "cafetería" dashboard, included in every workspace quality gate.
- An **isolated AI service** (FastAPI) that validates and scores operator-written icebreakers —
  kept separate from the NestJS backend. The backend talks to it through `AiEngineClient` and falls
  back to local rule evaluation when `AI_ENGINE_URL` is unset.
- **RocketChat**, deployed as an independent component on the client's own VPS (not built from
  scratch).

The system explicitly does **not** build on TalkyTimes' internal/undocumented API
(`McpClient.php`-style reverse engineering used by JarvisBot) — see agents.md §4-§5 decision #4 for
why.

## Open risks to keep in mind

A technical spike (credential injection under TalkyTimes' anti-automation checks, Chrome profile
isolation under concurrent office sessions, DOM control for icebreaker scoring) is still pending
and gates feasibility of a large part of the first delivery phase. See agents.md §6 for the full
list of open risks, and PLAN.md §11 for the eleven still-open questions and what each one blocks.

`extension/credenciales.json` is the spike's plaintext credential file and it is **tracked in git**.
The vault of PLAN.md §10 item 6 exists to replace it; until the spike is retired, do not add
credentials to it and do not treat it as a pattern to follow.
