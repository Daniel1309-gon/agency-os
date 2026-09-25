# Estación Windows — ensayo E2E de seis perfiles

Este bundle instala solamente la CA pública, el helper nativo y las políticas de Chrome. No contiene
la llave PEM de la extensión, certificados privados, credenciales, tokens ni secretos del vault.

## Antes de instalar

1. Use el usuario Windows dedicado de la estación y abra PowerShell como Administrador.
2. Confirme con el responsable del host la IPv4 reservada del servidor y la IPv4 `/32` de esta PC.
3. Obtenga un código de enrolamiento de un solo uso desde Agency OS. No lo copie a tickets ni chats.
4. Verifique `SHA256SUMS.txt` antes de ejecutar scripts.

## Instalar

```powershell
$code = Read-Host 'Código de enrolamiento' -AsSecureString
.\install.ps1 `
  -ServerIp 192.168.1.10 `
  -StationIpCidr 192.168.1.25/32 `
  -EnrollmentCode $code `
  -ExtensionId fcniigapdfcoigmnkhkcgmhlhjdledbo
```

Reinicie Chrome por completo. En `chrome://policy`, pulse **Reload policies** y compruebe
`ExtensionInstallForcelist`. Cree seis perfiles nuevos y confirme `Profile 1` a `Profile 6`.
No pulse **Log in**: las cuentas `@talkytimes.test` son ficticias.

## Evidencia mínima

Registre versión de Chrome, política, extensión administrada, Native Messaging, heartbeat, seis
ventanas, inyección DOM, ocultamiento del ojo, replay rechazado, revocación, consumos RAM/CPU y
tiempos de apertura. Sanitice capturas y logs antes de copiarlos a `tasks/evidence`.

## Desinstalar

La desinstalación exige un JWT de administrador para revocar el dispositivo antes de retirar el
token local. Si el API no está disponible, no fuerce la limpieza: restáurelo y repita.

```powershell
$adminToken = Read-Host 'JWT temporal de administrador' -AsSecureString
.\uninstall.ps1 -AdministratorAccessToken $adminToken
```

La desinstalación conserva todos los perfiles de Chrome. Su eliminación es una acción posterior,
separada y explícita, únicamente después de recolectar la evidencia.

