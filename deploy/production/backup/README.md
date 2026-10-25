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

- Backblaze → **Buckets → Create a Bucket**. Nombre: `agency-os-backups`. Los nombres de bucket son
  globales en B2: el ensayo usó `agency-os-ensayo-backups` en la cuenta de Daniel (región
  `us-east-005`) y `agency-os-backups` queda reservado para la clienta.
- Región: una de EE. UU. cercana al VPS (el VPS está en EE. UU.). Elegirla fija: el endpoint S3 del
  bucket debe coincidir con `B2_ENDPOINT`.
- **Files in Bucket: Private**.
- **Object Lock: Enabled** (no se puede activar después sin recrear el bucket). Dejar la retención
  por defecto desactivada: la retención por objeto la pone el script en cada subida.
- Guardar el **Endpoint S3** que muestra el bucket y ponerlo en `B2_ENDPOINT` **con el esquema**:
  `https://s3.<región>.backblazeb2.com`. Sin `https://`, aws-cli falla con «scheme is missing».

**2. Reglas de ciclo de vida** (el script sube con retención de 24 h y 30 días; la regla borra
después, con un día de margen para no pelear con el Object Lock)

En B2, **«Days Till Delete» cuenta desde que el archivo se oculta, no desde la subida**, y dejar
«Days Till Hide» vacío significa que nunca se borra nada. Valores correctos:

| Prefijo | Days Till Hide | Days Till Delete |
|---|---|---|
| `frequent/` | 2 | 1 |
| `daily/` | 31 | 1 |

**3. Application key** — **no crearla en el panel web.** Una clave «Read and Write» limitada al
bucket creada en el panel resultó incluir `bypassGovernance`, `deleteFiles`, `writeBuckets`,
`writeBucketRetentions`, `writeBucketLifecycleRules` y `writeFileLegalHolds`, lo que anula el Object
Lock. Crearla con la CLI de B2 (el script solo usa `s3api put-object` con
`--object-lock-mode GOVERNANCE`):

```sh
brew install b2-tools
b2 account authorize          # clave maestra, escrita en el prompt (no en la línea de comandos)
b2 key create --bucket <bucket> agency-os-vps-backup \
  listFiles,readFiles,writeFiles,readFileRetentions,writeFileRetentions
b2 key list --long            # verificar las capacidades; borrar cualquier clave creada en el panel
b2 account clear
```

- El panel web puede no listar las claves creadas por CLI: `b2 key list` es la fuente de verdad.
- Copiar `keyID` y `applicationKey` al `.env.production` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
  No pasan por chat ni por este repositorio.

**4. Passphrase y KEK: custodia fuera del VPS**

- `BACKUP_ENCRYPTION_PASSPHRASE` vive en el `.env.production` del VPS para cifrar, pero una **copia
  debe custodiarse fuera** (gestor de contraseñas de Daniel o de la clienta): sin ella los dumps no
  se pueden descifrar y el backup no sirve.
- Igual con `VAULT_KEK`: copia en custodia separada del VPS. Restaurar el vault sin la KEK correcta
  deja las credenciales ilegibles.
- No guardar ninguna de las dos en el bucket ni junto a los dumps.
- **Verificación de custodia obligatoria**, justo después de guardarlas en el gestor: comparar longitud
  y prefijo SHA-256 del valor en el VPS contra la copia del gestor, sin imprimir nunca el valor. En el
  ensayo la `VAULT_KEK` del gestor se había copiado mal y el vault habría sido irrecuperable tras
  perder el VPS; solo la restauración lo detectó.

  ```sh
  # VPS (repetir con BACKUP_ENCRYPTION_PASSPHRASE):
  grep '^VAULT_KEK=' deploy/production/.env.production | cut -d= -f2- | tr -d '\n' | wc -c
  grep '^VAULT_KEK=' deploy/production/.env.production | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12
  # Estación macOS, con el valor del gestor en $VALUE (sin eco en pantalla):
  printf %s "$VALUE" | wc -c
  printf %s "$VALUE" | shasum -a 256 | cut -c1-12
  ```

  Longitud y prefijo deben coincidir en ambos lados; si no, corregir la copia del gestor.

