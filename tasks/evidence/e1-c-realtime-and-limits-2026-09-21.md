# Evidencia C1/C2 — sockets revalidados y límites de oficina compartida (2026-09-21)

Alcance: plan [`plan-cierre-entrega-1-despliegue-2026-09-20.md`](../plan-cierre-entrega-1-despliegue-2026-09-20.md) §2 C1 y C2.
Correcciones de 2026-09-22: `e89a0ca` (sesión web) y `eea5dc0` (puente worker).
El resto de E1 aún contiene cambios anteriores en el árbol de trabajo.

## C1 — autorización de conexiones persistentes

1. **Vida máxima 45–60 s con cierres repartidos.** `RealtimeGateway` programa cada conexión
   (`SOCKET_LIFETIME_MIN_MS` + jitter de 15 s) y la cierra antes si el JWT vence. Cada reconexión
   repite usuario, rol, versión de autorización, certificado del equipo, IP y salas.
2. **Versión de autorización (`users.auth_version`).** Migración `0021_user_auth_version.sql`.
   El JWT lleva el claim `av`; `JwtAuthGuard` y el handshake WebSocket lo comparan con la fila vigente
   y rechazan cualquier token anterior. Sube al desactivar un usuario, cambiar rol/datos, cambiar la
   contraseña o mover una cuadrilla (`AuthVersionService.bump`), y además corta los sockets del usuario
   en el acto.
3. **Revocación que corta conexiones.** `RealtimeService.disconnectUser/disconnectDevice/disconnectRole`
   usan `disconnectSockets` sobre las salas `user:<id>` / `device:<id>` / `role:<code>`; con el adaptador
   Redis la orden cruza instancias. Se invoca al desactivar usuario, cambiar rol, cambiar contraseña,
   mover cuadrilla y revocar un dispositivo. Objetivo del plan: cierre en ≤5 s en condiciones normales.
4. **Snapshot al reconectar.** El gateway emite `operators.snapshot` y `cafeteria.orders.snapshot` en
   cada conexión; el cliente no asume que recibió todos los eventos.
5. **Cliente web.** Ambos consumidores (`use-operator-statuses`, `CafeteriaKds`) desactivan el
   retry automático de Socket.IO y aplican la misma regla a `disconnect` y `connect_error`:
   renuevan vía `/auth/me` antes de conectar; un 401/403 terminal corta el intento y notifica
   a `AuthProvider`, que pasa a anónimo. Red, 5xx y 429 reintentan con backoff exponencial,
   jitter y tope de 15 s; el contador vuelve a cero al conectar. `ApiClient` emite el fin de
   sesión una sola vez si falla el refresh o el request reintentado; un login fallido no lo emite.
6. **Cierre del servidor no es automático en socket.io.** Con `reason = "io server disconnect"` socket.io
   no reintenta: sin manejo explícito el semáforo y la cafetería quedan congelados tras el primer ciclo.
   `scheduleServerCloseReconnect` (`web-app/src/realtime/server-close-reconnect.ts`, 6 pruebas unitarias)
   reintenta con la política anterior para los dos consumidores, y
   `realtime-server-close.int.spec.ts` lo demuestra de punta a punta contra Postgres/Redis reales: el
   servidor cierra el socket y el **mismo** cliente vuelve a conectar y recibe snapshot fresco.
7. **Vencimiento del JWT.** El gateway cierra la conexión al vencer el token (`disconnect(true)`), no
   con `connect_error`; reconectar con el token vencido solo repite el rechazo. El helper renueva la
   sesión (`/auth/me`, con refresh deduplicado por el api-client) **antes** de reconectar, y
   `realtime-server-close.int.spec.ts` cubre el ciclo completo: cierre del servidor, rechazo con el
   token vencido, `POST /auth/refresh` y reconexión con snapshot.
8. **El worker publica a los sockets sin duplicados.** Sin servidor socket.io local (worker),
   `RealtimeService` publica por Redis `agency:realtime:bridge`; cada API emite a sus propios
   sockets con `server.local.to(...)`, evitando que el Redis adapter redistribuya dos veces el
   mismo evento. `realtime-redis.int.spec.ts` conecta un cliente a cada API y exige exactamente
   un evento por cliente en 300 ms. Si la suscripción inicial falla, el servicio registra el
   fallo y reintenta de 5 a 60 s; `RedisService` descarta el duplicado cuyo `connect()` falló.
   Las pruebas unitarias cubren retry, recreación y emisión local de operador y cafetería.

## C2 — límites de autenticación para 30 operadores

