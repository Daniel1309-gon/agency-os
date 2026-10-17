# Correcciones de la revisión del plan interno de E1 (2026-09-23)

Encargo para el agente implementador. El arquitecto revisó los 23 commits locales de
`codex/delivery1-backend` (de `e0213ba` a `3531f30`). `pnpm ci:verify` pasa sobre `3531f30`, pero
quedaron tres defectos que se corrigen **antes del push**. Este documento dice qué cambiar, dónde y
cómo se comprueba; si algo del código contradice lo que se describe aquí, **detente y repórtalo** en
vez de improvisar.

Lee antes `CLAUDE.md` y, para el contexto del vault, `backend/PLAN.md` §6.

## Reglas del encargo

- Un commit por corrección, más uno final de documentación (§4). Mensajes cortos en inglés,
  **sin línea de co-autor**.
- **No hagas push** ni toques el PR #1: el push lo aprueba Daniel aparte.
- No agregues dependencias, no edites migraciones existentes, no crees excepciones nuevas en
  `backend/architecture-baseline.json`.
- Prueba primero: en cada corrección, escribe la prueba, comprueba que **falla** sin el arreglo y
  anota cómo falla (va en la evidencia).
- Fuera de alcance (no tocar): ver §5.

---

## 1. Bloqueo del pool en las transacciones independientes (medio-alto) — HECHO `627089d`

### Problema

`DatabaseService.independentTransaction` (`backend/src/database/database.service.ts:140`) abre una
transacción en **el mismo pool** que usa la transacción del request. El `TransactionInterceptor`
(`backend/src/common/interceptors/transaction.interceptor.ts`) envuelve cada handler con
`request.user` en `withRequestContext`, que retiene una conexión durante todo el handler. Entonces
cada denegación del vault retiene una conexión y pide otra:

- `VaultService.deny` (`backend/src/modules/vault/vault.service.ts:285`)
- `VaultService.recordGrantReuse` (`vault.service.ts:271`)
- `VaultAlertService.raise` (`backend/src/modules/vault/vault-alerts.service.ts`), llamado desde
  las dos anteriores

El pool se crea con `new Pool({ connectionString: url })` (`database.service.ts:51`): máximo 10
conexiones y **sin `connectionTimeoutMillis`**, así que `pg-pool` encola la espera sin límite
(verificado en `pg-pool@3.14.0/index.js`). Con 10 denegaciones concurrentes cada petición tiene una
conexión y espera otra: la instancia se cuelga para siempre, incluido `/health/ready`. Es justo la
ráfaga `RATE_LIMITED` que SEC-10 quiere detectar.

### Corrección

En `backend/src/database/database.service.ts`:

1. Un **segundo pool, pequeño y reservado** para `independentTransaction`, con el mismo
   `connectionString`. Al no competir con el pool del request desaparece la espera circular: las
   transacciones independientes son cortas y nunca piden una conexión del pool principal.
2. `connectionTimeoutMillis` en **ambos** pools, para que cualquier agotamiento futuro termine en
   error y no en un cuelgue permanente.

Forma esperada (ajusta nombres al estilo del archivo):

```ts
/** Conexiones reservadas para `independentTransaction`; ver su comentario. */
const INDEPENDENT_POOL_MAX = 2;
/** Quien no consigue conexión en este tiempo falla en vez de esperar para siempre. */
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

// onModuleInit
this.pool = new Pool({ connectionString: url, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
this.independentPool = new Pool({ connectionString: url, max: INDEPENDENT_POOL_MAX, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
this._db = drizzle({ client: this.pool, schema });
this._independentDb = drizzle({ client: this.independentPool, schema });
```

- `independentTransaction` usa `this._independentDb.transaction(...)`. **No cambies su firma**: la
  usan el servicio del vault, el de alertas y el doble de `backend/src/test/support/fake-db.ts`.
- `onModuleDestroy` cierra los dos pools. La rama de error de `onModuleInit` también cierra y anula
  los dos. Esto importa para los scripts `backend/scripts/vault-restore-check.mjs` y
  `vault-rewrap-kek.mjs`, que construyen `DatabaseService` a mano: si el segundo pool queda
  abierto, el proceso no termina.
- `ping()` sigue usando el pool principal.
- Un `Pool` no abre conexiones hasta que se le piden, así que el worker (que nunca llama a
  `independentTransaction`) no gasta conexiones extra.
- Reemplaza el comentario `ponytail:` del método por uno que diga el techo real:
  `ponytail: dos conexiones reservadas por proceso; si las denegaciones concurrentes empiezan a
  esperar el timeout en este pool, subir INDEPENDENT_POOL_MAX`.
