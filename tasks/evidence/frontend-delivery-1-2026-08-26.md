# Evidencia frontend — Entrega 1

Fecha: 2026-08-28

## Alcance cerrado

- La operadora ve sus perfiles asignados desde `GET /agent/profiles/assigned` y puede preparar/reabrir una sesión segura para la extensión.
- La operadora ve el turno actual desde `GET /shifts/me/current`, los breaks desde `GET /breaks/:shiftId` y puede iniciar/finalizar cada break mediante los endpoints existentes.
- Coordinación ve el semáforo únicamente de su cuadrilla. El snapshot HTTP y los eventos Socket.IO usan el mismo contrato sanitizado y el canal se valida con JWT, origen, IP y rol.
- Coordinación, dirección y administración ven el catálogo de perfiles desde `GET /profiles`, incluyendo estado y vínculo de Chrome, sin contraseñas ni ciphertext.
- Se eliminaron de la pantalla de operadora los indicadores ficticios de mensajes/meta que pertenecen a Entrega 2. La fecha del dashboard ahora es dinámica.
- El botón de apertura valida el ID estable de la extensión desde `VITE_EXTENSION_ID`; frontend y backend quedan alineados con el ID público derivado del manifest (`fcniigapdfcoigmnkhkcgmhlhjdledbo`). La configuración inválida produce un error explícito y no intenta enviar credenciales.
- Se construyó el bloque administrativo de Entrega 1: usuarios y roles, catálogo editable de perfiles, asignaciones y relevos, turnos y overrides.
- Usuarios permite consulta para los roles autorizados y alta, edición y deshabilitación para el rol que tenga esas políticas; las contraseñas solo se reciben al crear un usuario y nunca se vuelven a mostrar.
- Perfiles permite crear, modificar metadatos y desactivar; conserva correctamente los perfiles que todavía no tienen carpeta nativa de Chrome vinculada.
- Asignaciones permite programar tramos con fecha/hora, preparar el relevo en el límite exacto y finalizar el tramo saliente. Turnos permite crear jornadas y registrar overrides con motivo; los overrides creados en la sesión pueden revocarse.
- Se añadió `roleCode` no sensible al listado de usuarios para que coordinación y dirección puedan filtrar operadores sin requerir acceso al catálogo administrativo de roles.
- Se construyó el panel de auditoría: consulta paginada, filtros por fecha/acción/actor, resultado, IP, request ID y metadata operativa sanitizada; nunca renderiza contraseñas, tokens, ciphertext ni secretos.
- Se construyó el panel de seguridad para administración: estado de PostgreSQL y Redis, estaciones aprobadas, heartbeat, IP y versiones de extensión/helper, con rotación y revocación de dispositivos sin exponer el secreto emitido.
- Se construyó la allowlist IP: reglas CIDR con alcance global, por rol o por usuario, expiración, alta y deshabilitación; la interfaz impide retirar la última regla activa antes de configurar otra red.

## Verificación

- `pnpm ci:quality`: PASS — requirements, extensión, helper, build, contratos, lint, typecheck, 31 suites backend (171 tests), 7 suites frontend (18 tests) y auditoría de dependencias sin vulnerabilidades conocidas.
- `pnpm --filter @agency-os/api test:integration`: PASS — 17 archivos, 198 pruebas contra PostgreSQL 16 y Redis 7.
- Verificación browser local con demo de desarrollo, sin credenciales reales: dirección cargó usuarios, perfiles, asignaciones y plantillas de turno desde la API; el formulario de nuevo perfil abrió correctamente; el dashboard cargó a 390 px de ancho sin errores de consola; la consola quedó sin errores en una navegación limpia.
- Verificación browser local del bloque de seguridad con administración: `/health/ready`, dispositivos, allowlist y auditoría respondieron correctamente; se comprobó el rechazo de un CIDR inválido sin mutar datos y una navegación limpia terminó sin errores de consola.
- La política actual conserva el principio de mínimo privilegio: dirección y coordinación consultan usuarios, mientras las mutaciones de usuarios solo aparecen si el rol tiene `users.create`, `users.update` o `users.disable`; el CRUD está implementado y queda habilitado para administración.

## Pendiente externo

`INT-01` sigue bloqueado: hace falta una PC de prueba autorizada para validar físicamente la política Chrome Enterprise, helper, vault, aislamiento de cookies y ocho perfiles simultáneos. Esto no impide seguir cerrando el frontend y los contratos backend verificables en local.
