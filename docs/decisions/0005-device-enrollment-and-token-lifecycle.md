# ADR 0005: enrolamiento y ciclo de vida del token de dispositivo

- Estado: aceptada
- Fecha: 2026-08-23
- Alcance: SEC-05

## Contexto

Las estaciones de oficina son compartidas: el token acredita una instalación
administrada de helper + extensión, pero no identifica a la persona sentada
frente a ella. La identidad humana sigue viniendo del JWT y de los guards de
rol/turno. El código de enrolamiento y el token de estación necesitaban
límites de vida y una rotación explícita.

## Decisión

Un código de enrolamiento se guarda únicamente como HMAC, tiene TTL de 15
minutos y se consume dentro de un `UPDATE` condicional que exige estado
`PENDING` y expiración futura. Al consumirse se limpia el hash y se emite un
token opaco de dispositivo con TTL de 90 días, guardando solo su hash.

La rotación administrativa genera un token nuevo en una sola actualización y
reemplaza el hash anterior; por tanto, el token anterior deja de ser válido
inmediatamente. Revocar limpia tanto el código pendiente como el token. El
heartbeat repite las condiciones de estación aprobada y token no expirado, y
normaliza la IP antes de persistirla.

El `DeviceTokenGuard` adjunta al request solo el principal interno de la
estación (`id`, `label`, expiración). No se crea binding operador→PC: el campo
`assigned_operator_id` legado no participa en autorización.

## Alternativas rechazadas

- Códigos de enrolamiento sin expiración: un código filtrado podría aprobar
  una estación meses después.
- Rotar agregando un token sin invalidar el anterior: una copia robada
  seguiría activa.
- Atar una estación a un operador: contradice el modelo de PCs compartidos y
  rompe los relevos; la asignación de trabajo se valida por JWT, turno y
  sesión.
- Guardar el token o incluirlo en auditoría: ampliaría el impacto de un log o
  lectura accidental de la base.

## Consecuencias

- La instalación debe completar el enrolamiento dentro de 15 minutos y
  guardar el token recién emitido en el canal seguro del helper/extensión.
- Una rotación requiere distribuir el token nuevo a la estación; durante esa
  operación el token anterior falla cerrado.
- Métricas, sesiones y vault aún deben consumir este principal y validar sus
  propios scopes en sus slices correspondientes; este ADR no convierte el
  token en autorización de negocio por sí solo.