| Ámbito | Límite | Clave |
|---|---|---|
| Login por cuenta | 5 / 15 min | `auth:login:account:<email>` |
| Login por certificado de estación | 30 / 15 min | `auth:login:cert:<sha256>` |
| Login agregado por IP | 300 / 15 min | `auth:login:ip:<ip>` |
| Refresh por sesión/dispositivo | 60 / 15 min | `auth:refresh:device:<id>` (fallback a cuenta) |
| Refresh agregado por IP | 1.200 / 15 min | `auth:refresh:ip:<ip>` |

Contadores con `INCR` + expiración en Redis (atómicos) y fail-closed: si Redis no responde, 503. Ningún
límite se desactivó. El límite anterior de 5/15 min por IP bloqueaba el relevo de toda la oficina.
La conexión perezosa del cliente (`enableOfflineQueue: false`) espera el evento `ready` cuando ya hay
un intento en curso: dos contadores concurrentes del mismo login (cuenta + IP) respondían 503 y quedó
cubierto por `redis-service.int.spec.ts`.

## Comandos y resultados

| Comando | Resultado |
|---|---|
| `pnpm --dir backend typecheck` / `lint` | verdes (34 excepciones de arquitectura) |
| `pnpm ci:verify` (Postgres 16 + Redis 7 aislados, 2026-09-22) | verde: backend 205 unitarios, integración **251/251**, shared 8 y web 66; build, lint, typecheck, migraciones, seed y check verdes |
| `pnpm test:contracts` | 10/10 |
| `pnpm test:requirements` | 34/34 |
| `pnpm --dir web-app test` | 66/66 |

`pnpm audit --prod --audit-level high` pasó el umbral configurado y reportó cuatro
vulnerabilidades **moderadas**; requieren seguimiento antes del despliegue.

Pruebas nuevas relevantes:
- `realtime-redis.int.spec.ts`: JWT con `av` obsoleto no permanece conectado; desactivar un usuario desde
  otra instancia cierra su socket; revocar un dispositivo cierra los sockets de ese equipo.
- `auth.int.spec.ts`: 30 logins con el mismo certificado e IP se aceptan y el 31.º da 429; otro
  certificado no hereda el castigo; refresh con 60 usos por sesión y 429 al 61.º.
- `guards.spec.ts`: `JwtAuthGuard` rechaza un token válido con `av` obsoleto.

## Limitaciones explícitas

- La revocación en Cloudflare (certificado) no corta una conexión ya establecida; por eso la conexión
  vive como máximo 60 s. No se presenta ese plazo como propagación instantánea de Cloudflare.
- La prueba de 30 WebSockets durante 30 minutos con reconexiones es parte de la prueba de carga del
  plan (§3) y requiere el VPS; aquí se cubren los mecanismos y sus pruebas de integración.
- El cierre en ≤5 s se verifica en las pruebas de integración con dos instancias en la misma máquina;
  la latencia real de la oficina se mide en la prueba de carga.

## Caída de Redis con las APIs vivas (E1-06, 2026-09-23)

`realtime-redis.int.spec.ts` › *recovers cross-instance events, the worker bridge and auth limits
after Redis drops every connection*: con dos APIs reales y un cliente socket.io conectado a la
segunda, una conexión administrativa ejecuta `CLIENT KILL TYPE normal` y `CLIENT KILL TYPE pubsub`
(corta ≥4 suscriptores: adaptador y puente de cada API). Es lo que ven los procesos cuando Redis se
reinicia.

| Comprobación | Resultado (3 corridas locales) |
|---|---|
| Evento originado en la API 1 llega al cliente de la API 2 | se recupera; test completo en ~620 ms |
| Evento publicado por el worker por el puente | llega tras la resuscripción automática de ioredis |
| Login con credenciales malas (límite en Redis) | 401, no 503 |
| Socket del cliente con su API | sigue conectado: la conexión cliente↔API no depende de Redis |

Qué se pierde y qué se recupera mientras Redis está caído:

- **Se pierde**: eventos en tiempo real entre instancias y del worker emitidos durante la caída
  (pub/sub no persiste). El test reintenta el disparador hasta recibir uno.
- **Se degrada (503)**: login, refresh y límites que leen Redis (`auth.service.ts` convierte el fallo
  en `ServiceUnavailableException`, sin conceder acceso).
- **Se recupera sin reiniciar la API**: clientes de comandos (`RedisService.ensureReady`), adaptador
  socket.io y puente (resuscripción automática). El estado de verdad está en PostgreSQL: al
  reconectar, cada socket recibe un snapshot (`realtime-server-close.int.spec.ts`).
- **No depende de Redis**: el scheduler durable (`job_runs` con lease en PostgreSQL).