**5. Heartbeat de la alerta por ausencia de backups**

- Crear un chequeo en Healthchecks.io (o equivalente) con período 45 minutos y gracia de 5.
- Copiar su URL de ping en `BACKUP_HEARTBEAT_URL` (es un secreto de operación: no va al repositorio). El script hace ping al completar y `<url>/fail`
  si la subida falla.

**6. Encender el servicio y verificar**

Tras editar `.env.production`, recrear el servicio: un `up -d` simple deja el contenedor viejo
corriendo con las variables anteriores.

```sh
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile backup up -d --force-recreate backup
```

```sh
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile backup up -d backup
docker compose --env-file deploy/production/.env.production -f compose.production.yml logs --tail 20 backup
docker compose --env-file deploy/production/.env.production -f compose.production.yml exec backup backup-postgres.sh --check
```

**7. Pruebas obligatorias de esta fase** (quedan registradas como evidencia)

1. **Objeto con retención real**: `aws s3api head-object` sobre una copia y su `.sha256` en
   `daily/` y `frequent/` para confirmar la misma `ObjectLockRetainUntilDate` (+24 h y +30 días).
   Ensayo 2026-10-21: `frequent/` GOVERNANCE hasta +24 h y `daily/` GOVERNANCE hasta +30 días.
2. **Nadie puede saltarse la retención**: un `delete-object` **sin** `--version-id` no prueba nada:
   el bucket está versionado (Object Lock lo implica), así que solo agrega un marcador de borrado
   (en B2, «ocultar», que requiere únicamente `writeFiles`) y devuelve exit 0 con
   `"DeleteMarker": true`; la versión con los datos sigue ahí. La prueba real, con las credenciales
   del VPS:

   ```sh
   aws --endpoint-url "$B2_ENDPOINT" s3api list-object-versions --bucket "$B2_BUCKET" --prefix <clave>
   # tomar el VersionId de la versión de datos (no el del marcador)
   aws --endpoint-url "$B2_ENDPOINT" s3api delete-object --bucket "$B2_BUCKET" --key <clave> --version-id <id>
   ```

   Debe fallar con `AccessDenied ... not entitled` y exit distinto de 0 (falta `bypassGovernance`).
   Ensayo 2026-10-21: aprobado; el marcador sin versión devolvió exit 0 y la versión de datos
   (662224 bytes) siguió existiendo.
3. **Limpieza de vencidos**: con las reglas del punto 2 (ocultar a los 2 días y borrar 1 día
   después), confirmar en el panel que los objetos de `frequent/` de más de 3 días desaparecen
   (verificación al tercer día).
4. **Ciclo completo <15 minutos** (ensayo 2026-10-21: 26 s con el volumen del ensayo): medir la corrida real con el volumen proyectado; si no cabe, el
   objetivo de una hora no se cumple y hay que ampliar el diseño antes de producción.
5. **Restauración**: el ensayo del servidor vacío con la KEK custodiada (ver abajo).

**8. Alertas externas (con Daniel, sin enviar mensajes sin autorización)**

- Indisponibilidad: monitor externo contra `https://erp.globalcompany.company/health/ready` (ruta
  pública del túnel, sin identidad de equipo).
- Backups: heartbeat del punto 5.
- Disco y errores de jobs/outbox: chequeo diario programado con el mismo canal.
- Certificados por vencer: revisar la columna de vencimiento en **Seguridad → Dispositivos**; cuando
  falten ≤30 días, renovar según `deploy/production/station/RUNBOOK.md`.

**Nota de amenaza.** Quien comprometa el VPS puede **ocultar** copias (marcadores de borrado) pero no
borrarlas antes de que termine la retención. Con las reglas de ciclo de vida (Days Till Delete 1 tras
ocultar), una copia oculta se elimina solo cuando se cumplen ambas condiciones: retención vencida y un
día desde que se ocultó; la ventana protegida sigue siendo el periodo de retención.

