# Agency OS — extensión

Este directorio es un proyecto independiente del backend y del frontend. No comparte `node_modules`
ni dependencias npm con ellos.

```powershell
npm run check
npm run check:js
npm run spike:login
npm run spike:launch -- "Profile 1"
```

El empaquetado de la extensión y la prueba de `ExtensionInstallForcelist` requieren Chrome y permisos
de Windows; se ejecutan explícitamente con `npm run package:crx`.

La versión productiva no lee archivos locales. `apiBaseUrl`, `webAppOrigin` y el token revocable del
dispositivo se provisionan con `chrome.storage.managed` mediante política empresarial. El web-app
prepara una sesión con `prepareSession`; el service worker marca la sesión `ACTIVE`, solicita un grant
de 60 segundos, lo redime una sola vez y entrega la credencial al content script solo en memoria.
