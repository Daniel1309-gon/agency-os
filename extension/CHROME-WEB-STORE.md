# Chrome Web Store: piloto local y despliegue administrado

Decisión aprobada el 2026-09-07: extensión **no listada** en Chrome Web Store e instalación forzada en las estaciones Windows. Hoy el web-app y el API son locales y todavía no existe la cuenta de desarrollador. El paquete de esta entrega es un **borrador BETA para localhost**, no una publicación ni una instalación validada en oficina.

## 1. Paquete preparado

Desde la raíz del repositorio, con Node y Windows PowerShell:

```powershell
node extension/scripts/package-webstore.mjs --local
```

El comando informa la ruta del ZIP bajo `.local/chrome-web-store/build-*/` y su SHA-256. `artifact.json` conserva versión y orígenes. Cada ejecución crea una carpeta nueva. El ZIP contiene solo `manifest.json` en la raíz, `background.js`, `content.js`, `managed_schema.json` e `icon128.png`. No contiene helper, claves, tokens, cuentas demo ni archivos del spike. El icono PNG procede del diseño existente en `web-app/public/favicon.svg`, con margen transparente para la tienda.

Orígenes del piloto: `http://localhost:5173` y `http://localhost:3000`; la política de ejecución usa `http://localhost:3000/api/v1`. En otra PC, localhost designa **esa PC**: este paquete solo sirve si el sistema corre allí. No habilita acceso al servidor del desarrollador por red.