### Problemas conocidos

- **`delete-object` devuelve exit 0 y `"DeleteMarker": true`.** No es un borrado: solo oculta la copia
  (ver prueba 2). Para comprobar la retención usar `--version-id`.

- **`Connection was closed before we received a valid response` en `put-object`.** En el ensayo fue
  un secreto mal copiado, no los checksums por defecto de aws-cli 2.34 (fijar
  `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` no cambió nada). Diagnosticar con una lectura que
  no modifica nada: `aws --endpoint-url "$B2_ENDPOINT" s3api list-objects-v2 --bucket "$B2_BUCKET"`.
  `SignatureDoesNotMatch` indica secreto mal copiado (espacios, comillas, truncado, o ID y secreto
  intercambiados).
- **Comprobar conectividad** desde el contenedor: `wget -S -O- "$B2_ENDPOINT/"`; un 403 sin
  credenciales es lo esperado.
- **`scheme is missing`**: falta `https://` en `B2_ENDPOINT`.
- **Cambios de `.env.production` sin efecto**: recrear con `--force-recreate` (punto 6).
- **`vault-restore-check.mjs` falla con `new row violates row-level security policy for table
  "tt_profile_credentials"`.** El contenedor `ops` corre como rol de runtime bajo FORCE RLS; corregido
  en PR #3 (`seal`/`open` corren en contexto de ADMIN). Redesplegar imágenes con esa corrección.
- **`open` falla con «Unsupported state or unable to authenticate data».** La `VAULT_KEK` usada no es la
  del sellado: comparar longitud y prefijo SHA-256 (ver custodia, punto 4).
- **`(version unknown)` en el log del ciclo**: el manifiesto no registra la versión desplegada;
  pendiente de corregir.

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

# Si la última versión de una clave es un marcador de borrado (alguien ocultó la copia), descargar la
# versión de datos de forma explícita: `aws s3api get-object --bucket "$B2_BUCKET" --key <clave>
# --version-id <id> <salida>` (el id sale de `s3api list-object-versions`). También se puede retirar
# el marcador con una clave admin/maestra desde la estación de trabajo; la clave del VPS no puede.

# 2. Servidor vacío, conectado como POSTGRES_USER (superusuario del contenedor):
# primero roles y tablespaces, después los datos con sus dueños y privilegios.
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
# Restore fiel, como superusuario y SIN --no-owner/--role: recrea las
# extensiones (citext, btree_gist, pgcrypto), el esquema drizzle, los dueños
# originales (agency_owner), los GRANT y los ALTER DEFAULT PRIVILEGES.
# Con --role=agency_owner el restore no puede crear extensiones ni esquemas y
# cae en cascada (365 errores en el ensayo del 2026-09-23).
# PostgreSQL gestionado no da superusuario: el rol administrador del proveedor
# debe poder crear esas extensiones y ser miembro de agency_owner. Queda por
# ensayar con el proveedor elegido antes de adoptarlo.
pg_restore --exit-on-error --dbname agency_os <nombre>.dump

# 3. Verificar dueño, GRANT y DEFAULT ACL antes de arrancar (0, `t`, >0):
psql -d agency_os -tAc "select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) <> 'agency_owner'"
psql -d agency_os -tAc "select has_table_privilege('agency_app', 'public.users', 'SELECT')"
psql -d agency_os -tAc "select count(*) from pg_default_acl where defaclrole = 'agency_owner'::regrole and defaclnamespace = 'public'::regnamespace"

