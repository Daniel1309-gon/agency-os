# Cierre de Entrega 1 y despliegue de Agency OS

Fecha: 2026-09-20. Estado: plan acordado, pendiente de ejecución. Guardarlo no implica contratar servicios ni desplegar cambios.

## 1. Resultado esperado y decisiones

Entregar Agency OS operativo para 30 PCs por turno, con autenticación individual, acceso mediante certificados mTLS, agente instalado en Windows, backups externos y recuperación comprobada.

**Decisiones confirmadas:**

| Área | Decisión |
|---|---|
| Infraestructura | Un VPS exclusivo para Agency OS; Rocket.Chat conserva su servidor |
| Capacidad inicial | 2 vCPU, 4 GB RAM, 80 GB SSD/NVMe, x86-64 |
| Proveedor | Comparar antes de contratar |
| Presupuesto objetivo | US$30/mes para VPS y B2; informar impuestos y extras |
| Alta disponibilidad | Aplazada explícitamente; sin promesa de continuidad ante caída del VPS |
| Acceso | Cloudflare Tunnel + mTLS de zona; sin WARP |
| Tokens de dispositivo | Retirar archivos, cabeceras y renovación del token propio |
| Windows | Cuenta compartida por PC; usuarios individuales en Agency OS |
| Claves | TPM preferido; excepción documentada con clave Windows no exportable |
| Dueña | Certificado propio por dispositivo; cuenta ADMIN de Agency OS |
| Backups | Backblaze B2, retención de 30 días |
| Recuperación | Objetivos: pérdida máxima de una hora de datos y recuperación en cuatro horas |
| Dominio | `erp.globalcompany.company`; dominio y DNSSEC ya configurados |

Los JWT de usuario y permisos temporales internos siguen siendo necesarios. Se elimina la credencial permanente de dispositivo almacenada como archivo, no la autenticación de las personas.

El agente implementador prepara código, configuración, pruebas y documentación. Daniel contrata servicios, proporciona accesos mediante mecanismos seguros y coordina las pruebas con cuentas reales autorizadas. No enviar mensajes ni contratar servicios automáticamente.

## 2. Implementación, en orden

### Fase A. Reconciliar el cierre funcional y elegir infraestructura

**A1. Auditar lo pendiente de E1**

Usar como punto de partida [el plan de cierre anterior](plan-cierre-entrega-1-2026-09-08.md), contrastando cada casilla con implementación y evidencia actual. No reconstruir funcionalidades ya terminadas.

Crear una matriz de cierre con: requisito, evidencia, brecha concreta, prueba necesaria y estado. Cubrir:

- Autenticación, roles, RLS, auditoría y vault.
- Perfiles, cuadrillas, asignaciones, turnos, breaks y semáforo.
- Scheduler, sesiones abandonadas, outbox, reintentos y recuperación tras reinicio.
- Integración permanente del bot y Rocket.Chat incluida en E1.
- Retención de auditoría, rotación de claves y recuperación del vault.
- Prueba física de múltiples perfiles y aceptación final.

Conservar el alcance funcional aprobado; no añadir Tableau, nómina, IA ni funcionalidades de E2. Resolver discrepancias comerciales pendientes antes de declarar E1 aceptada. Aplazar HA no aplaza backups, restauración ni rollback.

**A2. Comparar VPS y presentar una compra concreta**

Comparar DigitalOcean, Hetzner y Vultr en regiones disponibles próximas a Colombia. Registrar precio vigente, impuestos, disco, transferencia, arquitectura, ampliación, consola de recuperación y disponibilidad.

Seleccionar el candidato más económico que cumpla la capacidad inicial y deje margen para B2 dentro de US$30/mes. Desempatar por latencia desde la oficina y facilidad de operación. Presentar la comparación y el candidato a Daniel antes de contratar; si ninguno cabe, comunicar el costo real sin reducir silenciosamente la capacidad.

Construir imágenes fuera del VPS y desplegar versiones identificadas por commit/digest. No dimensionar el servidor para compilar durante la operación.

### Fase B. mTLS definitivo y retirada del token de dispositivo

**B1. Establecer una identidad de equipo confiable**

Configurar Tunnel como única entrada pública de la aplicación. Caddy, API, PostgreSQL y Redis quedan internos; administración del VPS mediante SSH restringido, claves y consola del proveedor.

En Cloudflare:

- WAF bloquea certificado ausente, inválido, revocado o de emisor inesperado.
- La protección cubre web, API y WebSocket.
- Una regla sobrescribe la cabecera de identidad del certificado con información obtenida de la conexión mTLS.
- El backend rechaza identidad ausente o malformada; no acepta cabeceras aportadas directamente por clientes.
- Probar falsificación de cabeceras, hostnames alternativos y acceso directo al origen.

