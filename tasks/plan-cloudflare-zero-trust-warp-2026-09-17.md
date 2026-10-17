# Agency OS: Cloudflare Zero Trust, WARP y acceso remoto de la dueña

Fecha: 2026-09-17. Estado: plan propuesto, pendiente de implementación y piloto. La alternativa mTLS se evalúa por separado; este documento conserva el plan WARP.

## 1. Objetivo y decisiones

Cloudflare autoriza los equipos registrados por IT y el acceso remoto de la dueña. Agency OS sigue autenticando a cada persona y aplicando roles, permisos, turnos y asignaciones.

Se asume una cuenta compartida de Windows por PC y usuarios individuales de Agency OS. El correo de IT identifica la instalación de WARP, nunca al operador ni sus permisos de negocio.

El nuevo flujo elimina el registro de dispositivos en Agency OS, `device-token.txt`, `x-device-token`, la renovación propia a 180 días y la restricción por IP pública de la oficina. Conserva el agente local que abre Chrome: se instala una vez y arranca automáticamente al iniciar sesión en Windows.

Un equipo registrado podrá acceder desde cualquier red. Esto acredita un equipo autorizado, no su presencia física en la oficina.

## 2. Configuración de Cloudflare

### 2.1. Dominio y DNS

- Dominio: `globalcompany.company`. Aplicación: `erp.globalcompany.company`.
- Cuenta de Cloudflare propiedad de la clienta, con MFA y plan Free.
- Exportar y revisar los registros actuales de Hostinger antes de cambiar nada. Conservar web, MX, SPF, DKIM y DMARC; no asumir que el escaneo automático importa todo.
- Gestionar correctamente el DNSSEC anterior antes de cambiar los nameservers por los dos asignados por Cloudflare.
- Verificar resolución y correo después del cambio y habilitar nuevamente DNSSEC.

Referencia: [configuración de zona completa](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).

### 2.2. Organización e identidades

- Crear la organización Zero Trust `globalcompany`, si está disponible.
- Usar `it@globalcompany.company` para registrar y reautenticar las PCs. El buzón queda exclusivamente bajo control administrativo; no se entrega a operadores ni queda abierto en las PCs.
- Usar el correo personal autorizado de la dueña para el acceso remoto. Inicialmente, autenticación por código enviado por correo.
- En permisos de enrolamiento: Allow, Include, correo exacto de IT. No permitir todo el dominio.
- La dueña no necesita instalar WARP para acceder remotamente con su identidad personal.

### 2.3. Access y políticas

Crear una aplicación self-hosted que cubra todo `erp.globalcompany.company`, incluyendo API y WebSocket, antes de publicar el hostname.

| Política | Acción | Include | Require |
| --- | --- | --- | --- |
| PCs de oficina | Allow | Correo exacto de IT | Comprobación Gateway de nuestra organización |
| Dueña remota | Allow | Correo exacto de la dueña | Autenticación de su identidad |

Crear primero la comprobación de postura Gateway. No sustituirla por la condición genérica de WARP activo: el cliente de consumo no acredita pertenencia a nuestra organización.

Activar **Authenticate with Cloudflare One Client** para evitar un segundo login de Access en cada navegador y permitir el tráfico del agente. Configurar la sesión del cliente en 90 días, máximo documentado al preparar este plan; esta función figura como Beta y debe validarse en el piloto. La sesión remota de la dueña será de 24 horas.

La propuesta anterior de 180 días para el token propio desaparece. No equivale a configurar 180 días en Cloudflare.

Configurar respuesta 401 para clientes no interactivos cuando falte autenticación. Mantener Binding Cookie desactivado por incompatibilidad con la autenticación del cliente. No añadir Bypass ni dejar rutas de API públicas.

Referencias: [políticas de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), [sesiones del cliente](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/client-sessions/).

### 2.4. Túnel y VPS

Ejecutar `cloudflared` en Docker, con reinicio automático y secreto fuera del repositorio.

