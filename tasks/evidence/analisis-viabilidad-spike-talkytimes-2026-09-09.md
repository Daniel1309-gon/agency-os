# Viabilidad del acceso asistido a TalkyTimes

Actualización posterior: la desaparición en Profile 2 se reprodujo y se corrigió cargando una copia idéntica desde una ruta nueva. Dos IDs históricos compartían carpeta y el registro antiguo invalidaba esa ruta durante el arranque. El usuario confirmó persistencia tras reiniciar Chrome completamente. Véase [evidencia del diagnóstico y corrección](extension-persistence-profile-2-2026-09-09.md). Las referencias siguientes a la causa desconocida describen el estado del análisis inicial; la viabilidad del login real sigue pendiente.

La evidencia permite recomendar una última validación acotada del acceso asistido. No permite declarar el spike viable, ni concluir que Chrome hace imposible la solución. La distribución tiene alternativas oficiales; la tolerancia de TalkyTimes y la operación real de ocho perfiles siguen sin demostrarse. El estado correcto es **viabilidad no demostrada, con defectos subsanables en el ensayo**.

Este análisis corresponde al código disponible el 9 de septiembre de 2026. No certifica una instalación en la oficina ni un login real. La desaparición reportada no se reprodujo y su causa exacta permanece abierta. No se modificaron políticas, perfiles, credenciales ni código funcional.

## Distribución y Chrome Enterprise

La política oficial actual de Chromium establece que, en Windows, forzar extensiones ajenas a Chrome Web Store requiere unión a Active Directory, Azure Active Directory o inscripción en Chrome Enterprise Core. Elevar PowerShell y escribir HKLM no satisface por sí solo ese requisito. La documentación anterior del proyecto omitió esta condición. [1]

Chrome Enterprise Core ofrece administración sin costo adicional y permite inscribir navegadores existentes. No hace falta asumir una compra de Chrome Enterprise Premium. La inscripción y administración sí requieren trabajo operativo y una organización responsable; descargar un instalador empresarial no equivale a inscribir el navegador. [2]

| Vía | Aplicación al proyecto | Condición pendiente |
|---|---|---|
| Core + CRX propio por HTTPS | Primera opción para probar el paquete actual en una PC de oficina | Inscripción efectiva, política válida, descarga, persistencia y actualización verificadas |
| Chrome Web Store no listado + política de instalación | Alternativa oficial que evita la condición específica del CRX externo | Cuenta de publicación, revisión y configuración de estación |
| Web Store privado para testers | Útil para una prueba limitada | Cuentas Google autorizadas y revisión |
| Carga descomprimida | Diagnóstico local | Carpeta estable, perfil correcto y políticas compatibles; no constituye despliegue productivo |

Una extensión no listada puede instalarla cualquiera que conozca el enlace: eso no reemplaza la autenticación del backend. Todas las opciones de visibilidad pasan por revisión. La publicación privada de dominio es otra modalidad y tiene requisitos propios; no debe confundirse con una publicación no listada. [3][4]

Cambiar a otro navegador o Chrome for Testing no sería la primera inversión: agrega una nueva validación de distribución y compatibilidad sin demostrar aceptación por TalkyTimes. Tampoco se recomienda recuperar flags retirados o mantener versiones antiguas de Chrome.

## Carga descomprimida y desaparición

Google sigue documentando la carga descomprimida desde el modo de desarrollador de `chrome://extensions`. No presenta el Modo Desarrollador de Windows como requisito de ese procedimiento. La atribución histórica del bloqueo a Windows o Defender no está demostrada por el mensaje genérico de error. [5]

Google retiró `--load-extension` de las compilaciones oficiales desde Chrome 137. Eso explica que un lanzador con ese flag deje de cargar la extensión; no demuestra por sí mismo por qué una extensión cargada manualmente desaparece al reabrir el mismo perfil. [6]

En el repositorio conviven dos lanzadores diferentes: `extension/lanzar_perfil_con_extension.py` crea un `user-data-dir` separado en el repositorio; `extension/lanzar_perfil_nativo.py` usa el directorio predeterminado y selecciona `--profile-directory`. El helper Go también selecciona perfiles nativos. Por tanto, el mismo nombre visible no basta para demostrar que se reabrió la misma carpeta.

La próxima reproducción debe registrar, antes y después de cerrar:

1. Ruta de perfil y versión desde `chrome://version`, usuario Windows y método de lanzamiento.
2. ID, ruta de carga, estado y error de la extensión en `chrome://extensions`.
3. Estado, origen y conflictos de políticas en `chrome://policy`, sin copiar tokens.
4. Existencia de la carpeta de origen; distinguir extensión eliminada, deshabilitada y presente pero inoperante.

Hipótesis pendientes: perfil distinto, origen movido o eliminado, política incompatible, perfil efímero o acción de protección con evidencia concreta. Una extensión antes forzada también puede desinstalarse al retirarla de la política; eso está documentado, pero no se ha demostrado en este incidente. [1]

## Defectos encontrados en el ensayo y código

