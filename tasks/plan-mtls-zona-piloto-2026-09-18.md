# Piloto de mTLS de zona para Agency OS: guía de ejecución delegable

Fecha: 2026-09-18. Estado: **ejecutado, aprobado y cerrado (2026-09-19)** — resultados en
[`tasks/evidence/mtls-pilot/README.md`](../evidence/mtls-pilot/README.md) y
procedimiento operativo en [`deploy/mtls-pilot/CERTIFICATES.md`](../../deploy/mtls-pilot/CERTIFICATES.md).

**Estado confirmado por el usuario:** `globalcompany.company` ya está activo en Cloudflare y DNSSEC ya fue configurado en Cloudflare y Hostinger. No repetir la configuración ni cambiar nameservers o registros de correo. Esta anotación registra lo informado por el usuario; no constituye una verificación técnica independiente.

**Resumen de la ejecución (2026-09-18):** los seis criterios de aprobación
quedaron verificados. El entorno aislado vive en `compose.mtls-pilot.yml`; el
agente acepta `--client-cert-file`/`--client-key-file`; la revocación se detectó
en 11 s con heartbeats de 10 s; el reemplazo (v2) recuperó el acceso y el v1
revocado siguió bloqueado. Hallazgo relevante: `NODE_ENV=test` desactiva los
timers de `JobsService`, por lo que el piloto usa `development`. La retirada
del token de dispositivo y el instalador definitivo quedan para el siguiente plan.

**Prueba end-to-end del agente (2026-09-19):** con el arnés local de TalkyTimes
(`tools/talkytimes-harness.py` y `tools/mtls-pilot-agent-harness.py`), el
operador entró por Chrome con mTLS y el agente abrió Alma Demo y completó el
login con la credencial del vault. Detalle en la evidencia. También se verificó
en Chrome del Galaxy S24 con el certificado en PKCS#12.

## 1. Objetivo, decisiones y responsabilidades

Demostrar que Chrome y el agente Python pueden acceder a Agency OS mediante un certificado de cliente, y que Cloudflare bloquea las conexiones sin certificado o con certificado revocado.

**Decisiones ya tomadas:**

- Usar `mtls-pilot.globalcompany.company`.
- Ejecutar el piloto en Docker en el computador de desarrollo. **No contratar un VPS.**
- Crear un entorno aislado de `agency-os-prod`, con datos ficticios y secretos propios.
- Usar mTLS de zona con CA administrada por Cloudflare y protección WAF. No usar WARP ni Access para este hostname.
- Mantener temporalmente el token de dispositivo de Agency OS.
- No operar perfiles reales de TalkyTimes.
- No implementar todavía el instalador definitivo ni la sustitución del token propio.

**El agente ejecuta** la preparación del entorno, cambios de código, configuración de Cloudflare cuando tenga acceso autorizado, pruebas y documentación.

**El usuario interviene únicamente** para iniciar sesión en Cloudflare, completar MFA, aceptar elevaciones de Windows que correspondan y facilitar una segunda red —por ejemplo, internet compartido desde su teléfono—.

El agente debe reutilizar la sesión de navegador autorizada si está disponible. Si no puede operar Cloudflare, debe proporcionar al usuario los campos y valores exactos, agrupando las acciones para evitar interrupciones repetidas. No solicitar contraseñas, claves privadas ni tokens en el chat.

## 2. Preparar el entorno local y la entrada de Cloudflare

### Paso 1. Inspeccionar y aislar el trabajo

Antes de modificar archivos:

- Leer las instrucciones vigentes del repositorio y revisar el estado de Git.
- Identificar los contenedores, redes y puertos existentes.
- Conservar los cambios ajenos; no reiniciar ni modificar `agency-os-prod`.
- Reutilizar las imágenes, servicios y scripts de migración del proyecto.

Crear una configuración de ensayo reproducible para el proyecto Docker `agency-os-mtls-pilot`, con:

- API, web, PostgreSQL, Redis, Caddy y `cloudflared`.
- Base de datos, volúmenes, redes y secretos exclusivos.
- Ningún puerto de estos servicios publicado en interfaces externas.
- Ninguna conexión a las bases de datos o volúmenes de producción.

Guardar secretos fuera de Git y comprobar que sus rutas están ignoradas. No imprimirlos en logs, capturas ni resultados de herramientas.

**Resultado esperado:** el entorno puede levantarse y detenerse sin afectar producción.

### Paso 2. Configurar la aplicación de ensayo

Preparar:

- Origen web: `https://mtls-pilot.globalcompany.company`.
- API: `https://mtls-pilot.globalcompany.company/api/v1`.
- CORS limitado al origen del piloto.
- Caddy interno por HTTP en el puerto 80.
- Rutas `/api/*` y `/socket.io/*` hacia la API; resto hacia la web.
- Rechazo de hostnames distintos al del piloto.
- Health checks ejecutados dentro de Docker.

Crear datos de prueba mediante los mecanismos existentes:

- Un administrador y un operador.
- Un dispositivo y token exclusivos del ensayo.
- Un perfil ficticio, una asignación y un turno vigentes.
- Credenciales ficticias en el vault de prueba.

Mantener el control actual por IP. Registrar únicamente las IP públicas concretas de las redes usadas durante el ensayo, con expiración al terminar el piloto. Configurar los proxies de confianza para los saltos internos reales y verificar la IP que interpreta el backend; no resolver problemas habilitando todos los rangos.

**Resultado esperado:** servicios saludables y reglas de negocio listas para probar, sin datos reales.

### Paso 3. Preparar el hostname y el túnel

En Cloudflare, comprobar que el hostname elegido no está en uso. No sobrescribir un registro existente. El dominio y DNSSEC ya están configurados por el usuario; no rehacer esa parte.

Crear un túnel administrado denominado `agency-os-mtls-pilot` y configurar su ruta pública:

| Campo | Valor |
|---|---|
| Hostname | `mtls-pilot.globalcompany.company` |
| Tipo de servicio | HTTP |
| Destino | `caddy:80` |

Preparar `cloudflared` en la red Docker del piloto, con su secreto fuera del repositorio. Mantenerlo detenido hasta completar la protección de mTLS.

No configurar una aplicación Access para este hostname ni activar su validación JWT en el túnel: la protección de este piloto será mTLS de zona más WAF.

**Resultado esperado:** ruta y conector preparados, sin publicar todavía la aplicación.

### Paso 4. Emitir el certificado y activar el bloqueo

En la PC Windows de prueba:

1. Generar localmente una clave privada y CSR exclusivos del ensayo, usando OpenSSL.
2. Identificar el certificado como `agency-pilot-pc01`.
3. En Cloudflare, abrir la zona → **SSL/TLS → Client Certificates** y emitir el certificado usando la CSR y la CA administrada por Cloudflare.
4. Elegir la menor vigencia disponible para el piloto y registrar su fecha de vencimiento.
5. Habilitar mTLS para `mtls-pilot.globalcompany.company`.
6. Obtener el identificador SKI del emisor para restringir la regla a esa CA.

Crear una regla WAF con acción **Block**, equivalente a:

```text
(http.host eq "mtls-pilot.globalcompany.company" and (
  not cf.tls_client_auth.cert_verified
  or cf.tls_client_auth.cert_revoked
  or cf.tls_client_auth.cert_issuer_ski ne "<SKI_DEL_EMISOR>"
))
```

Validar la expresión con el editor de Cloudflare antes de publicarla. Debe cubrir todo el hostname, sin excepciones por ruta, IP o usuario. Revisar que otras reglas no omitan su evaluación.

