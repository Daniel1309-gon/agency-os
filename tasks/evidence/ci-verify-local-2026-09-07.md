# `pnpm ci:verify` local — 2026-09-07

Estado: **PASS** (`exit 0`). Ejecución local, no en GitHub Actions.

## Entorno

- Commit base: `def2d24`, rama `codex/delivery1-backend`.
- Node 24.12.0, pnpm 10.29.2, Windows 11.
- PostgreSQL 16.14 y Redis 7.4.8 vía `docker-compose.yml`.
- `ci:database` corrió con `NODE_ENV=test` y `TEST_DB_RECREATE=1`: la base `agency_os_test`
  se reconstruyó desde cero, así que las migraciones se aplicaron en orden sobre base vacía.

## Resultado por etapa

| Etapa | Resultado |
|---|---|
| `test:requirements` | 32/32; trazabilidad de 44 requisitos y 13 preguntas abiertas |
| `extension:check` | 3/3 + validación de manifiesto |
| `helper:test` | paquetes Go PASS |
| `build` | shared, backend y frontend OK |
| `test:contracts:run` | 9/9, incluidos snapshot OpenAPI y matriz ruta × política |
| `lint` | 8/8 reglas de arquitectura |
| `typecheck` | PASS |
| `test` (unit) | backend 172/172 en 31 archivos; frontend 22/22 en 8; shared 7/7 |
| `pnpm audit --prod --audit-level high` | PASS; quedan 4 avisos moderados |
| `db:migrate` | migraciones aplicadas sobre base recreada |
| `db:seed:verify` | seed ejecutado dos veces, idempotente |
| `db:check` | esquema Drizzle consistente |
| `test:integration` | **198/198 en 17 archivos**, 78,6 s |

## Suites de integración relevantes para la Entrega 1

`assignments` 34 · `shifts-and-crews` 28 · `auth` 21 · `vault` 19 · `schema-invariants` 17 ·
`rls` 14 · `payroll` 13 · `cafeteria` 12 · `http-security` 8 · `communication` 8 ·
`metrics` 7 · `database-roles` 5 · `shift-access` 3 · `guards` 3 · `devices` 3 ·
`operator-status` 2 · `realtime-redis` 1.

`rls.int.spec.ts` incluye el alcance de coordinador por cuadrilla vigente
(`0014_rbac_scope_policy.sql`), que es lo que SEC-02 tenía pendiente de ejecutar.

## Incidencia corregida durante el run

El primer intento falló en `test:contracts:run`: `backend/openapi.snapshot.json` y
`tasks/route-policy-matrix.md` se comparan byte a byte, pero con `core.autocrlf=true` y sin
`.gitattributes` el checkout en Windows los escribe con CRLF mientras los generadores emiten LF.
No era deriva de contrato. Se añadió `.gitattributes` fijando `eol=lf` para esos dos artefactos y
se normalizó la copia de trabajo. Solo afectaba a estaciones Windows; en CI Linux nunca falló.

## Lo que este run no cierra

El mismo commit corrió en GitHub Actions: [run 34163719832](https://github.com/Daniel1309-gon/agency-os/actions/runs/34163719832),
verde en los tres jobs (calidad, imágenes de estación, migraciones/seed/integración).
No sustituye los Checkpoints 1–3, ni los gates
externos INT-01, OQ-03, OQ-10 y OQ-13.
