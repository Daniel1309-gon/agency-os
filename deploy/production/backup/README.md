# Backups y restauración de Agency OS (producción)

Objetivo del plan: **pérdida máxima de una hora de datos y recuperación en cuatro horas**. Esta
primera versión usa dumps consistentes cada 30 minutos, no archivo continuo de WAL. Si el ciclo no
completa generación y subida en menos de 15 minutos con el volumen real, no cumple el objetivo y hay
que ampliar el diseño antes de producción.

## Qué hace el servicio

`compose.production.yml` (perfil `backup`) levanta `backup`, que corre
`backup-postgres.sh --once` cada 30 minutos:

1. `pg_dump --format=custom` (consistente, con GRANT y DEFAULT ACL; nunca copia archivos en caliente).
2. `pg_dumpall --globals-only --no-role-passwords` (roles, membresías y tablespaces).
3. Cifra ambos con AES-256-CBC + PBKDF2 (200.000 iteraciones) **antes** de salir del VPS.
4. Sube cada archivo cifrado y su `.sha256` a dos rutas de B2 con el mismo Object Lock en modo `GOVERNANCE`:
   - `frequent/` en cada ciclo (retención de 24 horas),
   - `daily/` **una sola vez por día UTC** (retención de 30 días), en el primer ciclo exitoso del día.
5. Escribe `last-backup.json` (versión, inicio, fin, checksum SHA-256 de ambos archivos cifrados y
   resultado) en el volumen `backup_status` **y lo sube a `manifest/last-backup.json` en B2** (sin
   Object Lock: es un puntero mutable). Los checksums de copias anteriores quedan junto a cada objeto
   en `frequent/` y `daily/`, con su misma retención. Un intento
   fallido se registra en `last-failure.json` y **no pisa** el manifiesto de la última copia exitosa;
   `--check` exige `result=SUCCESS` y antigüedad menor a `MAX_AGE_MINUTES`.

Nombres únicos por corrida (`agency-os-<UTC>.dump.enc` y `agency-os-<UTC>.globals.sql.enc`),
checksum verificado contra el archivo cifrado, `dailyUploaded` en el manifiesto y
`restart: unless-stopped`.

## Preparación (Daniel, una vez) — checklist

**1. Crear el bucket**

- Backblaze → **Buckets → Create a Bucket**. Nombre: `agency-os-backups`.
- Región: la que B2 ofrezca más cercana al VPS; con São Paulo cualquiera de EE. UU. sirve (los
  backups son batch). Elegirla fija: el endpoint S3 del bucket debe coincidir con `B2_ENDPOINT`.
- **Files in Bucket: Private**.
- **Object Lock: Enabled** (no se puede activar después sin recrear el bucket). Dejar la retención
  por defecto desactivada: la retención por objeto la pone el script en cada subida.
- Guardar el **Endpoint S3** que muestra el bucket (p. ej. `s3.us-west-004.backblazeb2.com`).

**2. Reglas de ciclo de vida** (el script sube con retención de 24 h y 30 días; la regla borra
después, con un día de margen para no pelear con el Object Lock)

- Regla para el prefijo `frequent/`: **Delete files 2 days after upload**.
- Regla para el prefijo `daily/`: **Delete files 31 days after upload**.

**3. Application key** (Buckets → Application Keys → Add a New Application Key)

- Nombre: `agency-os-vps-backup`. Acceso limitado al bucket `agency-os-backups`.
- Habilidades: `listFiles`, `readFiles`, `writeFiles`, `writeFileRetentions`.
- **Deshabilitar `bypassGovernance`** (el VPS no puede saltarse la retención) y `writeFileLegalHolds`.
- Copiar `keyID` y `applicationKey` al `.env.production` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
  No pasan por chat ni por este repositorio.

**4. Passphrase y KEK: custodia fuera del VPS**

- `BACKUP_ENCRYPTION_PASSPHRASE` vive en el `.env.production` del VPS para cifrar, pero una **copia
  debe custodiarse fuera** (gestor de contraseñas de Daniel o de la clienta): sin ella los dumps no
  se pueden descifrar y el backup no sirve.
