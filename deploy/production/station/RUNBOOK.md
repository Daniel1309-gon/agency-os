# Estación Windows — alta, operación y baja (Agency OS)

Runbook de la Fase D2. Cada PC tiene su propio certificado (clave no exportable) y su propia huella
SHA-256; el instalador y el enrolamiento usan esa huella, nunca un secreto compartido.

## 1. Preparar el certificado de la PC

1. En la PC, como el usuario compartido, con la consola elevada: generar CSR con clave no exportable
   (`certreq -new` con `Microsoft Software Key Storage Provider` y `Exportable = FALSE`, ver
   [`deploy/mtls-pilot/CERTIFICATES.md`](../../mtls-pilot/CERTIFICATES.md) § producción).
2. Emitir el certificado en Cloudflare con esa CSR e importarlo: `certreq -accept device.crt`.
3. Calcular la huella SHA-256:

   ```powershell
   $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*PC-OFICINA-*' }
   $fp = ([Security.Cryptography.SHA256]::Create().ComputeHash($cert.RawData) | ForEach-Object { $_.ToString('x2') }) -join ''
   $fp
   ```

## 2. Crear el dispositivo y el código de enrolamiento

En Agency OS, como ADMIN: **Seguridad → Dispositivos → Crear**, tipo `STATION`. El sistema devuelve un
código de un solo uso (15 minutos). Entregarlo por canal seguro; no va en el instalador ni queda en
historial.

## 3. Instalar

En la PC, como el usuario compartido, con PowerShell elevado (o doble clic y aceptar UAC):

```powershell
.\agency-os-station-setup.exe /CertSha256=<huella del paso 1>
```

Qué hace: copia agente y helper, escribe `%ProgramData%\AgencyOS\agent.json` (API, origen, huella,
puerto), registra Native Messaging, fuerza la extensión por política, habilita
`AutoSelectCertificateForUrls` **solo** para el dominio del ERP —en su propia entrada y filtrando por
el CN del certificado de la PC, sin pisar entradas de otros programas— y deja el agente en el arranque
de la sesión. No borra políticas ni certificados ajenos. El instalador exige que el certificado del
paso 1 ya esté en `Cert:\CurrentUser\My`; si no, falla con un mensaje explícito.

Verificar: `chrome://policy` muestra `ExtensionInstallForcelist` y `AutoSelectCertificateForUrls`;
el ERP abre sin selector de certificado.

## 4. Enrolar la PC

```powershell
& "$env:ProgramFiles\Agency OS\agent\agency-os-agent.exe" --enroll-code-file C:\ruta\codigo.txt
Get-Content "$env:ProgramData\AgencyOS\agent.log" -Tail 3
```

El agente presenta el certificado de la PC (WinHTTP) contra el API por el túnel; el log debe mostrar
`device enrolled: <uuid>`. Si el código venció, crear otro en Agency OS y repetir.
Antes de enrolar una PC desde fuera de la oficina, autorizar temporalmente su IP en la allowlist:
`/devices/enroll` aún no tiene dispositivo aprobado y sigue la regla de rutas públicas del ADR 0014.
Retirar esa entrada cuando termine el alta si ya no se necesita.

## 5. Validar operación

1. El agente escucha solo en `127.0.0.1:45831`; el web-app lo detecta.
2. Abrir un perfil desde el dashboard: Chrome del perfil aislado, login manual del operador.
3. Cerrar el perfil desde el dashboard.
4. **Huérfanos:** con un perfil abierto, matar `agency-os-agent.exe`; el Job Object del agente debe
   cerrar chromedriver y su Chrome de trabajo sin intervención. Si tras un crash quedaran residuos de
   una versión anterior al Job Object, el siguiente arranque registra `huerfano cerrado: chromedriver
   pid …` al limpiarlos.
5. Desactivar la PC en Agency OS (revocar dispositivo): el agente y la extensión dejan de autenticar.

## 6. Renovación y sustitución

- **Renovación:** emitir el certificado nuevo 30 días antes, registrarlo con
  `POST /devices/:id/certificate` (o reenrolar si es una PC nueva), reinstalar solo si cambia la
  configuración, y revocar el certificado anterior en Cloudflare. Sin perfiles activos.
- **Sustitución de PC:** revocar el dispositivo anterior en Agency OS (libera la huella), repetir el
  alta completa en la PC nueva.
- **Baja:** `uninstall-station.ps1` retira los componentes de Agency OS; la revocación del
  certificado en Cloudflare y del dispositivo en Agency OS son pasos administrativos aparte.

## Pendientes de esta fase

- Confirmar el ID de extensión de producción (`fcniigapdfcoigmnkhkcgmhlhjdledbo` es el que usan los
  ejemplos y el ensayo E2E).
- Prueba física completa en una PC de oficina (aquí Windows Defender bloquea escribir la política de
  Chrome, ya documentado en `agents.md` §5.2).
- Publicar el instalador en el sitio protegido con su checksum (`build-installer.ps1` lo imprime).
