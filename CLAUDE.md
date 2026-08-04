# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state of this repo

This repository has no code yet. It contains only:

- [`agents.md`](agents.md) — the project context document (see below)
- `backend/`, `extension/`, `web-app/` — empty scaffold directories for the three planned components

There is no package.json, build tooling, linter, or test runner to invoke yet. Do not invent
build/lint/test commands — check whether they exist before assuming any convention. When code
starts landing in these directories, update this file with the actual commands.

## Read agents.md first

[`agents.md`](agents.md) is the mandatory context document for this project — read it in full
before doing any non-trivial work here. It explains what Agency OS is, the business it serves, the
technical decisions already made (and why), open risks, and where the authoritative source
documents live. Do not duplicate its content here; this file only adds pointers and orientation
that agents.md itself doesn't cover.

Key things to know before touching this repo:

- **Most source-of-truth documents live outside this repo.** The functional spec
  (`agency-os-requerimientos.md`, v2.1), the commercial proposal, and other reference docs live
  under `C:\Users\danig\Documents\FREELANCE\AGENCIA CAROL\documentos\`. A few documents (the phase
  reassignment addendum, the two JarvisBot-viability reports, `integraciones/`) still live in the
  JarvisBot repo (`C:\Users\danig\Documents\jarvisbot\jarvisbot-main\agency-os\`) because only
  `agents.md` was moved into this repo so far — see agents.md §3 and §3.1 for exact paths and which
  copy is current vs. frozen/stale.
- **JarvisBot is a separate, sibling project** (a different client's system, at
  `jarvisbot-main/`), not a dependency of this repo. It is referenced only as a design precedent
  (payroll-by-points logic, Tableau integration pattern, RocketChat deployment pattern, TalkyTimes
  API surface as a map) — see agents.md §4. Its code is not imported or built upon here.

## Planned architecture (not yet implemented)

Per agents.md §2 and §5, the target system is:

- **`backend/`** — NestJS on the Fastify adapter (`@nestjs/platform-fastify`), chosen specifically
  to force modularity and avoid the "god controller" pattern found in JarvisBot's audit. Runs as 2
  instances behind HA PostgreSQL and Redis.
- **`extension/`** — a Chrome extension + local helper that injects operator credentials into
  TalkyTimes via JS (no clipboard — TalkyTimes' password field blocks paste) and requires a real
  operator click on the sensitive step. Session isolation uses native Chrome profiles
  (`--profile-directory`), not Playwright `BrowserContext` or incognito (incognito windows within
  one Chrome instance share cookies — ruled out).
- **`web-app/`** — the admin/coordination/"cafetería" dashboard.
- An **isolated AI service** (FastAPI) that validates and scores operator-written icebreakers —
  kept separate from the NestJS backend.
- **RocketChat**, deployed as an independent component on the client's own VPS (not built from
  scratch).

The system explicitly does **not** build on TalkyTimes' internal/undocumented API
(`McpClient.php`-style reverse engineering used by JarvisBot) — see agents.md §4-§5 decision #4 for
why.

## Open risks to keep in mind

A technical spike (credential injection under TalkyTimes' anti-automation checks, Chrome profile
isolation under concurrent office sessions, DOM control for icebreaker scoring) is still pending
and gates feasibility of a large part of the first delivery phase. See agents.md §6 for the full
list of open risks and unresolved business questions before making architectural assumptions.
