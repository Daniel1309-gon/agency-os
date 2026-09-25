# Plan de implementación: piloto del bot de Rocket.Chat

## Alcance

Implementar `backend/PLAN_BOT_ROCKETCHAT.md` manteniendo `backend/` y `web-app/`
como proyectos independientes. El bot será determinístico, estará limitado a
salas registradas con propósito `BOT` y no ejecutará operaciones administrativas.

## Cortes verticales

### Corte 1: contrato y proveedor FAQ

- Payload HTTP nativo de Rocket.Chat validado y normalizado en la frontera.
- Interfaz `BotAnswerProvider` y proveedor FAQ sin privilegios operativos.
- Pruebas unitarias de normalización, prefijo, ranking determinístico y contenido
  no operativo.

### Corte 2: procesamiento seguro y entrega durable

- Token en tiempo constante, ignorado del bot, prefijo configurable y sala `BOT`.
- Usuario vinculado/no vinculado, alcance de conocimiento por cuadrilla y límite
  Redis de 10 consultas por minuto.
- Deducción por `message_id`, auditoría sanitizada y respuesta por outbox.
- Pruebas de integración PostgreSQL/Redis y contrato HTTP.

### Corte 3: conocimiento y operación local

- Cinco artículos JSON versionados.
- Importador idempotente que usa un JWT administrativo temporal sin imprimirlo.
- Scripts de migración, rol runtime restringido, bootstrap de IP, seed y arranque
  con `.env`.

### Corte 4: gates

- Lint, typecheck, build y unitarias del backend.
- Integración real si Docker/PostgreSQL/Redis están disponibles.
- Build/typecheck/lint/test del `web-app` desde su propio directorio.
- Revisión del diff y verificación de secretos/contenido del chat.

## Decisiones de implementación

- Los eventos de aplicación (token inválido, usuario no vinculado, mensaje fuera
  de alcance, duplicado) responden `200` para que Rocket.Chat no reintente. Las
  fallas de infraestructura se propagan como error para conservar reintentos.
- Un usuario de Rocket.Chat no vinculado recibe únicamente el mensaje genérico
  aprobado y no puede consultar artículos de cuadrilla.
- Las respuestas se guardan solo en la outbox necesaria para entregarlas; nunca
  se escriben pregunta, respuesta o token en logs/auditoría.
- La importación usa `BOT_KNOWLEDGE_ADMIN_JWT` o hace login temporal con
  `BOT_KNOWLEDGE_ADMIN_EMAIL/PASSWORD`; el token vive solo en memoria.

## Riesgos y verificación

| Riesgo | Mitigación |
|---|---|
| Payload real distinto al esperado | Schema nativo estricto y prueba HTTP con todos los campos documentados |
| Reintentos duplican respuestas | Índice único parcial sobre `sourceMessageId` y prueba concurrente/replay |
| FAQ filtra datos de otra cuadrilla | Filtrado por membresía vigente antes del proveedor |
| Error operativo expone secretos | Redacción de logger, metadata allowlist y tests sin token/texto |
| Se mezclan proyectos | Comandos de verificación ejecutados desde `backend/` y `web-app/` |
