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

El VPS **no compila**. Solo necesita un token de GitHub con `read:packages`:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <usuario> --password-stdin
```

Desplegar por digest (no por tag: un tag se puede mover, un digest no):

```sh
docker buildx imagetools inspect ghcr.io/<owner>/agency-os-api:latest
# copiar el digest a AGENCY_OS_API_IMAGE en .env.production, igual para web y backup
```

## Preparar el VPS

1. Instalar Docker Engine y el plugin Compose (guía oficial de Docker para la distribución).
2. Firewall: no abrir puertos entrantes salvo SSH. La única entrada pública es el túnel de
   Cloudflare, que sale del VPS; PostgreSQL y Redis no se publican.
3. Llevar al VPS solo `compose.production.yml` y `deploy/production/` (el VPS no compila), respetando
   esas rutas relativas.
4. Crear `deploy/production/.env.production` desde el ejemplo y ejecutar
   `chmod 600 deploy/production/.env.production`.
5. `docker login ghcr.io` (ver [Imágenes](#imágenes)).

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

# Después del bootstrap, vaciar BOOTSTRAP_ADMIN_PASSWORD en .env.production.

# 5. Arrancar el stack y los backups
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

## Actualización (despliegue rodante, base para HA)

```sh
export COMPOSE='docker compose --env-file deploy/production/.env.production -f compose.production.yml'
```

1. Publicar el commit (workflow de GHCR) y anotar los digests nuevos.
2. Actualizar `AGENCY_OS_*_IMAGE` en `.env.production`.
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
