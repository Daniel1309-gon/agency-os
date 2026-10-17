# Persistencia de Agency OS en Profile 2

Resultado: el usuario confirmó que la extensión permanece después de salir completamente de Chrome y reabrir Profile 2, tras cargar una copia idéntica desde una ruta nueva.

## Reproducción y causa

- Perfil: `C:/Users/danig/AppData/Local/Google/Chrome/User Data/Profile 2`.
- La carga manual desde `extension/chrome-extension` sobrevivía al cierre de una ventana, pero desaparecía de `chrome://extensions` y `chrome://extensions-internals` tras reiniciar Chrome completamente.
- `Secure Preferences` conservaba dos IDs para la misma ruta: `kepgdblopolklgkgmbkkcgilmdknedlo` (histórico) y `fcniigapdfcoigmnkhkcgmhlhjdledbo` (actual). El modo desarrollador permanecía activo.
- El commit `42186cf` añadió la clave pública al manifest para estabilizar el ID. El registro histórico permaneció apuntando a la carpeta cuyo manifest ya producía el ID nuevo.
- El log de arranque registró un error de carga de esa carpeta sin descripción adicional. No se observó una eliminación del registro en disco.
- El cargador actual de Chromium compara el ID del manifest con el guardado y añade la ruta a `invalid_extensions_` si no coinciden. Después omite las instalaciones cuya ruta está en ese conjunto. Esto explica que el registro antiguo bloquee también el actual en esa misma carpeta. Fuente: [InstalledLoader](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/installed_loader.cc), `LoadAllExtensions` y `Load`. Se consultó la rama principal; no se obtuvo el archivo de la etiqueta exacta del binario local.

## Corrección comprobada

Se copiaron exclusivamente `manifest.json`, `background.js`, `content.js` y `managed_schema.json` a `.local/extension-stable`. Se comprobaron los hashes de cada archivo contra el origen. Se conservó el ID actual y no se editaron las preferencias de Chrome.

El usuario cargó esa carpeta manualmente en Profile 2 y confirmó persistencia después del reinicio completo. La nueva instalación evita la ruta invalidada por el registro histórico. No se ha limpiado el registro antiguo: la ruta original no debe reutilizarse para esta instalación mientras persista el conflicto.

La copia es un artefacto local de diagnóstico y no se sincroniza automáticamente con el código fuente. Si se actualiza para próximas pruebas, conservar su ruta y la clave pública del manifest; actualizar los archivos deliberadamente. No eliminar `.local/extension-stable` mientras el perfil la utilice.

## Alcance y límites

Queda comprobada la persistencia manual en Profile 2 para este ciclo de reinicio. No se han reparado ni verificado los demás perfiles. No se modificaron políticas ni se instaló Chrome Enterprise.

Este fallo no es evidencia de detección por TalkyTimes. La corrección tampoco valida login real, backend, Native Messaging, aislamiento de ocho perfiles ni tolerancia de TalkyTimes.

Se abrió Chrome con logging temporal para diagnosticar el arranque. El siguiente inicio normal no incorpora esos argumentos. El log completo quedó en el directorio de datos de Chrome; no se copió al repositorio porque puede contener datos ajenos al incidente.

## Revisión posterior de los demás perfiles

Inventario de solo lectura solicitado por el usuario, realizado después de la corrección de Profile 2:

| Perfil | Registros de Agency OS | Resultado de inspección |
|---|---|---|
| Profile 1 y Profile 4 | ID antiguo y actual en `extension/chrome-extension` | Mismo conflicto de ruta que causaba la desaparición en Profile 2; pendientes de corregir |
| Profile 2 | Actual en `.local/extension-stable`; antiguo en la ruta original | Rutas separadas; persistencia confirmada por el usuario |
| Profile 3, 5, 6, 10 y 11 | Solo ID actual en la ruta original | No presentan este conflicto en sus registros; no se probó su arranque |
| Default | Sin registros de los dos IDs | Agency OS no figura registrada |
| Prueba `operador_1/Default` | Solo ID antiguo apuntando al manifest actual | Incompatibilidad entre ID registrado y manifest; pendiente de corregir |
| Dos pruebas `forcelist_test_*/Default` y `spike_devtools/Default` | Sin registros de los dos IDs | Agency OS no figura registrada |

Todas las carpetas referenciadas por los registros encontrados existen. La inspección no instaló, retiró ni modificó extensiones. Ausencia de conflicto en disco no equivale a carga funcional ni a login validado.