# 4. Aplicar migraciones pendientes, arrancar API/worker y validar.
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile ops run --rm ops
```

### Variante desde una estación de trabajo (macOS, usada en el ensayo del 2026-10-25)

Demuestra que la recuperación solo necesita B2 y los secretos custodiados, no el VPS. Si el ciclo del
día ya subió su copia `daily/`, usar la última copia de `frequent/`.

1. Crear con la CLI de B2 una clave **de solo lectura** para la restauración
   (`listFiles,readFiles,readFileRetentions`, nombre distinto de la del VPS) y usarla con `aws-cli`.
2. Descargar los cuatro objetos (dump, globals y sus `.sha256`) y verificar con
   `shasum -a 256 -c <archivo>.sha256` antes de descifrar.
3. Descifrar con **OpenSSL 3 de Homebrew** (`openssl@3`): el LibreSSL de macOS puede no soportar
   `-pbkdf2` ni `-iter`. Comando: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 ...`; el dump
   descifrado debe empezar por `PGDMP`.
4. Levantar un `postgres:16-alpine` vacío en un puerto no estándar, solo en loopback
   (por ejemplo `-p 127.0.0.1:55432:5432`), y seguir el procedimiento del servidor de arriba (globals
   omitiendo el `CREATE ROLE` del usuario del contenedor, contraseña de runtime restablecida
   localmente, `pg_restore --exit-on-error`).
5. Las migraciones aplicadas se verifican con el conteo de `drizzle.__drizzle_migrations` (26 filas,
   0000–0025, nada pendiente): `db-migrate.mjs` imprime siempre «Database migrations applied».
6. `vault-restore-check.mjs open` desde el repositorio en `main`, con un archivo de entorno
   (`NODE_ENV=development`, `DATABASE_URL` del dueño, `DATABASE_APP_URL` del runtime,
   `DATABASE_RUNTIME_ROLE=app`, `REDIS_URL`, un `JWT_SECRET` aleatorio y `VAULT_KEK` del gestor).
   Debe salir 0 con «opened restore-check credential (DEK v1)». Control negativo: con una `VAULT_KEK`
   aleatoria **exportada en el entorno** (`node --env-file` no pisa variables ya definidas) debe salir
   1 con «Unsupported state or unable to authenticate data».

Resultado del ensayo: RTO bruto 3 h 14 min 52 s (2026-10-25T18:58:51Z a 22:13:43Z) y ≈ 45 min netos
tras descontar a mano una pausa de 2 h 30 min; el neto incluye instalar herramientas, crear la clave
de restauración y diagnosticar la KEK. Ambos están bajo el objetivo de 4 h. La pérdida de datos de
esa copia queda acotada por la cadencia de 30 minutos (no es un RPO de HA).

Validación mínima del ensayo (el plan la exige): abrir una **credencial sintética del vault** con la
KEK custodiada, iniciar sesión, ver el semáforo y confirmar el turno. Medir desde el inicio del
incidente hasta el servicio validado: **máximo 4 horas**, con pérdida de datos no superior a 1 hora.

La credencial sintética se guarda una vez, al poner en marcha producción, en un perfil de prueba que
no sea de ninguna operadora; su secreto se custodia junto a la KEK. El perfil debe existir antes de
sellar: crearlo desde la web con el `external_ref` que se usará (por ejemplo `restore-check`). El
script corre como el rol de runtime bajo el contexto RLS de un ADMIN y atribuye la rotación a
`BOOTSTRAP_ADMIN_EMAIL` (o, si no está definido, al admin más antiguo). Nunca usar una credencial real:
el secreto viaja en la línea de comandos.

```sh
# Al poner en marcha (una vez):
$COMPOSE --profile ops run --rm ops node scripts/vault-restore-check.mjs seal <externalRef> <secreto>
# Tras cada restauración: sale 0 si abre con la KEK del .env.production, 1 si no.
$COMPOSE --profile ops run --rm ops node scripts/vault-restore-check.mjs open <externalRef> <secreto>
```

Redis no es fuente única de información irrecuperable: al restaurar, las sesiones efímeras se
invalidan y el trabajo duradero se recupera desde PostgreSQL (jobs, outbox, sesiones de perfil).

## Rotación de la KEK del vault (SEC-09a)

