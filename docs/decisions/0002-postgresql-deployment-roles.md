# ADR 0002: PostgreSQL deployment roles and runtime connections

- Estado: aceptada
- Fecha: 2026-08-21
- Alcance: SEC-01

## Decisión

PostgreSQL usa cuatro roles de capacidad sin login:

- `agency_owner`: dueño de las tablas y rol efectivo de migraciones; nunca se usa por la API ni por workers.
- `agency_app`: DML del runtime HTTP, sin `DELETE` ni `TRUNCATE` global.
- `agency_worker`: permisos explícitos solo sobre sesiones, turnos, breaks, cafetería, mensajes y outbox.
- `agency_readonly`: allowlist de reportes; tablas de tokens y claves se omiten y las tablas con secretos se exponen por columnas.

Las credenciales pertenecen a cuentas concretas (`agency_runtime` y `agency_worker_runtime`) creadas por bootstrap y heredando el rol de capacidad correspondiente. Ningún rol de capacidad tiene `LOGIN`, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` o `BYPASSRLS`.

La API selecciona `DATABASE_APP_URL`; un proceso worker selecciona `DATABASE_WORKER_URL` mediante `DATABASE_RUNTIME_ROLE=worker`. `DATABASE_URL` queda reservado para migración/seed. El arranque en producción verifica membresía al rol esperado, ausencia de membresía a `agency_owner`, ausencia de ownership, y ausencia de privilegios de superusuario.

## Grants y secretos

La migración `0008_database_deployment_roles.sql` mueve las relaciones existentes a `agency_owner`, revoca capacidades de `PUBLIC`, aplica los grants de runtime y configura defaults futuros solo para `agency_app`. La allowlist readonly no incluye `refresh_tokens`, `encryption_keys`, `app_settings` ni los hashes de `users`/`devices`; tampoco expone ciphertext, nonce, tag o AAD del vault.

Los grants readonly son explícitos. No se usa `GRANT SELECT ON ALL TABLES` para ese rol porque una tabla futura podría introducir un secreto por accidente.

## Alternativas rechazadas

- Un único usuario `agency` para API, migraciones y jobs: mantiene ownership y hace que RLS sea una defensa ilusoria.
- Dar `SELECT` global a readonly y revocar columnas después: facilita que una migración nueva exponga un secreto.
- Crear credenciales LOGIN directamente en la migración: mezcla schema deployment con gestión de secretos y obliga a versionar contraseñas.

## Consecuencias

- El despliegue debe ejecutar `db-bootstrap-runtime` y, cuando exista un proceso separado, `db-bootstrap-worker`.
- Las migraciones futuras se ejecutan con el rol dueño cuando `agency_owner` ya existe; el script usa una conexión única para que `SET ROLE` cubra toda la migración.
- El script concede de forma idempotente `CREATE` sobre la base de datos y `USAGE, CREATE` sobre el esquema `drizzle` únicamente a `agency_owner` antes de `SET ROLE`, porque Drizzle ejecuta `CREATE SCHEMA IF NOT EXISTS` en cada corrida. `agency_app` y `agency_worker` no reciben esos privilegios.
- El cambio de rol solo ocurre cuando la entrada de `0008_database_deployment_roles` ya está en el journal; una instalación interrumpida a mitad de esa migración debe reanudarla con la cuenta de migración original para que su `DO` pueda completar la creación/configuración de roles.
- La integración debe probar los cuatro catálogos de roles y los intentos de abuso sobre auditoría, vault, payroll y perfiles.
- El runtime actual todavía puede convivir con `DATABASE_URL` en development/test; producción exige la URL de la capacidad seleccionada.
