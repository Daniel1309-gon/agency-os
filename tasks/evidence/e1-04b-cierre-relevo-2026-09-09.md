# E1-04b — materialización y cierre · subavances 2026-09-09

**Estado: parcial; no es cierre formal de E1-04b.**

## Alcance

Se cubre la brecha pendiente de cierre tardío: después de un relevo contiguo, un worker que
despierta tarde debe respetar el borde superior programado del turno y cerrar el break abierto
contra ese mismo borde, no contra la hora de recuperación.

## Prueba

- Archivo: `backend/src/test/integration/checkpoint2-restart.int.spec.ts`
- Caso: `closes a handed-off overdue shift and break at their scheduled boundaries`
- Entorno: PostgreSQL y Redis de integración reales; se reinicia la instancia de API antes del
  cierre para que la liquidación ocurra desde un proceso nuevo.
- Comando:

  ```text
  cd backend
  .\node_modules\.bin\vitest.CMD run --config vitest.integration.config.ts src/test/integration/checkpoint2-restart.int.spec.ts
  ```

- Resultado: **1 archivo, 5 pruebas, 5 passed** (corrida focal posterior al backfill).

## Escenario y esperado

1. Turno en curso con rango `[start, boundary)` y break programado 30 minutos antes del borde,
   iniciado 15 minutos antes.
2. Sesión del operador saliente abierta; el relevo contiguo ocurre exactamente en `boundary` y
   la sesión termina con `SHIFT_ENDED` en ese instante.
3. La nueva instancia ejecuta `closeExpiredShifts(recovery)` con `recovery = boundary + 45 min`.

Resultado observado:

- `shift.status = COMPLETED` y `actualEndAt = boundary`.
- `break.status = COMPLETED`, `endedAt = boundary` y `durationMinutes = 15`; `scheduledAt` se
  conserva.
- La sesión saliente conserva `endedAt = boundary` y `endReason = SHIFT_ENDED`.
- `effectiveMinutes = 75`, calculados sobre la ventana programada y descontando el break, sin
  sumar los 45 minutos de retraso del worker.

## Recuperación de una fecha no materializada

Se añadió `JobsService.materializeShiftBacklog()`, con una ventana acotada de hoy y el día de
negocio inmediatamente anterior. El job del scheduler usa esa reconciliación en cada tick, por lo
que una caída que cruza medianoche o mes puede recuperar el turno nocturno sin duplicarlo.

- Archivo: `backend/src/test/integration/checkpoint2-restart.int.spec.ts`
- Caso: `recovers an unmaterialized previous business date after an API restart`
- Escenario: el turno del 31 de agosto no existe; tras reconstruir las instancias de servicios se
  recupera desde el 1 de septiembre, cruza al mes siguiente y una segunda ejecución inserta cero.
- Resultado: **1/1 passed** contra PostgreSQL/Redis reales.
- Cobertura auxiliar: `shift-schedule.spec.ts` verifica el cálculo de `2026-09-01 → 2026-08-31`.

## Conclusión y límite pendiente

El cálculo del cierre tardío no requiere cambio: `JobsService.closeExpiredShifts()` ya usa
`upper(shifts.scheduled_range)` para `actualEndAt`, el cierre del break y la liquidación efectiva.
Sí hubo un cambio de producción para la recuperación acotada de materialización.

E1-04b **permanece abierto**: `bootApi().stop()`/`bootApi()` demuestra que el estado sobrevive al
reemplazo de las instancias de servicios dentro de la prueba, pero aún falta el gate de reinicio
del proceso API/worker real, con su scheduler arrancando fuera de `NODE_ENV=test`, y la evidencia
operativa correspondiente.
