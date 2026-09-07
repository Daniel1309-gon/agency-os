# Plan: inicio de turno y apertura fiable de perfiles

Fecha: 2026-09-07. Estado: distribución por Chrome Web Store no listada + instalación forzada elegida por el usuario. Paquete local y script de política preparados; registro, publicación y piloto real pendientes. Resto del plan sin implementar. Procedimiento: [CHROME-WEB-STORE.md](../extension/CHROME-WEB-STORE.md).

## Resultado buscado

El operador entra a Agency OS, pulsa **Abrir mis perfiles** y ve el resultado de cada cuenta. Si TalkyTimes exige autenticación, recibe el formulario rellenado y realiza el clic de ingreso acordado. Si ya existe una sesión válida de la cuenta correcta, continúa con ella. Un fallo identifica el perfil y ofrece recuperación; nunca se presenta una ventana abierta como un ingreso exitoso.

Se conserva Chrome estable, perfiles nativos aislados, extensión y helper Go. No se añaden navegadores automatizados, servicios de CAPTCHA, archivos de contraseñas ni llamadas a la API interna de TalkyTimes. La disponibilidad de TalkyTimes sigue siendo externa: el objetivo verificable es recuperación y diagnóstico, además de apertura correcta en condiciones normales.

## 1. Evidencia y límites del diagnóstico

Comprobaciones locales realizadas en esta conversación el 7 de septiembre:

| Hallazgo | Qué significa |
|---|---|
| Luna recibió la credencial; Mar no hizo solicitudes al vault en los intentos de hoy | Hay que localizar el fallo de Mar antes de la entrega del secreto; no atribuirlo todavía al vault. |
| Luna y Mar tienen credenciales; Sol, Nube, Alma y Vera no | La prueba completa requiere cargar datos sintéticos en esas cuatro cuentas demo. No sustituir credenciales reales. |
| Las preferencias guardadas tienen entradas de la extensión en Profile 1–6; el usuario informa que no aparece en algunas ventanas | La entrada en disco no demuestra ejecución. Falta comparar `chrome://version` y `chrome://extensions` en una ventana afectada. |
| HKCU tiene una política hacia `http://localhost:8765/update.xml`; el servidor rechaza conexiones | La distribución automática de prueba no está operativa. No demuestra que haya eliminado las copias manuales. |
| El XML local anuncia 0.1.0 y el manifest fuente 1.0.0 | Tampoco basta con encender el servidor viejo: hay que generar y verificar un paquete coherente. |
| No se detectó unión AD ni los indicadores de administración Chrome consultados | La elegibilidad para instalación privada debe comprobarse en la estación; esa inspección no fue una certificación completa de enrolamiento. |

Problemas comprobados en el código:

