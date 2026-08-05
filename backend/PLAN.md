# Agency OS — Plan de construcción del backend

**Versión 1.0 · 2026-08-04**
Ámbito: `backend/` (NestJS sobre adaptador Fastify). No cubre `web-app/`, `extension/` ni el
`ai-engine` salvo en sus contratos de frontera.

Documentos que este plan asume leídos y no duplica:
[`agents.md`](../agents.md) (decisiones §5, riesgos §6) y
`agency-os-requerimientos.md` v2.2 (FR-01…FR-39).
Si algo aquí contradice esos documentos, gana el documento fuente y este archivo se corrige.

---

## 0. Cómo leer este plan

| Sección | Qué contiene |
|---|---|
| §1 | Decisiones nuevas que toma este plan (formato de §5 de agents.md) |
| §2 | Convenciones transversales del modelo de datos |
| §3 | Modelo de datos, módulo por módulo, con tablas y campos |
| §4 | Invariantes que se garantizan en la BD (no solo en código) |
| §5 | Superficie HTTP: contrato común y endpoints por módulo |
| §6 | Seguridad: modelo de amenazas, flujo del vault, guards, RLS |
| §7 | Estructura de módulos NestJS y capas |
| §8 | Trabajos en background (ETL Tableau, outbox, expiraciones) |
| §9 | Testing, observabilidad, operación |
| §10 | Secuencia de construcción mapeada a las Entregas 1/2/3 |
| §11 | Preguntas que este plan deja abiertas y bloquean algo concreto |

---

## 1. Decisiones nuevas que toma este plan

