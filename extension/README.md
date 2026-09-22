# Agency OS — extensión

Este directorio es un proyecto independiente del backend y del frontend. No comparte `node_modules`
ni dependencias npm con ellos.

```powershell
npm run check
npm run check:js
npm run manifest:render
npm run spike:login
npm run spike:launch -- "Profile 1"
```

El empaquetado de la extensión y la prueba de `ExtensionInstallForcelist` requieren Chrome y una
consola de Windows elevada: la prueba escribe la política de máquina en `HKLM`, que es la misma
superficie que debe usar el instalador de las PCs de oficina. Se ejecutan explícitamente con
`npm run package:crx`. No ejecutar esta prueba en el equipo personal de desarrollo.

El manifest incluye únicamente la clave pública de distribución para conservar el mismo ID al cargar
la extensión manualmente en cada PC. La clave privada `.pem` no se versiona y debe permanecer en el
entorno de empaquetado autorizado.

La versión productiva no lee archivos locales ni usa credenciales de prueba. El acceso al API se
limita primero por el mTLS de zona y la IP pública permitida de la oficina. `apiBaseUrl`, `webAppOrigin`
y el nombre del host Native Messaging se provisionan con `chrome.storage.managed` mediante política
empresarial. La identidad del equipo no es un secreto: es el certificado cliente emitido para esa PC,
registrado por huella en Agency OS. No asocia la estación a un operador: cualquier operador
autenticado puede usar cualquier PC aprobado dentro de la red autorizada.

Después de enrolar la estación, provisiona esos valores desde una PowerShell elevada:

```powershell
.\scripts\install-managed-policy.ps1 `
  -ExtensionId EXTENSION_ID `
  -ApiBaseUrl https://api.example.com/api/v1 `
  -WebAppOrigin https://app.example.com
```

El web-app prepara una sesión `LAUNCHING` vinculada al operador, al perfil, a la asignación y al
certificado del equipo; el service worker valida el origen, guarda el contexto únicamente en
`chrome.storage.session`, invoca el helper sin secretos y reclama la sesión desde el certificado
vinculado. Después solicita un grant de 60 segundos, lo redime una sola vez y entrega la credencial
al content script solo en memoria.

Antes de empaquetar, renderiza el manifest con los orígenes exactos de producción:

```powershell
$env:AGENCY_OS_WEB_APP_ORIGIN = 'https://app.tu-dominio.com'
$env:AGENCY_OS_API_ORIGIN = 'https://api.tu-dominio.com'
npm run manifest:render
```
