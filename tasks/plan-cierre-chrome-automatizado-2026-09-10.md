# Cierre del agente Chrome automatizado

Estado: implementación base de CA-00a a CA-05 aplicada; pruebas de backend, contratos, agente y puente web correctas. La prueba del formulario renderizado y la aceptación física de CA-02, CA-03, CA-04 y CA-06 siguen pendientes en una PC Windows de prueba. Fecha: 2026-09-10.

## Objetivo y alcance

Completar gestión de credenciales desde Perfiles, cierre/relevo, aislamiento al reutilizar slots y protección rutinaria de contraseña en el recorrido web → agente local → vault → Chrome. Mantener el backend como autoridad de permisos. No reconstruir extensión ni Native Messaging. Este cierre no acredita FR-39 ni automatización de conversaciones.

## Hallazgos que determinan el plan

- `tools/agency-os-local-agent.py` conserva drivers solo en memoria, reutiliza directorios por slot y bloquea todas las aperturas con un lock global. No mantiene heartbeat ni recibe cierres; `close_all()` solo corre en salida normal. Ignora la versión devuelta al marcar ACTIVE.
- `backend/src/modules/assignments/assignments.service.ts` ya comprueba dispositivo, asignación vigente, propiedad de sesión y versión. `updateSession()` incrementa versión y actualiza heartbeat; no revive CLOSED/STALE. Reutilizar esas invariantes.
- `StationSessionsController` solo expone PATCH; su esquema admite ACTIVE/ERROR. Faltan lectura/renovación de autorización y confirmación de cierre para estación. El cierre actual del operador requiere JWT y no sirve directamente al agente.
- `JobsService` cierra por asignación y marca STALE tras 120 s sin heartbeat. Eso no termina Chrome. `DevicesService.heartbeat()` registra presencia del dispositivo, no autorización de una sesión.
- `extension/chrome-extension/content.js` ya elimina `svg#Eye`/`svg#EyeOff` y observa cambios del DOM. Reutilizar esa lógica pequeña.
- El spike elimina directorios entre pasadas: su resultado no demuestra reutilización segura del directorio persistente del agente.

## Solución a implementar

### 1. Autorización corta y cierre local

Agregar una renovación por sesión en `POST /station/sessions/:id/heartbeat`, autenticada por dispositivo y limitada a sesiones de ese dispositivo. Devuelve decisión explícita de continuar/cerrar, versión, hora del servidor y fin efectivo autorizado. Verifica sesión, dispositivo, operador/perfil habilitados y asignación/turno vigente; calcula el límite efectivo con las reglas existentes de asignaciones y overrides. Una sesión terminal nunca se reactiva.

Propuesta inicial medible: renovar cada 10 s, timeout de petición 5 s y permiso local máximo de 30 s, siempre acotado por el fin autorizado. Son parámetros de esta propuesta, no comportamiento actual. Un rechazo definitivo cierra inmediatamente; red/5xx permiten continuar solamente hasta vencer el permiso ya obtenido. Una respuesta perdida no deja una sesión abierta indefinidamente. El backend continúa cerrando registros aunque el agente desaparezca.

Usar hora de servidor y reloj monotónico para calcular vencimiento conservador, descontando el tiempo de petición. No confiar en la hora Windows ni en fechas enviadas por la web. Tras suspensión/reanudación, no renovar ni mostrar la sesión como vigente sin comprobar el límite; probar cambios del reloj. El relevo programado cierra al borde sin gracia de negocio: objetivo de terminación del proceso ≤1 s respecto del borde en PC de prueba. Revocación inesperada: objetivo ≤15 s con red; sin red, nunca más de 30 s desde la última renovación válida. Registrar esos límites: polling no promete revocación instantánea.

Agregar confirmación idempotente `POST /station/sessions/:id/close`, limitada a la estación propietaria. Permite confirmar salida aunque haya vencido la asignación; no reabre ni sobrescribe el motivo/hora de cierre de negocio. Separar en auditoría “permiso terminado” y “navegador cerrado confirmado”. Con token revocado el agente cierra igualmente; no necesita autorización para dejar de operar. No mostrar cierre físico confirmado cuando no se recibió confirmación.