```text
Internet → Cloudflare Access → Tunnel → Caddy interno
                                      ├─ /api/* → API
                                      ├─ /socket.io/* → API
                                      └─ resto → web
```

- Publicar el hostname `erp.globalcompany.company` con destino interno `http://caddy:80`.
- Usar HTTP únicamente dentro de la red interna de contenedores; el navegador mantiene HTTPS con Cloudflare.
- Configurar validación de Access en cloudflared con organización y audiencia de la aplicación.
- Retirar la exposición pública de Caddy, API, web, PostgreSQL y Redis. Mantener la administración del VPS por un canal restringido independiente.
- Eliminar hostnames o accesos directos al origen que permitan saltarse Access.
- Un túnel hacia un único VPS no implementa por sí mismo la alta disponibilidad final del proyecto.

Referencia: [configuración de túneles](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/).

### 2.5. PCs de oficina

IT instala el cliente oficial, lo enrola con su correo y registra cada equipo con un nombre identificable en el inventario. Configurar conexión automática y las restricciones administrativas disponibles para impedir que el operador cambie de organización o desactive la protección de forma rutinaria.

Configurar Split Tunnels en modo Include para Agency OS y los destinos necesarios de Cloudflare. Mantener TalkyTimes fuera del túnel; verificarlo expresamente en el piloto. No habilitar inspección TLS general como parte de este cambio.

Instalar también el agente de Agency OS. Cloudflare administra y revoca equipos; Agency OS conserva la auditoría individual por operador.

## 3. Backend: reemplazar el token de dispositivo

### 3.1. Control de acceso de infraestructura

Variables propuestas:

```dotenv
ACCESS_GATE_MODE=CLOUDFLARE
CF_ACCESS_TEAM_DOMAIN=https://<organizacion>.cloudflareaccess.com
CF_ACCESS_AUD=<audiencia de la aplicación>
CF_OFFICE_IDENTITY_EMAIL=it@globalcompany.company
CF_REMOTE_ADMIN_EMAIL=<correo real de la dueña>
```

En modo Cloudflare, sustituir el control por IP por validación del JWT de Access: firma, emisor, audiencia y expiración. Usar `jose` con JWKS remoto y caché, sin implementar criptografía propia. Verificar antes si ya existe una dependencia equivalente.

Fallar cerrado ante configuración ausente o JWT inválido: nunca volver automáticamente al modo anterior. Conservar JWT propio, usuario activo, permisos, RLS y reglas de negocio. Aplicar el control al establecimiento de WebSocket y **cerrar los WebSocket ya establecidos cuando la autorización se revoca** (usuario desactivado, sesión de Access vencida, asignación terminada). El piloto mTLS del 2026-09-19 verificó que revocar el certificado en Cloudflare no termina una conexión abierta: sobrevivió los 90 s medidos y solo la reconexión quedó bloqueada. Hoy no existe cierre iniciado por el backend: el JWT se valida solo en el handshake y ni `disableUser` ni `revokeAllUserTokens` tocan los sockets. Implementarlo (por ejemplo `server.in(room).disconnectSockets(true)` o revalidación periódica) y probarlo antes de retirar el token de dispositivo. Evidencia: [`tasks/evidence/mtls-pilot/README.md`](../evidence/mtls-pilot/README.md). Health checks quedan internos.

El modo por IP puede conservarse para desarrollo o despliegues anteriores, pero no como escape en producción Cloudflare.