| Evidencia local | Consecuencia |
|---|---|
| `deploy/station-e2e/station/preflight.ps1` comprueba Windows, elevación, archivos y conectividad, pero no elegibilidad para CRX externo | Puede declarar preflight correcto en una estación que no puede aceptar ese despliegue |
| `extension/empaquetar_y_probar_forcelist.py` ejecuta un servidor en hilo daemon y termina tras `time.sleep(3)` | La fuente de descarga desaparece muy pronto; genera una carrera con Chrome y no sirve para validar actualizaciones |
| Ese servidor publica todo `extension/`, donde también se ubica la PEM | El servidor del ensayo no debe reutilizarse; servir solo artefactos públicos |
| `manifest.template.json` y el empaquetador gestionado no añaden `update_url` | La URL de instalación inicial de Forcelist no establece por sí sola el canal de actualizaciones posteriores; hay que declararlo o configurar el override oficial [1][7] |
| El manifest de desarrollo apunta a localhost; el empaquetador genera orígenes `.test` | Cargar cualquier carpeta descomprimida no prueba el mismo artefacto ni los mismos orígenes |
| `background.js`, `managedConfiguration()` exige política de estación | La extensión instalada puede no funcionar si falta configuración; esto es independiente de su distribución |
| `content.js` exige `agencyProfile` y `agencySession` en la URL | Abrir TalkyTimes directamente no inicia el flujo actual de credenciales |
| `content.js` absorbe errores de inyección sin señal visible | Una falla de configuración o de API puede parecer inactividad; se necesita diagnóstico sanitizado por etapa |
| `background.js`, `finishCredentialInjection()` marca ACTIVE al terminar el relleno | Ese estado no acredita login exitoso; el clic humano todavía puede no haber ocurrido |

La revisión también encontró una limitación de cierre: `Launcher.Close` conserva PIDs en memoria del helper, mientras `sendNativeMessage` inicia un proceso nuevo por llamada. Ese mapa no proporciona propiedad persistente entre llamadas. Además, el PID de lanzamiento no demuestra propiedad exclusiva de una ventana de Chrome. Debe validarse cierre y relevo sin afectar perfiles vecinos; no vender revocación del backend como cierre automático de la sesión de TalkyTimes. [8]

Los hallazgos son lectura de código, no reproducción de todos los fallos. Ninguno demuestra por sí solo rechazo antibot de TalkyTimes.

## Detección y seguridad

La promesa de «indetectable» no es defendible. El content script modifica el DOM y genera eventos con `dispatchEvent`; dichos eventos tienen `isTrusted=false`. El clic humano posterior no cambia esa propiedad de los eventos anteriores. Esto constituye una diferencia observable, no prueba de que TalkyTimes la utilice para bloquear. [9]

No se obtuvo documentación pública suficiente de TalkyTimes para afirmar autorización de esta integración o sus reglas de detección. La página pública accesible no aportó esas condiciones. La autorización de la agencia sobre sus cuentas tampoco equivale automáticamente a autorización de la plataforma.

El criterio de aceptación debe ser acceso asistido compatible, con formulario y captcha reales y clic humano, sin bloqueos observados en condiciones registradas. Un ensayo aprobado reduce incertidumbre; no garantiza ausencia futura de restricciones. Conviene confirmar con soporte de TalkyTimes si admite herramientas de autofill para las cuentas de la agencia. No se enviaron mensajes a terceros.

Ocultar el ojo evita exposición rutinaria, pero la contraseña sigue en el DOM. El vault protege el secreto en servidor y limita su entrega; no hace imposible extraerlo en un dispositivo controlado por un operador técnico. Este riesgo ya estaba aceptado en `agents.md`, y debe mantenerse explícito en la aceptación comercial. También debe comprobarse que el navegador no ofrezca guardar la contraseña.

FR-11/FR-12, monitor de conversaciones y FR-39 requieren decisiones separadas. Que funcione un login asistido no valida automatización de likes, visitas o control de mensajes. No es necesario descartar todos los módulos por un fallo de instalación, ni aprobarlos todos por un login exitoso.

## Último intento propuesto

Se recomienda un máximo de **dos jornadas de ingeniería** para instalación, diagnóstico y flujo básico, más **tres a cinco días de observación operativa** si supera esa primera fase. Son límites propuestos, no una estimación garantizada ni una extensión ya acordada. Los tiempos externos de inscripción o revisión deben tener fecha de decisión propia para no convertir la espera en un spike indefinido.

Primero, una PC de prueba de oficina, usuario Windows dedicado y Chrome estable actualizado. Elegir Core con CRX propio, por ser lo más cercano al paquete existente. Completar la inscripción antes de ejecutar el ensayo y corregir solamente los defectos de distribución y diagnóstico que bloquean la prueba.

La primera puerta exige instalación automática, reinicio de Chrome y Windows sin pérdida, creación de un perfil nuevo con extensión y una actualización de versión comprobada. Si no puede conseguirse dentro del límite, cerrar como despliegue no validado bajo las condiciones disponibles. No atribuir ese resultado a TalkyTimes.