- Igual con `VAULT_KEK`: copia en custodia separada del VPS. Restaurar el vault sin la KEK correcta
  deja las credenciales ilegibles.
- No guardar ninguna de las dos en el bucket ni junto a los dumps.

**5. Heartbeat de la alerta por ausencia de backups**

- Crear un chequeo en Healthchecks.io (o equivalente) con período 45 minutos y gracia de 5.
- Copiar su URL de ping en `BACKUP_HEARTBEAT_URL`. El script hace ping al completar y `<url>/fail`
  si la subida falla.

**6. Encender el servicio y verificar**

```sh
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile backup up -d backup
docker compose --env-file deploy/production/.env.production -f compose.production.yml logs --tail 20 backup
docker compose --env-file deploy/production/.env.production -f compose.production.yml exec backup backup-postgres.sh --check
```

**7. Pruebas obligatorias de esta fase** (quedan registradas como evidencia)

1. **Objeto con retención real**: `aws s3api head-object` sobre una copia y su `.sha256` en
   `daily/` y `frequent/` para confirmar la misma `ObjectLockRetainUntilDate` (+24 h y +30 días).
2. **Nadie puede saltarse la retención**: intentar borrar una copia con las credenciales del VPS; debe
   fallar (falta `bypassGovernance`).
3. **Limpieza de vencidos**: subir un objeto de prueba a `frequent/` con retención de 1 día y regla
   temporal de ciclo de vida de 2 días; confirmar en el panel que desaparece (verificación al tercer
   día).
4. **Ciclo completo <15 minutos**: medir la corrida real con el volumen proyectado; si no cabe, el
   objetivo de una hora no se cumple y hay que ampliar el diseño antes de producción.
5. **Restauración**: el ensayo del servidor vacío con la KEK custodiada (ver abajo).

**8. Alertas externas (con Daniel, sin enviar mensajes sin autorización)**

- Indisponibilidad: monitor externo contra `https://erp.globalcompany.company/health/ready` (ruta
  pública del túnel, sin identidad de equipo).
- Backups: heartbeat del punto 5.
- Disco y errores de jobs/outbox: chequeo diario programado con el mismo canal.
- Certificados por vencer: revisar la columna de vencimiento en **Seguridad → Dispositivos**; cuando
  falten ≤30 días, renovar según `deploy/production/station/RUNBOOK.md`.


## Restauración en un servidor vacío (ensayo obligatorio)