- Agrega al comentario del método este **invariante**: el callback no debe tocar filas que la
  transacción del request ya modificó o bloqueó. Esperaría un lock que el request retiene y
  Postgres no puede detectar ese bloqueo (el request espera en la aplicación, no en la base). Hoy
  se cumple: las denegaciones insertan en `credential_access_log`, `audit_log`, `notifications` y
  `outbox_events`, y `markGrantReuse` actualiza una fila que el request no tocó antes. Compruébalo
  al leer `redeem` y repórtalo si no es así.

### Prueba (integración)

En `backend/src/test/integration/vault.int.spec.ts`, dentro de
`describe('denials survive the request transaction')`, siguiendo el patrón de
`'does not let a revoked device obtain a grant'`:

- Escenario con `scenario()`, dispositivo pasado a `REVOKED` con `ctx.pool.query(...)`.
- Lanza **15** llamadas concurrentes (más que las 10 del pool principal), cada una como la haría el
  interceptor:
  `ctx.database.withRequestContext(s.operatorId, 'OPERADOR', () => vault.grant({ profileId: s.profileId, sessionId: s.sessionId }, contextFor(s)))`,
  y recoge los resultados con `Promise.allSettled`.
- Espera que las 15 rechacen con `ForbiddenException` (ningún error de timeout del pool) y que haya
  15 filas `DEVICE_NOT_APPROVED` en `credential_access_log`.
- Timeout del test: 20 s, para que una regresión falle en vez de colgar la suite.
- Antes de escribirla, confirma que el `vault` del spec usa `ctx.database`, y que ese
  `DatabaseService` se construye con `onModuleInit` y con el máximo por defecto del pool principal.

Fallo esperado sin el arreglo: con solo el timeout nuevo, varias llamadas rechazan con
`timeout exceeded when trying to connect`; sin nada, el test agota sus 20 s.

---

## 2. `advanceSeries` rompe el lote cuando el reloj de la app va atrasado (bajo) — HECHO `817cb37`

### Problema

`enqueueDueScheduled` (`backend/src/modules/communication/communication.worker.ts`) selecciona las
filas vencidas con el `now()` de Postgres, pero `advanceSeries` calcula las ocurrencias con el
`new Date()` de la app. Si la app va unos segundos detrás de la base, `occurrencesUpTo` devuelve
`[]`, `latest` queda `undefined` (`communication.worker.ts:101`) y se lanza un `TypeError`. Eso
revierte **toda** la transacción del tick, incluidos los mensajes puntuales del mismo lote (hasta 25),
y se repite en cada tick hasta que la app alcance a la base.

### Corrección

En `advanceSeries`, justo después de calcular `due`:

```ts
// El SELECT filtra con el now() de Postgres y esto usa el reloj de la app: si la
// app va atrasada, la ocurrencia todavía no venció aquí. Queda PENDING y la toma
// el próximo tick; lanzar revertiría el lote completo.
if (!due.length) return;
```

No cambies la fuente del reloj: con la guarda, un desfase solo retrasa la ocurrencia un tick.

### Prueba (integración)

En `backend/src/test/integration/communication.int.spec.ts`, dentro de
`describe('recurring scheduled messages')`, usando `seriesActor()`, `services()` y `rows()`:

- Programa una serie `DAILY` con `scheduledFor = ahora − 10 s` y un mensaje puntual con
  `scheduledFor = ahora − 5 s`, **antes** de falsear el reloj.
- `const real = Date.now(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(real - 60_000);`
  llama a `worker.tick()`, y en un `finally` llama a `vi.useRealTimers()`.
- Espera: la fila de la serie sigue `PENDING` con el mismo `scheduledFor`, y el mensaje puntual ya
  **no** está `PENDING` (quedó `QUEUED` o `SENT`). Comprueba estados en la base, no si `tick()` lanza.
- Después, con el reloj real, otro `worker.tick()` encola la serie.

Fallo esperado sin el arreglo: el puntual sigue `PENDING` porque el lote se revirtió.

---

## 3. La web interpreta fechas y horas en la zona del navegador (medio-bajo) — HECHO `78a6ba6`

### Problema

El backend define el tiempo de negocio en America/Bogota (UTC−5 fijo, sin horario de verano):
`backend/src/modules/jobs/shift-schedule.ts` y la validación de `scheduledMessageSchema`. Pero los
helpers de `web-app/src/components/OperationsManagement/management-view.ts` usan la zona del
navegador:

