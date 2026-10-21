# Producción de Agency OS — despliegue y operación

Compose de referencia: [`compose.production.yml`](../../compose.production.yml). Variables:
[`.env.production.example`](.env.production.example) (copiar a `.env.production`, permisos 600, nunca
al repositorio).

Todos los comandos llevan **`--env-file deploy/production/.env.production`** (Compose interpola
`${...}` con ese archivo, no con `.env`) y **`-f compose.production.yml`** (sin él, `docker compose`
desde la raíz toma el compose de desarrollo, que publica PostgreSQL y Redis). Ejecutar desde la raíz
del repositorio.

```sh
export COMPOSE='docker compose --env-file deploy/production/.env.production -f compose.production.yml'
```

Con esa variable los comandos del runbook quedan cortos; cada bloque la usa tal cual.

## Imágenes

Las imágenes se publican en GHCR con el workflow `publish-images` en cada push a `main` o tag `v*`:

| Imagen | Contenido |
|---|---|
| `ghcr.io/<owner>/agency-os-api` | API y worker (mismo artefacto, distinto comando) |
| `ghcr.io/<owner>/agency-os-web` | Frontend compilado con los orígenes de producción |
| `ghcr.io/<owner>/agency-os-backup` | Servicio de backups a B2 |

Condiciones del workflow:

- Publica **solo** en push a `main` o tag `v*`. `workflow_dispatch` únicamente funciona cuando el
  workflow ya existe en la rama por defecto.
- La imagen web incrusta `VITE_API_BASE_URL` en la compilación, tomándola de la **variable de
  repositorio** de GitHub `VITE_API_BASE_URL` (por defecto `https://erp.globalcompany.company/api/v1`).
  Si la variable apunta a otro dominio (por ejemplo el de un ensayo), la web llamará a ese dominio:
  restaurar el valor de la clienta y **republicar las imágenes** antes de desplegar en producción.
- Los digests salen del log del workflow (`containerimage.digest`) o de `docker buildx imagetools inspect`.

