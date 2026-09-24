# `pnpm ci:verify` local — 2026-09-23

Estado: **PASS** (`exit 0`). Ejecución local, no en GitHub Actions.
Commit base: `70ab4b7`, rama `codex/delivery1-backend`.
Node 24.12.0, pnpm 10.29.2, Windows 11. PostgreSQL 16 y Redis 7 vía `docker-compose.yml`.

Cierra la verificación del slice crítico (A0–A4) y de OPS-06 (B1) con una corrida limpia: la corrida
anterior, hecha en paralelo con el suite de unitarios, había dado dos fallas por contención (la suite
tardó 363 s contra 215 s de esta). Aquí no hubo ninguna otra carga.

## Resultado por etapa

| Etapa | Resultado |
|---|---|
| `test:requirements` | 34/34; trazabilidad de 44 requisitos y 13 preguntas abiertas |
| `extension:check` | checks del manifiesto y política de extensión |
| `helper:test` | paquetes Go del helper local en verde |
| `build` | shared, backend y frontend OK |
| `test:contracts:run` | 10/10, incluidos snapshot OpenAPI y matriz ruta × política |
| `lint` | backend 37 excepciones explícitas; frontend OK |
| `typecheck` | shared, backend y frontend OK |
| `test` (unit) | backend 208/208 en 36 archivos; frontend 67/67 en 12 |
| `pnpm audit --prod --audit-level high` | `No known vulnerabilities found` |
| `db:migrate` | sin migraciones pendientes |
| `db:seed:verify` | seed ejecutado dos veces, idempotente |
| `db:check` | esquema Drizzle consistente |
| `test:integration` | **263/263 en 24 archivos**, 215 s |

`ci:database` corre con `NODE_ENV=test` y `TEST_DB_RECREATE=1`: la base `agency_os_test` se
reconstruyó desde cero, así que las 24 migraciones —incluida la `0023` de retención de auditoría— se
aplicaron en orden sobre base vacía.

## Qué cubre esta corrida del trabajo de estos días

- **A0**: pruebas de denegación que sobreviven al rollback del request (`vault.int.spec.ts`).
- **A1**: retención a dos meses, migración aplicada desde cero y prueba de `audit_log_maintain`.
- **A2**: reenvoltura de la KEK (unitarios y ensayo local aparte) y `rotateKey` concurrente → 409.
- **A3**: alertas de abuso (cinco pruebas) y política de revocación.
- **A4**: atomicidad con auditoría que falla en login y enroll.
- **B1**: breaks por iniciativa (ventanas, autocierre, job en `job_runs`) y retiro de los programados.

## Lo que este run no cierra

Los gates externos de siempre: VPS/B2, reglas mTLS en Cloudflare, capacidad y prueba física, registro
del canal `ALERTS` en el Rocket.Chat real y el acta de cierre (E1-16 a E1-19).

---

## Corrida sobre las correcciones de la revisión — `78a6ba6`

Estado: **PASS** (`exit 0`). Ejecución local, no en GitHub Actions. Rama `codex/delivery1-backend`,
commit `78a6ba6` (incluye `627089d`, `817cb37` y `78a6ba6` de
[`plan-correcciones-revision-e1-2026-09-23.md`](../plan-correcciones-revision-e1-2026-09-23.md)).
Node 24.12.0, pnpm 10.29.2, Windows 11. PostgreSQL 16 y Redis 7 vía `docker-compose.yml`, sin otra
carga en paralelo.

| Etapa | Resultado |
|---|---|
| `test:requirements` | 34/34; trazabilidad de 44 requisitos y 13 preguntas abiertas |
| `extension:check` | checks del manifiesto y política de extensión |
| `helper:test` | paquetes Go del helper local en verde |
| `build` | shared, backend y frontend OK |
| `test:contracts:run` | 10/10, incluidos snapshot OpenAPI y matriz ruta × política |
| `lint` | backend 35 excepciones explícitas; frontend OK |
| `typecheck` | shared, backend y frontend OK |
| `test` (unit) | backend 214/214 en 36 archivos; frontend 77/77 en 13, ahora en `TZ=UTC` |
| `pnpm audit --prod --audit-level high` | `No known vulnerabilities found` |
| `db:migrate` | `Database migrations applied` |
| `db:seed:verify` | seed ejecutado dos veces, idempotente |
| `db:check` | `Everything's fine` |
| `test:integration` | **276/276 en 24 archivos**, 210 s |

Pruebas nuevas de esta corrida: 15 denegaciones concurrentes sobre un pool de 10
(`vault.int.spec.ts`), serie recurrente con el reloj de la app atrasado (`communication.int.spec.ts`)
y los helpers de hora de Bogotá en la web (`management-view.test.ts`,
`scheduled-messages-view.test.ts`).

**Las pruebas fallan sin su arreglo** (revisión del arquitecto sobre `1ed6daa`; se quitó el arreglo,
se corrió solo la prueba y se restauró el archivo):

| Arreglo retirado | Prueba | Resultado sin el arreglo |
|---|---|---|
| `independentTransaction` vuelve al pool principal | `vault.int.spec.ts` › *does not exhaust the pool…* | **FAIL** a los 5,4 s: las 15 llamadas no terminan todas en `ForbiddenException`; el timeout de conexión corta la espera circular |
| Sin la guarda `if (!due.length) return;` | `communication.int.spec.ts` › *…when the app clock lags the database* | **FAIL**: `expected 'PENDING' not to be 'PENDING'`; el mensaje puntual se revierte con el lote |

En la web no se retiró el arreglo: bajo `TZ=UTC`, el `toIsoDateTime('2026-08-27T06:05')` anterior
devolvía `2026-08-27T06:05:00.000Z` y la prueba espera `11:05Z`, así que falla por construcción.

