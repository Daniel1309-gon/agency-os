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

El empaquetado de la extensión y la prueba de `ExtensionInstallForcelist` requieren Chrome y permisos
de Windows; se ejecutan explícitamente con `npm run package:crx`.

La versión productiva no lee archivos locales ni usa credenciales de prueba. El acceso al API se
limita primero por la IP pública permitida de la oficina. `apiBaseUrl`, `webAppOrigin`, el nombre del
host Native Messaging y el token revocable de la estación se provisionan con
`chrome.storage.managed` mediante política empresarial. Ese token acredita una estación compartida,
no la asocia a un operador: cualquier operador autenticado puede usar cualquier PC aprobado dentro
de la red autorizada.

El web-app prepara una sesión `LAUNCHING` sin elegir PC; el service worker valida el origen, guarda
el contexto únicamente en `chrome.storage.session`, invoca el helper sin secretos y reclama la
sesión desde la estación que está usando el operador. Después solicita un grant de 60 segundos, lo
redime una sola vez y entrega la credencial al content script solo en memoria.

Antes de empaquetar, renderiza el manifest con los orígenes exactos de producción:

```powershell
$env:AGENCY_OS_WEB_APP_ORIGIN = 'https://app.tu-dominio.com'
$env:AGENCY_OS_API_ORIGIN = 'https://api.tu-dominio.com'
npm run manifest:render
```
