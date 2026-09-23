# Evidencia B1/B2 — identidad mTLS y retirada del token de dispositivo (2026-09-21)

Alcance: plan [`plan-cierre-entrega-1-despliegue-2026-09-20.md`](../plan-cierre-entrega-1-despliegue-2026-09-20.md) §2 B1 y B2.
Commit: pendiente (árbol de trabajo). No se contrató ningún servicio ni se aplicó configuración de Cloudflare.

## Qué cambió

1. **Identidad de equipo por certificado.** El backend resuelve la identidad desde la cabecera RFC 9440
   `Client-Cert`, que Cloudflare construye con reglas de transformación (elimina la cabecera aportada por
   el cliente y la reescribe desde `cf.tls_client_auth.cert_rfc9440` solo si el certificado está verificado
   y no revocado). El guard `ClientCertGuard` (`backend/src/common/auth/client-cert.ts`):
   - exige procedencia del proxy confiable (`TRUSTED_PROXY_CIDRS`); en producción rechaza identidad ausente;
   - calcula la huella SHA-256 sobre el DER y la busca en `devices.cert_fingerprint` con estado `APPROVED`,
     `revoked_at` nulo y certificado no vencido;
   - deja `request.device = { id, label, kind, fingerprint, certNotAfter }`;
   - audita cada denegación como `client_cert.denied` sin registrar el certificado completo.
   Las excepciones de identidad son `health` (`@SkipClientCert`) y el enrolamiento
   (`@AllowUnregisteredClientCert`, 2026-09-22): una PC nueva presenta su certificado y canjea el código
   de un solo uso; el guard deja la huella y el vencimiento verificados en el request y el cuerpo solo
   puede confirmarlos (`device-enroll.int.spec.ts`).
2. **Inventario reutilizado, sin secretos de dispositivo.** Migración aditiva
   `0020_client_certificate_identity.sql`: `cert_fingerprint`, `cert_not_after`, `device_kind`
   (`STATION`/`ADMIN`) e índice único parcial que libera la huella al revocar. Las columnas de token se
   conservan por historial y ya no se leen ni escriben. `POST /devices/:id/certificate` registra la
   renovación; el enrolamiento (`POST /devices/enroll`) usa la huella verificada del certificado
   presentado y ya no emite token.
3. **Sesión vinculada desde su creación.** `prepare` exige dispositivo de estación (`@RequireStationDevice`)
   y persiste operador + perfil + asignación + `device_id`. El grant/redeem del vault y el handoff de
   estación filtran por ese mismo `device_id`, repiten la comprobación de dispositivo aprobado y el canje
   sigue siendo de un solo uso con TTL 60 s. Heartbeat/estado/cierre validan el mismo equipo.
4. **Retirada del token.** Sin `x-device-token` en backend, extensión, agente Python ni helper Go. Sin
   `device-token.txt`, sin rotación, sin pantalla de rotación en la web (`SecurityOverview` ahora muestra
   tipo, huella corta y vencimiento). El modo de desarrollo es explícito: `DEV_CLIENT_CERT_FINGERPRINT`
   se rechaza en producción (arranque y petición).
5. **Documentación de borde.** Las reglas de Cloudflare (WAF + transformación de cabecera) quedan
   descritas en `deploy/mtls-pilot/CERTIFICATES.md` §mTLS definitivo; su aplicación es una entrada externa.

## Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `pnpm --dir backend typecheck` | verde |
| `pnpm --dir backend lint` | verde (32 excepciones de arquitectura, una actualizada) |
| `pnpm --dir backend test` | 198 unitarios verdes (incluye `client-cert.spec.ts` nuevo) |
| `pnpm test:integration:run` (Postgres 16 + Redis 7 en contenedores de prueba) | **228 pruebas verdes**, 19 archivos |
| `pnpm test:contracts:run` | verde; `openapi.snapshot.json` y `tasks/route-policy-matrix.md` regenerados |
| `pnpm test:requirements` | 34 pruebas verdes |
| `pnpm extension:check` + `node --test extension/scripts/background.test.mjs` | verde |
| `pnpm helper:test` (Go) | verde |
| `uv run tools/test-local-agent-mtls.py` | `mtls client tests: ok` |
| `pnpm build && pnpm typecheck && pnpm lint && pnpm test` | verdes en shared, api y web |

Nota de entorno: el equipo tiene un PostgreSQL 17 nativo escuchando en `127.0.0.1:5432` que tapa el
puerto publicado por Docker. Las integraciones se ejecutaron con contenedores de prueba en
`127.0.0.1:55432` (Postgres) y `127.0.0.1:56379` (Redis). No se detuvo el servicio del usuario.

## Pruebas de seguridad cubiertas

- Certificado ausente, malformado, desconocido, revocado o vencido → 403 auditado (`client-cert.spec.ts`,
  `guards.int.spec.ts`, `http-security.int.spec.ts`).
- Cabecera aportada por el cliente desde fuera del proxy → 403 `UNTRUSTED_SOURCE` (unitaria).
- Dispositivo administrativo (dueña) no puede operar rutas de estación (`StationDeviceGuard`).
- Handoff/grant desde un equipo distinto al que preparó la sesión → 403 (`vault.int.spec.ts`).
- Redeem de un grant desde otro dispositivo o tras revocar el equipo → 403.
- `DEV_CLIENT_CERT_FINGERPRINT` en producción → error explícito, no bypass.

## Limitaciones explícitas

- Las reglas de Cloudflare (WAF, transformación de cabecera, mTLS de zona) **no están aplicadas**: es
  trabajo de Daniel en la consola, documentado en `deploy/mtls-pilot/CERTIFICATES.md`.
- El webhook de Rocket.Chat viaja por el mismo hostname; en producción necesitará un certificado cliente
  propio (dispositivo `ADMIN`) o una regla explícita. Queda como entrada de despliegue, no como bypass.
- El instalador definitivo, el almacén Windows y la supervisión de procesos huérfanos son Fase D.
- El stack local `station-e2e` usa `DEV_CLIENT_CERT_FINGERPRINT` (NODE_ENV=test) porque su gateway nginx no
  reenvía cabeceras de certificado; producción no permite esa bandera.