La segunda puerta exige recorrido completo web-app → helper → perfil correcto → API → relleno → clic humano → sesión autenticada comprobada, con cuenta de prueba autorizada. Empezar con un perfil, después dos y por último ocho. Registrar incidencias, tiempos y consumo real; detener la prueba ante restricciones de cuenta, sin insistir para sortearlas.

La tercera puerta exige aislamiento, un relevo real, comportamiento de cierre/reapertura, fallo de API, revocación y recuperación. El estado visual de Agency OS debe representar lo que se comprobó. Con una cookie de TalkyTimes todavía válida, retirar permisos en Agency OS no acredita por sí solo expulsión de TalkyTimes.

Solo si las tres puertas pasan corresponde proponer aceptación del alcance probado. El número de ciclos y el periodo observado deben aparecer en el acta; no presentar unos días sin incidentes como garantía permanente.

## Cobro y decisión comercial

La propuesta comercial v3, sección 3, ya contempla segunda cuota de $9.975.000 si es viable, aproximadamente $8.230.000 si es parcialmente viable y aproximadamente $6.900.000 si no es viable. No establece que toda la Entrega 1 pase a cero. Debe comprobarse qué versión fue efectivamente aceptada antes de liquidar. [10]

La adenda, secciones 4.3 y 12, explica el cálculo interno: $6.483.750 para el resto de Entrega 1 y $3.491.250 para automatización; de esta última parte, $418.950 como investigación si falla. Son estimaciones de reparto, no una tarifa independiente demostrada ni prueba de aceptación contractual. [11]

| Decisión | Tratamiento recomendado |
|---|---|
| Continúa el intento acotado | No presentar el componente como aceptado ni cobrarlo como completo antes de evidencia |
| Cierre sin implementación | Retirar el cobro de automatización no entregada y documentar módulos afectados |
| Investigación técnicamente concluyente | Considerar el fee previsto solo conforme a lo aceptado y a la evidencia entregada |
| Cierre por defectos propios o validación inconclusa | Considerar renunciar al fee de investigación; no trasladar al cliente el costo de intentos de instalación defectuosos |
| Resto de Entrega 1 | Cobrar únicamente alcance entregado y aceptado; no asumir que está completo por excluir automatización |

Si se decide renunciar también al fee, el reparto interno deja $6.483.750 como referencia para el resto de la segunda cuota, sujeto a aceptación y conciliación de pagos. No es una factura calculada ni una decisión ejecutada.

La recomendación final es conservar una oportunidad breve de validación porque existen rutas oficiales no agotadas, sin prolongar desarrollo especulativo. Si no se supera, cerrar honestamente como no validado/no entregable en las condiciones de la agencia y ajustar el cobro. Si la exigencia es invisibilidad garantizada o imposibilidad absoluta de extraer contraseñas del PC, la arquitectura actual no satisface esa exigencia y debe replantearse desde ahora.

## Fuentes

Fuentes externas consultadas el 9 de septiembre de 2026. Las políticas vigentes y el código oficial tienen precedencia sobre notas históricas del proyecto.

1. Chromium, [ExtensionInstallForcelist, definición oficial](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/Extensions/ExtensionInstallForcelist.yaml).
2. Google, [Chrome Enterprise Core, funciones y preguntas frecuentes](https://chromeenterprise.google/products/chrome-enterprise-core/).
3. Google, [Configurar distribución y visibilidad](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
4. Google, [Opciones de publicación empresarial](https://developer.chrome.com/docs/webstore/cws-enterprise).
5. Google, [Hello World: cargar una extensión descomprimida](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world), consultado mediante documentación indexada.
6. Google, [Novedades de extensiones, junio de 2025](https://developer.chrome.com/blog/extension-news-june-2025?hl=es_419).
7. Google, [Alojamiento de extensiones](https://developer.chrome.com/docs/extensions/how-to/distribute/host-extensions).
8. Google, [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
9. MDN, [Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted).
10. Archivo privado: `C:/Users/danig/Documents/FREELANCE/AGENCIA CAROL/documentos/agency-os-propuesta-comercial-v3.md`, sección 3; y `agency-os-requerimientos.md`, Entrega 1. Consultados en disco; aceptación contractual no verificada.
11. Archivo privado: `C:/Users/danig/Documents/jarvisbot/jarvisbot-main/agency-os/agency-os-reasignacion-fases.md`, secciones 4.3 y 12. Documento interno de estimación.
12. Evidencia local: [ensayo Docker del 4 de septiembre](station-e2e-six-profile-docker-2026-09-04.md), que declara explícitamente pendiente la validación Windows/TalkyTimes.
13. Código local: `extension/chrome-extension/`, `extension/scripts/package-managed-extension.mjs`, `extension/empaquetar_y_probar_forcelist.py`, `deploy/station-e2e/station/`, `local-helper/internal/launcher/launcher.go` y `local-helper/cmd/agency-os-helper/main.go`.
