# Alta, renovación y revocación de certificados de cliente (piloto mTLS)

Procedimiento operativo derivado del piloto del 2026-09-18. Aplica a
certificados de la CA administrada por Cloudflare para
`mtls-pilot.globalcompany.company`. No incluye claves ni tokens.

## Alta de un certificado

1. En la PC del dispositivo, generar clave y CSR (OpenSSL):

   ```sh
   openssl genrsa -out <nombre>.key 2048
   openssl req -new -key <nombre>.key -out <nombre>.csr \
     -subj "/CN=<nombre>/O=Agency OS Pilot/C=CO"
   ```

2. Cloudflare → zona `globalcompany.company` → **SSL/TLS → Client Certificates
   → Add Certificate**:
   - CA: **Cloudflare-managed**
   - Opción **Use my own private key and CSR** y pegar el contenido de `<nombre>.csr`
   - Certificate Validity: la menor vigencia suficiente
   - Copiar el certificado emitido a `<nombre>.crt` (no se muestra de nuevo)

3. Importar en el almacén personal de Windows y configurar la política de Chrome
   (requiere elevación):

   ```powershell
   .\deploy\mtls-pilot\import-chrome-cert.ps1 `
     -CertificatePem <nombre>.crt -PrivateKeyPem <nombre>.key -CertificateName <nombre>
   Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass',`
     '-File','deploy/mtls-pilot/install-chrome-policy.ps1','-CertificateName','<nombre>'
   ```

4. Para el agente Python, arrancar con el par del certificado:

   ```powershell
   .\deploy\mtls-pilot\start-pilot-agent.ps1 -CertificateName <nombre>
   ```

5. Verificar: health por HTTPS y ciclo de estación
   (`uv run tools/mtls-pilot-cycle.py --cert-name <nombre>`).

## Alta en Android (probado en Galaxy S24)

1. Empaquetar el certificado y su clave en PKCS#12:

   ```sh
   openssl pkcs12 -export -inkey <nombre>.key -in <nombre>.crt \
     -name "Agency OS Piloto" -passout "pass:<contraseña>" -out <nombre>.p12
   ```

2. Enviar el `.p12` al teléfono (QuickShare, USB o el medio que prefiera IT).
3. Ajustes → Seguridad y privacidad → Más ajustes de seguridad → **Instalar
   certificados** → **Certificado de usuario de VPN y aplicaciones** (no "CA").
4. Abrir el hostname en Chrome: aparece el selector de Android; elegir el
   certificado una vez (Chrome lo recuerda).
5. El teléfono debe estar en la misma red que la allowlist del piloto; el
   origen se evalúa por IP pública.

## Renovación

Repetir el alta con un CN nuevo (por ejemplo `<nombre>-v2`) y dejar el anterior
activo hasta confirmar el reemplazo. Cloudflare Free permite 100 certificados
activos por zona; revocar libera el cupo de inmediato.

## Revocación

1. Cloudflare → **SSL/TLS → Client Certificates** → el certificado → **Revoke**.
2. El efecto en clientes con conexión establecida llega en el siguiente
   handshake TLS; en el piloto, con heartbeats de 10 s, la detección medida fue
   de 11 s.
3. Retirar el certificado del almacén de Windows y la política de Chrome:

   ```powershell
   .\deploy\mtls-pilot\remove-chrome-cert.ps1 -CertificateName <nombre>
   ```

## Producción: clave no exportable y agente por WinHTTP (Fase D1)

En producción la clave no se escribe en disco. Se genera en la PC con el proveedor
de almacenamiento de Windows (TPM cuando está disponible) y Cloudflare firma una
CSR que solo contiene la clave pública:

1. Crear `request.inf` con el proveedor no exportable:

   ```ini
   [NewRequest]
   Subject = "CN=PC-OFICINA-01/O=Agency OS/C=CO"
   KeySpec = 1
   KeyLength = 2048
   Exportable = FALSE
   ProviderName = "Microsoft Software Key Storage Provider"
   MachineKeySet = FALSE
   RequestType = PKCS10
   ```

2. `certreq -new request.inf device.csr` y emitir el certificado en Cloudflare
   (misma pantalla del alta, pegando la CSR).
3. `certreq -accept device.crt` deja el certificado en `Cert:\CurrentUser\My`
   con su clave no exportable (TPM si el proveedor lo permite).
4. Calcular la huella SHA-256 y registrarla en Agency OS:

   ```powershell
   $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*PC-OFICINA-01*' }
   $fingerprint = ([Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('x2') }) -join ''
   .\agency-os-helper.exe enroll --api-base-url https://erp.globalcompany.company/api/v1 `
     --code-file <archivo> --hostname $env:COMPUTERNAME --label "PC oficina 01" `
     --cert-fingerprint $fingerprint
   ```

   O bien `--cert-file device.crt`, que calcula la misma huella desde el PEM.