- `toIsoDateTime` (línea 92): `new Date("YYYY-MM-DDTHH:mm")` se interpreta en hora local.
- `toLocalDateTime` (línea 98) y `localDateString` (línea 44): `getHours()`, `getDate()` y similares
  también locales.

Desde un equipo fuera de UTC−5:

- **Mensajes programados**: se envían a otra hora. Además la validación del día semanal
  (`scheduled-messages-view.ts:45`, `getDay()`) no coincide con la del backend, y la lista los
  muestra en hora de Bogotá (`scheduledAtLabel`), distinta de la que se escribió.
- **Turnos y overrides** (`ShiftManagement.tsx:101` y `:119`, valores por defecto en `:34-35`): el
  turno queda desplazado y con él las ventanas de break y el tiempo efectivo. `formatRange` muestra
  en la zona del navegador, así que quien lo crea no lo nota.
- **Relevo de asignaciones** (`AssignmentManagement.tsx:122`): prellena fecha y hora con
  `toLocalDateTime` y el día con `getDay()`, pero el formulario interpreta las horas en Bogotá
  (`buildAssignmentWindows`, línea 80, ya usa `-05:00`).

### Regla de la corrección

Toda hora que la web **envía** a la API, y la que muestra **en esas mismas pantallas**, es hora de
pared de Bogotá. Se reutiliza el patrón que ya existe en `buildAssignmentWindows`: la cadena de pared
más el sufijo `-05:00`.

### Cambios

**`web-app/src/components/OperationsManagement/management-view.ts`**, la causa raíz, un solo lugar:

- `BOGOTA_OFFSET = '-05:00'` **ya existe** (línea 273; lo usa `buildCrewMemberPayload`, línea
  312). Súbelo al principio del archivo, agrega a su lado `BOGOTA_OFFSET_MS = 5 * 3_600_000` y un
  comentario («Bogotá es UTC−5 fijo, sin horario de verano; el backend aplica la misma regla en
  `jobs/shift-schedule.ts`»). Úsalo también en `buildAssignmentWindows` (líneas 80-81, hoy con el
  literal `-05:00`). No crees una segunda constante.
- `toIsoDateTime(value)`: valida `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$`, completa los segundos
  si faltan y construye `new Date(\`${value}${BOGOTA_OFFSET}\`)`. Mismo error si es inválido.
- `toLocalDateTime(value)`: hora de pared de Bogotá,
  `new Date(date.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 16)`.
- `localDateString(date = new Date())`: `toLocalDateTime(date).slice(0, 10)`.
- Exporta `calendarWeekday(value: string): number` (`parseCalendarDate(value).getUTCDay()`), para
  el día semanal de una fecha de calendario sin pasar por la zona del navegador.
- `localDay` (línea 127): día calendario de Bogotá,
  `parseCalendarDate(localDateString(new Date(value))).getTime()`.
- `formatRange` (línea 168): agrega `timeZone: 'America/Bogota'` a las opciones.
- Mantén los nombres de los helpers (menos diff), pero corrige sus comentarios: ya no son «hora
  local» sino «hora de pared de Bogotá».

**`web-app/src/components/OperationsManagement/scheduled-messages-view.ts`**:

- Línea 45: `calendarWeekday(values.scheduledFor.slice(0, 10))` en vez de
  `new Date(values.scheduledFor).getDay()`.
- La comparación con `until` (línea 43) ya compara cadenas de pared; no cambia.

**`web-app/src/components/OperationsManagement/AssignmentManagement.tsx`**:

- Línea 122: `weekdays: [calendarWeekday(localDate(handoffAt))]` en vez de `handoffAt.getDay()`.
- `groupSchedule`, línea 36: el día semanal con `calendarWeekday(localDateString(...))` en vez de
  `.getDay()`. Agrega `timeZone: 'America/Bogota'` a `timeFormatter` y `dateFormatter`
  (líneas 25-26).

**Rótulos** (el formulario de asignaciones ya lo dice; mismo tono):

- `ScheduledMessagesPanel.tsx`: el campo «Envío» pasa a «Envío (hora de Bogotá)».
- `ShiftManagement.tsx`: una nota bajo los formularios de turno y override: «Las horas se
  interpretan en America/Bogota.»

Los demás usos de estos helpers (`CrewMemberForm.tsx`, `ShiftTemplateForm.tsx`) quedan bien solos:
son fechas de calendario de negocio y pasan a ser de Bogotá.

### Pruebas (unitarias web)

