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

## Verificación rápida

```sh
# sin certificado: debe devolver 403
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
