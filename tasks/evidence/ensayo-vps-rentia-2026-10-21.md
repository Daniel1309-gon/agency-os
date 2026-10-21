# Ensayo en VPS propio (rentia.online) — 2026-10-17 a 2026-10-21

Estado: **Fase 1 PASS; Fase 3 en curso (3 de 5 pruebas cerradas); Fases 2, 5 y 6 sin iniciar.**
Ensayo previo al despliegue de la clienta, según [ADR 0013](../../docs/decisions/0013-production-topology-and-ha-path.md)
(revisión 2026-10-17) y [`docs/prueba-vps-postgresql-gestionado.md`](../../docs/prueba-vps-postgresql-gestionado.md).
Datos y secretos propios del ensayo; ningún secreto, IP, huella ni URL de ping figura aquí.

## Entorno

- VPS Hostinger KVM 2, región EE. UU., Ubuntu 24.04 LTS limpio, acceso por clave SSH, firewall del
  panel con solo TCP 22. Docker Engine + plugin Compose desde el repositorio apt oficial.
- Dominio `rentia.online` en Cloudflare (plan Free), hostname `erp.rentia.online` vía túnel
  (`cloudflared` en el compose, destino `caddy:80`).
- Imágenes de GHCR por digest, publicadas por `publish-images` tras el push a `main`.
- Backups: bucket de B2 propio del ensayo (`agency-os-ensayo-backups`, `us-east-005`), Object Lock
  activado, sin retención por defecto, privado. Heartbeat en healthchecks.io (período 45 min, gracia 5).
- Rocket.Chat apuntado a `https://chat.invalid` para que el outbox no llegue a un servidor real.

## Resultados

### Fase 1 — Baseline del VPS (PASS)

| Prueba | Resultado | Veredicto |
|---|---|---|
| Despliegue (migraciones, seed, bootstrap runtime/worker/IP/equipo ADMIN, `up -d`) | stack arriba | PASS |
| `GET /health/ready` y `/health/live` sin certificado | 200 | PASS |
| `POST /api/v1/auth/login` sin certificado | 403 | PASS |
| Ídem con cabecera falsificada `Client-Cert: :ZmFrZQ==:` | 403 | PASS |
| `GET /` sin certificado | 403 | PASS |
| `curl --cert admin.crt --key admin.key -X POST .../auth/login` | 400 (pasó Cloudflare y el guard de equipo; 400 por falta de cuerpo) | PASS |
| Login del admin en el navegador con el certificado | OK en Safari | PASS |

Ciclo completo de estación con certificado (`tools/mtls-pilot-cycle.py`): no ejecutado en el ensayo.

### Fase 3 — Backups B2 (EN CURSO)

| # | Prueba | Resultado | Veredicto |
|---|---|---|---|
| 1 | `head-object` con retención (`daily/` y `frequent/`) | `frequent/agency-os-20261021T174120Z.dump.enc` GOVERNANCE hasta 2026-10-22T17:41:20Z (+24 h); `daily/` del mismo ciclo GOVERNANCE hasta 2026-11-20T17:41:20Z (+30 d). El listado mostró los 4 objetos (dump, dump.sha256, globals, globals.sha256) en cada prefijo y `manifest/last-backup.json` | PASS |
| 2 | Borrado con la clave del VPS debe fallar | Sin `--version-id`: exit 0 y `"DeleteMarker": true` (solo oculta; `list-object-versions` confirmó la versión de datos de 662224 bytes). Con `--version-id` de la versión de datos: `AccessDenied ... not entitled`, exit 254. La copia de `frequent/` quedó oculta (vence el 2026-10-22); la de `daily/` intacta | PASS |
| 3 | Limpieza de vencidos por regla de ciclo de vida | verificar el 2026-10-24 | PENDIENTE |
| 4 | Ciclo completo < 15 min | primer ciclo exitoso 2026-10-21 17:41:20 → 17:41:46 UTC: **26 s**; `backup-postgres.sh --check` → «backup fresco: 0 min» | PASS |
| 5 | Restauración en servidor vacío con la KEK | no ejecutada | PENDIENTE |

Fases 2 (capacidad), 5 (humo funcional) y 6 (interrupción): sin iniciar.

## Desviaciones y cómo se resolvieron

Todas están incorporadas a los runbooks
([`deploy/production/README.md`](../../deploy/production/README.md),
[`backup/README.md`](../../deploy/production/backup/README.md),
[`CERTIFICATES.md`](../../deploy/mtls-pilot/CERTIFICATES.md)).