### 2. Directorio nuevo por sesión

Cada sesión usa un directorio exclusivo bajo la raíz del agente, asociado a sessionId; el slot queda como identificador lógico. No copiar cookies, almacenamiento ni preferencias de una sesión anterior. Al terminar: cerrar todos los procesos propios, verificar su salida y eliminar el directorio. Si la limpieza falla, registrar limpieza pendiente y nunca reutilizar esa carpeta. En el siguiente arranque limpiar residuos propios después de comprobar que no tienen procesos activos.

Validar rutas absolutas dentro de la raíz, rechazar enlaces/junctions que escapen y no aceptar rutas desde el navegador. Mantener exclusión por slot y sesión: dos clics no crean dos Chrome. “Continuar” enfoca la sesión viva; si ya murió, reconcilia y permite preparar otra. El costo aceptado es login y caché fría en cada nueva sesión.

### 3. Contraseña protegida antes del relleno

Antes de introducir el secreto, ocultar los controles de revelado y activar observación de cambios del formulario. Si no puede comprobarse el campo password protegido, no rellenar: cerrar ese intento y ofrecer reintento. Configurar el Chrome administrado para no ofrecer guardar contraseñas y verificarlo en el navegador real. Borrar los valores del formulario ante fallo antes de cerrar cuando sea posible.

Mantener secretos fuera de archivos, argumentos, respuestas loopback, logs, trazas y capturas. Sustituir el volcado actual de excepciones por códigos permitidos y metadatos sanitizados; liberar referencias al secreto después de inyectarlo, sin prometer borrado garantizado de memoria en Python. Confirmar login mediante una señal autenticada y, si el DOM la expone, identidad de la cuenta; salir de `/auth/login` por sí solo no basta.

El objetivo sigue siendo impedir exposición rutinaria. El secreto llega al DOM y no se promete impedir su extracción por un operador técnico; no se incorpora bloqueo de DevTools ni bypass de CAPTCHA.

## Gestión de credenciales desde la web

La persona con permisos debe poder ir a **Perfiles → Credenciales → Guardar**, ingresar usuario/correo y nueva contraseña, y recibir confirmación. La contraseña existente nunca se devuelve ni se precarga. Mostrar únicamente si hay credencial configurada y quién/cuándo la actualizó. Al crear un perfil, ofrecer configurar su credencial en ese mismo flujo; si queda pendiente, indicarlo y no presentarlo como listo para abrir.

Roles previstos: dueño mediante el rol ADMIN existente, director operativo y coordinador. ADMIN/director administran los perfiles de su alcance; coordinador solo los perfiles autorizados dentro de su ámbito operativo, conforme a las reglas de acceso existentes. La API y RLS deben aplicar el mismo alcance aunque alguien altere el ID en la petición; ocultar un botón no concede seguridad.

Hallazgo: existe `PUT /profiles/:profileId/credential`, pero `ProfileManagement.tsx` solo pide asociar la credencial y no ofrece el formulario. En `role-permissions.ts`, director/coordinador no tienen `vault.rotate`. Ese permiso también protege `/vault/keys/rotate`: separar actualización de credenciales de rotación de clave maestra antes de conceder acceso. No ampliar permisos criptográficos globales a coordinadores/directores.

Guardar aquí actualiza la copia usada por Agency OS; **no cambia la contraseña en TalkyTimes**. El formulario debe explicarlo en una frase. La siguiente apertura consulta la nueva credencial sin editar archivos, reiniciar agentes ni reinstalar nada. Las sesiones ya autenticadas no se cierran solo por guardar: usar la acción explícita de cierre cuando se necesite. Un fallo de login posterior permite corregir desde este mismo formulario y reintentar, sin afirmar que guardar verificó la contraseña con TalkyTimes.

### Comportamiento final del formulario

