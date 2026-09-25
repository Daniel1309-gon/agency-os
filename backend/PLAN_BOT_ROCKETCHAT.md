# Piloto del bot informativo en Rocket.Chat

## Resumen

El bot funcionará exclusivamente en `#ayuda-bot`, mediante el prefijo `ayuda`. El backend seguirá ejecutándose localmente durante el piloto y se publicará temporalmente con Cloudflare Quick Tunnel.

La primera versión será determinística: solo responderá desde preguntas y respuestas aprobadas. No modificará turnos, usuarios, asignaciones, credenciales ni otros datos operativos.

## Cambios de implementación

- Adaptar `POST /api/v1/rocketchat/bot/events` al payload nativo de Rocket.Chat: `token`, `user_id`, `channel_id`, `message_id`, `timestamp`, `text` y `trigger_word`.
- Normalizar ese payload en la frontera HTTP para conservar limpio el contrato interno del bot.
- Validar el token en tiempo constante, responder HTTP `200` para evitar reintentos innecesarios y deduplicar por `message_id`.
- Ignorar mensajes del propio `agency.bot`, mensajes sin el prefijo configurado y salas que no estén registradas como canal `BOT`.
- Limitar cada usuario a 10 consultas por minuto mediante Redis.
- No guardar preguntas, respuestas, tokens ni contenido del chat en logs o auditoría. Registrar solamente resultado, usuario interno, artículo utilizado, versión y latencia.
- Responder a usuarios no vinculados con un mensaje genérico: “Tu cuenta todavía no está vinculada con Agency OS. Contacta a administración”.
- Mantener la entrega mediante outbox para que los mensajes sobrevivan reinicios y no se dupliquen.
- Crear `backend/knowledge/*.json` con artículos versionados y un comando `pnpm bot:knowledge:import` que:
  - omita versiones idénticas;
  - rechace cambios sin aumentar la versión;
  - use un JWT administrativo temporal;
  - nunca imprima tokens.
- Añadir una interfaz interna `BotAnswerProvider`. Ahora usará FAQ controlada; más adelante podrá agregarse un proveedor generativo sin darle acceso a operaciones privilegiadas.
- Preparar scripts locales para migraciones, creación del rol restringido `agency_runtime`, seed, arranque con `.env` e IP bootstrap `127.0.0.1/32`.

## Guía paso a paso del piloto

1. En Rocket.Chat, crear:
   - usuario de servicio `agency.bot`, sin permisos administrativos;
   - canal privado `#ayuda-bot`;
   - cuatro participantes: administrador, coordinador y dos operadores;
   - membresía de `agency.bot` y los cuatro participantes en el canal.