- **Pruebas en UTC, como en CI.** En `web-app/vite.config.ts`, importa `defineConfig` de
  `vitest/config` y agrega `test: { env: { TZ: 'UTC' } }`. CI ya corre en UTC, así que no rompe
  nada que CI no rompa hoy, y hace que un equipo en Bogotá (donde el bug no se ve) detecte las
  regresiones. Agrega en `management-view.test.ts` la guarda
  `expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0)`. Si la guarda falla porque `test.env`
  no aplica `TZ`, pon `process.env.TZ = 'UTC'` en un `setupFiles` y repórtalo.
- **`management-view.test.ts`**, con valores exactos:
  - `toIsoDateTime('2026-08-27T06:05')` → `'2026-08-27T11:05:00.000Z'`
  - `toIsoDateTime('2026-08-27T21:30')` → `'2026-08-28T02:30:00.000Z'` (cruza la medianoche UTC)
  - `toLocalDateTime(new Date('2026-08-27T03:30:00.000Z'))` → `'2026-08-26T22:30'`
  - `localDateString(new Date('2026-08-27T03:30:00.000Z'))` → `'2026-08-26'`
  - `calendarWeekday('2026-09-23')` → `3`
  - `formatRange` de `[2026-08-27T11:05:00.000Z,2026-08-27T19:05:00.000Z)` muestra 6:05 y 14:05 (o
    2:05 p. m.): fija la aserción según el formato `es-CO` real.
  - `toIsoDateTime('not-a-date')` sigue lanzando el mismo error.
- **`scheduled-messages-view.test.ts`**:
  - El primer caso espera hoy `new Date('2026-09-23T14:05').toISOString()`, que depende de la zona
    de la máquina: cámbialo por `'2026-09-23T19:05:00.000Z'`.
  - Caso nuevo: `scheduledFor: '2026-09-23T21:30'` (miércoles en Bogotá, jueves en UTC) con
    `WEEKLY` y `weekdays: [3]` se acepta, y el payload lleva `'2026-09-24T02:30:00.000Z'`.
- Si otra prueba web existente falla con `TZ=UTC`, es el mismo tipo de bug: repórtala con el nombre
  y el motivo; no amplíes el alcance para arreglarla.

---

## 4. Documentación y gate final (commit aparte) — HECHO (commit de documentación)

- `pnpm ci:verify` completo al final; los tres commits van incluidos.
- `tasks/evidence/ci-verify-local-2026-09-23.md`: agrega una sección con la corrida sobre el SHA
  final (etapas, conteos y exit code), en el formato de la existente.
- `tasks/plan-trabajo-interno-e1-2026-09-23.md`: agrega a la tabla de estado una fila
  «Correcciones de la revisión» con los tres commits.
- `agents.md` §6, en «Decisiones de cierre de E1», una línea fechada con el hallazgo: las
  transacciones independientes compartían el pool del request (bloqueo con 10 denegaciones
  concurrentes), ahora tienen pool propio y los dos pools tienen timeout; y la web pasa a hora de
  Bogotá en las pantallas de gestión.
- Este archivo: marca cada punto como hecho con su commit.

## 5. Fuera de alcance (no tocar)

- Código muerto de breaks programados: `POST /breaks/:id/start`, `BreaksService.start` y la rama
  `PENDING` de `breakStatusCopy`. Queda para otra tarea.
- El texto de la alerta `DEVICE_MISMATCH` en el handoff (`vault.service.ts:222`).
- Pantallas de solo lectura que siguen en la zona del navegador: filtros y fechas de auditoría y
  seguridad (`AuditLogPanel.tsx` `dateFilter`, `formatSecurityDate`), paneles de operador
  (`shift-view.ts` `formatLocalTime`, `TeamOverview`, `OperatorProfiles`) y cafetería. No escriben
  horas en la API y son coherentes consigo mismas; queda como decisión pendiente.
- El presupuesto de conexiones en PostgreSQL gestionado (hasta 12 por proceso de API después de este
  cambio): se revisa con el despliegue.

## 6. Criterios de aceptación

- [x] 15 denegaciones concurrentes en un pool de 10 terminan todas en 403, con sus 15 filas de
      bitácora; el test falla sin el pool reservado.
- [x] Los scripts `vault-restore-check.mjs` y `vault-rewrap-kek.mjs` siguen terminando (los dos
      pools se cierran).
- [x] Con el reloj de la app atrasado, la serie queda `PENDING` y el mensaje puntual del mismo lote
      sí se encola.
- [x] Las pruebas web corren en UTC (guarda en verde), y los helpers dan hora de Bogotá con valores
      exactos.
- [x] Mensajes, turnos, overrides y relevos envían hora de Bogotá; los rótulos lo dicen.
- [x] `pnpm ci:verify` en exit 0 sobre el SHA final, registrado en la evidencia.
- [x] Nada empujado al remoto.