1. En cada perfil autorizado, acción **Configurar credenciales** si falta la configuración, o **Actualizar credenciales** si ya existe. Usar el formulario/panel del módulo Perfiles, sin una sección técnica de vault aparte.
2. Mostrar el perfil seleccionado, **Usuario o correo de TalkyTimes**, **Nueva contraseña**, **Guardar** y **Cancelar**. Precargar solo el usuario/correo; contraseña siempre vacía. El campo nuevo admite pegado y un control accesible para revisar lo que acaba de escribir el gestor autorizado; esto no permite consultar la contraseña anterior ni cambia la protección del login del operador.
3. Mantener el formulario abierto ante errores de validación/guardado, con un mensaje comprensible y sin incluir el secreto. Bloquear envío duplicado mientras guarda. Al guardar, cancelar, cambiar de perfil o salir de sesión, limpiar el secreto del estado del formulario.
4. Confirmar **Credenciales actualizadas. Se usarán la próxima vez que se abra el perfil.** Mostrar autor y fecha de última actualización. Si el resultado de la petición es incierto, consultar metadatos antes de afirmar éxito o reenviar.
5. Actualizar usuario de login del perfil y credencial cifrada en una misma transacción para que el catálogo y el login no diverjan. Comprobar versión esperada: si otro gestor guardó mientras el formulario estaba abierto, informar conflicto y pedir revisar, sin sobrescribir silenciosamente. No transformar ni recortar el valor de la contraseña.

Conservar `vault.rotate` para actualizar credenciales y separar la clave maestra bajo `vault.keys.rotate`, exclusiva de administración. Conceder lectura de metadatos seguros a los mismos gestores dentro de su alcance. Migrar permisos existentes y comprobar rutas, contratos y RLS antes de habilitar los botones.

## Tareas ordenadas y verificaciones

### CA-00a — Permisos para gestionar credenciales (M)

Dependencias: ninguna. Archivos previstos: controlador vault, permisos y sus pruebas, migración de permisos/RLS; dividir contratos/metadatos en un cambio focal si supera cinco archivos.

- [x] Separar permiso de actualizar credencial y permiso de rotar clave maestra; conceder el primero a ADMIN, DIRECTOR_OPERATIVO y COORDINADOR con alcance de recurso. Incluir acceso a metadatos seguros.
- [x] Aplicar los cambios a instalaciones existentes mediante migración, no solamente seeds. Revisar las políticas de escritura/lectura de credenciales y comprobar que el servicio respeta el alcance del perfil.
- [x] Integración con rol real de BD: los tres roles guardan donde corresponde; coordinador ajeno, operador y cafetería reciben denegación. Director/coordinador no pueden rotar claves maestras. Auditoría registra autor/perfil/fecha sin el secreto; la prueba física de un coordinador ajeno queda en el ensayo CA-06.

### CA-00b — Formulario de credenciales en Perfiles (M)

Dependencias: CA-00a. Archivos previstos: ProfileManagement, formulario de credenciales, prueba focal y cliente/contrato si hace falta.

- [x] Crear/actualizar credencial con usuario/correo, nueva contraseña y Guardar; campos etiquetados, pegado permitido y error comprensible. No exigir credencial anterior ni herramientas técnicas. Vaciar contraseña al guardar/cancelar y no persistirla en storage, telemetría ni caché de consultas.
- [x] Mostrar configuración pendiente y última actualización; permitir configurar inmediatamente después de crear el perfil. Mantener consistente el usuario de login mostrado y el que usa el vault; resolver esa actualización sin dejar dos valores contradictorios. No declarar éxito si falló el guardado.
- [ ] Prueba del formulario y guardado: éxito, fallo, edición concurrente, cancelación, alcance y ausencia del secreto en respuesta/logs. El backend, RLS y puente web tienen cobertura; falta la prueba renderizada del formulario y el checkpoint integrado web → vault → agente con credenciales autorizadas.

