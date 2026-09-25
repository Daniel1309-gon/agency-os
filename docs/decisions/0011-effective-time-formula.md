# ADR 0011: fórmula del tiempo efectivo

- Estado: aceptada
- Fecha: 2026-09-08
- Alcance: FR-17, OPS-07, y por dependencia FR-29 (nómina) y el Checkpoint 2

## Contexto

`shifts.effective_minutes` se calculaba como `fin − inicio`, escrito dos veces: en
`shifts.service.ts` (cierre manual) y en `jobs.service.ts` (cierre automático al vencer el turno).
Ninguna de las dos restaba los descansos. La prueba `records the effective minutes when the shift
closes` estaba **verde afirmando esa fórmula equivocada**, así que el defecto no era una omisión
sino una afirmación incorrecta consolidada en la suite.

## Decisión

La fórmula, versión 1, vive una sola vez, en
[`effective-time.port.ts`](../../backend/src/modules/shifts/effective-time.port.ts):

```
segmentos = (turno aprobado ∩ sesiones válidas) − descansos
minutos   = round(Σ duración(segmentos) / 60 s)
```

| Término | Qué es | Por qué así |
|---|---|---|
| turno aprobado | `scheduled_range` unido a los `shift_overrides` no revocados **que lo tocan** | Un override de otro día no debe ampliar la ventana de hoy. Es también la cota superior: los minutos nunca pueden exceder lo aprobado. |
| sesiones válidas | `profile_sessions` del operador, unidas | Unidas, no sumadas: ocho perfiles abiertos a la vez son una jornada, no ocho. |
| descansos | `breaks` del turno con `started_at`, unidos | Descansos solapados se descuentan una sola vez. |

Los tramos abiertos al momento del cierre (sesión viva, break sin terminar) se cierran en el
instante del cierre.

Tres consecuencias de diseño que se decidieron explícitamente:

1. **Se redondea una sola vez, sobre el total.** Redondear cada tramo haría que partir una sesión
   en dos cambiara el resultado; nómina necesita que la cuenta sea reproducible.
2. **La función es pura y vive en un `.port.ts`.** El módulo `jobs` también cierra turnos y llama
   exactamente el mismo `settle()` del repositorio. Dos copias de la fórmula fue el defecto
   original; que jobs no pueda tener la suya es parte del arreglo.
3. **Un turno sin `scheduled_range` da 0**, sin caso especial: su ventana aprobada es vacía.

## La consecuencia que hay que aceptar a ojos abiertos

**Un operador que estuvo presente todo el turno pero nunca abrió una sesión de perfil suma cero
minutos efectivos.** Es lo que dice la fórmula de `plan.md` §5.4 y es coherente con lo que el
reporte mide: trabajo, no asistencia. Pero ata el número a que la extensión funcione, y la
extensión es justamente lo que INT-01 todavía no valida en una PC administrada.

Queda cubierto por la prueba `does not pay a shift where no session was ever opened`, que existe
para que el día que alguien vea un turno completo liquidado en cero encuentre la decisión escrita
y no un bug.

La alternativa descartada era acotar por asistencia (`actual_start_at` → `actual_end_at`) e
ignorar las sesiones. Se descartó porque contradice el criterio escrito de FR-17. Si el cliente
prefiere pagar presencia, el cambio es quitar el término de sesiones de la función pura y esta ADR
se reabre.

## Alcance del reporte

`GET /api/v1/reports/effective-time` pasa de `UNBOUNDED` a `OFFSET` y deja de ser global:

- ADMIN y DIRECTOR_OPERATIVO ven todo, y pueden filtrar por `crewId`;
- COORDINADOR ve solo operadores con membresía vigente en las cuadrillas que coordina — pedir
  explícitamente un `operatorId` ajeno devuelve vacío, no error, para no filtrar existencia;
- cualquier otro rol ve solo lo propio.

`COORDINADOR` gana el permiso `reports.read`, que antes no tenía: la matriz de rutas ya declaraba
`scope = CREW` para este endpoint, pero el rol no podía llegar a él.

Los totales (`totalMinutes`, `byOperator`) describen el periodo completo, no la página devuelta.

## Lo que esta ADR no decide

- No se persiste la versión de la fórmula por turno. Si la versión 2 cambia la cuenta, los turnos
  ya liquidados quedan con el número viejo hasta que se recalculen. La constante
  `EFFECTIVE_TIME_FORMULA_VERSION` viaja en la respuesta del reporte, que es suficiente para
  detectar el desajuste; persistirla es trabajo de PAY-01 si nómina lo necesita.
- Zona horaria: Colombia no tiene DST, así que la duración en minutos no depende del huso. El
  agrupamiento por `business_date` sigue usando `businessDateInBogota`, que ya existía.
