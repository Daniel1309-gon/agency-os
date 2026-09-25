# Piloto mTLS de zona — evidencia de ejecución

Fecha: 2026-09-18. Estado: **aprobado** (los seis criterios de aceptación verificados).
Este documento registra resultados verificados; no incluye claves, tokens,
contraseñas ni contenido del vault.

## Criterios de aprobación

1. Chrome y Python acceden sin intervención habitual. **Cumplido.**
2. Las pruebas sin certificado y con certificado revocado bloquean el acceso. **Cumplido.**
3. Las autorizaciones propias de Agency OS siguen funcionando. **Cumplido.**
4. El origen no queda expuesto directamente. **Cumplido.**
5. Renovar el certificado permite recuperar ambos clientes. **Cumplido.**
6. Las limitaciones de revocación y almacenamiento de claves quedan medidas y documentadas. **Cumplido.**

## Alcance

Piloto de mTLS de zona (CA administrada por Cloudflare + regla WAF) sobre
`mtls-pilot.globalcompany.company`, con el entorno aislado `agency-os-mtls-pilot`
en Docker local. No usa WARP ni Access. Conserva el token de dispositivo de
Agency OS.

## Entorno aislado

- Proyecto Compose: `agency-os-mtls-pilot` (`compose.mtls-pilot.yml`).
- Redes propias: `172.32.0.0/24` (edge) y `172.32.1.0/24` (data, interna).
- Volúmenes propios: `pilot_pgdata`, `pilot_redisdata`, `pilot_caddy_data`,
  `pilot_caddy_config`.
- Secretos y material local en `.local/mtls-pilot/` (ignorado por Git, ACL
  restringida a la cuenta, SYSTEM y Administradores).
- Ningún puerto publicado al host: solo Caddy (interno) y cloudflared saliente.
- Caddy por HTTP interno con Host exacto; cualquier otro hostname responde 404.
- `TRUSTED_PROXY_CIDRS` limitado a los saltos reales (`172.32.0.10/32` Caddy,
  `172.32.0.11/32` cloudflared).
- Allowlist de IP del ensayo: dos entradas `/32` (IP pública de la red de prueba
  e ingreso interno del contenedor de operaciones), con expiración
  `2026-10-02T18:27:57Z` y reconciliación por etiqueta `mtls-pilot-*`.

## Datos de ensayo

- Operador: `operador@agency.test` (rol OPERADOR, cuenta demo).
- Perfil: `Alma Demo` (`Profile 5`), asignación y turno demo vigentes.
- Credencial ficticia en el vault del piloto (no es de TalkyTimes).
- Dispositivo `mtls-pilot-pc01` con token exclusivo del ensayo.

## Certificado

- Nombre: `agency-pilot-pc01` (CN propio, CSR generado localmente).
- Emisor: Managed CA de Cloudflare (SKI `3A5E5BECDD39EB05C7C1A289F1B50E01E244EFC3`).
- Vigencia observada: `2026-09-18` a `2027-09-18`.
- La clave privada permanece fuera del repositorio.

## Resultados verificados

