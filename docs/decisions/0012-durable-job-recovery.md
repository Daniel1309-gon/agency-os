# ADR 0012: contrato de recuperación de jobs de Entrega 1

- Estado: propuesta técnica para E1-04
- Fecha: 2026-09-08
- Alcance: ASY-01, ASY-04, E1-03

## Problema

Los jobs de Entrega 1 despiertan hoy con `setInterval` y un lock Redis. El lock evita dos
ejecutores simultáneos, pero no conserva una ejecución omitida cuando el proceso está detenido,
ni distingue una ejecución que tardó más que su TTL de una ejecución recuperada por otro worker.

## Inventario y contrato

| Job | Fuente durable | Disparador | Idempotencia | Recuperación | Permiso worker |
|---|---|---|---|---|---|
| `shifts:materialize` | `shift_templates` + `shifts` | cada minuto | `ON CONFLICT DO NOTHING` sobre turno/operator/template/fecha | reprocesa fechas vencidas dentro de una ventana acotada; nunca crea más de una fila válida | `agency_worker` sobre plantillas, usuarios, crews y shifts |
| `shifts:open-close` | `shifts.scheduled_range` | cada minuto | transición condicionada por estado y borde superior | cierra usando `upper(scheduled_range)`, no la hora de recuperación; liquida una vez por CAS/estado | `agency_worker` sobre shifts/breaks/sesiones y outbox |
| `sessions:reap` | asignaciones y sesiones | cada minuto | `UPDATE ... WHERE status/heartbeat/boundary` | reconcilia estado actual; un heartbeat posterior al borde no revive la sesión | `agency_worker` sobre sesiones y asignaciones |
| `breaks:notify` | `breaks.notified_at` + `scheduled_at` | cada minuto | claim de `notified_at IS NULL` | un aviso vencido no se presenta como anticipado; política inicial: marcarlo omitido y no enviarlo tarde | `agency_worker` sobre breaks, shifts y outbox |
| `cafeteria:expire-orders` | `pickup_deadline_at` + estado | cada minuto | transición condicionada por estado | expira pedidos vencidos al siguiente ciclo; no reabre pedidos | `agency_worker` sobre pedidos |
| `audit:partitions` | particiones y `app_settings` | al arrancar + cada hora | función SQL idempotente | crea particiones futuras y conserva todo mientras retención sea 0 | hoy `agency_app` ejecuta la función autorizada; moverlo a worker exige grant explícito y prueba de rol |
| `outbox:dispatch` | `outbox_events` + leases | continuo, polling de 1 s | identidad del evento, claim y fencing por token | `PENDING/FAILED/PROCESSING` vencido vuelve a ser reclamable; `DEAD` requiere reproceso explícito | `agency_worker` solo en outbox y tablas de entrega autorizadas |

La fuente durable es la tabla de negocio cuando el job puede derivar su trabajo de ella. No se
añade una tabla de scheduler para duplicar fechas ya expresadas por `scheduled_range`, deadlines,
`notified_at` o leases. Una tabla de ejecuciones solo se justifica para métricas, backoff o una
cadencia que no pueda reconstruirse; esa decisión queda para E1-04a.

## Reglas de ejecución

1. PostgreSQL es el reloj autoritativo para límites de negocio (`now()` y `scheduled_range`). Redis
   coordina exclusión breve, pero perder Redis no cambia estados ni inventa tiempo trabajado.
2. Cada claim lleva `lease_expires_at` y un `lease_token`. El ejecutor conserva el token hasta
   confirmar; una actualización sin coincidencia de token y estado no modifica nada.
3. El TTL del lock debe superar el tiempo normal de la operación y renovarse mientras se procesa.
   Si el lease vence, el ejecutor antiguo puede terminar su cálculo, pero no puede confirmar efectos
   reclamados por otro. Las operaciones de negocio deben seguir siendo idempotentes por sus propias
   restricciones.
4. El backlog se procesa por lotes pequeños y ordenados, con un máximo por tick. Una recuperación
   grande continúa en ciclos posteriores; no se ejecuta una consulta sin límite al arrancar.
5. Los errores se registran con `job`, `run_id`, duración, lote, resultado y causa sanitizada.
   Una promesa rechazada no puede salir de un tick sin manejo. Los fallos repetidos pasan a una
   superficie observable de `FAILED/DEAD` cuando el job tenga cola durable.

## Caídas y bordes de negocio

- Una caída antes del claim deja el trabajo en su fuente durable.
- Una caída después del claim deja un lease vencible; otro worker lo puede reclamar tras el TTL.
- Una caída después de un efecto remoto y antes de marcar `SENT` conserva el estado ambiguo y se
  reintenta con la misma identidad. No se afirma exactly-once sobre Rocket.Chat.
- Un cierre recuperado después de `06:05`, `14:05`, `22:05`, medianoche o cambio de mes usa el
  intervalo aprobado y el instante de negocio almacenado. Nunca añade el tiempo que el scheduler
  estuvo detenido.
- Un break cuyo aviso quedó vencido durante una caída se marca omitido según la política inicial;
  la decisión de enviar avisos tardíos requiere aceptación operativa y no se infiere del código.

## Alternativas descartadas

- **`setInterval` como scheduler durable:** no conserva ticks omitidos ni ofrece observabilidad de
  backlog.
- **BullMQ como dependencia inmediata:** duplicaría el estado que ya existe en PostgreSQL y no
  resuelve por sí mismo la idempotencia de los efectos remotos.
- **Mover todos los jobs a la conexión worker sin revisar grants:** puede romper jobs que leen
  datos fuera del alcance de `agency_worker`; cada job se verifica con el rol real antes de moverlo.

## Próximo slice

E1-04a debe implementar solo el claim durable, renovación/fencing y observabilidad mínima, con dos
workers y PostgreSQL/Redis reales. E1-04b y E1-04c conservarán los jobs existentes y añadirán
recuperación acotada por familia. No se modifica el modelo ni se cambia el TTL hasta que esa prueba
mida la duración real de cada operación.