`VAULT_KEK` envuelve las DEK de `encryption_keys`; las credenciales siguen cifradas con su DEK. Rotar
la KEK cambia la envoltura, no re-cifra credenciales: el recifrado a la DEK vigente es SEC-09b y queda
para E2. Es una operación de ventana corta: mientras corre, nada debe estar cifrando ni descifrando.

```sh
# 1. Con la KEK nueva ya escrita en .env.production, agregar la anterior al mismo archivo
#    (nunca en la línea de comandos: quedaría en el historial y en `ps`):
#      VAULT_KEK_PREVIOUS=<kek anterior>
# 2. Detener API y worker.
docker compose --env-file deploy/production/.env.production -f compose.production.yml stop api worker
# 3. Reenvolver. Aborta sin escribir si alguna fila no abre con la KEK anterior.
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile ops run --rm ops \
  node scripts/vault-rewrap-kek.mjs
# 4. Quitar VAULT_KEK_PREVIOUS de .env.production, arrancar y validar la credencial sintética.
docker compose --env-file deploy/production/.env.production -f compose.production.yml up -d api worker
docker compose --env-file deploy/production/.env.production -f compose.production.yml --profile ops run --rm ops \
  node scripts/vault-restore-check.mjs open <externalRef> <secreto>
```

- **Custodiar la KEK anterior 30 días**: los dumps retenidos en B2 siguen envueltos con ella, y
  restaurar esos días exige la KEK con la que se hizo el dump, no la nueva.
- Si el paso 3 falla, no escribió nada: confirmar que `VAULT_KEK_PREVIOUS` es la KEK vigente y repetir.
- No confundir con `POST /vault/keys/rotate` (rotación de DEK): esa agrega una DEK nueva para
  credenciales nuevas y no toca la KEK.

Ensayo local (2026-09-23): la credencial sintética abrió con la KEK nueva, dejó de abrir con la vieja,
la reenvoltura de vuelta la restauró y con una KEK anterior equivocada el script abortó sin cambios.
Detalle en [`tasks/evidence/e1-09a-kek-rewrap-2026-09-23.md`](../../../tasks/evidence/e1-09a-kek-rewrap-2026-09-23.md).

## Verificación local (sin B2)

El ensayo usa el esquema real: el stack de `compose.station-e2e.yml` (migraciones, bootstrap y
seeds de demo) como origen, un `postgres:16-alpine` vacío como destino y el stub
[`test/aws-stub.sh`](test/aws-stub.sh), que copia cada `--body` a `AWS_STUB_DEST/<key>` y guarda el
modo y vencimiento de Object Lock en `<key>.lock`.

1. Guardar la credencial sintética en el origen con `vault-restore-check.mjs seal DEMO-LUNA-01 <secreto>`.
2. Ejecutar `backup-postgres.sh --once` con la imagen de backup en la red del origen, pasando
   `AWS=/usr/local/bin/aws-stub` (copiado con `install -m 755`; `$AWS` debe ser una ruta
   ejecutable), `AWS_STUB_DEST=/upload/objects` y `BACKUP_WORKDIR=/upload/work`.
3. Verificar los `.sha256` de `daily/`, descifrar y restaurar en el destino con el procedimiento
   anterior; `pg_restore --exit-on-error` debe terminar sin errores.
4. Comparar origen y destino: dueños, extensiones, ACL del esquema, `pg_default_acl` y privilegios
   efectivos de `agency_app`/`agency_worker`/`agency_readonly`; `db-migrate.mjs` no debe aplicar nada.
5. `vault-restore-check.mjs open` contra el destino: sale 0 con la KEK del origen y 1 con otra KEK.

Repetir la subida con `AWS_STUB_FAIL_SUFFIX=.sha256`: la corrida debe registrar
`FAILED_UPLOAD_FREQUENT` y conservar `last-backup.json` en `SUCCESS`.

Resultados de los ensayos (2026-09-22 y 2026-09-23) en
[`tasks/evidence/e1-e-backups-2026-09-21.md`](../../../tasks/evidence/e1-e-backups-2026-09-21.md).
