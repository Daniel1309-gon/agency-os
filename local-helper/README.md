# Agency OS Native Messaging helper

El binario se ejecuta como host Native Messaging de Chrome en Windows. Su contrato productivo solo
acepta `launchProfile` y `closeProfile` con `profileId`, `sessionId`, `chromeProfileDir` y `launchUrl`.
No acepta `accessToken`, nombres de usuario ni contraseñas; los campos desconocidos se rechazan.

```powershell
go build -o agency-os-helper.exe ./cmd/agency-os-helper
go test ./...
```

El enrolamiento se realiza con un código de un solo uso emitido por un administrador. El token se
escribe en un archivo de provisión para la política administrada y nunca se imprime:

```powershell
./agency-os-helper.exe enroll `
  --api-base-url https://api.example.com/api/v1 `
  --code CODE_FROM_ADMIN `
  --hostname PC-OFICINA-01 `
  --label "Estación oficina 01" `
  --token-file C:\ProgramData\AgencyOS\device-token.txt
```

Después del enrolamiento, el instalador registra `native-host-manifest.template.json` usando
`scripts/install-native-host.ps1`, sustituyendo el ID real de la extensión. La política empresarial
de Chrome sigue siendo la responsable de provisionar `apiBaseUrl`, `webAppOrigin`, `deviceToken` y
el nombre del host. El token identifica una estación compartida aprobada; no se vincula a un
operador concreto. El acceso humano se decide por IP permitida, JWT, turno y asignación vigente.