Cloudflare Free permite por defecto 100 certificados activos por zona. La regla debe comprobar expresamente las revocaciones. Referencias: [emisión de certificados](https://developers.cloudflare.com/ssl/client-certificates/create-a-client-certificate/) y [configuración de mTLS y WAF](https://developers.cloudflare.com/api-shield/security/mtls/configure/).

Después de activar la regla:

- Arrancar `cloudflared`.
- Confirmar que el túnel aparece saludable.
- Intentar abrir el hostname sin certificado.
- Comprobar que Cloudflare bloquea la petición y que no llega a la aplicación.

**Resultado esperado:** la primera exposición del entorno ya está protegida.

## 3. Configurar Chrome y adaptar el agente Python

### Paso 5. Instalar el certificado en Chrome

El agente prepara los archivos y comandos; el usuario acepta los permisos de Windows si son necesarios.

- Convertir el certificado y clave a un PFX protegido con contraseña.
- Importarlo en el almacén personal de la cuenta Windows usada en la prueba.
- No instalarlo como una autoridad raíz de confianza.
- Configurar `AutoSelectCertificateForUrls` para el hostname exacto, con filtro del emisor y del certificado de ensayo.
- Conservar las políticas existentes de Chrome; añadir solamente la entrada del piloto.
- Eliminar el PFX temporal después de la importación.
- Abrir el hostname y comprobar que aparece el login de Agency OS sin selector de certificados.

La clave PEM que requiere Python se conservará por separado durante el ensayo. Por ello, este piloto **no demuestra protección contra copia de la credencial ni vinculación al hardware**.

### Paso 6. Añadir mTLS al cliente HTTP del agente

Modificar el cliente compartido de `tools/agency-os-local-agent.py`, evitando implementar una ruta HTTP distinta para cada operación.

Interfaz nueva:

```text
--client-cert-file <certificado.pem>
--client-key-file <clave.pem>
```

Comportamiento requerido:

- Los dos argumentos deben suministrarse juntos.
- Crear el contexto con `ssl.create_default_context()` y cargar el certificado mediante `load_cert_chain()`.
- Mantener la validación HTTPS del servidor y su hostname.
- Reutilizar ese contexto para canje de credenciales, cambios de estado, heartbeat y cierre.
- Rechazar redirects, evitando reenviar el token de dispositivo a otro destino.
- Fallar al arrancar si los archivos no se pueden leer o no forman un par válido.
- No continuar sin certificado si se configuró mTLS y su carga falla.
- Conservar el funcionamiento existente cuando no se proporcionen los nuevos argumentos.
- Mantener obligatorio el token de dispositivo durante este piloto.
- Tratar respuestas de bloqueo y errores TLS sin mostrar secretos ni HTML al usuario.

Guardar certificado y clave en:

```text
%LOCALAPPDATA%\AgencyOS\mtls-pilot
```

Limitar los permisos de los archivos a la cuenta de Windows de prueba y SYSTEM. No incrustar claves en código, imágenes Docker ni parámetros de línea de comandos.

Preparar un comando reproducible de arranque con:

- API HTTPS del piloto.
- Origen web exacto del piloto.
- Token de dispositivo de ensayo.
- Certificado y clave.
- Carpeta de perfiles aislada.

Mantener la escucha del agente en `127.0.0.1`. Si el puerto habitual está ocupado, no detener el otro agente: usar el puerto 45832 para el piloto y compilar la web de ensayo con esa dirección local.

**Resultado esperado:** navegador y agente presentan el certificado independientemente; el agente no depende de cookies de Chrome.

## 4. Ejecutar las pruebas y reunir evidencias

### Paso 7. Verificar automáticamente el cliente HTTP

Añadir una prueba con la biblioteca estándar de Python y un servidor HTTPS local que exija certificado cliente. Comprobar:

- Certificado válido: petición aceptada.
- Sin certificado: conexión rechazada.
- Certificado de servidor no confiable: conexión rechazada.
- Redirect: no se sigue.
- Configuración parcial o archivos inválidos: error al arrancar.

Ejecutar también el self-test existente del agente. Ampliar checks del repositorio solamente si se modifican otros componentes.

### Paso 8. Verificar el flujo real a través de Cloudflare

Usar Chrome real y el agente modificado. Las peticiones a Cloudflare y al backend deben ser reales.

Para ejercitar el ciclo operativo, simular únicamente la interacción con TalkyTimes desde el arnés de prueba, sin añadir un modo ficticio activable en producción. No introducir credenciales reales ni iniciar sesión en perfiles de la clienta.

| Escenario | Criterio de aceptación |
|---|---|
| Chrome con certificado válido | Login visible sin selector de certificado. |
| Dispositivo sin certificado | Web y API bloqueadas por Cloudflare. |
| Agente con certificado y token válidos | Canje, estado, heartbeat y cierre funcionan. |
| Token válido sin certificado | Cloudflare bloquea la operación. |
| Certificado válido con token inválido | Agency OS rechaza la operación. |
| Reinicio de Chrome y agente | Funcionan sin reimportar certificado. |
| Cambio a la segunda red de ensayo | Funciona con el mismo certificado. |
| IP y puertos del equipo anfitrión | No ofrecen una entrada pública alternativa al piloto. |
| Certificado revocado | Nuevas peticiones de Chrome y agente quedan bloqueadas. |
| Certificado de reemplazo | Recupera el acceso; el anterior continúa bloqueado. |

Comprobar también la comunicación desde la web HTTPS hacia el agente en localhost. Si Chrome exige un permiso de acceso a red local, registrar el aviso y verificar su comportamiento después de reiniciar.

### Paso 9. Medir revocación y conexiones existentes

Revocar el certificado mientras el agente envía heartbeats y existe una conexión WebSocket abierta.

Registrar:

- Hora de revocación.
- Primera petición nueva rechazada.
- Último heartbeat aceptado.
- Momento en que vence el permiso local del agente.
- Comportamiento del WebSocket abierto y de su reconexión.

No asumir que revocar el certificado corta inmediatamente una conexión ya establecida. Una conexión que permanece abierta debe figurar como limitación explícita para el diseño definitivo.

## 5. Entrega, cierre y criterio de aprobación

El agente entregará:

- Configuración reproducible del entorno aislado.
- Cambio mínimo del agente Python y sus pruebas.
- Instrucciones de alta, importación, renovación y revocación.
- Informe en `tasks/evidence/mtls-pilot/README.md`, con resultados, versiones y tiempos medidos.
- Lista de cambios locales de Windows para poder retirarlos.
- Evidencias sanitizadas, sin claves, tokens, contraseñas ni contenido del vault.

**El piloto se aprueba si:**

1. Chrome y Python acceden sin intervención habitual.
2. Las pruebas sin certificado y con certificado revocado bloquean el acceso.
3. Las autorizaciones propias de Agency OS siguen funcionando.
4. El origen no queda expuesto directamente.
5. Renovar el certificado permite recuperar ambos clientes.
6. Las limitaciones de revocación y almacenamiento de claves quedan medidas y documentadas.

Al finalizar las pruebas, detener el túnel, revocar los certificados de ensayo y retirar los archivos privados y la política de Chrome añadida. Conservar configuración y evidencias para reproducir el piloto.

La recuperación ante fallos consiste en detener el entorno de ensayo. No desactivar su protección para dejarlo público ni modificar producción.

El siguiente plan, basado en los resultados, cubrirá la retirada del token propio, protección definitiva de claves, acceso de la dueña, instalador y arranque automático con Windows.

**Consecuencia concreta para la siguiente fase (2026-09-19):** revocar el
certificado no basta para terminar sesiones WebSocket existentes. El backend hoy
solo valida el JWT en el handshake del gateway y no cierra sockets al desactivar
un usuario ni al revocar sus tokens. Antes de eliminar el token de dispositivo
hay que implementar y verificar el cierre desde el backend en el siguiente
piloto. Requisito detallado en
[`plan-cloudflare-zero-trust-warp-2026-09-17.md`](plan-cloudflare-zero-trust-warp-2026-09-17.md)
§3.1 y escenario 8 de §5.1; medición en
[`evidence/mtls-pilot/README.md`](evidence/mtls-pilot/README.md).