| Escenario | Resultado |
|---|---|
| Hostname sin certificado | Bloqueado por Cloudflare (HTTP 403) |
| Hostname con certificado válido (health) | HTTP 200 `{"status":"ok"}` |
| Hostname con certificado válido (login operador) | HTTP 201, rol OPERADOR |
| Ciclo de estación completo por Cloudflare | `prepare` 201, `claim` 201, `ACTIVE` 200, `heartbeat` 201 `CONTINUE`, `close` 201 |
| Token válido sin certificado | Bloqueado por Cloudflare |
| Certificado válido con token inválido | Rechazado por Agency OS (HTTP 401) |
| Cliente Python sin User-Agent de navegador | Bloqueado por Cloudflare (error 1010); el agente envía `AgencyOS-Local-Agent/0.1` |
| Pruebas automatizadas del cliente mTLS | `uv run tools/test-local-agent-mtls.py` → ok |
| Self-test del agente | `uv run tools/agency-os-local-agent.py --self-test` → ok |
| Chrome con certificado y política aplicada | Login visible sin selector de certificado |
| Galaxy S24 con certificado (PKCS#12) | Login visible; el selector de Android se elige una vez y Chrome lo recuerda |
| Certificado revocado | Bloqueado por Cloudflare en `/healthz` y `/api/v1/auth/login` (HTTP 403) |
| Certificado de reemplazo (`agency-pilot-pc01-v2`) | Acceso recuperado (health 200) y ciclo operativo completo 201/200/201/201; el v1 revocado sigue bloqueado (403) |
| Agente abre perfil desde la web (end-to-end con arnés) | Operador entró por Chrome con mTLS, abrió Alma Demo y el agente completó el login de TalkyTimes con la credencial del vault (ver detalle) |
| WebSocket ya abierto durante la revocación | El socket sobrevivió los 90 s de observación posteriores a la revocación; la reconexión nueva quedó bloqueada (ver detalle) |

## Prueba de revocación de certificado con WebSocket ya abierto (2026-09-19)

Artefacto: `tools/mtls-pilot-websocket.mjs` (login + conexión al namespace
`/operations` con el certificado de cliente y JWT; sonda de revocación cada 5 s
con handshakes nuevos; observación de 90 s tras detectar el 403; reintento de
conexión al final).

Secuencia verificada (2026-09-19, certificado `agency-pilot-pc01-v4`):

1. `18:57:06` conexión al WebSocket con certificado válido; snapshot inicial con
   ack correcto.
2. `18:57:46` la sonda detecta la revocación (HTTP 403 de Cloudflare).
3. `18:57:46` a `18:59:16` (90 s): **el socket abierto siguió funcionando**; los
   10 round-trips posteriores a la revocación respondieron con ack. El único
   cierre lo hizo el propio cliente al terminar la observación
   (`io client disconnect`), no Cloudflare.
4. `18:59:18` reintento de conexión nueva con el mismo certificado revocado:
   **bloqueado** (`connect_error: websocket error`).

Conclusión para el diseño: la revocación corta conexiones nuevas en el siguiente
handshake, pero **no termina un WebSocket ya establecido**. Verificado en el
código: el gateway valida el JWT únicamente en `handleConnection`
(`backend/src/modules/realtime/realtime.gateway.ts:32-56`), y ni
`AdminService.disableUser` ni `AuthService.revokeAllUserTokens` desconectan
sockets. Un socket abierto sobrevive a la revocación del certificado, a la
desactivación del usuario y al vencimiento del access token, y sigue recibiendo
eventos de sus salas.

Consecuencia concreta para la siguiente fase: **antes de eliminar el token de
dispositivo hay que implementar y verificar el cierre desde el backend** —
desconectar las salas del usuario al desactivarlo o revocarle la sesión
(por ejemplo `server.in(room).disconnectSockets(true)`), y/o revalidar
periódicamente la autorización del socket. El piloto de la fase siguiente debe
medir la demora máxima de ese cierre. Ver el requisito en
[`tasks/plan-cloudflare-zero-trust-warp-2026-09-17.md`](../plan-cloudflare-zero-trust-warp-2026-09-17.md)
§3.1 y el escenario 8 de §5.1.

## Prueba end-to-end del agente con el arnés de TalkyTimes (2026-09-19)

Sustitución local de TalkyTimes (hosts + servidor HTTPS con CA de ensayo); el
arnés vive en `tools/talkytimes-harness.py` y no se integra al agente de
producción. El resto del recorrido es real: Chrome/Windows con certificado v2,
web por Cloudflare con mTLS, canje de la credencial del vault y sesión de
estación.

Secuencia verificada (2026-09-19 ~17:12 UTC):

1. El operador entró a `https://mtls-pilot.globalcompany.company` desde Chrome
   con el certificado v2, sin selector (política aplicada).
2. Click en **Abrir perfil** de Alma Demo.
3. El agente local (puerto 45832, mTLS + token de dispositivo) reclamó la
   credencial del vault y abrió Chrome aislado contra TalkyTimes.
4. El arnés registró el intento: `email=alma.demo@talkytimes.test`,
   `password_length=24`, `credential_ok=true` (contraseña nunca escrita en el log).
5. La sesión `cb12c871-3097-4705-ad1d-51264f80b30d` quedó `ACTIVE` con heartbeat
   y se cerró al terminar (versión final 4).

Artefactos: `tools/talkytimes-harness.py`, `tools/mtls-pilot-agent-harness.py`,
log del arnés en `.local/mtls-pilot/talkytimes-harness/access.log`.

Hallazgos de la prueba:

- La IP pública del hotspot cambió entre sesiones; la allowlist del backend
  rechazó con `403 IP address is not allowed` hasta actualizarla. La web mostró
  "No pudimos verificar tu sesión" (estado recuperable), no un error de mTLS:
  el certificado y el WAF funcionaron. En operación real esto exige gestión de
  IP (o el reemplazo del control por IP que propone el plan Zero Trust).
- Chrome mantuvo en caché el certificado viejo (revocado) hasta reiniciarse: la
  política `AutoSelectCertificateForUrls` se lee al arrancar.
- Brave no aplica la política de Chrome: muestra el selector y funciona
  eligiendo `agency-pilot-pc01-v2` una vez.

## Medición de revocación (paso 9)

Ensayo con heartbeats cada 10 s sobre una sesión `ACTIVE`:

- Último heartbeat aceptado: `2026-09-18T21:40:35.601262+00:00`
- Primera petición rechazada: `2026-09-18T21:40:46.101482+00:00` (HTTP 403 de Cloudflare)
- **Los 11 s anteriores no son el tiempo medido desde la revocación**: la
  revocación la ejecutó el operador manualmente y no quedó registrada su hora
  exacta. Lo que se midió es el intervalo entre dos intentos consecutivos de
  heartbeat (uno aceptado y el siguiente rechazado). La latencia real de
  detección queda acotada por el período de heartbeat: cualquier petición nueva
  posterior a la revocación es rechazada, y la primera que ocurre no puede
  tardar más que un ciclo (≤10 s más la latencia de la petición). No se midió
  el instante exacto de la revocación, así que no se afirma un valor menor.
- El permiso local del agente vence como máximo 30 s después del último heartbeat
  aceptado; con la revocación, el rechazo corta el ciclo antes.
- Limitación confirmada: la revocación se aplica en el siguiente handshake TLS;
  una conexión ya establecida no se corta por sí sola. El agente reintenta en
  cada heartbeat, por lo que el efecto práctico es de un ciclo. La misma
  limitación se midió específicamente sobre un WebSocket abierto (ver la prueba
  dedicada arriba): sobrevivió los 90 s medidos y solo la reconexión quedó
  bloqueada.
- El agente desaparecido sin cerrar sesión: la sesión quedó `ACTIVE` y el reaper
  del backend la marcó `STALE`/`HEARTBEAT_TIMEOUT` al superar 120 s sin heartbeat
  (verificado).

## Hallazgo: `NODE_ENV=test` desactiva los jobs del backend

`JobsService.onModuleInit()` retorna sin programar timers cuando
`NODE_ENV === 'test'` (`backend/src/modules/jobs/jobs.service.ts:18`). El piloto
arrancó en `test` y por eso el reaper de sesiones no actuaba. Se cambió el
piloto a `development` para ejercitar el comportamiento real; con eso el reaper
marcó la sesión huérfana. El entorno station-e2e usa `test` deliberadamente,
así que este comportamiento es esperado en ese stack, pero no debe usarse como
referencia de operación.

## Cambios de código

- `tools/agency-os-local-agent.py`: opener HTTPS compartido con certificado de
  cliente opcional (`--client-cert-file`, `--client-key-file`), rechazo de
  redirects, User-Agent propio, `certifi` para el bundle de CAs; `ca_file`
  opcional sin certificado de cliente para pruebas de confianza aisladas.
- `tools/test-local-agent-mtls.py`: servidor HTTPS local con certificado de
  cliente obligatorio. El caso «sin certificado» usa la misma CA que el caso
  válido, de modo que el rechazo solo puede deberse a la ausencia del
  certificado de cliente (no a desconfianza del servidor); el caso «servidor no
  confiable» exige un fallo de verificación explícito. Cubre además redirect y
  configuración parcial/inválida.
- `tools/mtls-pilot-cycle.py`: ciclo operativo completo contra Cloudflare.
- `tools/mtls-pilot-websocket.mjs`: mide la supervivencia de un WebSocket
  abierto a la revocación y el bloqueo de la reconexión.
- `tools/talkytimes-harness.py` y `tools/mtls-pilot-agent-harness.py`: arnés
  local de TalkyTimes y arranque del agente con el arnés (solo ensayo).
- `compose.mtls-pilot.yml`, `deploy/mtls-pilot/`: entorno, Caddyfile, scripts de
  inicialización, importación/retiro del certificado y arranque del agente.

## Límites conocidos

- La clave PEM del agente se conserva en disco: el piloto no demuestra
  protección contra copia ni vinculación al hardware.
- La revocación del certificado no corta una conexión TLS ya establecida. En el
  agente, el efecto práctico es el siguiente heartbeat (≤10 s); en un WebSocket
  abierto, la conexión sobrevivió los 90 s medidos y solo la reconexión quedó
  bloqueada (ver la prueba dedicada).
- `AutoSelectCertificateForUrls` requiere elevación de Windows (la clave de
  políticas de Chrome pertenece a Administradores/SYSTEM). Aplicada y verificada.
- El error 1010 de Cloudflare obliga a que el agente use un User-Agent propio.
- El trust store de Windows puede conservar intermedios vencidos; el agente usa
  `certifi` para no depender de él.
- Los heartbeats con certificado revocado reciben HTML de Cloudflare; el agente
  lo trata como error de autenticación seguro, sin mostrarlo al usuario.

## Cambios locales de Windows a retirar

- Certificado `agency-pilot-pc01-v2` en `Cert:\CurrentUser\My` — **retirado** el
  2026-09-19.
- Entrada de política Chrome del piloto (`AutoSelectCertificateForUrls`) —
  **retirada** el 2026-09-19; la clave quedó eliminada.
- Certificado PKCS#12 en el Galaxy S24 — **retirado** el 2026-09-19.
- Ningún otro cambio de sistema.

## Cierre del piloto (2026-09-19)

- Procesos locales del agente, del arnés y de la prueba WebSocket detenidos;
  puertos 443 y 45832 libres.
- Stack `agency-os-mtls-pilot` eliminado con sus volúmenes y redes
  (`docker compose down --volumes`); no queda nada corriendo.
- Archivos privados del piloto eliminados (`.local/mtls-pilot/`, incluidos
  secretos, certificados, token de dispositivo y logs). La configuración
  reproducible permanece en `compose.mtls-pilot.yml` y `deploy/mtls-pilot/`.
- Certificado de Windows y política de Chrome retirados; certificado del S24
  retirado.
- Los cuatro certificados de ensayo (`agency-pilot-pc01`, `-v2`, `-v3`, `-v4`)
  quedaron revocados en Cloudflare por el operador.
- Túnel `agency-os-mtls-pilot` y registro DNS de
  `mtls-pilot.globalcompany.company` eliminados en Cloudflare, según
  confirmación del usuario el 2026-09-19. La configuración local reproducible
  se conserva para recrearlos cuando sea necesario.
- CSRs del escritorio retirados.