La plantilla y la extensión descomprimida conservan su clave pública de desarrollo. El ZIP omite esa clave: **el ID que cuenta para la tienda se obtiene del dashboard al subir el borrador**. No usar automáticamente `fcniigapdfcoigmnkhkcgmhlhjdledbo` como ID de la tienda. Para probar una copia descomprimida con el nuevo ID, usar la clave pública de *Package → View public key* del mismo borrador, siguiendo la [documentación de identidad de Chrome](https://developer.chrome.com/docs/extensions/reference/manifest/key).

Cuando existan dominios HTTPS reales, generar otro ZIP para el mismo artículo, incrementando la versión en `manifest.template.json` antes de actualizarlo:

```powershell
$env:AGENCY_OS_WEB_APP_ORIGIN = 'https://app.DOMINIO_REAL'
$env:AGENCY_OS_API_ORIGIN = 'https://api.DOMINIO_REAL'
node extension/scripts/package-webstore.mjs
```

Esos dominios son marcadores; reemplazarlos por los acordados. No ejecutar `manifest:render` para este empaquetado: el comando de la tienda renderiza en su propia carpeta y deja el manifest local intacto.

## 2. Registro y borrador

1. El titular elige la cuenta Google que administrará la publicación y entra al [dashboard de desarrolladores](https://chrome.google.com/webstore/devconsole). Completa el registro, los términos y el pago único que muestre Google; no se ha realizado ninguna de estas acciones. [Registro oficial](https://developer.chrome.com/docs/webstore/register).
2. Crear un artículo y subir **el ZIP**, no un CRX. Copiar el ID asignado y su clave pública. Mantenerlo como borrador mientras se prepara la revisión.
3. Completar ficha y privacidad con el borrador de la sección siguiente. Definir titular, contacto y URL pública de privacidad antes de certificar las declaraciones.
4. Preparar una imagen promocional 440×280 y al menos una captura **real** 1280×800 o 640×400 del flujo con datos sintéticos. El icono 128×128 ya está incluido. Las capturas del error actual no acreditan el flujo corregido. [Requisitos de imágenes](https://developer.chrome.com/docs/webstore/images).
5. Preparar instrucciones de prueba reproducibles para el revisor: instalación del helper, configuración de la estación y acceso de prueba al web-app/API. `localhost` del desarrollador no es accesible desde Google. Resolver un entorno demo o un procedimiento local reproducible; no entregar credenciales de clientes. La revisión sigue pendiente hasta tener ese acceso y comprobar el recorrido.
6. Seleccionar **Unlisted / No listada** y enviar cuando la ficha y las pruebas estén completas. Esperar la aprobación y publicación antes de aplicar la política de oficina. No listada permite instalar a cualquiera que conozca el enlace; los permisos reales siguen dependiendo del backend y del dispositivo autorizado. [Distribución oficial](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## 3. Texto de ficha y datos para privacidad

**Nombre del piloto:** Agency OS - Acceso seguro a TalkyTimes BETA.

**Descripción breve:** Prepara el acceso a perfiles asignados de TalkyTimes desde Agency OS. Requiere una estación configurada.

**Descripción:** Extensión complementaria para operadores de Agency OS. Desde el web-app, abre el perfil nativo de Chrome asignado y prepara el formulario de acceso a TalkyTimes con una credencial autorizada por el backend. El operador realiza el clic de ingreso. Requiere el helper de Agency OS, una estación aprobada, configuración administrada y una asignación vigente. Esta edición BETA utiliza el web-app y el API en localhost. No ofrece una cuenta de TalkyTimes ni funciona como aplicación independiente.

**Propósito único:** preparar el acceso del operador a los perfiles de TalkyTimes asignados por Agency OS.

| Permiso / acceso | Justificación basada en el código actual |
|---|---|
| `storage` | Leer configuración y token de estación en `storage.managed`; guardar temporalmente identificadores y versión del contexto en `storage.session`. |
| `nativeMessaging` | Pedir al helper instalado que abra el perfil Chrome correspondiente. El mensaje de lanzamiento contiene identificadores y destino, no contraseña ni token de operador. |
| `https://talkytimes.com/*` | Detectar y rellenar el formulario de acceso; ocultar el control visual que revela la contraseña. |
| `http://localhost:3000/*` | Solicitar credenciales autorizadas y comunicar estado de inyección/dispositivo al API local. Cambiar esta justificación al pasar a HTTPS. |
| `externally_connectable`: localhost:5173 | Aceptar solicitudes de apertura únicamente del origen configurado del web-app. |
| Código remoto | El JavaScript de la extensión viaja en el ZIP. Las respuestas del API se usan como datos, no como código ejecutable. |

**Inventario técnico para redactar la política de privacidad** (no es todavía una política publicable):

- La extensión procesa tokens de autenticación del operador y del dispositivo, usuario/contraseña de TalkyTimes, identificadores de perfil/sesión, directorio de Chrome, versión de extensión y estado de inyección. No declarar «no se manejan datos» ni «no se manejan datos de autenticación».
- Los tokens/identificadores se envían al API de Agency OS para autorización y operación. El backend conoce la IP de origen de la petición. La credencial recibida se coloca en el formulario de TalkyTimes; la página la usa al iniciar sesión.
- La extensión no escribe la contraseña de TalkyTimes en `storage.local`, `storage.sync` o archivos. La contraseña sí está en memoria y en el campo del formulario. El token de dispositivo persiste en la política de Windows; el contexto de sesión temporal no contiene la contraseña. No prometer que la contraseña sea inaccesible mediante herramientas técnicas.
- El código actual no recoge conversaciones, historial general de navegación, pagos ni datos para publicidad. El backend conserva sus propios datos de vault y operación: documentar su tratamiento y retención por separado, sin afirmar que todo desaparece al cerrar Chrome.
- Antes de publicar, el titular debe concretar responsable y contacto, destinatarios/proveedores, conservación y mecanismo de solicitud de eliminación; confirmar las declaraciones sobre uso limitado conforme a la operación real. Publicar la política en una URL accesible sin login y enlazarla desde la ficha. [Campos de privacidad de la tienda](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## 4. Instalación en una estación de prueba

Usar el **ID del artículo publicado**, nunca uno inventado. Empezar en una estación dedicada. La política HKLM afecta a los perfiles de Chrome de esa máquina; no ejecutar el ensayo en el Chrome personal de desarrollo. No modificar `Preferences` ni copiar carpetas de extensión.

Preparar el helper en una ruta estable y un token de estación vigente mediante el enrolamiento descrito en `local-helper/README.md`. Ejecutar Native Messaging bajo el mismo usuario Windows que utilizará Chrome. Desde la raíz del repo, en PowerShell elevada:

```powershell
$StoreExtensionId = 'PEGAR_ID_REAL_DE_LA_TIENDA'

# Usar el helper ya compilado y copiado a esta ruta estable.
.\local-helper\scripts\install-native-host.ps1 `
  -ExtensionId $StoreExtensionId `
  -HelperPath 'C:\Program Files\Agency OS\agency-os-helper.exe'

.\extension\scripts\install-managed-policy.ps1 `
  -ExtensionId $StoreExtensionId `
  -ApiBaseUrl 'http://localhost:3000/api/v1' `
  -WebAppOrigin 'http://localhost:5173' `
  -DeviceTokenFile 'C:\ProgramData\AgencyOS\device-token.txt'

# Vista previa; no instala nada.
.\extension\scripts\install-webstore-policy.ps1 -ExtensionId $StoreExtensionId -WhatIf

# Aplicar después de comprobar el ID publicado y la vista previa.
.\extension\scripts\install-webstore-policy.ps1 -ExtensionId $StoreExtensionId
```

El nuevo script escribe únicamente `ExtensionInstallForcelist\1001` con el ID y `https://clients2.google.com/service/update2/crx`, la [URL oficial para extensiones de la tienda](https://support.google.com/chrome/a/answer/7532015?hl=en). Si 1001 corresponde a otra extensión, falla antes de escribir: elegir `-ValueName` libre y registrar el número. No elimina otras políticas. Si la entrada es del mismo ID, puede reemplazar una URL anterior y es repetible.

Configurar también `VITE_EXTENSION_ID` con el mismo ID en el entorno que inicia/compila `web-app`; reiniciar Vite o reconstruir el frontend. Política administrada, `allowed_origins` del helper y web-app deben coincidir con la extensión visible en Chrome.

En la estación del piloto, retirar la copia descomprimida antigua y **solo** su entrada de instalación heredada tras verificar el reemplazo y guardar los datos necesarios para volver atrás. Mantener perfiles y cookies. No ejecutar los scripts antiguos `package:crx`, `empaquetar_y_probar_forcelist.py` ni `deploy/station-e2e/station/install.ps1` para este piloto: esos ensayos usan distribución privada y podrían volver a configurar otro origen. La migración de ese bundle de laboratorio se hará si se reutiliza con los dominios HTTPS definitivos.

## 5. Aceptación y límites

- `chrome://policy`: `ExtensionInstallForcelist` sin errores, URL de Google y configuración administrada presente; no capturar ni compartir el valor de `deviceToken`.
- `chrome://extensions`: mismo ID y versión publicados, habilitada por política en el perfil del web-app, un perfil destino existente y uno recién creado. Esperar a que Chrome termine de instalar antes de abrir la sesión; registrar también tiempo de instalación inicial.
- Verificar `chrome://version` → Ruta del perfil y abrir Luna y Mar desde el web-app. Comprobar formulario, cuenta correcta y ausencia de solicitudes/secretos cruzados. Usar datos ficticios sin enviar el login a TalkyTimes; el ensayo de acceso real requiere una cuenta de prueba autorizada para el clic manual.
- Repetir tras cerrar/reabrir Chrome y reiniciar Windows; verificar que una actualización publicada llega al mismo ID. Solo entonces extender al resto de estaciones.
- Si falla, conservar los errores de política e ID/versión/ruta del perfil. No borrar perfiles. Para retirar la instalación forzada, eliminar únicamente el valor registrado si todavía contiene exactamente el ID y URL instalados; Chrome puede desinstalar la extensión al retirar la política, por lo que debe hacerse fuera del turno.

**Validación realizada en desarrollo:** generación y apertura real del ZIP con .NET, lista cerrada de archivos, hash, dimensiones PNG, manifest local intacto, validación de orígenes y simulación de registro para comprobar colisiones y `-WhatIf`. No se escribió ninguna política real en esta entrega.

**Pendientes:** registro, ficha/privacidad/capturas, acceso de revisión, aprobación de Google, instalación real en estación y pruebas anteriores. La distribución resuelve cómo instalar la extensión; los estados de login, el plazo de credencial y los perfiles demo sin credenciales siguen siendo tareas independientes de `tasks/inicio-turno-plan.md`.