Usar la huella SHA-256 del certificado como identificador público. Reutilizar el inventario de dispositivos existente para nombre, estado y certificado autorizado; no crear otro inventario ni emitir secretos de dispositivo. Registrar los dispositivos de la dueña como administrativos, sin permiso para operaciones de estación.

La procedencia confiable de las cabeceras es parte de la seguridad, no solo un detalle de proxy. [Documentación de Cloudflare](https://developers.cloudflare.com/ssl/client-certificates/forward-a-client-certificate/).

**B2. Vincular cada sesión al operador y al certificado**

Adaptar los endpoints actuales, conservando sus rutas cuando sea posible:

- `prepare` requiere usuario autenticado, turno, asignación y certificado operativo activo.
- La preparación queda vinculada desde su creación a operador, perfil, asignación y equipo. Expira en 60 segundos si no se reclama.
- El agente reclama una única vez desde el certificado vinculado; el backend repite las comprobaciones antes de entregar la credencial.
- Estado, heartbeat y cierre validan ese mismo equipo y sesión.
- Mantener heartbeat cada 10 segundos, permiso local máximo de 30 segundos y límite por fin efectivo de turno/asignación.
- Una respuesta perdida no permite volver a obtener la contraseña; cerrar o expirar la sesión y preparar otra.
- Las acciones locales desde la web requieren autorización verificable del backend; conocer un identificador de sesión no concede permiso.

Retirar `x-device-token`, `device-token.txt`, emisión/renovación de tokens y las pantallas asociadas. Auditar todos los usos de `RequireDevice`, incluyendo rutas legacy y extensión: ninguna ruta puede conservar un bypass por token antiguo.

Eliminar la dependencia de la IP de oficina para el acceso mTLS. Conservar IP para auditoría y protección contra abuso.

Aplicar migraciones aditivas para asociación de certificados y estado de reclamación; preservar el historial. Actualizar contratos compartidos, OpenAPI, pruebas y matriz de rutas. Cualquier modo de desarrollo debe ser explícito y no habilitable accidentalmente en producción.

### Fase C. WebSockets y autenticación durante el relevo

**C1. Autorización de conexiones persistentes**

- Limitar cada WebSocket a 45–60 segundos, distribuyendo los cierres para evitar reconexiones simultáneas.
- Cerrar antes si vence el JWT.
- Implementar reconexión explícita del cliente, con espera aleatoria breve y backoff ante fallos.
- Renovar JWT cuando corresponda; no hacer refresh por cada reconexión.
- Revalidar usuario, versión de autorización, dispositivo y salas en cada conexión.
- Recuperar un snapshot al reconectar; no asumir que se recibieron todos los eventos.

Al desactivar un usuario, revocar sus sesiones, bloquear un dispositivo o cambiar permisos/cuadrillas, desconectar sus sockets afectados. Incorporar una versión de autorización del usuario, comprobada en HTTP y WebSocket, para impedir que un JWT anterior permita reconectar después de una revocación.

Bloqueo desde Agency OS: cierre objetivo en cinco segundos en condiciones normales. Revocación solo en Cloudflare: la conexión existente dura como máximo 60 segundos; no presentar ese plazo como garantía de propagación de Cloudflare.

**C2. Corregir límites de autenticación para una oficina compartida**

El límite actual de cinco logins por IP cada 15 minutos impide el relevo de 30 operadores.

Separar límites iniciales:

- Login por cuenta: conservar cinco intentos por 15 minutos.
- Login por certificado operativo: 30 intentos por 15 minutos.
- Login agregado por IP: 300 intentos por 15 minutos.
- Refresh por sesión/dispositivo: 60 por 15 minutos; por IP: 1.200.

Aplicar contadores atómicos y pruebas de abuso. Ningún límite se desactiva para aprobar la carga. Revisar que una reconexión WebSocket no provoque tormentas de refresh.

### Fase D. Certificados protegidos y agente instalable

**D1. Sustituir las claves PEM por el almacén Windows**

Generar la clave en la PC y emitir una CSR:

- Preferir proveedor criptográfico TPM y clave no exportable.
- Si el TPM no es compatible, exigir una excepción registrada y usar almacenamiento Windows no exportable.
- Cloudflare firma la CSR; la clave nunca se distribuye en PFX/PEM para las PCs.
- Usar un certificado exclusivo por PC, con identificador único y fecha de expiración.
- Renovar con 30 días de anticipación; efectuar el cambio sin perfiles activos y revocar el anterior después de verificarlo.

Adaptar el transporte HTTPS del agente a WinHTTP mediante integración Python con Windows. Seleccionar explícitamente el certificado; no elegir el primero disponible. Mantener verificación HTTPS, rechazo de redirects, timeouts y errores sanitizados. Inicializar correctamente el acceso COM en los threads que realizan peticiones.

Chrome y el agente deben funcionar con la misma clave no exportable. Probar esa compatibilidad antes de construir el instalador. [Certificados cliente en WinHTTP](https://learn.microsoft.com/en-us/windows/win32/winhttp/iwinhttprequest-setclientcertificate).

Para dispositivos móviles de la dueña, emitir certificados individuales mediante el mecanismo soportado por el dispositivo, sin prometer la misma protección TPM de Windows.

**D2. Instalación y operación diaria**

Empaquetar el agente para Windows x64 con PyInstaller e Inno Setup:

- Instalar una vez para la cuenta Windows compartida.
- Iniciar automáticamente al entrar en Windows, sin consola y con instancia única.
- Ejecutar sin privilegios administrativos.
- Configurar Chrome para seleccionar el certificado solo en el dominio de Agency OS.
- Conservar acceso únicamente local y validación exacta de Origin.
- Mostrar en la web: agente disponible, actualización requerida, certificado vencido y servicio temporalmente inaccesible.
- Actualizar o desinstalar solo después de cerrar perfiles.
- No eliminar certificados ni políticas ajenas.

Cerrar la prueba pendiente de procesos huérfanos: si el agente falla, sus Chrome de trabajo deben cerrarse sin afectar Chrome personal. Verificar el mecanismo de supervisión de procesos en Windows, incluyendo suspensión y reinicio.

Distribuir el instalador por el sitio protegido, publicar su checksum y registrar la versión instalada. No incorporar secretos de Cloudflare ni permisos de emisión de certificados en el instalador.

### Fase E. VPS, backups B2 y recuperación

Desplegar web, API, worker, PostgreSQL, Redis, Caddy y `cloudflared` en el VPS. Mantener roles separados de BD, secretos fuera de Git, reinicio automático, límites de logs y versiones fijadas.

Usar `NODE_ENV=production`. Verificar que scheduler y worker realmente ejecutan materialización, cierres, reaper, particiones, outbox y comunicación; evitar instancias duplicadas sin coordinación.

**Backups para el objetivo de una hora:**

- Dump consistente de PostgreSQL cada 30 minutos, comprimido y cifrado antes de salir del VPS.
- Guardar roles/configuración necesarios y un manifiesto con versión, fecha de inicio, checksum y resultado de subida.
- Conservar copias frecuentes durante 24 horas y una diaria durante 30 días.
- Usar nombres únicos y Object Lock: protección de 24 horas para copias frecuentes y 30 días para diarias.
- Credenciales del VPS sin capacidad de saltarse retención; probar la limpieza de objetos vencidos.
- Custodiar claves de restauración y KEK del vault separadamente del servidor.
- No copiar archivos de PostgreSQL en caliente como sustituto de un backup consistente.

Esta primera versión usa dumps, no archivo continuo de WAL. Debe completar generación y subida en menos de 15 minutos; si no lo consigue con el volumen proyectado, no cumple el objetivo y debe ampliarse el diseño antes de producción.

Alertar cuando la última copia completada represente datos de más de 45 minutos. Redis no debe ser la única fuente de información irrecuperable: al restaurar, invalidar sesiones efímeras y recuperar trabajos duraderos desde PostgreSQL.

Probar una restauración completa en un servidor vacío, incluyendo apertura de una credencial sintética del vault. Medir desde el inicio del incidente hasta el servicio validado: máximo cuatro horas, con pérdida de datos no superior a una hora.

Object Lock debe probarse con las reglas de expiración elegidas; no habilitar una retención incompatible con el borrado automático. [Documentación de B2](https://www.backblaze.com/docs/cloud-storage-object-lock).

## 3. Pruebas obligatorias y criterios de aceptación

### Seguridad y contratos

Demostrar rechazo de:

- Certificado ausente, revocado, vencido, desconocido o de otro equipo.
- Cabeceras de certificado falsificadas y token de dispositivo legacy.
- Claim repetido, vencido o concurrente.
- Operador fuera de turno, sin asignación o desactivado.
- Acceso a sesión/perfil de otro operador o equipo.
- JWT revocado que intenta reconectar.

Verificar que desactivar usuarios o dispositivos cierra sockets y sesiones operativas dentro de los plazos definidos. No registrar contraseñas, claves ni respuestas completas del vault.

### Prueba de 30 logins simultáneos

Ejecutar sobre el VPS candidato con configuración de producción, pasando por Cloudflare y desde una única IP pública, como ocurre en la oficina.

- Preparar 30 cuentas sintéticas, 30 identidades de certificado de ensayo y asignaciones válidas.
- Usar conexiones HTTPS independientes y los parámetros reales de scrypt.
- Disparar 30 logins dentro de una ventana de un segundo.
- Ejecutar tres oleadas; incluir una durante un backup.
- Mantener después 30 WebSockets durante 30 minutos, atravesando sus reconexiones.
- Simular hasta 240 sesiones con heartbeat cada 10 segundos, escalonando aperturas por operador. Simular únicamente TalkyTimes en esta prueba de carga.

Criterios iniciales:

| Medida | Umbral |
|---|---|
| Logins correctos | 30/30 por oleada, sin 429 ni 5xx |
| Latencia de login | p95 ≤5 s; máximo ≤10 s |
| Heartbeats | p95 ≤1 s; sin pérdidas de permiso atribuibles a saturación |
| Memoria | Sin OOM, reinicios ni uso sostenido de swap |
| Margen de RAM | Al menos 20% disponible tras estabilizarse |
| Reconexiones | Sin bucles de refresh ni pérdida persistente del estado |
| Backup concurrente | Completado y verificable |

Registrar resultados brutos sanitizados, CPU, RAM, disco, conexiones de BD y versión probada.

Si falla, identificar primero el cuello de botella. No reducir scrypt ni eliminar controles para obtener resultados verdes. Si se necesita 4 vCPU/8 GB y supera el presupuesto, presentar mediciones y costo antes de ampliar.

### Pruebas físicas y TalkyTimes real

Con cuentas autorizadas y una PC representativa:

1. Login real y cierre de un perfil.
2. Relevo A → B → A sin cookies ni datos del anterior.
3. Dos, cinco y ocho perfiles simultáneos, con RAM/CPU medidas.
4. Fin de turno, desactivación, revocación y pérdida de internet.
5. Caída del agente, suspensión, reanudación y reinicio de Windows.
6. Comprobación de que Chrome personal permanece intacto.

No eludir CAPTCHA. Las credenciales se cargan por el vault y no se comparten en el chat.

Ejecutar typecheck, lint, build, contratos, pruebas unitarias e integraciones PostgreSQL/Redis sobre el commit candidato. Completar la matriz de E1 con evidencia; no marcar requisitos por asociación.

## 4. Despliegue gradual, operación y aceptación

1. Crear staging con datos sintéticos y certificados distintos de producción.
2. Completar pruebas de seguridad, carga, instalador y restauración.
3. Preparar cuentas Cloudflare/B2/proveedor a nombre de la clienta, MFA y recuperación bajo custodia administrativa.
4. Desplegar el candidato sin sesiones operativas activas, con backup previo y migraciones aditivas.
5. Habilitar dos PCs y un turno supervisado.
6. Ampliar a 30 PCs después de un relevo correcto; observar tres días operativos.
7. Revocar certificados de ensayo, retirar datos sintéticos y cerrar accesos temporales.

Configurar alertas externas al VPS para indisponibilidad y ausencia de backups, más alertas de disco, errores de jobs/outbox y certificados próximos a vencer. Preparar destinatario y canal con Daniel; no enviar mensajes de prueba sin autorización.

Detener la expansión ante fuga de información, acceso fuera de alcance, sesiones heredadas, OOM o pérdida de datos. Rollback con imágenes anteriores compatibles y procedimiento probado; nunca reabrir el origen ni restaurar ciegamente una BD sobre datos recientes.

**Entregables finales:**

- Candidato identificado por commit e imágenes.
- Matriz E1 cerrada con evidencias y excepciones explícitas.
- Configuración reproducible de producción y backups.
- Instalador y procedimientos de alta, renovación, baja y sustitución de PC.
- Informe de 30 logins, ocho perfiles físicos, revocación y restauración.
- Runbook de incidentes, actualizaciones y rollback.
- Acta de aceptación que registre HA aplazada, objetivos de recuperación medidos y responsabilidad de soporte.

La aceptación de E1 exige tanto el funcionamiento del producto como la recuperación y operación demostradas. El proveedor, los accesos y las cuentas reales son entradas administrativas del despliegue; no justifican omitir pruebas ni declarar terminado un paso sin evidencia.