2. Generar:
   - un PAT permanente para `agency.bot`, limitado a enviar mensajes;
   - un PAT administrativo temporal para consultar IDs de usuarios y sala;
   - un secreto aleatorio de al menos 32 caracteres para el webhook.

   Rocket.Chat autentica su REST API con `X-Auth-Token` y `X-User-Id`; el backend enviará respuestas mediante `chat.sendMessage`. Consulta la [documentación oficial de `chat.sendMessage`](https://developer.rocket.chat/apidocs/send-message).

3. Configurar `backend/.env` sin publicar secretos:
   - `NODE_ENV=production`
   - `DATABASE_URL` con el dueño de migraciones.
   - `DATABASE_APP_URL` con `agency_runtime`.
   - `REDIS_URL`
   - secretos reales para JWT y vault.
   - `ROCKETCHAT_BASE_URL`
   - PAT e ID de `agency.bot`.
   - `ROCKETCHAT_WEBHOOK_SECRET`
   - `ROCKETCHAT_BOT_TRIGGER=ayuda`
   - `TRUSTED_PROXY_CIDRS=127.0.0.1/32`
   - `CORS_ORIGINS` con el dominio real de Rocket.Chat.

4. Levantar el entorno local:

   ```powershell
   docker compose up -d postgres redis
   pnpm --dir backend db:migrate
   pnpm --dir backend db:bootstrap-runtime
   pnpm --dir backend db:seed
   pnpm --dir backend build
   pnpm --dir backend start:local
   ```

5. Confirmar:
   - `GET /health/live` devuelve `200`.
   - `GET /health/ready` confirma PostgreSQL y Redis.
   - el backend usa `agency_runtime`, no el dueño de la base.

6. Obtener con el PAT administrativo temporal:
   - ID de `#ayuda-bot`;
   - ID Rocket.Chat de cada participante.

   Después:
   - crear los cuatro usuarios en Agency OS;
   - guardar su `rocketchatUserId`;
   - registrar `#ayuda-bot` como canal global con propósito `BOT`;
   - revocar el PAT administrativo temporal.

7. Importar cinco FAQ técnicas iniciales:
   - capacidades y límites del bot;
   - turnos;
   - breaks;
   - protección de credenciales;
   - reporte de incidentes.

   Las respuestas de prueba indicarán cuándo contactar al coordinador y no afirmarán políticas de negocio todavía no aprobadas.

8. Abrir otra terminal y ejecutar:

   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```

   El comando generará una URL HTTPS aleatoria `trycloudflare.com`; cambiará cada vez que se reinicie el túnel. Consulta la documentación de [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

9. En Rocket.Chat crear una integración saliente:
   - evento: `Message Sent`;
   - canal: `#ayuda-bot`;
   - trigger word: `ayuda`;
   - ubicación del trigger: solo al comienzo;
   - URL: `https://<túnel>/api/v1/rocketchat/bot/events`;
   - token: el mismo `ROCKETCHAT_WEBHOOK_SECRET`;
   - script: deshabilitado;
   - ejecutar en ediciones: deshabilitado;
   - reintentos: habilitados, máximo 3;
   - publicar como: `agency.bot`.

   Rocket.Chat soporta nativamente canal, trigger words, token y reintentos para integraciones salientes. Consulta la [guía oficial de integraciones](https://docs.rocket.chat/docs/integrations).

10. Ejecutar el piloto:
    - `ayuda qué puedes hacer`
    - `ayuda cómo consulto mi turno`
    - `ayuda cambia mi contraseña`
    - repetir exactamente un mensaje;
    - probar con un usuario no vinculado.

11. Al terminar:
    - deshabilitar primero la integración saliente;
    - detener `cloudflared`;
    - detener el backend;
    - no eliminar volúmenes de PostgreSQL;
    - revocar cualquier PAT temporal restante.

## Pruebas y aceptación

- Payload nativo válido, inválido y con token incorrecto.
- Mensajes del propio bot no generan bucles.
- Un reintento del mismo `message_id` produce una sola respuesta.
- Usuarios no vinculados no reciben información interna.
- Artículos de una cuadrilla no aparecen para otra.
- Solicitudes de cambiar usuarios, vault o turnos no ejecutan ninguna acción.
- El límite de consultas se aplica por usuario.
- Caídas temporales de Rocket.Chat conservan el mensaje en la outbox.
- Token y texto del chat no aparecen en logs ni auditoría.
- Respuesta observable en Rocket.Chat en menos de 3 segundos durante el piloto.
- Gate: lint, typecheck, build, unitarias, integración y prueba HTTP completa.

## Supuestos

- El piloto tendrá cuatro participantes.
- `#ayuda-bot`, `agency.bot` y `ayuda` serán los nombres iniciales.
- El túnel es exclusivamente temporal y no representa el despliegue de Entrega 1.
- El despliegue definitivo usará un VPS separado, dominio estable, TLS, PostgreSQL/Redis respaldados y reemplazará la URL del túnel.
- La futura IA generativa recibirá únicamente conocimiento aprobado, tendrá timeout y fallback determinístico, y no podrá invocar operaciones administrativas.