5. El agente arranca seleccionando ese certificado del almacén, sin exportarlo:

   ```powershell
   python tools\agency-os-local-agent.py --winhttp-cert-sha256 $fingerprint
   ```

   WinHTTP verifica el servidor, desactiva redirecciones, aplica timeouts y
   recibe el contexto del certificado (`WINHTTP_OPTION_CLIENT_CERT_CONTEXT`).
   Si el certificado no está en el almacén, el agente no arranca: no se elige
   "el primero disponible".

**Renovación:** emitir 30 días antes del vencimiento, registrar la huella nueva
con `POST /devices/:id/certificate` (o el enrolamiento, si es una PC nueva),
verificar el acceso y revocar el certificado anterior en Cloudflare. El cambio
se hace sin perfiles activos.

**Excepción documentada:** si el TPM no es compatible, se admite el proveedor
`Microsoft Software Key Storage Provider` sin TPM, con la clave no exportable y
la excepción registrada por dispositivo. En móviles de la dueña se emite un
certificado individual con el mecanismo del dispositivo, sin prometer la misma
protección.

## Excepción de la WAF para health (producción)

El monitoreo externo del VPS consulta `GET /health/ready` sin certificado de
cliente (ver `deploy/production/backup/README.md` §8). En la zona de producción la
regla de exigencia mTLS debe exceptuar **solo** esas rutas, y el orden importa:
primero la excepción, después la exigencia.

Regla 1 — Exception/Skip (Cloudflare → Security → WAF → Custom rules):

- Expresión: `(http.request.method eq "GET" and starts_with(http.request.uri.path, "/health/"))`
- Acción: **Skip** → *All remaining custom rules* y *Client Certificate*.
- Cubre `/health/live` y `/health/ready`; ninguna otra ruta queda exenta.

Regla 2 — la exigencia mTLS vigente sobre `/*`, sin cambios.

El backend ya declara esas rutas públicas y sin identidad de equipo
(`@Public @SkipIpAllowlist @SkipClientCert`, `backend/src/modules/health/health.controller.ts`)
y la respuesta no incluye DSN, versiones ni detalles internos. Las peticiones sin
certificado llegan sin `Client-Cert` y ahí no se exige.

Comprobación posterior (gate de la excepción):

```sh
# sin certificado: 200 solo en health; 403 en todo lo demás
curl -s -o /dev/null -w "%{http_code}\n" https://erp.globalcompany.company/health/ready
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://erp.globalcompany.company/api/v1/auth/login
```

La aplica Daniel en la consola de la zona; el repositorio no despliega reglas de
Cloudflare.

## mTLS definitivo: reglas de Cloudflare para producción (runbook de consola)

Cierre de la referencia de la evidencia B1/B2 (2026-09-21): las reglas WAF y de
transformación que el guard `backend/src/common/auth/client-cert.ts` espera. La
aplica Daniel en la consola de la zona `globalcompany.company`; el repositorio no
despliega reglas de Cloudflare.

**Prerrequisito:** en `deploy/production/.env.production`, `TRUSTED_PROXY_CIDRS` debe
llevar las IP reales de los saltos del túnel dentro de la red Docker del VPS (el
ejemplo trae `172.28.0.10/32,172.28.0.11/32`); confirmarlas con `docker network
inspect <red>` tras el primer arranque. El guard rechaza como `UNTRUSTED_SOURCE`
cualquier `Client-Cert` que no venga de esos saltos.

### Paso 1 — WAF: excepción de health

La regla Skip de la sección anterior
(`(http.request.method eq "GET" and starts_with(http.request.uri.path, "/health/"))`
→ Skip: *All remaining custom rules* y *Client Certificate*). Debe quedar por
encima de la exigencia mTLS.

### Paso 2 — WAF: exigencia mTLS sobre el resto