El VPS **no compila**. Si los paquetes de GHCR son públicos, `docker pull` funciona sin login (así
fue en el ensayo). Si son privados, usar un PAT clásico solo con `read:packages`:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <usuario> --password-stdin
```

Desplegar por digest (no por tag: un tag se puede mover, un digest no):

```sh
docker buildx imagetools inspect ghcr.io/<owner>/agency-os-api:latest
# copiar el digest a AGENCY_OS_API_IMAGE en .env.production, igual para web y backup
```

## Cloudflare: zona, túnel y reglas

Hacer esto antes del primer despliegue. El plan Free de la zona es suficiente.

1. **Alta del dominio.** El escaneo rápido de Cloudflare puede omitir registros (en el ensayo omitió
   DKIM, SPF y MX de Resend en un subdominio `notifications`). Antes de cambiar los nameservers,
   comparar los registros DNS del registrador con los importados y recrear los que sigan en uso
   (MX y TXT en modo *DNS only*). Eliminar los A/CNAME del apex y `www` que apunten al hosting o
   parking del registrador si allí no se sirve nada. Si DNSSEC está activo en el registrador,
   desactivarlo antes de cambiar los nameservers.
2. **No crear a mano ningún registro DNS para el hostname del ERP**, ni en el registrador ni en
   Cloudflare: el *public hostname* del túnel crea el CNAME. Jamás un registro A hacia la IP del VPS
   (expondría el origen y saltaría el mTLS).
3. **Crear el túnel** (Zero Trust → Networks → Tunnels → Cloudflared, nombre `agency-os-prod`):
   elegir el entorno **Docker** y copiar solo el valor posterior a `--token` al gestor de
   contraseñas (será `CLOUDFLARE_TUNNEL_TOKEN`). **No ejecutar el comando que muestra el asistente.**
   El asistente nuevo no deja continuar hasta detectar un conector; el túnel ya existe en ese punto,
   así que se puede salir y añadir el *public hostname* después, desde la página del túnel:
   subdominio `erp`, servicio **HTTP**, URL `caddy:80`.
4. **Client Certificates → Hosts.** En la zona: SSL/TLS → Client Certificates → **Hosts**, añadir el
   hostname del ERP. Sin ese paso Cloudflare nunca pide el certificado y la regla de bloqueo mTLS
   bloquea todo.
5. **Reglas WAF y Transform** en el nivel de **zona** (Domains → la zona → Security → Security
   rules / WAF → Custom rules; Rules → Transform Rules → Modify Request Header). El WAF de nivel de
   cuenta (Application security → WAF en la barra lateral de la cuenta) es solo Enterprise y muestra
   «Purchase add-on». Contenido y orden de las reglas:
   [`../mtls-pilot/CERTIFICATES.md`](../mtls-pilot/CERTIFICATES.md) (Skip de health primero, Block
   sin certificado verificado después).

## Preparar el VPS

Ensayo y producción usan la misma receta. Referencia usada: Hostinger KVM 2, región EE. UU.

1. Ubuntu 24.04 LTS limpio (sin plantilla de panel ni de Docker), acceso por clave SSH. Firewall del
   panel del proveedor permitiendo solo TCP 22: la única entrada pública es el túnel de Cloudflare,
   que sale del VPS; PostgreSQL y Redis no se publican.
2. Instalar Docker Engine y el plugin Compose desde el repositorio apt oficial de Docker.
3. Llevar al VPS solo los archivos versionados de `main`, desde la raíz del repositorio en la
   estación de trabajo (el VPS no compila; se conservan las rutas relativas):

   ```sh
   git archive origin/main compose.production.yml deploy/production \
     | ssh root@<IP> 'mkdir -p /opt/agency-os && tar -x -C /opt/agency-os'
   ```

4. Crear `deploy/production/.env.production` desde el ejemplo y ejecutar
   `chmod 600 deploy/production/.env.production`. **Generar cada secreto en el VPS** con
   `openssl rand -hex 32` (el hexadecimal evita codificar la URL de PostgreSQL). El mismo valor va en
   `POSTGRES_PASSWORD` y `DATABASE_URL`, en `DATABASE_RUNTIME_PASSWORD` y `DATABASE_APP_URL`, y en
   `DATABASE_WORKER_PASSWORD` y `DATABASE_WORKER_URL`. Guardar `VAULT_KEK` y
   `BACKUP_ENCRYPTION_PASSPHRASE` **fuera del VPS**. En producción la API no arranca sin
   `ROCKETCHAT_BASE_URL`, `ROCKETCHAT_TOKEN`, `ROCKETCHAT_USER_ID` y un `ROCKETCHAT_WEBHOOK_SECRET`
   de al menos 32 caracteres: el despliegue de la clienta necesita los valores reales (el ensayo usó
   `https://chat.invalid`, dominio reservado que nunca resuelve, para que el outbox no llegue a un
   servidor real). Al terminar, `grep -nE 'replace-with|example\.com|203\.0\.113' deploy/production/.env.production`
   solo debe listar valores opcionales sin usar.
5. Ejecutar siempre los comandos desde `/opt/agency-os`: si el shell queda dentro de
   `deploy/production`, las rutas relativas `deploy/production/...` fallan.