| # | Desviación | Resolución |
|---|---|---|
| 1 | El escaneo de Cloudflare omitió DKIM/SPF/MX de Resend en un subdominio | Comparar registros con el registrador antes de cambiar nameservers y recrear los faltantes |
| 2 | Registros A/CNAME del apex y `www` hacia el parking del registrador; DNSSEC activo | Eliminarlos si no se sirve nada; desactivar DNSSEC antes del cambio |
| 3 | El asistente del túnel no deja continuar sin conector | El túnel ya existe: salir y añadir el public hostname desde su página (`erp`, HTTP, `caddy:80`) |
| 4 | `docker run cloudflare/cloudflared` del asistente ejecutado a mano: conector en la red bridge por defecto, sin resolver `caddy`, 502 en todo | `docker rm -f` del contenedor, limpiar el token del historial y dejar solo el servicio del compose |
| 5 | Sin el hostname en Client Certificates → Hosts, Cloudflare no pide certificado y el bloqueo mTLS corta todo | Añadir el hostname en SSL/TLS → Client Certificates → Hosts |
| 6 | El WAF de cuenta es Enterprise («Purchase add-on») | Crear las reglas custom y Transform a nivel de zona |
| 7 | `cd deploy/production` dejó el shell en esa carpeta y las rutas relativas fallaron | Ejecutar siempre desde `/opt/agency-os` |
| 8 | `workflow_dispatch` no funcionaba antes de que el workflow existiera en `main` | Publicar por push a `main`; leer digests del log (`containerimage.digest`) |
| 9 | Primer admin imposible de enrolar en producción sin equipo aprobado | Paso 4b (`db-bootstrap-admin-device.mjs`, PR #2) |
| 10 | PKCS#12 de OpenSSL 3+ de Homebrew rechazado por el llavero de macOS | Construir el `.p12` con `/usr/bin/openssl` (LibreSSL) |
| 11 | Panel web de B2: la clave «Read and Write» limitada al bucket traía `bypassGovernance`, `deleteFiles`, `writeBucketRetentions`, etc., anulando el Object Lock | Crear la clave con la CLI de B2 con solo `listFiles,readFiles,writeFiles,readFileRetentions,writeFileRetentions`; borrar la del panel |
| 12 | La redacción «Delete files N days after upload» del runbook era incorrecta: «Days Till Delete» cuenta desde el ocultado | `frequent/` hide 2 / delete 1; `daily/` hide 31 / delete 1 |
| 13 | `B2_ENDPOINT` sin esquema: aws-cli «scheme is missing» | Incluir `https://` (comentado en `.env.production.example`) |
| 14 | `up -d` tras editar `.env.production` dejó el contenedor viejo | `up -d --force-recreate backup` |
| 15 | `Connection was closed before we received a valid response` en `put-object` | Era un secreto mal copiado (no los checksums de aws-cli 2.34; `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` no cambió nada). Diagnóstico con `list-objects-v2`: `SignatureDoesNotMatch` |
| 16 | Región de B2 del runbook pensada para un VPS en São Paulo | El VPS está en EE. UU.: bucket en región de EE. UU. cercana |
| 17 | La prueba 2 del runbook («intentar borrar una copia») daba un falso positivo: `delete-object` sin `--version-id` devuelve exit 0 porque en un bucket versionado solo agrega un marcador de borrado (ocultar, basta `writeFiles`) | Reescrita con `list-object-versions` y `delete-object --version-id`, esperado `AccessDenied` y exit distinto de 0; añadidas nota de amenaza y nota de restauración |

## Pendientes

- **Versión desconocida:** el log del ciclo muestra `(version unknown)`; el manifiesto no registra la
  versión desplegada.
- **`VITE_API_BASE_URL`:** la variable de repositorio de GitHub vale hoy `https://erp.rentia.online/api/v1`;
  antes del despliegue de la clienta debe volver a `https://erp.globalcompany.company/api/v1` y las
  imágenes deben republicarse.
- **Brave** no presentó el certificado de cliente; Safari sí. Usar Safari o Chrome y comprobar Chrome
  antes de entregar a la clienta.
- **Ciclo de vida:** verificar el 2026-10-24 que `frequent/` se limpia con las reglas corregidas.
- **Restauración** en servidor vacío con la KEK custodiada (prueba 5) y medición de RTO.
- Ciclo de estación con certificado (`mtls-pilot-cycle.py`) y Fases 2, 5 y 6.