Referencia: [validación del JWT de Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

### 3.2. Separación de identidades

La identidad de IT solo habilita la entrada desde PCs autorizadas. Cada operador inicia sesión con su propia cuenta de Agency OS.

La identidad remota de la dueña debe corresponder al correo y rol ADMIN autorizados en Agency OS. Comprobarlo en login, refresh y peticiones autenticadas. No permitir que esa entrada remota sirva para iniciar sesión como operador.

Las operaciones de estación y agente requieren la identidad de oficina. El acceso remoto de administración no autoriza a abrir perfiles operativos.

### 3.3. Preparación del lanzamiento

Mantener `POST /agent/sessions/prepare`, autenticado como operador. Responder con identificador de sesión, versión, `launchGrant` y `launchGrantExpiresAt`.

El grant será aleatorio, de un solo uso y con TTL de 60 segundos, ligado a operador, perfil, asignación y sesión. Guardarlo en Redis. No incluirlo en URLs, logs ni almacenamiento persistente del navegador.

La web entrega ese permiso al agente local; no le entrega la contraseña del perfil ni el JWT general del operador.

### 3.4. Canje y autorización de sesión

En `POST /station/credential-claims`, reemplazar el token de dispositivo por el grant de lanzamiento. Validar Access de oficina, consumir el grant atómicamente, repetir las validaciones de negocio e impedir reclamaciones concurrentes.

La respuesta incluirá las credenciales del perfil y `sessionVersion`, `sessionToken`, `sessionTokenExpiresAt`. Nunca registrar el secreto de perfil.

El token de sesión será aleatorio, permanecerá en memoria del agente y se almacenará como hash con expiración en el backend. Duración propuesta: 15 minutos, renovada mediante heartbeats autorizados. Solo permite operar esa sesión: estado, heartbeat y cierre. No permite volver a obtener credenciales ni sustituye el JWT de usuario.

Migración aditiva: incorporar hash, expiración y `claimedAt`; permitir `deviceId` nulo para nuevas sesiones y conservar relaciones históricas existentes.

### 3.5. Continuidad y cierre

- Heartbeat cada 10 segundos; permiso local máximo de 30 segundos y nunca posterior al final efectivo del turno/asignación.
- Revalidar usuario activo, rol, asignación y cobertura operativa. Mantener control de versión y cerrar ante pérdida de autorización o vencimiento.
- Para enfocar o cerrar desde la web, un endpoint autenticado emite un permiso de acción de un solo uso y 60 segundos. El agente lo canjea en backend; conocer un `sessionId` no concede autorización.
- El cierre por el propietario de la sesión no exige tener un turno todavía activo. El agente puede notificar el estado terminal mientras su autorización de sesión siga siendo válida.
- Si se pierde la respuesta con credenciales o token, no habilitar replay: cerrar o dejar expirar esa sesión y preparar un nuevo lanzamiento.

### 3.6. Retirada del flujo anterior

Deshabilitar en producción Cloudflare las rutas que aceptan únicamente `x-device-token`. Retirar la interfaz de registro de dispositivos propios y cualquier fallback de extensión que permita saltarse el nuevo flujo.

Conservar tablas históricas. Actualizar contratos compartidos, OpenAPI, matriz de rutas y pruebas. Auditar por usuario y sesión, sin inventar identificadores de dispositivo que Cloudflare no haya acreditado.

## 4. Web, agente e instalador

### 4.1. Web

Usar API del mismo origen (`/api/v1`). Comprobar disponibilidad, versión y capacidades del agente antes de preparar una sesión.

Mostrar estados comprensibles: conectado, apagado, requiere actualización o requiere reautenticación del equipo. Traducir errores conocidos de forma segura; no mostrar HTML de Cloudflare, excepciones internas ni secretos.

La descarga del instalador queda en el sitio protegido; IT puede obtenerla y distribuirla durante el alta de cada PC.

### 4.2. Agente Python actual

En `tools/agency-os-local-agent.py`, retirar el requisito de archivo de token de dispositivo. Canjear grants y conservar autorizaciones de sesión exclusivamente en memoria.

Usar la URL HTTPS pública protegida también para canje, estado y heartbeat. No copiar cookies del navegador ni guardar credenciales de Cloudflare en el agente. Tratar redirects inesperados y respuestas no JSON como errores de autenticación seguros.

Mantener escucha exclusivamente local en el puerto 45831 y validación exacta de Origin. Publicar versión y capacidades en health.

El piloto debe demostrar que las peticiones Python atraviesan Access mediante WARP sin interacción humana. Si no funciona, revisar el diseño antes del despliegue; no resolverlo con API pública ni Bypass.

### 4.3. Instalador Windows

Propuesta: PyInstaller e Inno Setup, Windows x64, interfaz en español y dependencias incluidas.

- Instalación por usuario en `%LOCALAPPDATA%\AgencyOS`.
- Arranque automático mediante HKCU Run al iniciar sesión en Windows, sin ventana de consola; proceso único.
- Acceso directo, comprobación de Chrome y configuración sin secretos.
- Logs rotativos sin credenciales ni grants.
- Bloquear actualización o desinstalación mientras haya perfiles activos.
- Desinstalación que retire el arranque automático y ofrezca eliminar datos locales.

WARP se distribuye mediante su instalador oficial. IT realiza el enrolamiento; no incrustar PIN, contraseña del buzón ni secreto compartido de enrolamiento en nuestro instalador.

## 5. Validación y despliegue

### 5.1. Piloto con dos PCs

Verificar:

1. PC enrolada con IT y Gateway corporativo accede al login de Agency OS.
2. WARP de consumo, otra organización y equipo sin WARP quedan bloqueados, incluso desde la oficina.
3. La dueña entra desde el móvil con su cuenta ADMIN; esa entrada no permite usar una cuenta operativa.
4. IP directa y cualquier hostname alternativo no permiten acceder al origen.
5. Agente Python abre un perfil, informa estado, mantiene heartbeat y cierra sin autenticación interactiva.
6. Grants vencidos o repetidos y tokens de otra sesión se rechazan.
7. Desactivar al usuario, terminar la asignación o perder WARP hace caducar el permiso local y cerrar la operación.
8. Desactivar al usuario o revocar su sesión de Access **cierra el WebSocket de realtime ya abierto** desde el backend (no solo bloquea reconexiones), con la demora máxima definida registrada.
9. Reiniciar Windows inicia el agente correctamente.
10. Probar reautenticación de WARP, pérdida de WebSocket, respuestas perdidas y ausencia de TalkyTimes en el túnel.

### 5.2. Verificación del código

Pruebas de guards con JWT de Access válido, inválido y vencido; integración de grants, carreras y expiraciones; regresiones de turnos, excepciones y relevos; pruebas del cliente HTTP Python; contratos compartidos, typecheck, lint y build. Probar el instalador en Windows limpio.

### 5.3. Orden de puesta en producción

1. Preparar cambios y pruebas en entorno de ensayo.
2. Configurar Cloudflare, Access y Tunnel.
3. Ejecutar el piloto y resolver sus bloqueos.
4. Programar transición sin sesiones operativas activas.
5. Aplicar migración aditiva y desplegar backend, web y agente coordinadamente.
6. Habilitar modo Cloudflare y deshabilitar el flujo legacy en producción.
7. Desplegar al resto de PCs y entregar procedimiento de alta, baja, reautenticación y recuperación.

Rollback: volver a la versión anterior dentro del perímetro protegido o detener el servicio. Nunca reabrir el origen públicamente para recuperar disponibilidad.

## 6. Supuestos y pendientes explícitos

- Confirmar correo real de la dueña, organización, audiencia y parámetros definitivos de despliegue.
- El plan Free cuenta identidades registradas, no usuarios concurrentes ni equipos por turno. Verificar las condiciones vigentes y el encaje del uso compartido de IT antes del despliegue; no prometer gratuidad por tener solo 30 PCs simultáneas.
- Dominio y VPS mantienen sus costos existentes.
- La autorización de PCs la administra Cloudflare; la atribución individual de operaciones sigue en Agency OS.
- La alta disponibilidad final sigue siendo un trabajo separado.
- Eliminar el token de dispositivo visible al cliente no elimina toda autenticación interna: los permisos breves de lanzamiento y sesión son necesarios para conservar el alcance por operador y perfil.

Referencia de licencias: [gestión de asientos](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/).