- `web-app/src/components/OperatorProfiles/OperatorProfiles.tsx`: anuncia éxito después de `sendToExtension`, que confirma lanzamiento del helper. No espera confirmación del perfil destino. **Continuar** vuelve a construir una URL de login con el mismo identificador de sesión.
- `extension/chrome-extension/background.js`: transforma `credentialInjectionComplete` en `ACTIVE`, aunque aún falta el clic y la respuesta de TalkyTimes. Elimina el contexto después; solo hace heartbeat del dispositivo al abrir, no heartbeat periódico de la sesión.
- `extension/chrome-extension/content.js`: silencia las excepciones. No confirma la autenticación ni comprueba la identidad visible de una sesión existente.
- `backend/src/modules/vault/vault.drizzle-repository.ts`: el handoff exige `LAUNCHING` y antigüedad menor de 60 segundos desde la preparación. Abrir Chrome y esperar al formulario consumen esa ventana.
- `backend/src/modules/jobs/jobs.service.ts`: cierra `LAUNCHING` después de 120 segundos y marca `ACTIVE` como `STALE` tras 120 segundos sin heartbeat. Hay dos plazos distintos que hoy no se explican al operador.
- `local-helper/internal/launcher/launcher.go`: abrir Chrome no instala la extensión. El cierre depende de un mapa en memoria de procesos; con `sendNativeMessage`, cada mensaje crea un host nuevo. Ese mecanismo no acredita el cierre de un perfil en el relevo. [Comportamiento de Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## 2. Opciones de distribución

| Opción | Uso propuesto | Coste o condición operativa |
|---|---|---|
| **Chrome Web Store no listada + instalación forzada por política** | Recomendación por defecto: Google distribuye y actualiza el paquete; el instalador de la estación aplica la política y el token del dispositivo. | Requiere cuenta de publicación, revisión y configuración por estación. El tiempo de revisión no se puede prometer. |
| **Chrome Enterprise Core + CRX privado en HTTPS** | Alternativa si la agencia necesita distribución fuera de la tienda; reutiliza el empaquetador del repo. | Enrolar los navegadores y mantener paquete, firma, XML y servidor. Verificar instalación real en Windows antes de adoptarla. |
| **Carga manual desde carpeta fija** | Puente para desarrollar y reproducir el problema en una PC de prueba. | Instalación por perfil, sin reparación central automática. No es criterio de aceptación de despliegue en oficina. |

La visibilidad **no listada** permite instalar a cualquiera que conozca el enlace; no equivale a privada. El acceso a los perfiles lo controla el backend con estación, operador, turno y asignación. Todas las modalidades de visibilidad pasan revisión. [Distribución en Chrome Web Store](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

La política permite forzar instalación y evita desinstalar/deshabilitar desde la interfaz normal. Para extensiones fuera de la tienda en Windows exige AD, Azure AD o Chrome Enterprise Core. No basta con escribir el registro ni instalar el MSI de Chrome. [Política oficial](https://chromeenterprise.google/policies/extension-install-forcelist/).

Chrome Enterprise Core ofrece gestión central sin coste de licencia de Core. Se puede añadir a la opción de tienda para administrar todas las PCs; no requiere cambiar el navegador. [Producto y enrolamiento](https://chromeenterprise.google/products/chrome-enterprise-core/).

No recomiendo migrar ahora a Selenium/Playwright/Electron: reabre el cambio de arquitectura descartado y no corrige los estados, plazos ni credenciales ausentes. Reutilizar cookies válidas sí reduce logins, pero es una mejora del mismo flujo, no un sustituto de instalación y autorización. No copiar cookies entre perfiles o PCs.

## 3. Flujo propuesto

1. **Comprobación de estación.** El web-app verifica su extensión, versión compatible, configuración administrada, helper y API. El backend valida operador, turno, asignaciones y disponibilidad de credenciales sin devolverlas. Antes del turno se permite comprobar instalación y conectividad; no emitir credenciales ni habilitar trabajo fuera de horario.
2. **Preparación por perfil.** Al pulsar Abrir mis perfiles se procesa una cola con concurrencia inicial 1. Cada intento se crea justo antes de lanzar ese perfil. El siguiente puede comenzar cuando el anterior quede listo para el clic; no necesita esperar al login humano. Si hay un fallo, se registra y se continúa con los otros perfiles autorizados.
3. **Confirmación del destino.** Abrir primero una página mínima del dominio de Agency OS en el perfil destino. Esa página consulta la extensión por el mecanismo `externally_connectable` ya usado por el producto y muestra una instrucción concreta si no responde. El background confirma la preparación al backend con el token de estación. No se exige iniciar sesión en Agency OS dentro de cada perfil de TalkyTimes. [Mensajes desde páginas](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
4. **Entrada en TalkyTimes.** Solo después de esa confirmación se navega a la página prevista. La credencial se solicita cuando el formulario correcto está disponible. El grant continúa siendo de un uso y máximo 60 segundos. El plazo de arranque del navegador y el de entrega del secreto se gestionan por separado.
5. **Confirmación del ingreso.** Rellenar deja el estado **Esperando tu clic**. Pasar a **Sesión activa** exige una señal DOM de autenticación y correspondencia con la cuenta esperada, verificadas en el spike real. Si no existe una señal fiable, mostrar **Ingreso sin confirmar**; no inventar un indicador ni leer la API interna.
6. **Continuidad y relevo.** Heartbeat de sesión, cierre de pestañas de trabajo al terminar autorización y recuperación después de caída o reinicio. Las cookies existentes solo se aprovechan después de validar la nueva asignación y la identidad de la cuenta.

La página de preparación necesita una ampliación pequeña de la allowlist de URLs del helper: únicamente el origen de Agency OS provisionado y una ruta exacta. Nunca aceptar una URL arbitraria enviada por una página web. El mensaje nativo sigue sin JWT ni credenciales.

## 4. Contratos e invariantes que deben quedar cerrados antes de implementar

- Correlacionar los pasos por intento y perfil. El backend vincula el intento al operador, asignación y dispositivo aprobado **antes** de aceptar el destino. Un UUID en la URL no autentica al llamante ni demuestra la carpeta real de Chrome; siempre exigir token de estación y comprobar el mapeo en la instalación.
- Proponer `AWAITING_LOGIN` entre `LAUNCHING` y `ACTIVE`. Cambiar juntos schemas, transiciones, consultas de sesiones vivas, índice único, jobs y UI. No permitir dos sesiones ocupando el mismo perfil durante la espera humana.
- Mantener el grant de 60 segundos. Propuesta inicial: arranque 120 segundos y espera del clic 5 minutos, ambos acotados por el fin de asignación; son parámetros de piloto, no cifras medidas. La autorización para el handoff debe empezar tras la confirmación válida del destino y quedar limitada por el plazo de arranque. No ampliar ni reabrir una autorización indefinidamente.
- La preparación de un mismo intento es idempotente. Repetir un canje no debe devolver nuevamente el secreto. Si se pierde su respuesta, cerrar ese intento y obtener autorización nueva; nunca reusar un grant consumido ni crear otra sesión sobre una todavía activa.
- Error público limitado a códigos conocidos: extensión sin respuesta, configuración incompleta, helper ausente, credencial no disponible, formulario incompatible, expiración, red y login no confirmado. No reenviar cuerpos arbitrarios del API, tokens, contraseñas ni contenido de conversaciones.
- Heartbeat inicial cada 30 segundos usando `chrome.alarms`; conservar únicamente identificadores y versión en `storage.session`, restaurar alarmas y reconciliar con backend tras reinicios. Ajustar CAS y plazos existentes sin permitir revivir sesiones cerradas. Las alarmas no son un reloj exacto ni sobreviven garantizadamente a todo reinicio. [Alarmas](https://developer.chrome.com/docs/extensions/reference/api/alarms), [ciclo de vida](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- Al límite del turno, la autorización termina por hora del servidor, sin esperar al barrido periódico. El cierre local debe actuar sobre las pestañas/ventanas de TalkyTimes identificadas por la extensión de ese perfil. No usar `taskkill` sobre un proceso compartido ni confundir cerrar una fila en BD con cerrar TalkyTimes. Probar el caso de pérdida de red y un heartbeat atrasado.
- Reutilizar endpoints, Redis, auditoría y publicación de cambios existentes. En el panel de apertura basta refrescar los perfiles mientras haya intentos pendientes; no crear otro servicio de tiempo real para esta corrección.

## 5. Secuencia de implementación

Cada tarea incluye implementación y una comprobación específica que falle ante la regresión. Dividir en otro cambio cuando exceda cinco archivos; no mezclar entrega de infraestructura con cambios del vault.

### T1. Reproducir Luna y Mar en la misma estación — alcance pequeño, sin código productivo

Dependencias: acceso a las ventanas afectadas. Comparar ruta exacta de `chrome://version`, extensión visible/ID/versión/permisos, política efectiva y errores sanitizados. Registrar el primer paso que no ocurre. Abrir de nuevo una sesión vigente, no reciclar una URL de prueba vencida.

Aceptación: evidencia del perfil real y del fallo; Luna y Mar con credenciales existentes; ninguna conclusión basada solo en Preferences. Verificación: observación de UI y auditoría correlacionada. Archivo: evidencia sanitizada bajo `tasks/evidence/station/`.

### T2. Verificar distribución en una estación dedicada — alcance mediano

Dependencias: T1 y elección del canal. Publicar/preparar un único artefacto con ID y versión coherentes; verificar el ID real de la tienda antes de actualizar web-app, política y Native Messaging. Reemplazar la política antigua solo después de tener sustitución comprobable, preservando el resto de extensiones. Instalar el helper en ruta fija de la estación, fuera del checkout de desarrollo. No aplicar cambios de administración al PC personal para simular la oficina.

Crear y verificar los perfiles de trabajo antes del primer turno, con un mapeo explícito cuenta → carpeta en cada estación. En operación se reutilizan esas carpetas; cambiar de operador no crea otra carpeta ni copia extensiones/cookies. Un perfil nuevo debe pasar la misma verificación antes de asignarse.

Aceptación: un perfil nuevo recibe la extensión sin carga manual, mantiene la instalación tras reinicio y actualiza en el piloto. Verificación: Chrome estable real y versión efectiva. Áreas: `deploy/station-e2e/station/`, scripts de empaquetado y manifest; partir la publicación y el instalador en cambios separados si es necesario.

### T3. Detectar faltantes antes de lanzar — alcance mediano

Dependencias: T1. Añadir una consulta de salud limitada a la extensión de control/helper; en backend comprobar existencia de credencial y devolver un motivo seguro. Completar las cuatro cuentas sintéticas faltantes mediante el flujo administrativo existente, sin añadir secretos al plan ni al repositorio.

Aceptación: helper ausente, token revocado y credencial inexistente se muestran antes de anunciar preparación; la comprobación no descifra ni retorna la contraseña. Verificación: prueba de salud negativa y prueba backend de preparación. Áreas: contratos/mensajes, background, servicio de preparación y pruebas; separar UI si supera cinco archivos.

**Checkpoint 1:** una estación y un perfil nuevo se aprovisionan correctamente; Luna y Mar abren mediante intentos nuevos; los faltantes tienen diagnóstico visible.

### T4. Alinear estados y plazos en backend — alcance mediano por cambio

Dependencias: T3. Primero contratos e índice de sesión viva; después servicio/jobs y sus pruebas; por último, autorización de handoff ligada a estación y confirmación del destino. Mantener la invariancia de un solo canje.

Aceptación: esperar Chrome no consume prematuramente el grant; espera humana tiene su propio límite; doble clic/replay/otra estación no obtienen dos credenciales ni ocupan dos sesiones. Verificación: tests de assignments/vault/jobs y test de integración del índice/CAS con PostgreSQL y Redis. Áreas: shared, schema/migración, assignments, vault y jobs, en cambios separados de hasta cinco archivos.

### T5. Confirmar la extensión del perfil destino — alcance mediano

Dependencias: T2 y T4. Página de preparación, allowlist estricta del helper y confirmación de background. Fallo o expiración dejan una instrucción visible en el perfil y estado recuperable en el panel. No instalar extensiones automáticamente desde esa página.

Aceptación: destino sin extensión no se anuncia listo; una confirmación cruzada o fuera de plazo se rechaza. Verificación: perfil con extensión y perfil nuevo aún sin ella en Chrome real; test negativo de URL/mensajes. Áreas: página de preparación, background, helper/messages y sus pruebas.

### T6. Distinguir formulario listo de login confirmado — alcance mediano

Dependencias: T4 y T5. Validar selectores de formulario y señal de cuenta autenticada; emitir estados sin secretos; conservar contexto no sensible para seguimiento. Si TalkyTimes cambia el DOM, detener ese intento con motivo visible.

Aceptación: rellenar no produce ACTIVE; fallo de login no se oculta; una cookie de otra cuenta nunca se considera ingreso correcto. Verificación: fixture DOM, prueba de content script y ensayo real con cuenta autorizada para login. Áreas: content, background, pruebas y panel.

### T7. Mantener y cerrar la sesión de trabajo — alcance mediano por cambio

Dependencias: T6. Primero heartbeat recuperable y CAS; después cierre local y relevo sin depender del mapa de procesos del helper. Incorporar la nueva fase de espera a los vencimientos.

Aceptación: una sesión no caduca estando el perfil sano; reiniciar el worker no pierde el seguimiento; el saliente pierde autorización y sus pestañas de trabajo se cierran al relevo, sin afectar otros perfiles. Verificación: más de 10 minutos de actividad, suspensión/reanudación, pérdida de red y relevo de prueba a la hora exacta. Áreas: extensión/manifest, station sessions y jobs; cambios separados.

**Checkpoint 2:** un perfil recorre preparación → clic pendiente → ingreso confirmado → heartbeat → cierre; expiración y reintento no dejan un falso ACTIVE ni una reserva bloqueada.

### T8. Abrir todos y reintentar solo fallidos — alcance mediano

Dependencias: T5–T7. Cola simple en el panel, progreso por perfil y botón Reintentar para intentos cerrados o fallidos. Continuar consulta sesión e identidad antes de decidir navegar al login. El estado proviene del backend; refrescar mientras haya aperturas pendientes y al volver a la página.

Aceptación: seis perfiles se preparan sin duplicados; uno fallido no relanza los otros; refrescar el web-app conserva el resultado. Verificación: prueba del flujo de cola/errores y ensayo de seis perfiles. Áreas: `OperatorProfiles`, consulta de perfiles y pruebas existentes.

### T9. Piloto de turno y despliegue gradual — operación

Dependencias: T8. Probar primero una estación, luego una cuadrilla. Mantener un artefacto anterior conocido y un procedimiento de recuperación; para volver a una compilación anterior vía tienda puede ser necesario publicarla con número de versión superior. No prometer rollback instantáneo de la tienda.

Aceptación propuesta: 20 rondas consecutivas con seis perfiles sin falsos éxitos, sin copiar credenciales ni recargar extensiones manualmente; después ocho perfiles con tiempos/RAM/CPU registrados. Incluir arranque frío, Chrome ya abierto, actualización de extensión, pestaña con sesión previa, credencial faltante, API caída, token revocado y relevo.

La prueba de inyección usa cuentas sintéticas sin enviar login a TalkyTimes. Confirmar autenticación real requiere una cuenta de prueba autorizada y clic humano; separar sus resultados en la evidencia. Registrar tiempos p50/p95 de preparación y tasa de recuperación; fijar objetivos de tiempo después de medir el hardware.

## 6. Estimación y decisiones pendientes

Estimación preliminar de ingeniería, no compromiso comercial: diagnóstico/piloto de instalación 0,5–1 día; canal de distribución e instalador 1–2 días; correcciones de estados, apertura, heartbeat y recuperación 3–5 días; piloto 1–2 días. Total orientativo 6–10 días laborables. Excluye revisión de tienda y espera de estación/cuentas. Se ajusta después de T1 y de verificar la señal DOM de autenticación y el cierre local.

Decisiones para ejecutar: canal de distribución; PC de prueba dedicada; cuenta autorizada para comprobar login real. La ruta exacta de la ventana afectada sigue pendiente para el diagnóstico de desaparición, pero no bloquea diseñar los demás cambios. No es necesario sustituir el stack ni cambiar alcance/precio acordados para redactar esta propuesta.

Este archivo es el plan de la corrección. Las decisiones propuestas aún no reemplazan `agents.md` ni los documentos comerciales. Al implementar, actualizar los documentos que hoy describen el spike o el estado antiguo como si fueran la versión vigente.