```sh
# 1. Elegir <nombre> en daily/ (el manifiesto apunta al ultimo ciclo, no
# necesariamente al daily elegido). Verificar los cifrados ANTES de descifrar.
aws --endpoint-url "$B2_ENDPOINT" s3 cp "s3://$B2_BUCKET/manifest/last-backup.json" .
aws --endpoint-url "$B2_ENDPOINT" s3 cp "s3://$B2_BUCKET/daily/<nombre>.dump.enc" .
aws --endpoint-url "$B2_ENDPOINT" s3 cp "s3://$B2_BUCKET/daily/<nombre>.dump.enc.sha256" .
aws --endpoint-url "$B2_ENDPOINT" s3 cp "s3://$B2_BUCKET/daily/<nombre>.globals.sql.enc" .
aws --endpoint-url "$B2_ENDPOINT" s3 cp "s3://$B2_BUCKET/daily/<nombre>.globals.sql.enc.sha256" .
sha256sum -c <nombre>.dump.enc.sha256
sha256sum -c <nombre>.globals.sql.enc.sha256
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <nombre>.dump.enc -out <nombre>.dump \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <nombre>.globals.sql.enc -out <nombre>.globals.sql \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE

# 2. Servidor vacío: primero roles y tablespaces, después los datos CON sus privilegios.
# postgres:16-alpine ya creó POSTGRES_USER; omitir solo su CREATE ROLE
# duplicado. El ALTER ROLE y todos los demás roles/grants sí se restauran.
bootstrap_role="${POSTGRES_USER:-agency}"
grep -vFx "CREATE ROLE $bootstrap_role;" <nombre>.globals.sql | psql -v ON_ERROR_STOP=1 -d postgres
# pg_dumpall omite contraseñas de rol a propósito: restablecerlas desde el
# .env.production del VPS (DATABASE_URL, DATABASE_WORKER_URL) antes de arrancar.
psql -d postgres -c "ALTER ROLE agency_app PASSWORD '<...>'"    # una por rol de runtime
# POSTGRES_DB puede haber creado ya la base vacía al iniciar el contenedor.
if [ "$(psql -At -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'agency_os'")" != 1 ]; then
  createdb agency_os
fi
# El esquema `public` pertenece a pg_database_owner: habilitar a agency_owner
# antes del restore para que pueda crear tablas y aplicar los GRANT del dump.
psql -d agency_os -c "GRANT CREATE, USAGE ON SCHEMA public TO agency_owner"
# Sin --no-privileges: el dump incluye los GRANT de tablas y los ALTER DEFAULT
# PRIVILEGES que 0008 dejó para las tablas futuras. Con --no-owner el dueño de
# los objetos pasa a ser agency_owner (el rol del restore), como en producción.
pg_restore --no-owner --role=agency_owner --dbname agency_os <nombre>.dump

# 3. Verificar dueño, GRANT y DEFAULT ACL antes de arrancar (0, `t`, >0):
psql -d agency_os -tAc "select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) <> 'agency_owner'"
psql -d agency_os -tAc "select has_table_privilege('agency_app', 'public.users', 'SELECT')"
psql -d agency_os -tAc "select count(*) from pg_default_acl where defaclrole = 'agency_owner'::regrole and defaclnamespace = 'public'::regnamespace"

# 4. Aplicar migraciones pendientes, arrancar API/worker y validar.
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile ops run --rm ops
```

Validación mínima del ensayo (el plan la exige): abrir una **credencial sintética del vault** con la
KEK custodiada, iniciar sesión, ver el semáforo y confirmar el turno. Medir desde el inicio del
incidente hasta el servicio validado: **máximo 4 horas**, con pérdida de datos no superior a 1 hora.

Redis no es fuente única de información irrecuperable: al restaurar, las sesiones efímeras se
invalidan y el trabajo duradero se recupera desde PostgreSQL (jobs, outbox, sesiones de perfil).

## Verificación local (sin B2)

El ensayo reproducible usa dos contenedores temporales `postgres:16-alpine` (origen y destino),
[`test/acl-fixture.sql`](test/acl-fixture.sql) y el stub [`test/aws-stub.sh`](test/aws-stub.sh).
El stub copia cada `--body` a `AWS_STUB_DEST/<key>` y guarda el modo y vencimiento de Object Lock
en `<key>.lock`. Montarlo como `/usr/local/bin/aws-stub` y pasar
`AWS=/usr/local/bin/aws-stub`, `AWS_STUB_DEST=/upload/objects` y
`BACKUP_WORKDIR=/upload/work` a la imagen de backup; ejecutar `backup-postgres.sh --once`
contra la base sintética de origen.

Verificar los dos `.sha256` de `daily/` con `sha256sum -c`, descifrar ambos objetos, restaurar
globals y el dump en el destino vacío con el procedimiento anterior y ejecutar
`psql -v ON_ERROR_STOP=1 -d agency_os -f test/verify-restore.sql`. Debe terminar con `DO`.
Repetir la subida con `AWS_STUB_FAIL_SUFFIX=.sha256`: la corrida debe registrar
`FAILED_UPLOAD_FREQUENT` y conservar `last-backup.json` en `SUCCESS`.

Resultado y nombres de artefactos del ensayo 2026-09-22 en
[`tasks/evidence/e1-e-backups-2026-09-21.md`](../../tasks/evidence/e1-e-backups-2026-09-21.md).