Mantener la exigencia ya vigente de la zona (SSL/TLS → Client Certificates). Si se
prefiere regla custom en lugar del toggle de zona: expresión
`(not cf.tls_client_auth.cert_verified or cf.tls_client_auth.cert_revoked)` →
acción **Block**, sobre `/*`, por debajo de la excepción de health. Una sola de las
dos formas, no ambas. Cubre web, API y el handshake de WebSocket: certificado
ausente, inválido, de emisor inesperado o revocado se bloquea en el borde.

El enrolamiento (`POST /devices/enroll`) no necesita excepción: la PC presenta su
certificado en el handshake y el guard lo acepta sin estar registrado
(`@AllowUnregisteredClientCert`); el código de un solo uso es el segundo factor.

### Paso 3 — Transform: cabecera `Client-Cert` (RFC 9440)

Reglas → Transform Rules → Modify Request Header. Dos reglas con condiciones
excluyentes (el orden entre ellas no altera el resultado):

**T1 — eliminar la cabecera aportada cuando el certificado no pasa:**

- Expresión: `not cf.tls_client_auth.cert_verified or cf.tls_client_auth.cert_revoked`
- Operación: **Remove header** `Client-Cert`

**T2 — escribirla desde el borde cuando sí pasa:**

- Expresión: `cf.tls_client_auth.cert_verified and not cf.tls_client_auth.cert_revoked`
- Operación: **Set dynamic** header `Client-Cert` con valor `cf.tls_client_auth.cert_rfc9440`

El backend espera exactamente ese formato (RFC 9440: `:<base64 del DER>:`; huella
SHA-256 hex minúscula sobre el DER). Ningún cliente puede falsificar la identidad:
sin certificado T1 elimina la cabecera en el borde, y con certificado válido T2 la
sobrescribe con el DER real.

### Paso 4 — Webhook de Rocket.Chat

La ruta `POST /api/v1/rocketchat/bot/events` es pública y valida un token
compartido (un token inválido se descarta en silencio). El Droplet de Rocket.Chat no
presenta certificado cliente — los webhooks salientes de Rocket.Chat no soportan
mTLS cliente; confirmar contra la 8.7.0 de producción. Sin excepción, la exigencia
del paso 2 lo bloquearía.

- Expresión: `(http.request.method eq "POST" and http.request.uri.path eq "/api/v1/rocketchat/bot/events")`
- Acción: **Skip** → *All remaining custom rules* y *Client Certificate*
- Ubicación: debajo de la excepción de health, encima de la exigencia.
- Acotar por IP del Droplet (`and ip.src in {<ip-del-droplet>}`) es opcional y mejor;
  la IP de un Droplet es estable. El token compartido sigue siendo la compuerta
  real: rotarlo como cualquier secreto.

Alternativa descartada salvo prueba en contrario: certificado cliente para el
Droplet registrado como dispositivo `ADMIN` — no existe soporte conocido en
Rocket.Chat para presentarlo.

### Verificación posterior

```sh
# sin certificado: 200 solo en health; 403 en el resto
curl -s -o /dev/null -w "%{http_code}\n" https://erp.globalcompany.company/health/ready
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://erp.globalcompany.company/api/v1/auth/login
# sin certificado + cabecera falsificada: 403 (T1 la elimina en el borde)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://erp.globalcompany.company/api/v1/auth/login \
  -H 'Client-Cert: :ZmFrZQ==:'
# con certificado válido: ciclo completo de estación con tools/mtls-pilot-cycle.py contra producción
# con certificado válido + cabecera propia: el ciclo sigue OK — T2 sobrescribe con el DER real
# revocación: Revoke en la consola → 403 en el siguiente handshake (detección medida ~11 s en el piloto)
# webhook: token válido → 2xx; inválido → descarte silencioso
```

Registrar en `tasks/evidence/` la fecha de aplicación, capturas de las reglas y
resultados de la verificación.

## Verificación rápida

```sh
# en el piloto no hay excepción: sin certificado, todo devuelve 403
curl -s -o /dev/null -w "%{http_code}\n" https://mtls-pilot.globalcompany.company/healthz
```

Con certificado, usar el agente o `tools/mtls-pilot-cycle.py`.

## Límites

- La clave privada vive en disco; no hay vinculación a hardware ni protección
  contra copia en este piloto.
- La revocación no corta conexiones TLS ya establecidas.
- El agente envía un User-Agent propio porque Cloudflare bloquea clientes sin
  firma de navegador (error 1010).
- El agente usa el bundle de CAs de `certifi`; no depende del almacén de
  Windows, que puede conservar intermedios vencidos.