Se numeran desde el 10 para continuar la tabla de §5 de `agents.md`.

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 10 | **Quien pide la credencial al backend es el service worker (background) de la extensión**, no el helper nativo ni el content script | Helper nativo como solicitante (propuesta tentativa en agents.md §6) | El helper es **un proceso por PC**; si él pidiera la credencial tendría que hacérsela llegar al perfil de Chrome correcto, lo que reintroduce un canal entre procesos que hoy no existe y que sería el punto más goloso de ataque en toda la PC. El background corre **dentro** del perfil de Chrome que ya está aislado, así que el scoping (operador, perfil) es natural. Además es lo que ya manda §6 regla 3 y 4 del documento de requerimientos. El helper se queda solo lanzando procesos (decisión #1). |
| 11 | **Drizzle ORM + migraciones SQL planas** para acceso a datos y esquema | Prisma; TypeORM | El modelo depende de cosas que Prisma no sabe expresar y TypeORM expresa mal: `EXCLUDE USING gist` (invariante FR-08), columnas generadas, particionado por rango, RLS, `citext`/`inet`/`tstzrange`, revocación de `SELECT` a nivel de columna sobre el vault. Drizzle es SQL-first, tipa la consulta sin ocultar el SQL y permite migraciones escritas a mano donde haga falta. |
| 12 | **Ledgers append-only** para puntos y para el saldo de cafetería, en vez de columnas de saldo mutables | `operators.balance_cop` actualizado con UPDATE | La nómina es el dominio financieramente sensible del sistema (agents.md §6). Un saldo mutable no se puede auditar hacia atrás ni reconstruir tras un bug; un ledger sí, y las correcciones son filas nuevas (reversos), nunca reescrituras. |
| 13 | **Snapshot de tasa y comisión en cada línea de nómina**, y comisión versionada por rango de vigencia | Leer `users.commission_rate` al liquidar | FR-29 permite cambiar comisión en cualquier momento y FR-05 obliga a auditar ese cambio. Sin snapshot, cambiar una comisión reescribe silenciosamente el histórico ya liquidado. |
| 14 | **Métricas de la extensión y métricas de Tableau se almacenan por separado y se concilian**, no se mezclan en una sola tabla | Una sola tabla de métricas con upsert desde ambas fuentes | Son dos fuentes con latencia, granularidad y confiabilidad distintas (una es DOM en vivo, la otra es corte del día anterior de un tercero). Guardarlas juntas hace imposible detectar divergencia, que es justo la señal que interesa vigilar. |
| 15 | **Ingesta de métricas de la extensión es idempotente por `dedupe_key`** | Insert directo por request | La extensión reintenta ante caída de red (NFR de disponibilidad: "la extensión gestiona reconexión automática"). Sin idempotencia, cada reintento infla puntos, y los puntos son dinero. |
| 16 | **Outbox transaccional** para todo efecto externo (RocketChat, socket.io, notificaciones) | Llamada directa al servicio externo dentro del handler | Hay 2 instancias del backend y un `@socket.io/redis-adapter`. Un `await rocketchat.send()` dentro de una transacción produce mensajes enviados con transacción abortada, o al revés. El outbox lo vuelve exactamente-una-vez con reintentos. |
| 17 | **RBAC por permiso, no por rol, con roles en tabla (no enum de Postgres)** | `role enum('ADMIN','COORDINADOR',…)` | El rol Director Operativo sigue sin formalizar (agents.md §6, requerimientos §3 nota) y el alcance del coordinador es pregunta abierta #5. Con permisos en tabla, formalizarlo es un seed, no una migración de enum ni un cambio de código en cada guard. |
| 18 | **La caducidad de la credencial emitida al vault es de un solo uso y ≤ 60 s**, ligada a un `jti` registrado | Devolver la contraseña en una respuesta normal cacheable | Reduce la ventana en que la credencial existe fuera del vault a la duración del formulario de login. Cualquier segundo uso del mismo `jti` es señal de compromiso y queda registrado como tal. |

---

## 2. Convenciones del modelo de datos

- **Motor:** PostgreSQL 16+ (DO Managed HA). Extensiones requeridas:
  `pgcrypto` (gen_random_uuid), `btree_gist` (constraints de exclusión), `citext` (emails).
- **Claves primarias:** `uuid` para entidades de dominio expuestas por la API.
  `bigint generated always as identity` para tablas append-only de alto volumen
  (`audit_log`, `metric_events`, `points_ledger`, `interaction_events`), que no se exponen
  como identidad externa.
- **Tiempo:** todo `timestamptz`, base en UTC. La zona de negocio es `America/Bogota` y se
  aplica en la capa de aplicación. Las tablas con corte diario llevan además
  `business_date date` explícita — no se deriva del timestamp en tiempo de consulta, porque
  el corte del día de nómina no coincide con medianoche UTC.
- **Dinero:** `numeric(14,2)` en COP. Nunca `float`/`double`. Nunca centavos en `int` (el COP no
  usa decimales en la práctica pero las comisiones sí producen fracciones intermedias).
- **Puntos:** `numeric(14,4)`. Se asume que TalkyTimes puede reportar fracciones; si el spike
  confirma que siempre son enteros, sigue siendo seguro.
- **Rangos:** `tstzrange` para vigencias (asignaciones, turnos, comisiones). Permite constraints
  de exclusión y consultas de solapamiento sin lógica en aplicación.
- **Borrado:** `deleted_at timestamptz` en entidades con histórico (usuarios, perfiles, productos).
  Nunca `DELETE` físico sobre nada referenciado por nómina o auditoría.
- **Auditoría de fila:** `created_at`, `updated_at`, `created_by`, `updated_by` en entidades
  mutables. `version int` (optimistic locking) donde haya edición concurrente real: perfiles,
  icebreakers, líneas de nómina.
- **Nombres:** tablas en `snake_case` plural, columnas en `snake_case`. La API expone `camelCase`;
  la traducción vive en la capa de mapeo, no en la BD.
- **Enums:** enums de Postgres para conjuntos cerrados y estables (estados de máquina). Tabla de
  catálogo para conjuntos que el administrador puede extender (roles, reglas de icebreakers,
  categorías de producto).

---

## 3. Modelo de datos

### 3.1 Identidad, roles y organización

**`roles`** — catálogo, seeded.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `code` | text UNIQUE | `ADMIN`, `DIRECTOR_OPERATIVO`, `COORDINADOR`, `OPERADOR`, `CAFETERIA` |
| `name` | text | Nombre visible |
| `hierarchy_level` | smallint | Menor = más autoridad. Usado por "rol superior determina si incumplió" (FR-21) |
| `is_system` | boolean | Roles de sistema no se borran |
| `created_at` | timestamptz | |

**`permissions`** — catálogo, seeded.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `code` | text UNIQUE | `vault.credential.issue`, `payroll.configure`, `icebreaker.review`, … |
| `module` | text | Agrupación para UI de administración |
| `description` | text | |

**`role_permissions`** — `(role_id, permission_id)` PK compuesta.

**`users`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `email` | citext | UNIQUE parcial `WHERE deleted_at IS NULL` |
| `password_hash` | text | scrypt con los parámetros dentro del propio hash (decisión #19). Ver §6.2 |
| `full_name` | text | |
| `national_id` | text NULL | Cédula, para liquidación |
| `phone` | text NULL | |
| `role_id` | uuid FK roles | |
| `status` | enum | `ACTIVE`, `SUSPENDED`, `DISABLED` |
| `must_change_password` | boolean | Alta de operador por el admin |
| `password_changed_at` | timestamptz NULL | |
| `last_login_at` | timestamptz NULL | |
| `failed_login_count` | int default 0 | |
| `locked_until` | timestamptz NULL | Bloqueo por fuerza bruta |
| `rocketchat_user_id` | text NULL | Mapeo FR-36/FR-37 |
| `created_at` / `updated_at` / `created_by` / `updated_by` / `deleted_at` | | |

> El `password_hash` nunca sale del repositorio de usuarios: las consultas de lectura usan una
> proyección explícita. No hay `SELECT *` sobre `users` en todo el código (regla verificable en CI).

**`crews`** (cuadrillas)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `coordinator_id` | uuid FK users NULL | |
| `is_active` | boolean | |
| `created_at` / `updated_at` | | |

**`crew_members`** — membresía con historia (la atribución de nómina y las métricas de coordinador
dependen de a qué cuadrilla pertenecía el operador *en ese momento*).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `crew_id` | uuid FK | |
| `user_id` | uuid FK | |
| `valid_range` | tstzrange | `EXCLUDE (user_id WITH =, valid_range WITH &&)` — un operador en una cuadrilla a la vez |

**`operator_compensation`** — comisión y tasa versionadas (decisión #13).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `operator_id` | uuid FK users | |
| `commission_rate` | numeric(5,4) | 0.0000–1.0000 |
| `points_to_cop_rate` | numeric(12,4) | Puede sobrescribir la tasa global |
| `monthly_goal_points` | numeric(14,4) NULL | |
| `max_concurrent_profiles` | smallint | Default configurable; ver pregunta abierta #1 |
| `valid_range` | tstzrange | `EXCLUDE (operator_id WITH =, valid_range WITH &&)` |
| `created_by` / `created_at` / `note` | | Cambios auditados por FR-05 |

**`refresh_tokens`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | Es el `jti` |
| `user_id` | uuid FK | |
| `token_hash` | text | SHA-256 del token. Nunca el token |
| `family_id` | uuid | Rotación: toda la familia se revoca si se detecta reuso |
| `issued_at` / `expires_at` / `revoked_at` | timestamptz | |
| `replaced_by_id` | uuid NULL FK self | |
| `revoked_reason` | enum NULL | `ROTATED`, `LOGOUT`, `REUSE_DETECTED`, `ADMIN_REVOKE` |
| `ip` | inet | |
| `user_agent` | text | |
| `device_id` | uuid NULL FK devices | |

**`ip_allowlist`** (FR-03)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | "Oficina principal" |
| `cidr` | cidr | Soporta IP única (`/32`) y rango |
| `scope` | enum | `ALL`, `ROLE`, `USER` |
| `role_id` / `user_id` | uuid NULL | Según `scope` |
| `is_active` | boolean | |
| `created_by` / `created_at` / `expires_at` | | `expires_at` para excepciones temporales |

**`login_attempts`** — alimenta rate limiting persistente y el reporte de "intentos bloqueados"
de FR-05.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `email_attempted` | citext | |
| `user_id` | uuid NULL | Null si el email no existe |
| `ip` | inet | |
| `outcome` | enum | `SUCCESS`, `BAD_CREDENTIALS`, `IP_BLOCKED`, `OUT_OF_SHIFT`, `LOCKED`, `DISABLED` |
| `occurred_at` | timestamptz | |

**`audit_log`** (FR-05) — append-only, particionada por mes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK compuesta `(id, occurred_at)` por el particionado |
| `occurred_at` | timestamptz | Clave de partición |
| `actor_type` | enum | `USER`, `DEVICE`, `SYSTEM`, `JOB` |
| `actor_user_id` / `actor_device_id` | uuid NULL | |
| `action` | text | `vault.credential.issued`, `payroll.commission.changed`, `assignment.changed`, `auth.blocked`, `icebreaker.published` |
| `entity_type` / `entity_id` | text / uuid NULL | |
| `result` | enum | `SUCCESS`, `DENIED`, `ERROR` |
| `ip` | inet NULL | |
| `request_id` | text | Correlación con logs |
| `metadata` | jsonb | Contexto. Ver restricción abajo |

Inmutabilidad y la decisión #8 de agents.md se implementan **en la BD**, no solo en código:

```sql
-- 1. La aplicación no puede modificar ni borrar auditoría.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM agency_app;

-- 2. Criterio de aceptación de la decisión #8: el campo contraseña no entra al log.
ALTER TABLE audit_log ADD CONSTRAINT audit_log_no_secret_keys CHECK (
  NOT jsonb_exists_any(metadata, ARRAY[
    'password','contrasena','contraseña','secret','plaintext',
    'credential','credentialValue','secret_ciphertext','token'
  ])
);
```

> Dos advertencias sobre ese CHECK, para que no se confíe de más en él:
> `jsonb_exists_any` solo mira **claves de primer nivel** — un secreto anidado no lo detecta, y
> tampoco detecta un secreto puesto como *valor* de una clave inocente. Es una red de seguridad
> de último recurso; la defensa real es el allowlist de campos en el serializador de auditoría
> (§6.5). Se usa `jsonb_exists_any(...)` y no el operador `?|` a propósito: el `?` colisiona con
> los placeholders de parámetros de varios drivers de Postgres.

### 3.2 Perfiles de TalkyTimes y vault

**`tt_profiles`** (FR-06)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `display_name` | text | Nombre del perfil femenino |
| `login_email` | citext | UNIQUE parcial `WHERE deleted_at IS NULL` |
| `external_ref` | text NULL | Id de TalkyTimes si se llega a conocer |
| `country` | char(2) NULL | ISO-3166 |
| `status` | enum | `ACTIVE`, `PAUSED`, `BANNED`, `RETIRED` |
| `chrome_profile_dir` | text NULL | Mapeo perfil → carpeta de Chrome (agents.md §5.1) |
| `notes` | text NULL | |
| `version` | int | Optimistic locking |
| `created_at` / `updated_at` / `created_by` / `updated_by` / `deleted_at` | | |

**`encryption_keys`** — cifrado con sobre (envelope). La KEK vive en variable de entorno / secreto
de DO; la DEK envuelta vive aquí. Permite rotar sin re-desplegar ni re-cifrar todo de golpe.

| Campo | Tipo | Notas |
|---|---|---|
| `version` | int PK | Referenciado por cada ciphertext |
| `wrapped_dek` | bytea | DEK cifrada con la KEK |
| `algorithm` | text | `AES-256-GCM` |
| `created_at` / `retired_at` | timestamptz | |

**`tt_profile_credentials`** (FR-07) — versionada, solo una vigente por perfil.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | uuid FK tt_profiles | |
| `username` | text | El email/usuario de login (no es secreto) |
| `secret_ciphertext` | bytea | AES-256-GCM |
| `secret_nonce` | bytea | 12 bytes, único por cifrado |
| `secret_tag` | bytea | Tag de autenticación GCM |
| `key_version` | int FK encryption_keys | |
| `aad_context` | text | Additional authenticated data: `profile_id:version`. Impide mover un ciphertext de un perfil a otro |
| `version` | int | 1, 2, 3… por rotación |
| `is_current` | boolean | UNIQUE parcial `(profile_id) WHERE is_current` |
| `rotated_at` / `rotated_by` / `created_at` | | |

```sql
-- Ni siquiera un SELECT * accidental desde un rol de lectura puede leer el ciphertext.
REVOKE SELECT ON tt_profile_credentials FROM agency_readonly;
GRANT  SELECT (id, profile_id, username, version, is_current, rotated_at)
       ON tt_profile_credentials TO agency_readonly;
```

**`credential_access_log`** — bitácora específica del vault. Nunca contiene el valor.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `profile_id` | uuid | |
| `user_id` | uuid NULL | Operador que la solicitó |
| `device_id` | uuid NULL | PC desde la que se solicitó |
| `assignment_id` | uuid NULL | Asignación que la autorizó |
| `purpose` | enum | `LOGIN_INJECTION`, `ADMIN_ROTATION` |
| `granted` | boolean | |
| `deny_reason` | enum NULL | `NO_ASSIGNMENT`, `OUT_OF_SHIFT`, `IP_BLOCKED`, `DEVICE_REVOKED`, `RATE_LIMITED`, `PROFILE_INACTIVE` |
| `grant_jti` | uuid NULL | El id del ticket de un solo uso (decisión #18) |
| `consumed_at` | timestamptz NULL | Cuándo se canjeó el ticket |
| `reuse_attempted` | boolean | Señal de compromiso |
| `ip` / `occurred_at` | | |

**`devices`** — identidad de cada PC de oficina (helper + extensión). Resuelve el punto (3) del
riesgo abierto de agents.md §6.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `hostname` | text | |
| `label` | text | "PC-Operador-04" |
| `assigned_operator_id` | uuid NULL FK users | |
| `status` | enum | `PENDING`, `APPROVED`, `REVOKED` |
| `enrollment_code_hash` | text NULL | Código de un solo uso que el admin entrega al instalar |
| `token_hash` | text NULL | SHA-256 del token de dispositivo |
| `token_issued_at` / `token_expires_at` | timestamptz | Rotación periódica |
| `extension_version` / `helper_version` | text NULL | Para detectar PCs desactualizadas |
| `os_version` | text NULL | |
| `last_seen_at` / `last_ip` | | |
| `created_at` / `approved_by` / `revoked_at` / `revoked_reason` | | |

### 3.3 Asignaciones y sesiones (FR-08 a FR-12)

**`profile_assignments`** (FR-08, FR-09)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | uuid FK tt_profiles | |
| `operator_id` | uuid FK users | |
| `shift_id` | uuid NULL FK shifts | |
| `valid_range` | tstzrange | Ventana de la asignación |
| `status` | enum | `SCHEDULED`, `ACTIVE`, `ENDED`, `CANCELLED` |
| `assigned_by` | uuid FK users | |
| `ended_at` / `end_reason` | | `NORMAL`, `REASSIGNED`, `INCIDENT` |
| `created_at` | | |

**`profile_sessions`** (FR-10, FR-15)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` / `operator_id` / `device_id` / `assignment_id` | uuid FK | |
| `chrome_profile_dir` | text | Con qué `--profile-directory` se lanzó |
| `status` | enum | `LAUNCHING`, `ACTIVE`, `ERROR`, `CLOSED` |
| `started_at` / `last_heartbeat_at` / `ended_at` | timestamptz | |
| `end_reason` | enum NULL | `OPERATOR_CLOSED`, `SHIFT_ENDED`, `HEARTBEAT_TIMEOUT`, `ERROR` |
| `error_code` / `error_detail` | text NULL | Mensajes accionables (NFR de usabilidad) |

> FR-10 expone `inactivo | conectando | activo | error`. Se mapea desde `status` + ausencia de
> sesión, no se guarda un cuarto estado redundante.

### 3.4 Turnos y jornada (FR-04, FR-15 a FR-17)

**`shift_templates`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `crew_id` | uuid NULL FK | |
| `start_time` / `end_time` | time | |
| `crosses_midnight` | boolean | Turno nocturno |
| `weekdays` | smallint[] | 1..7 ISO |
| `break_minutes` | smallint | |
| `valid_from` / `valid_to` | date | |
| `is_active` | boolean | |

**`shifts`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `operator_id` | uuid FK | |
| `template_id` | uuid NULL FK | |
| `business_date` | date | Día de negocio al que se imputa |
| `scheduled_range` | tstzrange | |
| `actual_start_at` / `actual_end_at` | timestamptz NULL | Registro automático de FR-15 |
| `status` | enum | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `MISSED`, `CANCELLED` |
| `effective_minutes` | int NULL | Calculado al cerrar: turno − breaks |
| `notes` / `created_by` | | |

**`shift_overrides`** — cubre "VERIFICAR OPCION DE HORAS EXTRA Y HORARIOS EXTENDIDOS" de FR-04.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `operator_id` | uuid FK | |
| `range` | tstzrange | Ventana adicional en que el operador **sí** puede autenticarse |
| `type` | enum | `OVERTIME`, `EXTENDED_SHIFT`, `SPECIAL_PERMISSION` |
| `reason` | text | |
| `approved_by` | uuid FK users | Solo `COORDINADOR` o superior |
| `created_at` | | |

**`breaks`** (FR-16)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `shift_id` | uuid FK | |
| `type` | enum | `SCHEDULED`, `UNSCHEDULED` |
| `scheduled_at` | timestamptz NULL | Base del aviso anticipado |
| `notified_at` | timestamptz NULL | |
| `started_at` / `ended_at` | timestamptz NULL | |
| `duration_minutes` | int GENERATED | `EXTRACT(EPOCH FROM (ended_at − started_at))/60` |
| `status` | enum | `PENDING`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED` |

**`operator_status_events`** (FR-38, semáforo) — append-only.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `operator_id` | uuid FK | |
| `status` | enum | `ONLINE`, `BREAK`, `ALERT`, `OFFLINE` |
| `source` | enum | `HELPER`, `EXTENSION`, `WEB`, `SYSTEM` |
| `occurred_at` | timestamptz | |
| `metadata` | jsonb | Motivo de alerta, etc. |

**`operator_current_status`** — proyección de una fila por operador, para que el semáforo no
tenga que hacer un `DISTINCT ON` sobre la tabla de eventos en cada carga. Se escribe en la misma
transacción que el evento; el broadcast en vivo va por Redis.

### 3.5 Métricas (FR-14, FR-18 a FR-20)

**`metric_events`** — captura cruda de la extensión, particionada por mes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK `(id, occurred_at)` |
| `dedupe_key` | text | UNIQUE `(dedupe_key, occurred_at)`. Lo genera la extensión: `sha256(profileId + tipo + marca temporal de la página + valor)` |
| `profile_id` / `operator_id` / `session_id` / `device_id` | uuid | |
| `event_type` | enum | `POINTS`, `MESSAGE_SENT`, `ICEBREAKER_SENT`, `ICEBREAKER_REPLY`, `LIKE`, `VISIT` |
| `value` | numeric(14,4) | |
| `occurred_at` | timestamptz | Momento según la página |
| `captured_at` / `received_at` | timestamptz | Para medir retraso de ingesta |
| `icebreaker_id` | uuid NULL FK | Cierra el feedback loop de FR-26 |
| `raw` | jsonb | Payload tal cual lo leyó el DOM. Sujeto a límite de tamaño |

**`profile_daily_metrics`** — agregado por día, perfil y fuente (decisión #14).

| Campo | Tipo | Notas |
|---|---|---|
| `business_date` | date | PK compuesta con las dos siguientes |
| `profile_id` | uuid | |
| `source` | enum | `EXTENSION`, `TABLEAU` |
| `points` | numeric(14,4) | |
| `messages_sent` / `icebreakers_sent` / `icebreakers_replied` | int | |
| `response_rate` | numeric(6,4) GENERATED | `icebreakers_replied / NULLIF(icebreakers_sent,0)` |
| `operator_count` | smallint | Cuántos operadores trabajaron el perfil ese día. `> 1` marca un día con relevo |
| `computed_at` | timestamptz | |

> **Esta tabla no lleva `operator_id`, a propósito.** Su grano es *perfil × día*, que es lo que
> pide el dashboard de FR-18 ("métricas por perfil"). Como un perfil puede pasar por dos
> operadores en un día (§4.1), un único `operator_id` aquí sería una mentira: guardaría al
> "dominante" y perdería al otro. La atribución por operador vive donde corresponde y donde se
> puede auditar fila por fila — en `points_ledger` (§3.8), con su `assignment_id` y su
> `attribution_method`.

**`metric_reconciliation`** — la divergencia entre fuentes es un dato de negocio, no un error a
esconder.

| Campo | Tipo | Notas |
|---|---|---|
| `business_date` / `profile_id` | PK compuesta | |
| `extension_points` / `tableau_points` | numeric(14,4) | |
| `delta_abs` / `delta_pct` | numeric | |
| `status` | enum | `MATCH`, `WITHIN_TOLERANCE`, `DIVERGENT`, `MISSING_SOURCE` |
| `resolved_by` / `resolution_note` | | Cuál fuente se toma como buena para nómina |

### 3.6 ETL de Tableau (decisión #9 de agents.md)

**`tableau_views`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `view_id` | text | Id de Tableau |
| `workbook_name` / `view_name` | text | |
| `purpose` | enum | `POINTS`, `PROFILE_METRICS`, `ICEBREAKERS`, `PAYROLL`, `MALE_PROFILE_COUNTRIES` |
| `download_format` | enum | `CSV`, `XLSX` |
| `filters` | jsonb | Parámetros `vf_<campo>` |
| `column_mapping` | jsonb | Columna de Tableau → campo del modelo. **Es configuración, no código**: la lista exacta de vistas sigue sin confirmar (agents.md §6) |
| `grain` | enum | `HOURLY`, `DAILY`. La vista de puntos es `HOURLY` (§4.2) |
| `source_timezone` | text | Zona en que Tableau devuelve las marcas de tiempo. Sin esto la atribución del relevo se desplaza una hora sin avisar (§4.2) |
| `schedule_cron` | text | |
| `is_active` | boolean | |

**`tableau_hourly_points`** — hecho horario, la base de la atribución exacta de §4.2.

| Campo | Tipo | Notas |
|---|---|---|
| `business_date` | date | PK compuesta con las dos siguientes |
| `profile_id` | uuid FK | |
| `hour_start` | timestamptz | Inicio de la hora, ya normalizado a `America/Bogota` |
| `points` | numeric(14,4) | |
| `run_id` | uuid FK etl_runs | De qué corrida vino |
| `loaded_at` | timestamptz | |

Una re-ejecución del ETL para un mismo día reemplaza estas filas y **recalcula** las filas de
`points_ledger` derivadas, siempre que el periodo de nómina siga abierto; si está cerrado, la
diferencia entra como fila de reverso más fila nueva, nunca como reescritura (decisión #12).

**`etl_runs`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `view_id` | uuid FK | |
| `business_date` | date | Corte que representa |
| `started_at` / `finished_at` | timestamptz | |
| `status` | enum | `RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED` |
| `rows_extracted` / `rows_loaded` / `rows_rejected` | int | |
| `source_checksum` | text | SHA-256 del archivo descargado: detecta que Tableau no refrescó |
| `artifact_uri` | text NULL | Copia cruda en DO Spaces |
| `error` | jsonb NULL | |
| UNIQUE | `(view_id, business_date)` | Re-ejecución explícita, no accidental |

**`etl_staging_rows`** — filas crudas antes de transformar. Retención 90 días.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `run_id` | uuid FK | |
| `row_number` | int | |
| `payload` | jsonb | Fila tal cual |
| `validation_status` | enum | `VALID`, `REJECTED` |
| `validation_errors` | jsonb NULL | |

### 3.7 Icebreakers e IA (FR-21 a FR-27)

**`icebreaker_rules`** — catálogo editable. Las reglas reales de TalkyTimes son pregunta abierta
#2; el modelo permite cargarlas sin migración.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `code` | text UNIQUE | |
| `description` | text | Se le muestra al operador cuando la incumple |
| `severity` | enum | `BLOCKING`, `WARNING` |
| `detection_type` | enum | `REGEX`, `LLM`, `MANUAL` |
| `pattern` | text NULL | Solo si `REGEX`. Ver §6.7 (ReDoS) |
| `version` | int | |
| `valid_from` / `valid_to` | timestamptz | Una infracción vieja se explica con la regla vigente entonces |
| `is_active` | boolean | |

**`icebreakers`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` / `operator_id` | uuid FK | |
| `text` | text | CHECK longitud ≤ 2000 |
| `text_hash` | text | Detecta reenvíos idénticos |
| `language` | char(2) NULL | |
| `status` | enum | `DRAFT`, `EVALUATING`, `BLOCKED`, `APPROVED`, `PUBLISHED`, `REJECTED`, `ARCHIVED` |
| `current_evaluation_id` | uuid NULL FK | Última evaluación vigente |
| `review_state` | enum | `NONE`, `PENDING_REVIEW`, `OVERRIDDEN_ALLOW`, `OVERRIDDEN_BLOCK` |
| `published_at` / `published_by` | | FR-05 audita la publicación |
| `version` | int | |
| `created_at` / `updated_at` | | |

**`icebreaker_evaluations`** (FR-22, FR-23, FR-24)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `icebreaker_id` | uuid FK | |
| `attempt_no` | int | UNIQUE `(icebreaker_id, attempt_no)`. FR-24: intentos ilimitados |
| `is_valid` | boolean | Resultado bloqueante de FR-22 |
| `score_total` | smallint NULL | 0–100 |
| `score_originality` / `score_engagement` / `score_tone` / `score_cta` | smallint NULL | Las 4 dimensiones de FR-23 |
| `tips` | jsonb | Lista de sugerencias accionables |
| `engine_version` / `model` | text | Necesario para recalibrar (FR-26) |
| `raw_response` | jsonb | Respuesta del motor de IA, ya validada contra schema |
| `latency_ms` / `token_cost_usd` | | Control de costo (LLM10) |
| `evaluated_at` | timestamptz | |

**`icebreaker_violations`** (FR-25)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `evaluation_id` / `icebreaker_id` / `rule_id` | uuid FK | |
| `rule_version` | int | La versión de la regla en el momento |
| `matched_excerpt` | text NULL | |
| `confidence` | numeric(4,3) NULL | |
| `created_at` | | |

**`icebreaker_reviews`** — "rol superior determina si incumplió o no" (nota de FR-21).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `icebreaker_id` / `violation_id` | uuid FK | |
| `reviewer_id` | uuid FK users | CHECK a nivel de servicio: `hierarchy_level` menor que el del autor |
| `decision` | enum | `CONFIRM_VIOLATION`, `FALSE_POSITIVE`, `FALSE_NEGATIVE` |
| `comment` | text | |
| `decided_at` | timestamptz | |

**`icebreaker_effectiveness`** (FR-26, FR-27)

| Campo | Tipo | Notas |
|---|---|---|
| `icebreaker_id` / `business_date` | PK compuesta | |
| `sent_count` / `reply_count` | int | |
| `response_rate` | numeric(6,4) GENERATED | |
| `points_attributed` | numeric(14,4) | |
| `source` | enum | `EXTENSION`, `TABLEAU` |

### 3.8 Nómina (FR-28 a FR-31)

**`points_ledger`** — append-only (decisión #12), particionada por mes.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity | PK `(id, business_date)` |
| `operator_id` | uuid FK | |
| `profile_id` | uuid NULL FK | |
| `business_date` | date | |
| `points` | numeric(14,4) | Puede ser negativo (reverso) |
| `source` | enum | `EXTENSION`, `TABLEAU_ETL`, `MANUAL_ADJUSTMENT`, `COMPETITION_AWARD` |
| `reference_type` / `reference_id` | text / uuid NULL | Trazabilidad al origen |
| `reverses_id` | bigint NULL | Si es un reverso, a qué fila |
| `description` | text | Obligatoria si `MANUAL_ADJUSTMENT` |
| `created_by` / `created_at` | | |

**`payroll_periods`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `year` / `month` | int | UNIQUE `(year, month)` |
| `starts_on` / `ends_on` | date | |
| `status` | enum | `OPEN`, `LOCKED`, `CLOSED`, `PAID` |
| `default_points_to_cop_rate` | numeric(12,4) | Snapshot de la tasa global |
| `locked_at` / `closed_at` / `closed_by` | | Cerrado ⇒ ninguna escritura más al ledger de ese rango |

**`payroll_lines`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | UNIQUE `(period_id, operator_id)` |
| `period_id` / `operator_id` | uuid FK | |
| `total_points` | numeric(14,4) | |
| `commission_rate_snapshot` | numeric(5,4) | Decisión #13 |
| `points_to_cop_rate_snapshot` | numeric(12,4) | |
| `gross_cop` | numeric(14,2) | `total_points × tasa × comisión` |
| `bonus_cop` | numeric(14,2) | Metas cumplidas (FR-30) |
| `competition_cop` | numeric(14,2) | Premios de competencias |
| `cafeteria_debit_cop` | numeric(14,2) | FR-35 |
| `adjustments_cop` | numeric(14,2) | Suma de `payroll_adjustments` |
| `net_cop` | numeric(14,2) | Valor final a pagar |
| `worked_days` | int | "CONTAR DIAS TRABAJADOS" (nota de FR-29) |
| `effective_minutes` | int | FR-17 |
| `computed_at` / `computed_by` / `status` | | `DRAFT`, `APPROVED`, `PAID` |

**`payroll_adjustments`** — `(id, line_id, type, amount_cop, reason, created_by, created_at)`,
con `type` en `BONUS | PENALTY | ADVANCE | CORRECTION`. Nunca se edita una línea a mano.

**`goals`** (FR-30)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `scope` | enum | `OPERATOR`, `CREW`, `GLOBAL` |
| `operator_id` / `crew_id` | uuid NULL | |
| `period_id` | uuid FK | |
| `target_points` | numeric(14,4) | |
| `bonus_type` | enum | `FIXED`, `PERCENT`, `TIERED` |
| `bonus_cop` | numeric(14,2) NULL | |
| `tiers` | jsonb NULL | `[{min_points, bonus_cop}]` |
| `is_active` | boolean | |

**`competitions`** / **`competition_participants`** — cubre "COMPETENCIAS DE OPERADORES POR
PUNTOS" y "EVENTOS DINÁMICOS CREADOS POR EL ADMINISTRADOR" (notas de FR-20 y FR-29).

`competitions`: `id`, `name`, `description`, `metric` (`POINTS | RESPONSE_RATE |
ICEBREAKER_SCORE`), `scope`, `crew_id`, `starts_at`, `ends_at`, `rules jsonb`, `prize_scheme jsonb`,
`status` (`DRAFT | ACTIVE | CLOSED | CANCELLED`), `created_by`.
`competition_participants`: `competition_id`, `operator_id`, `enrolled_at`, `current_value`,
`final_rank`, `awarded_cop`, `awarded_at`.

**`payroll_exports`** (FR-31): `id`, `period_id`, `format` (`XLSX`), `file_uri`, `checksum`,
`row_count`, `generated_by`, `generated_at`, `expires_at`.

### 3.9 Cafetería (FR-32 a FR-35)

**`cafeteria_products`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `sku` | text UNIQUE | |
| `name` / `description` | text | |
| `category` | text | |
| `price_cop` | numeric(12,2) | Precio **vigente**; los pedidos guardan su propio snapshot |
| `is_available` | boolean | FR-32 |
| `prep_minutes` | smallint NULL | |
| `pickup_deadline_minutes` | smallint | "TIEMPO MÁXIMO PARA RECOGERLO" (FR-34) |
| `image_uri` | text NULL | |
| `created_at` / `updated_at` / `deleted_at` | | |

**`cafeteria_orders`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `order_number` | bigint identity | Número corto para la pantalla de cocina |
| `operator_id` | uuid FK | |
| `status` | enum | `PLACED`, `ACCEPTED`, `PREPARING`, `READY`, `DELIVERED`, `CANCELLED`, `EXPIRED` |
| `placed_at` / `accepted_at` / `ready_at` / `delivered_at` / `cancelled_at` | timestamptz NULL | |
| `pickup_deadline_at` | timestamptz NULL | Se fija al pasar a `READY` |
| `total_cop` | numeric(12,2) | |
| `delivered_by` | uuid NULL FK users | |
| `cancel_reason` | text NULL | |
| `notes` | text NULL | |

**`cafeteria_order_items`**: `id`, `order_id`, `product_id`, `product_name_snapshot`,
`unit_price_cop`, `quantity`, `line_total_cop`, `notes`.
El snapshot de nombre y precio evita una tabla de historial de precios: un cambio de precio no
reescribe pedidos pasados.

**`operator_account_entries`** — ledger de saldo del operador, append-only (decisión #12).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | bigint identity PK | |
| `operator_id` | uuid FK | |
| `entry_type` | enum | `DEBIT_CAFETERIA`, `CREDIT_REFUND`, `CREDIT_ADJUSTMENT`, `PAYROLL_SETTLEMENT` |
| `amount_cop` | numeric(14,2) | Con signo |
| `reference_type` / `reference_id` | | Pedido, línea de nómina |
| `business_date` | date | |
| `period_id` | uuid NULL FK | A qué periodo se imputa |
| `created_by` / `created_at` | | |
| UNIQUE | `(reference_type, reference_id, entry_type)` | El débito de un pedido entregado no se puede duplicar (FR-35) |

### 3.10 Comunicación y notificaciones (FR-36 a FR-38)

**`rocketchat_channels`**: `id`, `crew_id NULL`, `rc_room_id`, `name`, `type`
(`CHANNEL | GROUP | DM`), `purpose` (`CREW | ALERTS | GENERAL | BOT`), `is_active`.

**`scheduled_messages`** (FR-37): `id`, `channel_id NULL`, `target_user_id NULL`, `body`,
`scheduled_for`, `recurrence_rule NULL` (RRULE), `status` (`PENDING | SENT | FAILED | CANCELLED`),
`sent_at`, `attempts`, `last_error`, `created_by`, `created_at`.
CHECK: exactamente uno de `channel_id` / `target_user_id` no nulo.

**`notifications`**: `id`, `user_id`, `type`, `title`, `body`, `severity`
(`INFO | WARNING | CRITICAL`), `channels` (`WEB | ROCKETCHAT | BOTH`), `reference_type`,
`reference_id`, `read_at`, `created_at`.

**`outbox_events`** (decisión #16): `id bigint identity`, `event_type`, `aggregate_type`,
`aggregate_id`, `payload jsonb`, `status` (`PENDING | PROCESSING | SENT | FAILED | DEAD`),
`attempts`, `next_attempt_at`, `last_error`, `created_at`, `processed_at`.
Índice parcial `(next_attempt_at) WHERE status IN ('PENDING','FAILED')`.

### 3.11 Automatización de interacciones (FR-39) — gated por el spike

**`interaction_campaigns`**: `id`, `profile_id`, `type` (`LIKE | VISIT`),
`target_countries char(2)[]`, `daily_limit`, `hourly_limit`, `active_hours`,
`status` (`DRAFT | ACTIVE | PAUSED | STOPPED`), `created_by`, `created_at`.

**`interaction_events`**: `id bigint identity`, `campaign_id`, `profile_id`, `session_id`,
`target_external_ref`, `type`, `status` (`QUEUED | EXECUTED | FAILED | SKIPPED`), `executed_at`,
`error`, `dedupe_key UNIQUE`.

Todo el módulo queda detrás del feature flag `fr39.interactions` (§3.12), apagado hasta que el
spike de semanas 1–2 concluya.

### 3.12 Configuración

**`app_settings`**: `key text PK`, `value jsonb`, `description`, `is_secret boolean`,
`updated_by`, `updated_at`. Cubre el NFR de "cero hardcoding": tasa global de puntos → COP,
tolerancia de conciliación, límites de rate, ventana de gracia del turno.

**`feature_flags`**: `key text PK`, `is_enabled boolean`, `rollout jsonb`, `description`,
`updated_by`, `updated_at`. Flags previstos: `fr39.interactions`, `feature9.chat_verification`,
`icebreakers.blocking_score`, `tableau.etl`.

---

## 4. Invariantes garantizados en la base de datos

No basta con validarlos en código: con 2 instancias del backend, la carrera es real y el código
que gana es el que la BD rechaza.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- FR-08: un perfil no puede estar asignado a dos operadores en ventanas que se solapen.
ALTER TABLE profile_assignments
  ADD CONSTRAINT profile_assignment_no_overlap
  EXCLUDE USING gist (profile_id WITH =, valid_range WITH &&)
  WHERE (status <> 'CANCELLED');

-- FR-08 (refuerzo en vivo): un perfil no puede tener dos sesiones abiertas a la vez.
CREATE UNIQUE INDEX profile_single_live_session
  ON profile_sessions (profile_id)
  WHERE status IN ('LAUNCHING', 'ACTIVE');

-- Un operador no puede tener dos turnos solapados.
ALTER TABLE shifts
  ADD CONSTRAINT shift_no_overlap
  EXCLUDE USING gist (operator_id WITH =, scheduled_range WITH &&)
  WHERE (status <> 'CANCELLED');

-- Solo una credencial vigente por perfil.
CREATE UNIQUE INDEX one_current_credential_per_profile
  ON tt_profile_credentials (profile_id) WHERE is_current;

-- FR-35: el débito de un pedido entregado ocurre una sola vez.
ALTER TABLE operator_account_entries
  ADD CONSTRAINT one_debit_per_reference
  UNIQUE (reference_type, reference_id, entry_type);

-- Decisión #15: la ingesta de métricas de la extensión es idempotente.
ALTER TABLE metric_events
  ADD CONSTRAINT metric_event_dedupe UNIQUE (dedupe_key, occurred_at);

-- No se escribe al ledger de un periodo ya cerrado.
CREATE OR REPLACE FUNCTION reject_write_on_closed_period() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payroll_periods p
    WHERE NEW.business_date BETWEEN p.starts_on AND p.ends_on
      AND p.status IN ('CLOSED', 'PAID')
  ) THEN
    RAISE EXCEPTION 'payroll period closed for business_date %', NEW.business_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

### 4.1 Relevo de perfil entre operadores el mismo día (pregunta abierta #4, resuelta 2026-08-04)

**Respuesta del negocio: sí, un mismo perfil puede trabajarse en dos turnos del mismo día por
operadores distintos.** El constraint de exclusión de arriba ya lo permite sin cambios — solo
prohíbe el solapamiento, que es exactamente lo que dice FR-08 ("no puede estar **activo** en dos
sesiones simultáneamente"). Lo que sí obliga esta respuesta es a definir cuatro cosas que sin ella
se podían dejar implícitas:

**1. Los rangos son semiabiertos `[)`, siempre.** Es la convención por defecto de `tstzrange` y
aquí pasa a ser carga estructural: con turnos consecutivos que terminan y empiezan a las 14:00,
un rango cerrado `[]` los haría solaparse en ese instante y el relevo fallaría con un 409 que
parece un bug del sistema y no lo es. Se fija por CHECK para que nadie inserte otra cosa:

```sql
ALTER TABLE profile_assignments
  ADD CONSTRAINT assignment_range_half_open CHECK (
    lower_inc(valid_range) AND NOT upper_inc(valid_range)
  );
```

**2. El relevo cierra la sesión saliente, no espera a que el operador cierre Chrome.** El índice
único parcial `profile_single_live_session` haría que el operador entrante recibiera 409 mientras
el saliente tenga la ventana abierta. El job `shifts:open-close` cierra las sesiones cuya
asignación venció, con `end_reason = 'SHIFT_ENDED'`. Si la sesión sigue viva, se cierra igual y se
notifica al coordinador — el perfil no puede quedar bloqueado para el turno siguiente porque
alguien no cerró una ventana.

> **La ventana de gracia debe ser 0, y esto solo se ve sabiendo el horario real.** Los turnos son
> consecutivos sin hueco (06:05, 14:05, 22:05: cada uno empieza exactamente cuando termina el
> anterior). Cualquier gracia que se le dé al saliente es tiempo que el entrante pasa recibiendo
> 409 al intentar abrir su perfil, sin entender por qué. Con turnos separados por un hueco una
> gracia de 5 minutos sería sensata; aquí es directamente un bloqueo al operador que llega. El
> cierre tiene que ser puntual al vencer la asignación, y el aviso de "cierra tus ventanas" va
> **antes** del corte, no después.

> `agents.md` §4 anota que JarvisBot ya resolvió en la práctica "qué pasa cuando una operadora
> entra a un perfil que otra dejó abierto". Es el precedente exacto de este caso y conviene
> mirarlo antes de implementar el job — sin portar código, solo la regla operativa que allá
> funcionó.

**3. La atribución usa `occurred_at`, nunca `received_at`.** Un evento capturado a las 14:05 pero
cuya marca en la página es 13:58 pertenece al operador saliente. La consulta que convierte
`metric_events` en filas de `points_ledger` resuelve el operador buscando la asignación cuyo
`valid_range @> metric_events.occurred_at`, no la asignación vigente en el momento de la ingesta.
Sin esto, cada relevo regala puntos del saliente al entrante — y los puntos son nómina.

**4. Tableau no puede atribuir por operador, y hay que decidir cómo se reparte.** Ver §4.2: es la
consecuencia más cara de esta respuesta.

### 4.2 Atribución de los puntos de Tableau en días con relevo (2026-08-04)

**Dato del cliente: Tableau tiene reporte de puntos por hora, y se pueden hacer cortes cada 8 h.**
Esto reduce el problema de atribución de "irresoluble sin estimar" a "exacto casi siempre".

TalkyTimes no tiene dimensión de operador — el perfil es la identidad, quién estaba sentado detrás
no existe en sus datos. Pero sí tiene dimensión de **tiempo**, y el tiempo es justamente lo que
distingue a un operador de otro en un relevo. Con grano horario, la atribución deja de ser un
reparto proporcional y pasa a ser una asignación directa: cada hora de puntos cae dentro del
`valid_range` de exactamente una asignación.

**Se toma el grano horario, no los cortes de 8 h.** Aunque los turnos duran 8 h, dejar que Tableau
pre-agregue en bloques de 8 h fijos (00–08, 08–16, 16–00) reintroduce el problema que se acaba de
resolver: un turno de 14:00 a 22:00 atraviesa dos bloques y ninguno le corresponde. Se descarga el
grano más fino que Tableau ofrezca y el troceo por turno lo hace el backend, que es el único que
conoce los `valid_range` reales — incluyendo los `shift_overrides` de horas extra, que por
definición no caen en bloques fijos.

**Los turnos reales arrancan a las 06:05, 14:05 y 22:05** (dato del cliente, 2026-08-04). Es decir:
ningún relevo cae en hora en punto, **los tres relevos del día atraviesan una hora**, y siempre con
el mismo corte — 5 minutos para el saliente, 55 para el entrante. Esto descarta la recomendación
de "programar relevos en hora en punto" que se había anotado aquí antes de conocer el horario: no
es lo que hace la agencia, y pedirle que mueva sus turnos por conveniencia del ETL sería mover el
negocio para acomodar el software.

Regla de atribución, en orden:

1. **Hora completamente dentro de una asignación** → `DIRECT`. Íntegra a ese operador, sin
   estimación. Son 21 de las 24 horas del día.
2. **Hora que atraviesa un relevo** (06:00–07:00, 14:00–15:00, 22:00–23:00) →
   `PROPORTIONAL_SPLIT` **por minutos**: 5/60 al saliente, 55/60 al entrante.
3. **Solo si hay indicio de que esa hora no fue uniforme** → resolución manual.

**Por qué por minutos y no según lo que capturó la extensión.** En la versión anterior de esta
sección el reparto se apoyaba en los `metric_events` de esa hora. Con relevos a las :05 eso deja
de ser razonable: serían **3 relevos al día × cada perfil × todos los días**, cada uno dependiendo
de que la extensión haya capturado bien esa hora concreta, y cada fallo de captura generando una
fila `PENDING_ATTRIBUTION` que alguien tiene que resolver a mano. Sería una tarea manual diaria
permanente para repartir 5 minutos.

El reparto por minutos, en cambio, es determinista, no depende de nada externo, y su error está
acotado y es **simétrico**: cada operador cede 5 minutos al final de su turno y recibe 55 al
principio del suyo — todos están a ambos lados de un relevo una vez por turno, así que el sesgo
neto a lo largo del tiempo es cero. El error máximo en un turno concreto son los puntos de 5
minutos sobre 480, y solo si la actividad se concentrase justo ahí. La suposición que se hace
(actividad uniforme dentro de esa hora) es explícita, está escrita en `attribution_basis`, y es de
un orden de magnitud menor que el ruido que introduciría depender de la captura de DOM.

La extensión sigue sirviendo aquí, pero como **verificación, no como base**: si sus datos de esa
hora contradicen fuertemente el reparto por minutos, se levanta una fila en
`metric_reconciliation` con estado `DIVERGENT` para que alguien la mire. Detectar es barato;
depender es caro.

> **Lo que sí vale la pena preguntar antes de construir esto** (§11, #16): si la API de Tableau
> acepta filtrar la vista por un rango de tiempo arbitrario (`vf_<campo>` con rango, no solo con
> valor), se puede pedir directamente la ventana 06:05–14:05 y obtener el total exacto del turno,
> con cero estimación y sin trocear nada. La colección Postman documentada en agents.md §4 no
> aclara si los filtros `vf_` admiten rangos. Si admiten, este apartado entero se simplifica a una
> consulta por turno; si no, queda el reparto por minutos, que de todos modos es suficiente.

### 4.3 El turno nocturno cruza el corte de día — y el de mes

Con arranque a las 22:05, el tercer turno termina a las 06:05 del **día siguiente**. Eso obliga a
decidir explícitamente algo que hasta ahora el modelo dejaba implícito: a qué `business_date` se
imputan sus puntos.

Hay dos respuestas, ambas defendibles, y usar una para nómina y otra para métricas sin decirlo es
la receta para que los números no cuadren y nadie sepa por qué:

- **Fecha de inicio del turno** — el turno que arrancó el 4 a las 22:05 es "el turno del 4"
  completo, incluidas sus horas del día 5. Es lo natural para nómina, para contar días trabajados
  (FR-29) y para que el operador vea su jornada como una unidad.
- **Fecha calendario de cada hora** — los puntos de la 01:00 del día 5 son del día 5. Es lo natural
  para conciliar contra Tableau, que agrega por fecha calendario.

**Regla que adopta este plan:** se guardan las dos, porque sirven para cosas distintas y ninguna
es derivable de la otra sin ambigüedad.

```sql
ALTER TABLE points_ledger
  ADD COLUMN shift_business_date date NOT NULL;
  -- fecha de inicio del turno: es la que usa nómina y "días trabajados"
  -- `business_date` (ya existente) queda como fecha calendario de la hora de origen,
  -- que es la que concilia contra Tableau
```

`payroll_periods` y `payroll_lines` agregan por `shift_business_date`;
`metric_reconciliation` y `profile_daily_metrics` por `business_date`. La diferencia entre ambas
sumas para un mismo mes es exactamente el turno nocturno de la frontera, y ser capaz de explicar
esa diferencia en una frase es el punto de guardar las dos.

**Dónde muerde de verdad: el cierre de mes.** Un turno que arranca el 31 a las 22:05 termina el 1
del mes siguiente. Con la regla adoptada, todo él se paga en el mes que arrancó — el operador no
ve su jornada partida entre dos liquidaciones. Pero eso significa que el ETL del día 1 escribe
filas cuyo `shift_business_date` cae en el mes anterior, así que **el periodo de nómina no se puede
cerrar el mismo día 1**: el trigger `reject_write_on_closed_period` de §4 rechazaría esas filas y
el turno de cierre de mes quedaría sin pagar. Se define una ventana de gracia: el periodo pasa a
`LOCKED` (no admite ajustes manuales) el día 1, y a `CLOSED` solo después de que corra el ETL del
día 1 y se liquide el turno nocturno de la frontera. Es una línea en la configuración y un bug
anual muy caro si se descubre en producción.

**Esto no toca la decisión #9 de agents.md — la refuerza.** Granularidad y frescura son cosas
distintas: Tableau sigue refrescando una vez al día, así que la extracción sigue siendo un batch
diario (ejecutarlo cada 8 h traería los mismos datos rancios tres veces). Lo que cambia es que
cada corrida diaria baja 24 filas por perfil en vez de 1. Si en algún momento se confirma que el
refresco es más frecuente que diario, ahí sí habría que revisar la cadencia — pero eso sería
revisar la decisión #9, no esta sección.

Cambios de modelo sobre §3.8:

```sql
ALTER TABLE points_ledger
  ADD COLUMN attribution_method text NOT NULL DEFAULT 'DIRECT',
      -- DIRECT | PROPORTIONAL_SPLIT | MANUAL_RESOLUTION
  ADD COLUMN attribution_basis jsonb,
      -- DIRECT: {horaDesde, horaHasta, viewId}
      -- PROPORTIONAL_SPLIT: {hora, totalTableauHora, puntosExtensionOperador,
      --                      puntosExtensionTotalHora, factor}
  ADD COLUMN assignment_id uuid REFERENCES profile_assignments(id),
  ADD COLUMN source_hour timestamptz;
      -- la hora de Tableau de la que provienen estos puntos
```

"Por qué a este operador le tocaron estos puntos" tiene que contestarse mirando una sola fila.
Con grano horario la respuesta habitual pasa a ser una frase verificable contra la fuente —
"la hora 15:00–16:00 del perfil X, y a esa hora el perfil estaba asignado a este operador"— en vez
de un porcentaje calculado.

**Trampa de zona horaria, a confirmar antes de escribir la transformación.** Las horas que
devuelve Tableau vienen en la zona configurada en el sitio de Tableau, que no tiene por qué ser
`America/Bogota` ni UTC. Un desfase de una hora sin detectar misatribuye **exactamente en cada
relevo** y en ningún otro lado, que es el patrón de bug más difícil de ver: la nómina cuadra en el
total del perfil y solo está mal el reparto entre dos personas. Se guarda la zona declarada de
cada vista (`tableau_views.source_timezone`) y se valida con un caso conocido antes de dar por
buena la primera carga.

---

## 5. Superficie HTTP

### 5.1 Contrato común

- Prefijo `/api/v1`. Versión en la ruta, no en header.
- Sustantivos en plural, sin verbos. `PATCH` para actualizaciones parciales.
- Envolvente de error, **una sola para toda la API**:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {}, "requestId": "…" } }
```

| Estado | Cuándo |
|---|---|
| 400 | Petición malformada |
| 401 | No autenticado / token vencido |
| 403 | Autenticado sin permiso, o fuera de turno, o IP no permitida |
| 404 | No existe **o no es visible para este rol** (no se distingue: no se filtra existencia) |
| 409 | Conflicto de estado o de versión (optimistic locking, perfil ya asignado) |
| 422 | Validación semántica fallida |
| 429 | Rate limit |
| 500 | Error interno. Nunca expone stack ni SQL |

- Envolvente de listado, **en todos** los endpoints de colección desde el día uno:

```json
{ "data": [...], "pagination": { "page": 1, "pageSize": 20, "totalItems": 142, "totalPages": 8 } }
```

- Validación con Zod en la frontera (schemas compartidos desde `packages/shared`), nunca dentro
  del servicio. Después de la frontera, el código confía en los tipos.
- `Idempotency-Key` obligatorio en: creación de pedidos, ingesta de métricas, ajustes de nómina.
- Todo cambio de estado emite un evento a `outbox_events` en la misma transacción.

### 5.2 Auth (FR-01 a FR-04)

| Método | Ruta | Rol | Nota |
|---|---|---|---|
| POST | `/auth/login` | público | Rate limit 5/15 min por IP+email. Devuelve access (15 min) y refresh (7 d, httpOnly) |
| POST | `/auth/refresh` | público con refresh | Rotación con detección de reuso |
| POST | `/auth/logout` | autenticado | Revoca la familia de refresh |
| GET | `/auth/me` | autenticado | Usuario, rol, permisos, turno vigente |
| POST | `/auth/password` | autenticado | Cambio propio; exige contraseña actual |
| POST | `/auth/password/reset` | ADMIN | Fuerza `must_change_password` |

### 5.3 Usuarios, roles y cuadrillas

| Método | Ruta | Permiso |
|---|---|---|
| GET / POST | `/users` | `users.read` / `users.create` |
| GET / PATCH | `/users/:id` | `users.read` / `users.update` |
| POST | `/users/:id/disable` | `users.disable` |
| GET | `/roles`, `/permissions` | `rbac.read` |
| GET / POST | `/crews` | `crews.read` / `crews.manage` |
| POST / DELETE | `/crews/:id/members` | `crews.manage` |
| GET / POST | `/users/:id/compensation` | `payroll.configure` — **invisible al operador** (FR-29) |
| GET / POST / DELETE | `/settings/ip-allowlist` | `security.manage` (FR-03) |

### 5.4 Perfiles y vault (FR-06, FR-07)

| Método | Ruta | Permiso | Nota |
|---|---|---|---|
| GET / POST | `/profiles` | `profiles.read` / `profiles.create` | Nunca devuelve nada del secreto |
| GET / PATCH | `/profiles/:id` | | |
| POST | `/profiles/:id/deactivate` | `profiles.update` | |
| PUT | `/profiles/:id/credential` | `vault.rotate` | Escribe una versión nueva; cuerpo nunca se loguea |
| GET | `/profiles/:id/credential/meta` | `vault.read_meta` | Solo `version`, `rotatedAt`, `rotatedBy`. **No hay endpoint que devuelva la contraseña a un humano** |
| GET | `/profiles/:id/access-log` | `audit.read` | |

### 5.5 Vault para la extensión — la superficie crítica

Autenticación doble: JWT del operador **y** token del dispositivo (header `X-Device-Token`).

| Método | Ruta | Nota |
|---|---|---|
| POST | `/agent/session/credential-grant` | Emite un ticket de un solo uso. Cuerpo: `{ profileId, sessionId }`. Respuesta: `{ grantId, expiresAt }` — **no contiene la credencial** |
| POST | `/agent/session/credential-redeem` | Canjea `grantId`. Devuelve `{ username, secret }` una sola vez, `Cache-Control: no-store`. Segundo canje ⇒ 409 + `reuse_attempted = true` + alerta |

El detalle del flujo y sus controles está en §6.3.

### 5.6 Dispositivos y helper local

| Método | Ruta | Nota |
|---|---|---|
| POST | `/devices/enroll` | Con código de un solo uso emitido por el admin. Devuelve token de dispositivo |
| POST | `/agent/devices/heartbeat` | Actualiza `last_seen_at`, versiones de helper y extensión |
| GET | `/agent/profiles/assigned` | Perfiles del turno vigente + `chromeProfileDir` (FR-10) |
| POST | `/agent/sessions` | Abre `profile_sessions`. 409 si el perfil ya tiene sesión viva |
| PATCH | `/agent/sessions/:id` | Cambio de estado / heartbeat |
| POST | `/agent/sessions/:id/close` | Cierre limpio (FR-15) |
| GET / POST / DELETE | `/devices`, `/devices/:id/revoke` | `devices.manage` |

### 5.7 Turnos (FR-15 a FR-17)

| Método | Ruta | Permiso |
|---|---|---|
| GET / POST | `/shift-templates` | `shifts.manage` |
| GET / POST | `/shifts` | `shifts.read` / `shifts.manage` |
| GET | `/shifts/me/current` | operador |
| POST | `/shifts/:id/start`, `/shifts/:id/end` | Normalmente automático (FR-15) |
| POST | `/shift-overrides` | `shifts.approve_overtime` |
| GET / POST | `/breaks`, `/breaks/:id/start`, `/breaks/:id/end` | FR-16 |
| GET | `/reports/effective-time?from&to&operatorId` | `reports.read` (FR-17) |
| GET | `/operators/status` | `operators.monitor` — semáforo (FR-38); además por WebSocket |
| POST | `/operators/me/status` | operador — `ONLINE | BREAK | ALERT` |

### 5.8 Métricas (FR-14, FR-18 a FR-20)

| Método | Ruta | Nota |
|---|---|---|
| POST | `/agent/metrics/batch` | Lote de la extensión. Idempotente por `dedupeKey`. Límite de tamaño y de eventos por lote |
| GET | `/metrics/profiles?from&to&profileId&crewId` | Filtrado por rol (FR-20) |
| GET | `/metrics/profiles/:id/timeseries` | Tendencia histórica |
| GET | `/metrics/ranking?metric=response_rate&period=` | Ranking de efectividad (FR-18) |
| GET | `/metrics/reconciliation?date=` | `metrics.audit` — divergencia extensión vs Tableau |
| GET / POST | `/tableau/views` | `etl.manage` |
| GET | `/tableau/runs?viewId&from&to` | Estado del ETL |
| POST | `/tableau/runs` | Disparo manual de un corte (idempotente por `(viewId, businessDate)`) |

### 5.9 Icebreakers (FR-21 a FR-27)

| Método | Ruta | Nota |
|---|---|---|
| GET / POST | `/icebreakers` | El operador solo ve los suyos |
| GET / PATCH | `/icebreakers/:id` | PATCH solo en `DRAFT` o `BLOCKED` |
| POST | `/icebreakers/:id/evaluate` | Llama al ai-engine. Rate limit por operador (costo de LLM) |
| POST | `/icebreakers/:id/publish` | 409 si la última evaluación es `BLOCKED` y no hay `OVERRIDDEN_ALLOW` |
| GET | `/icebreakers/:id/evaluations` | Historial de intentos |
| GET | `/icebreakers/violations?from&to&operatorId` | FR-25 |
| POST | `/icebreakers/:id/reviews` | `icebreaker.review` — falsos positivos/negativos |
| GET / POST / PATCH | `/icebreaker-rules` | `icebreaker.rules.manage` |
| GET | `/icebreakers/:id/effectiveness` | FR-26/FR-27 |

### 5.10 Nómina (FR-28 a FR-31)

| Método | Ruta | Nota |
|---|---|---|
| GET | `/payroll/me/summary` | **Solo** puntos propios y COP según su comisión. Nunca la tasa ni la comisión en crudo (FR-28/FR-29) |
| GET | `/payroll/periods` | `payroll.read` |
| POST | `/payroll/periods/:id/compute` | Recalcula líneas. Idempotente |
| POST | `/payroll/periods/:id/lock` / `/close` | `payroll.close` |
| GET | `/payroll/periods/:id/lines` | `payroll.read` |
| POST | `/payroll/lines/:id/adjustments` | `payroll.adjust` — motivo obligatorio, auditado |
| POST | `/payroll/periods/:id/exports` | Genera XLSX (FR-31). Trabajo asíncrono |
| GET | `/payroll/exports/:id` | URL firmada con expiración |
| GET / POST | `/goals` | `payroll.configure` (FR-30) |
| GET | `/goals/me/progress` | operador — avance porcentual |
| GET / POST | `/competitions`, `/competitions/:id/leaderboard` | Competencias y eventos dinámicos |
| GET / POST | `/points/adjustments` | `payroll.adjust` — escribe al ledger, nunca UPDATE |

### 5.11 Cafetería (FR-32 a FR-35)

| Método | Ruta | Nota |
|---|---|---|
| GET / POST / PATCH | `/cafeteria/products` | `cafeteria.manage` |
| GET | `/cafeteria/menu` | Solo disponibles; visible al operador |
| POST | `/cafeteria/orders` | Operador. `Idempotency-Key` obligatorio |
| GET | `/cafeteria/orders?status=` | KDS: rol `CAFETERIA` |
| PATCH | `/cafeteria/orders/:id/status` | Máquina de estados validada. `DELIVERED` genera el débito en la misma transacción |
| POST | `/cafeteria/orders/:id/cancel` | Motivo obligatorio |
| GET | `/cafeteria/accounts/me` | Saldo y consumo del mes |
| WS | `cafeteria:orders` | Nuevos pedidos en < 500 ms (NFR) |

### 5.12 RocketChat y notificaciones

| Método | Ruta | Nota |
|---|---|---|
| GET / POST | `/rocketchat/channels` | `chat.manage` |
| POST | `/rocketchat/messages` | Envío inmediato a canal u operador |
| GET / POST / DELETE | `/scheduled-messages` | FR-37 |
| GET / PATCH | `/notifications` | Del usuario autenticado |

### 5.13 Administración y salud

| Método | Ruta | Nota |
|---|---|---|
| GET | `/health/live`, `/health/ready` | Sin auth. `ready` verifica Postgres y Redis |
| GET / PATCH | `/settings` | `settings.manage` |
| GET / PATCH | `/feature-flags` | `settings.manage` |
| GET | `/audit-log?from&to&action&actorId` | `audit.read`. Solo lectura, paginada |

---

## 6. Seguridad

### 6.1 Fronteras de confianza y activos

| Frontera | Entrada | Confianza |
|---|---|---|
| Navegador web (admin/coordinador/cafetería) | HTTP + WS | Nula |
| Extensión de Chrome (background) | HTTP autenticado con JWT + token de dispositivo | Baja — corre en una PC de oficina que puede estar comprometida |
| Helper local | HTTP autenticado con token de dispositivo | Baja. **No maneja credenciales** (§6 regla 6 del documento de requerimientos) |
| Tableau Cloud | CSV/XLSX descargado | **Nula** — dato de tercero, se valida por schema antes de tocar la BD |
| ai-engine (FastAPI) | JSON de respuesta del LLM | **Nula** — LLM05, ver §6.7 |
| RocketChat | Webhooks / respuestas de API | Nula |

Activos ordenados por lo que costaría perderlos: **credenciales de los perfiles de TalkyTimes**
(es el problema de negocio #1 del proyecto), datos de nómina, historial de auditoría, PII de
operadores.

### 6.2 Autenticación

- **Hashing:** **scrypt** con `N=2^17, r=8, p=1` (decisión #19 de `agents.md` §5, aprobada por el
  cliente el 2026-08-04). Sustituye al bcrypt cost 12 que estipulaba el documento de requerimientos
  §4 y que este plan daba por contratado. Tres consecuencias de implementación, detalladas con
  números medidos en `agents.md` §5.3:
  - Los parámetros van **dentro del hash** (`scrypt$<log2N>$<r>$<p>$<salt>$<digest>`), no en
    configuración, para poder subirlos sin invalidar los hashes existentes. Un hash con parámetros
    viejos se reescribe en el siguiente login. Se acepta al verificar el formato heredado
    `scrypt$<cost>$<salt>$<digest>` para no dejar fuera al admin sembrado por el seed.
  - Se usa `crypto.scrypt` **asíncrono**. Con `scryptSync` los ~342 ms de cada hash son event loop
    bloqueado para toda la API, y los tres relevos del día concentran los logins de una cuadrilla
    entera en el mismo minuto.
  - **Desaparece la truncación a 72 bytes** de bcrypt, que era la advertencia de la versión anterior
    de este párrafo. El tope de los schemas de Zod sube a 256 caracteres y ya solo acota el costo de
    la petición, no la entropía utilizable de la contraseña.
- **Access token:** JWT HS256, 15 min, en memoria del cliente. HS256 y no RS256 porque el backend
  es el único verificador — el ai-engine no valida tokens de usuario, se le llama servidor a
  servidor con un token de servicio propio.
- **Refresh token:** 7 días, opaco (no JWT), `httpOnly; Secure; SameSite=Strict`, rotado en cada
  uso. Se guarda solo el SHA-256. **Detección de reuso:** si llega un refresh ya rotado, se revoca
  la familia completa y se registra `auth.refresh.reuse_detected` en auditoría.
- **Bloqueo por fuerza bruta:** 5 fallos ⇒ `locked_until` +15 min, con backoff. Además rate limit
  distribuido en Redis por IP y por email.
- **Sin enumeración de usuarios:** `/auth/login` devuelve el mismo error y en tiempo comparable
  exista o no el email.

### 6.3 El flujo del vault, paso a paso

Es la superficie que justifica el proyecto entero; se detalla completa.

```
Extensión (background service worker) — no el content script, no el helper
  1. POST /agent/session/credential-grant
     Headers: Authorization: Bearer <jwt operador>, X-Device-Token: <token PC>
     Body:    { profileId, sessionId }

  Backend valida, en este orden, y aborta al primer fallo:
     a. IP de origen dentro de ip_allowlist                     → si no: 403 IP_BLOCKED
     b. Dispositivo existe y status = APPROVED                  → si no: 403 DEVICE_REVOKED
     c. Dispositivo corresponde al operador del JWT             → si no: 403
     d. Operador con turno vigente (o shift_override activo)    → si no: 403 OUT_OF_SHIFT
     e. Existe profile_assignment ACTIVE (operador, perfil, ahora) → si no: 403 NO_ASSIGNMENT
     f. Perfil en status ACTIVE                                 → si no: 403 PROFILE_INACTIVE
     g. Rate limit: N solicitudes por (operador, perfil, hora)   → si no: 429
     h. No hay otra sesión viva del mismo perfil                → si no: 409

  Si pasa todo: crea un grant de un solo uso con TTL 60 s (Redis, clave = grantId),
  escribe credential_access_log(granted = true, grant_jti = grantId),
  y responde { grantId, expiresAt } — SIN la credencial.

  2. POST /agent/session/credential-redeem  { grantId }
     El backend consume el grant de forma atómica (GETDEL en Redis).
       - Si ya fue consumido → 409, reuse_attempted = true, alerta a coordinador, y
         opcionalmente revocación del dispositivo.
       - Si vigente → descifra con la DEK, responde { username, secret } con
         Cache-Control: no-store, Pragma: no-cache. Marca consumed_at.

  3. El background envía el valor al content script por chrome.tabs.sendMessage,
     el content script lo asigna al campo con el setter nativo del prototipo y dispara
     input/change (agents.md §5.2), y lo descarta de memoria. Nunca chrome.storage.

  4. El operador da el clic real en "Log in". El sistema no lo da por él.
```

Controles adicionales sobre ese flujo:

- La respuesta del `redeem` está **excluida por nombre** del interceptor de logging: la ruta está
  en una lista de rutas de las que no se serializa el cuerpo de respuesta bajo ninguna
  configuración de nivel de log, ni siquiera `debug`. Esto es criterio de aceptación (decisión #8
  de agents.md), y se prueba con un test que activa el logger en `debug`, ejecuta un redeem, y
  afirma que el secreto no aparece en la salida.
- El secreto nunca entra a `audit_log` ni a `credential_access_log` — esas tablas registran que
  *hubo* un acceso, no *qué* se accedió.
- El grant se ata a `sessionId`: un grant emitido para una sesión no sirve para otra.
- Si `reuse_attempted` supera un umbral por dispositivo, el dispositivo pasa a `REVOKED`
  automáticamente y se notifica por RocketChat.

**Riesgo residual que este diseño no elimina, y hay que decirlo:** el operador tiene la
credencial en el DOM de su propio navegador durante el login. `agents.md` §5.2 ya aceptó ese
riesgo residual explícitamente (se descartó bloquear DevTools). El vault reduce la exposición de
"el operador conoce la contraseña permanentemente" a "el operador podría leerla si sabe abrir
DevTools en el momento exacto del login" — y añade que cualquier rotación la invalida sin tocar
ninguna PC. Eso es la mejora real; conviene que quede escrita así y no como "el operador nunca
puede ver la contraseña".

### 6.4 Autorización

Orden de guards, global, en este orden exacto:

1. `IpAllowlistGuard` — FR-03, antes que nada. Rutas exentas: `/health/*`.
2. `JwtAuthGuard` — salvo rutas marcadas `@Public()`.
3. `DeviceTokenGuard` — solo en rutas `/agent/*`.
4. `PermissionsGuard` — `@RequirePermissions('vault.credential.issue')`. Por permiso, nunca por
   nombre de rol (decisión #17).
5. `ShiftWindowGuard` — FR-04. Aplica solo a `role.code = 'OPERADOR'`; admite `shift_overrides`.
6. Verificación de pertenencia **dentro del servicio**: que el recurso sea del operador o de la
   cuadrilla del coordinador. Un guard genérico no puede saberlo; se hace en la consulta,
   filtrando por `operator_id` / `crew_id`, no cargando y comparando después.

Reglas de visibilidad (FR-20):
- `ADMIN` / `DIRECTOR_OPERATIVO`: todo.
- `COORDINADOR`: su cuadrilla vigente (`crew_members` con `valid_range @> now()`).
  **Pendiente:** pregunta abierta #5 decide si es su cuadrilla o todas. El modelo soporta ambas;
  se implementa "su cuadrilla" por ser lo más restrictivo, y ampliarlo después es cambiar un
  filtro.
- `OPERADOR`: sus perfiles asignados, sus icebreakers, su nómina.
- `CAFETERIA`: solo el KDS y el catálogo. Ningún dato de nómina ni de perfiles.

### 6.5 Row-Level Security

El documento de requerimientos promete RLS. Se implementa como **defensa en profundidad sobre las
tablas sensibles**, no sobre las 40 tablas — RLS en todo el esquema multiplica la complejidad sin
añadir garantía donde el filtro de cuadrilla ya está en la consulta.

Tablas con RLS: `tt_profile_credentials`, `points_ledger`, `payroll_lines`,
`operator_account_entries`, `icebreakers`, `credential_access_log`.

```sql
-- La aplicación conecta con un rol sin BYPASSRLS.
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY operator_own_points ON points_ledger FOR SELECT
  USING (
    current_setting('app.role_code', true) IN ('ADMIN','DIRECTOR_OPERATIVO')
    OR operator_id = current_setting('app.user_id', true)::uuid
  );
```

**Caveat operativo que hay que tener presente desde el diseño:** `SET LOCAL` solo vive dentro de
una transacción. Con un pool de conexiones (y más aún si DO pone pgBouncer en modo transacción
por delante), cada request debe abrir su transacción, hacer `SET LOCAL app.user_id`, y cerrarla.
Se implementa con un interceptor de NestJS que envuelve la request en una transacción y expone
la conexión por `AsyncLocalStorage`. Si en algún punto se decide no envolver toda la request en
transacción por costo, **RLS deja de aplicar silenciosamente** — por eso hay un test que verifica
que un `current_setting('app.user_id')` vacío hace que las políticas nieguen todo, en vez de
permitir todo.

### 6.6 Entrada y superficie

- Zod en cada controlador. Cuerpos con tope de tamaño (`bodyLimit` de Fastify: 256 KB general,
  1 MB en `/agent/metrics/batch`).
- Todas las consultas parametrizadas — Drizzle lo hace por defecto; `sql.raw` prohibido por regla
  de lint salvo en archivos de migración.
- `helmet` con CSP restrictiva; HSTS; `X-Content-Type-Options`.
- CORS restringido a: el origen del web-app y `chrome-extension://<ID_FIJO>`. Nada de `*`, nada de
  reflejar el `Origin` recibido.
- Rate limiting distribuido en Redis (no en memoria, hay 2 instancias):
  `/auth/login` 5/15min · `/agent/session/credential-*` 30/h por operador ·
  `/icebreakers/:id/evaluate` 60/h por operador (costo de LLM) · resto 300/min.
- Sin trazas de error hacia el cliente: filtro de excepciones global que mapea a la envolvente de
  §5.1 y deja el detalle solo en el log del servidor, correlacionado por `requestId`.

### 6.7 IA y datos de terceros

- **La respuesta del ai-engine es entrada no confiable** (LLM05). Se parsea con un schema Zod
  estricto; si no valida, la evaluación se marca `FAILED` y el icebreaker no cambia de estado.
  Nunca se interpola en SQL, ni en HTML, ni se usa para decidir un permiso.
- **El texto del icebreaker es entrada de usuario que va a un prompt** (LLM01). Se envía como
  dato delimitado, y el resultado bloqueante lo decide el backend contra `icebreaker_rules`, no la
  narrativa del modelo: si el modelo dice "esto está bien" pero una regla `REGEX` de severidad
  `BLOCKING` coincide, gana la regla.
- **Costo acotado** (LLM10): tope de tokens por evaluación, rate limit por operador, y
  `token_cost_usd` registrado por evaluación para poder ver el gasto real.
- **Los `pattern` de `icebreaker_rules` son regex escritas por un administrador**, no por un
  desarrollador: se validan al guardarlas (complejidad acotada) y se ejecutan con timeout, para
  que un patrón con backtracking catastrófico no tumbe el proceso (ReDoS).
- **El CSV/XLSX de Tableau es dato de tercero.** Se valida fila por fila contra schema antes de
  salir de `etl_staging_rows`; las filas que no pasan se rechazan y se cuentan, no se descartan
  en silencio.
- **SSRF:** las URLs que el backend consulta (Tableau, RocketChat) salen de configuración, no de
  entrada de usuario. Si en algún momento se acepta una URL configurable por el admin, pasa por
  un allowlist de host + verificación de que ninguna IP resuelta sea privada.

### 6.8 Secretos

- Nada de secretos en el repo. `.env.example` con placeholders, `.env` en `.gitignore`.
- Secretos en producción: variables de entorno cifradas de DO App Platform.
- La KEK del vault se maneja aparte del resto de la configuración y **rotarla es un procedimiento
  documentado**, no un cambio de variable: se inserta una `encryption_keys` nueva, se re-envuelve
  la DEK, y se marca la anterior `retired_at`.
- Prohibido loguear: `password`, `secret`, `token`, `authorization`, `x-device-token`,
  `credencial`. Lista de redacción aplicada en el logger, con test.

---

## 7. Estructura de módulos NestJS

```
backend/src/
├── main.ts                       ← bootstrap Fastify, helmet, CORS, versionado
├── app.module.ts
├── config/                       ← carga y validación de env con Zod al arrancar
├── database/
│   ├── schema/                   ← definiciones Drizzle, un archivo por dominio
│   ├── migrations/               ← SQL plano, versionado, reversible
│   ├── seeds/                    ← roles, permisos, ajustes iniciales
│   └── transaction.interceptor.ts ← transacción por request + SET LOCAL (RLS)
├── common/
│   ├── guards/                   ← ip-allowlist, jwt, device-token, permissions, shift-window
│   ├── interceptors/             ← logging con redacción, auditoría, idempotencia
│   ├── filters/                  ← filtro global de excepciones
│   ├── decorators/               ← @Public, @RequirePermissions, @Audited
│   └── pagination/
└── modules/
    ├── auth/          users/     rbac/       crews/
    ├── profiles/      vault/     devices/    assignments/  sessions/
    ├── shifts/        breaks/    operator-status/
    ├── metrics/       tableau-etl/
    ├── icebreakers/   ai-client/
    ├── payroll/       competitions/
    ├── cafeteria/
    ├── rocketchat/    notifications/   outbox/
    └── admin/         audit/     settings/
```

Regla de frontera, para no repetir el "god controller" que motivó la decisión #6 de agents.md:
**un módulo no importa el repositorio de otro**. Si `payroll` necesita puntos, llama al servicio
público de `metrics`, no consulta `metric_events`. Se verifica con una regla de lint de límites
de importación, no con disciplina.

Capas por módulo: `*.controller.ts` (HTTP + validación) → `*.service.ts` (reglas de negocio,
transacciones) → `*.repository.ts` (Drizzle, único lugar con SQL) → `dto/` (schemas Zod
reexportados desde `packages/shared`).

---

## 8. Trabajos en background

Cola: BullMQ sobre el Redis HA que ya está en la arquitectura. Estado durable de cada corrida en
Postgres (`etl_runs`, `outbox_events`), no solo en Redis.

| Trabajo | Cadencia | Qué hace |
|---|---|---|
| `tableau:daily-etl` | Diario, hora configurable | Descarga cada `tableau_views` activa, valida, carga a staging, transforma, escribe `points_ledger` y `profile_daily_metrics` |
| `metrics:reconcile` | Tras el ETL | Compara extensión vs Tableau, escribe `metric_reconciliation` |
| `outbox:dispatch` | Cada 5 s | Envía eventos pendientes a RocketChat, socket.io, notificaciones. Backoff exponencial, DLQ tras N intentos |
| `sessions:reap` | Cada minuto | Cierra sesiones sin heartbeat (`HEARTBEAT_TIMEOUT`) |
| `shifts:open-close` | Cada minuto | Marca `IN_PROGRESS`/`MISSED`/`COMPLETED`, dispara aviso de break (FR-16) |
| `cafeteria:expire-orders` | Cada minuto | Pasa a `EXPIRED` los pedidos `READY` pasados de `pickup_deadline_at` |
| `payroll:recompute` | Bajo demanda + nocturno en periodo abierto | Recalcula líneas del periodo abierto |
| `scheduled-messages:send` | Cada minuto | FR-37 |
| `audit:partition-maintenance` | Mensual | Crea la partición del mes siguiente, archiva las viejas |

Todos los trabajos corren **en una sola instancia a la vez** (lock distribuido en Redis): hay 2
instancias del backend y un ETL ejecutado dos veces duplicaría puntos.

---

## 9. Testing y observabilidad

**Testing**
- Unitarios de servicios con repositorios en doble; el objetivo son las reglas de negocio de
  nómina y del vault, no cobertura por cobertura.
- Integración contra un Postgres real en Testcontainers — los invariantes de §4 solo se pueden
  probar contra Postgres de verdad (los constraints de exclusión no existen en SQLite).
- Casos de abuso como tests de primera clase, y son criterio de entrega:
  - dos operadores intentando abrir el mismo perfil a la vez → uno recibe 409;
  - canjear dos veces el mismo `grantId` → 409 y `reuse_attempted`;
  - logger en `debug` + redeem → el secreto no aparece en la salida;
  - operador fuera de turno pidiendo credencial → 403 `OUT_OF_SHIFT`;
  - petición desde IP fuera del allowlist → 403 sin filtrar si el recurso existe;
  - `POST /agent/metrics/batch` repetido con el mismo `dedupeKey` → puntos no se duplican;
  - operador consultando `/payroll/me/summary` → la respuesta no contiene `commissionRate`;
  - `SET LOCAL app.user_id` vacío → las políticas RLS niegan, no permiten.
- E2E del flujo completo de vault con la extensión, en el spike.

**Observabilidad**
- Logs estructurados JSON (pino, nativo en Fastify) con `requestId` propagado.
- Métricas Prometheus: latencia por ruta, tasa de 4xx/5xx, profundidad de colas, edad del outbox,
  duración y filas del ETL, tasa de denegación del vault.
- Alertas que importan: denegaciones de vault por encima de umbral, `reuse_attempted > 0`, ETL
  fallido, outbox con eventos más viejos que N minutos, saturación de rate limit en `/auth/login`.

---

## 10. Secuencia de construcción

Mapeada al plan de entrega del documento de requerimientos §9.

**Fase 0 — Cimientos (semana 1, en paralelo al spike)**
Monorepo pnpm, `apps/api` con NestJS+Fastify, config validada con Zod, Docker Compose con
Postgres y Redis, Drizzle + primera migración, CI (lint, typecheck, test, `pnpm audit` sobre el
lockfile), `/health/*`, logger con redacción, filtro de excepciones, envolventes de §5.1.

**Entrega 1 — Seguridad operacional (semanas 1–9)**
1. RBAC: `roles`, `permissions`, `users`, `crews` + seeds. Auth con rotación de refresh.
2. `ip_allowlist` + `IpAllowlistGuard` (FR-03). `audit_log` con particiones y el CHECK de la
   decisión #8.
3. Perfiles + vault (`encryption_keys`, `tt_profile_credentials`) con rotación. Sin ningún
   endpoint que devuelva el secreto a un humano.
4. `devices` + enrolamiento + token de dispositivo.
5. Asignaciones con el constraint de exclusión, y `profile_sessions` con el índice único parcial.
6. **El flujo grant/redeem de §6.3 completo, con sus tests de abuso.** Es el corazón de la
   entrega; sustituye el `credenciales.json` en texto plano que hoy usa el spike (riesgo abierto
   de agents.md §6).
7. Turnos, `shift_overrides` y `ShiftWindowGuard` (FR-04).
8. `operator_status_events` + WebSocket con `@socket.io/redis-adapter` (FR-38).
9. Módulo RocketChat + outbox, para el bot de ayuda.

**Entrega 2 — Operaciones completas (semanas 10–20)**
10. Ingesta de métricas idempotente (FR-14) y agregados diarios.
11. ETL de Tableau completo (decisión #9) + conciliación. *Bloqueado por la confirmación del
    cliente sobre qué vistas y con qué columnas.*
12. Icebreakers: reglas, evaluación contra el ai-engine, violaciones, revisiones.
13. Nómina: ledger, periodos, líneas con snapshot, metas, competencias, exportación XLSX.
14. Cafetería: catálogo, pedidos, KDS por WebSocket, débito en la transacción de entrega.
15. Reportes de tiempo efectivo (FR-17).

**Entrega 3 — Optimización (semanas 21–26)**
16. `icebreaker_effectiveness` y feedback loop (FR-26).
17. FR-39 detrás de su feature flag, **si el spike lo habilitó**.
18. Feature #9, misma condición.
19. Ajuste de índices y consultas con datos reales; endurecimiento a partir de lo observado.

---

## 11. Preguntas que este plan deja abiertas

Cada una bloquea algo concreto; no son "nice to have".

| # | Pregunta | Qué bloquea | A quién |
|---|---|---|---|
| 1 | ¿El rol Director Operativo qué permisos tiene exactamente? | El seed de `role_permissions`. El modelo ya lo soporta; falta el contenido | Cliente (agents.md §6) |
| 2 | ¿El coordinador ve solo su cuadrilla o todas? (abierta #5) | Un filtro en las consultas de métricas, turnos y nómina. Se implementa lo restrictivo por defecto | Cliente |
| ~~3~~ | ~~¿Un perfil puede tener dos turnos el mismo día con operadores distintos? (abierta #4)~~ | **Resuelta 2026-08-04: sí.** El constraint de §4 queda como estaba; ver §4.1 y §4.2 para lo que la respuesta obliga a definir | — |
| 4 | Lista documentada de reglas de icebreakers de TalkyTimes (abierta #2) | El seed de `icebreaker_rules` y el prompt del ai-engine. El módulo se puede construir sin ella; no se puede *operar* sin ella | Cliente |
| 5 | ¿El score tiene mínimo bloqueante? (abierta #3) | El flag `icebreakers.blocking_score` y la validación de `/publish` | Cliente |
| 6 | ¿Hay flujo de aprobación antes de publicar? (abierta #6) | Un estado más en la máquina de `icebreakers` | Cliente |
| 7 | Lista exacta de vistas de Tableau, sus columnas, nulos esperados | El `column_mapping` de `tableau_views` y toda la transformación del ETL. **Es el bloqueador más caro de los abiertos** | Cliente (agents.md §6) |
| 8 | ¿Cuántos perfiles simultáneos por operador? (abierta #1) | `max_concurrent_profiles` por defecto, y el dimensionamiento de las PCs | Spike + cliente |
| 9 | ¿Qué puede leer la extensión del DOM de una conversación? | Los `event_type` reales de `metric_events`, y si FR-39 / Feature #9 existen | Spike semanas 1–2 |
| 10 | ¿El operador se autentica en el backend con su propia contraseña, o el enrolamiento del dispositivo basta? | Si el operador tiene o no una pantalla de login propia; hoy el plan asume que sí (JWT de operador **y** token de dispositivo) | Cliente / decisión de producto |
| ~~11~~ | ~~¿Cómo se reparten en un relevo los puntos que Tableau agrega por perfil?~~ | **Resuelta en gran parte 2026-08-04:** Tableau tiene grano horario, así que la atribución es directa por hora (§4.2). Solo queda estimación en la hora que atraviesa un relevo | — |
| ~~13~~ | ~~¿Se pueden programar los relevos en hora en punto?~~ | **Resuelta 2026-08-04: no.** Los turnos arrancan 06:05 / 14:05 / 22:05, así que los tres relevos del día atraviesan una hora. El reparto de §4.2 pasa a ser por minutos (5/55), determinista | — |
| 16 | **¿Los filtros `vf_<campo>` de la API de Tableau aceptan rangos de tiempo arbitrarios, o solo valores?** | Si se puede pedir directamente la ventana 06:05–14:05 (atribución exacta, cero estimación) o hay que bajar horas fijas y trocear. La colección Postman de agents.md §4 no lo aclara — se resuelve probando contra el sitio del cliente, no preguntando | Verificable por nosotros con acceso al Tableau del cliente |
| 17 | ¿El turno nocturno (22:05→06:05) se paga completo en el mes en que arrancó? §4.3 lo adopta así, con la ventana `LOCKED`→`CLOSED` que eso obliga | El cierre de mes. Si se decide partirlo, cambia la agregación de `payroll_lines` y el operador ve su jornada dividida entre dos liquidaciones | Cliente — es una regla de pago |
| 14 | ¿En qué zona horaria devuelve Tableau las marcas de hora del reporte de puntos? | La transformación del ETL. Un desfase de una hora misatribuye exactamente en cada relevo y en ningún otro lado — el total del perfil cuadra y solo está mal el reparto entre dos personas (§4.2) | Cliente / admin de Tableau |
| 15 | ¿La vista horaria de puntos existe ya en el sitio Tableau del cliente, o hay que crearla? | Si el ETL arranca en la Entrega 2 como está planeado, o depende de trabajo del lado del cliente | Cliente |
| 12 | ¿Cuántos minutos de gracia tiene el operador saliente para cerrar sus ventanas antes de que el sistema las cierre por él? (§4.1) | El valor por defecto de `session.handoff_grace_minutes`; es configurable, así que no bloquea construir | Cliente / operación |

---

*Este documento se actualiza cuando cambie una decisión de §1, se resuelva una pregunta de §11, o
el spike de semanas 1–2 devuelva resultados que afecten el modelo.*