Checkpoint de configuración: una persona autorizada configura y corrige un perfil enteramente desde la web. No se acepta un recorrido que dependa de SQL, scripts o archivos de credenciales. La comprobación del login con la nueva contraseña corresponde al checkpoint integrado previo al piloto.

### CA-01 — Contrato de autorización y confirmación de cierre (M)

Dependencias: ninguna. Archivos previstos: controller/service/schema de assignments y contratos compartidos/rutas; separar registro de contratos en un commit auxiliar si supera cinco archivos.

- [x] Implementar renovación y cierre idempotente con alcance por dispositivo, fin efectivo y versión coherente. Reutilizar validaciones existentes y mantener auditoría sin secretos.
- [x] Cierre de negocio conserva su hora/motivo; renovación no revive CLOSED/STALE ni ignora revocación de dispositivo, operador o perfil.
- [x] Integración PostgreSQL/Redis: estación ajena, revocación, borde exacto, override, heartbeat concurrente con relevo y confirmación repetida. Extender las suites existentes de seguridad y turnos; comprobar contratos/RLS.

### CA-02 — Ciclo local y terminación de procesos (M)

Dependencias: CA-01. Archivos previstos: agente, módulo Windows de procesos si hace falta y prueba focal del agente.

- [x] Renovar en un ciclo independiente de aperturas; mantener versión actual y vencimiento por sesión. Ningún login lento ni lock global puede detener los cierres. No usar WebDriver simultáneamente desde dos hilos sobre el mismo driver.
- [ ] Cierre normal con `quit()` y límite de espera; si queda bloqueado, terminar exclusivamente el árbol de esa sesión. La implementación tiene `taskkill` acotado al proceso de driver como fallback, pero Job Objects, crash y no afectación de Chrome personal requieren prueba en Windows. Si esa prueba falla, CA-02 no se cierra.
- [ ] Prueba local automatizada: revocación durante login, red caída, llamada WebDriver bloqueada, cierre manual, crash forzado, suspensión/reanudación y cambio de reloj. Confirmar que los límites se mantienen incluso mientras abre otro perfil.

Checkpoint A: autorización y terminación real demostradas con navegador de prueba; no continuar a aceptación usando solo estados de BD.

### CA-03 — Aislamiento y reapertura (S)

Dependencias: CA-02. Archivos previstos: agente y su prueba focal.

- [x] Directorio nuevo por sesión, exclusión por slot, limpieza después de salida y recuperación segura de residuos; ninguna eliminación fuera de la raíz administrada.
- [x] “Continuar” sobre sesión viva no vuelve a reclamar credenciales ni abre otro proceso; sesión muerta queda disponible para preparación nueva.
- [ ] Prueba A → cierre → B → cierre → A en el mismo slot, incluyendo cookie/localStorage/IndexedDB/service worker de prueba, borrado fallido y reinicio. B no recibe estado de A; Chrome personal permanece intacto. Requiere navegador y PC de prueba.

### CA-04 — Formulario y secreto (S)

Dependencias: CA-03. Archivos previstos: agente, fixture HTML y prueba focal.

- [x] Ocultar revelado antes del relleno y tras re-render; configurar el Chrome del agente para impedir guardar contraseñas. La comprobación del resultado real queda en el ensayo físico.
- [x] Errores muestran códigos seguros, no texto bruto de excepciones. No marcar ACTIVE sin señal autenticada; fallo de protección o login termina el intento.
- [ ] Fixture con botón de revelar y re-render; secreto centinela ausente de logs/respuestas/archivos propios. La verificación autorizada en TalkyTimes del ojo, guardado y señal de login requiere el ensayo físico.

### CA-05 — Estado visible y recuperación (S)

Dependencias: CA-01–04. Archivos previstos: `OperatorProfiles.tsx`, `local-agent.ts` y prueba de interfaz.

- [x] Mostrar apertura, sesión activa, cierre pendiente de confirmación y reintento con mensajes comprensibles. No confundir cierre del permiso con cierre confirmado de Chrome.
- [x] Cerrar sesión manualmente y usar “Continuar” funcionan; la caída del agente no deja un estado ACTIVE indefinido. Reutilizar actualización de perfiles existente.
- [ ] Prueba de interfaz con agente inaccesible, cierre concurrente y reapertura; los builds/typecheck y el puente web pasan, pero la prueba renderizada completa queda pendiente.