6. Si las imágenes son privadas, `docker login ghcr.io` (ver [Imágenes](#imágenes)).

## Primer despliegue

```sh
export COMPOSE='docker compose --env-file deploy/production/.env.production -f compose.production.yml'

# 1. Migraciones y roles (una vez, con el perfil ops)
$COMPOSE --profile ops run --rm ops

# 2. Seed: roles, permisos, settings, feature flags y el primer admin (BOOTSTRAP_ADMIN_*)
$COMPOSE --profile ops run --rm ops node dist/database/seeds/seed.js

# 3. Crear roles de runtime y worker (bootstrap; requiere DATABASE_URL de owner)
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-runtime.mjs
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-worker.mjs

# 4. Allowlist inicial de IP para el admin (BOOTSTRAP_IP_CIDR); solo actúa si no hay ninguna activa
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-ip.mjs

# 4b. Primer equipo ADMIN (BOOTSTRAP_ADMIN_DEVICE_FINGERPRINT); solo actúa si no hay ningún equipo
#     ADMIN activo. En producción el login exige un equipo aprobado y enrolar uno exige sesión de
#     admin, así que el primero se registra por aquí. La huella es el SHA-256 en hex del DER del
#     certificado de cliente que emitió Cloudflare para el equipo del admin:
#       openssl x509 -in admin.crt -outform DER | openssl dgst -sha256 -r | cut -d' ' -f1
#     Emisión del certificado en macOS: ../mtls-pilot/CERTIFICATES.md (equipo del primer ADMIN).
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-admin-device.mjs

# Después del bootstrap, vaciar BOOTSTRAP_ADMIN_PASSWORD en .env.production.

# 5. Arrancar el stack y los backups. Antes, comprobar que no queda un conector de cloudflared
#    suelto (ver Problemas conocidos): el único conector debe ser el servicio del compose.
docker ps -a --filter ancestor=cloudflare/cloudflared
$COMPOSE up -d
$COMPOSE --profile backup up -d backup

# 6. Verificar
curl -fsS https://erp.globalcompany.company/health/ready
$COMPOSE ps
$COMPOSE exec backup backup-postgres.sh --check
```

Sin certificado cliente, Cloudflare debe bloquear el hostname; con certificado, el login debe
funcionar. El scheduler corre solo en `worker` (`JOBS_ENABLED=false` en la API) y sus jobs son
durables (`job_runs`); el acceso del worker usa `agency_worker_runtime` con los grants de la
migración `0022`.

Orden que funcionó en el ensayo: migraciones de `ops` → seed → bootstrap runtime → bootstrap worker →
bootstrap IP → bootstrap del equipo ADMIN (4b) → vaciar `BOOTSTRAP_ADMIN_PASSWORD` → `up -d`.

### Problemas conocidos

- **502 en todas las peticiones.** Causa vista: se ejecutó a mano el `docker run cloudflare/cloudflared
  ...` del asistente del túnel; ese contenedor queda en la red bridge por defecto, no resuelve
  `caddy` y Cloudflare responde 502. Eliminarlo con `docker rm -f <contenedor>` antes del
  `up -d` (el único conector debe ser el servicio del compose en la red `edge`) y borrar el token
  del historial del shell (`history -c` o editar `~/.bash_history`).
- **Todo 403 con certificado válido.** Falta el hostname en SSL/TLS → Client Certificates → Hosts
  (ver [Cloudflare](#cloudflare-zona-túnel-y-reglas)).
- **No se encuentra `deploy/production/...`.** El shell quedó dentro de `deploy/production`: volver a
  `/opt/agency-os`.
- Problemas de backups: [`backup/README.md`](backup/README.md#problemas-conocidos).

## Actualización (despliegue rodante, base para HA)

```sh
export COMPOSE='docker compose --env-file deploy/production/.env.production -f compose.production.yml'
```

1. Publicar el commit (workflow de GHCR) y anotar los digests nuevos.
2. Editar los tres valores `AGENCY_OS_API_IMAGE`, `AGENCY_OS_WEB_IMAGE` y `AGENCY_OS_BACKUP_IMAGE`
   en `.env.production` (por digest).
3. `$COMPOSE pull && $COMPOSE up -d` (los servicios se recrean uno a uno; Postgres y Redis no se
   tocan).
4. Verificar `/health/ready` y un login real. Las migraciones son aditivas: la versión nueva convive
   con el esquema anterior durante el despliegue.

Con dos nodos, repetir el paso 3 en el segundo nodo; el túnel de Cloudflare admite varios conectores
y la conmutación no requiere cambios de DNS.

## Rollback

Volver `AGENCY_OS_*_IMAGE` a los digests anteriores, `$COMPOSE up -d` y verificar. No revertir
migraciones ni restaurar la base salvo incidente de datos; en ese caso seguir
[`backup/README.md`](backup/README.md).

## Estaciones Windows

Alta, renovación y baja: [`station/RUNBOOK.md`](station/RUNBOOK.md).