### CA-06 — Ensayo operativo y retirada del camino anterior (M, dividir documentación/retiro)

Dependencias: CA-00a, CA-00b y CA-01–05.

- [ ] PC Windows de prueba: 1, 2 y 5 perfiles; medir 8 por ser el objetivo de capacidad aún abierto. El helper acepta hasta 8 sesiones, pero esa capacidad todavía no está aceptada sin medirla. Registrar tiempos, memoria, CPU y versiones.
- [ ] Ejecutar tres ciclos de cambio de cuenta por slot, un relevo real, revocación remota, pérdida de red, cierre manual, crash y reinicio de Windows. Evidencia sanitizada con horas de fin autorizado y salida de procesos. Objetivo de observación: tres días operativos con relevos, sin sesiones huérfanas ni mezcla de cuentas.
- [ ] Solo tras pasar: actualizar decisión arquitectónica, `agents.md`, `backend/PLAN.md` y catálogo/matriz; retirar fallback web de extensión y distribución anterior del recorrido operativo. Conservar evidencia histórica. La desinstalación en PCs se hace sobre inventario, sin eliminar perfiles personales ni mezclarla con el ensayo.

## Criterio de cierre

Orden de ejecución: **CA-00a → CA-00b → CA-01 → CA-02 → CA-03 → CA-04 → CA-05 → CA-06**. Cada tarea se verifica antes de darla por completada. No se retira el flujo anterior hasta superar el ensayo operativo.

Antes del piloto, ejecutar este recorrido completo con una cuenta de prueba autorizada:

1. El gestor configura una credencial desde Perfiles y el operador abre la cuenta correcta desde la web.
2. El gestor actualiza el vault con una credencial vigente de TalkyTimes. Tras cerrar y volver a abrir, el agente usa la nueva credencial sin intervención técnica.
3. Un login rechazado muestra un error seguro; el gestor corrige desde el mismo formulario y el operador puede reintentar.
4. Relevo/revocación termina el Chrome administrado dentro de los límites indicados; el siguiente usuario inicia con almacenamiento limpio.

La evidencia final identifica prueba, resultado, rol, versión del software y límites medidos, sin contraseñas. Los casos de permiso ajeno, fallo de limpieza, red caída y crash deben pasar; cualquier incumplimiento mantiene abierta la tarea correspondiente. La capacidad aceptada debe ser la medida, no el objetivo de ocho perfiles por sí solo.

Todas las tareas, incluida la gestión web de credenciales por los roles autorizados, tienen evidencia; los tres problemas pasan pruebas automáticas focales y ensayo real; se conocen los límites de revocación/offline y capacidad. Un CLOSED en BD, login exitoso o `finally` no bastan. No se declara expulsión global de TalkyTimes: se termina la sesión de navegador administrada y se elimina su almacenamiento, sin invalidar cookies copiadas fuera de ella.

La implementación base de CA-00a a CA-05 está aplicada y verificada en el entorno de desarrollo. Este documento no sustituye la prueba renderizada del formulario ni la aceptación física pendiente de CA-02, CA-03, CA-04 y CA-06, ni cambia honorarios, alcance comercial o fechas comprometidas. La caída de red >30 s interrumpe trabajo deliberadamente; ese costo operativo queda explícito para el piloto.

## Fuentes técnicas

- Código local referenciado en los hallazgos, revisado 2026-09-10.
- Selenium, [gestión de ventanas y quit](https://www.selenium.dev/documentation/webdriver/interactions/windows/), consultado mediante Context7: `quit()` termina ventanas y sesión de driver; `close()` no sustituye cierre completo.
- Microsoft, [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) y [JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information): base de la terminación por cierre de handle. El comportamiento con Chrome y jobs anidados debe verificarse en la PC objetivo.
