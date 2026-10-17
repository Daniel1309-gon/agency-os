# OPS-07 — tiempo efectivo por intersección de intervalos · 2026-09-08

`pnpm ci:verify` completo y verde: **188 pruebas unitarias, 208 de integración (17 archivos),
`EXIT=0`**, con contratos, matriz de requisitos, lint de arquitectura y typecheck incluidos.
Antes del cambio la suite de integración tenía 203 pruebas.

## El defecto que se corrigió

`shifts.effective_minutes` se calculaba como `fin − inicio`, escrito **dos veces**: en
`shifts.service.ts` y en `jobs.service.ts`. Ninguna restaba los descansos, y la prueba
`records the effective minutes when the shift closes` **estaba verde afirmando esa fórmula**. No
era una omisión de cobertura sino una afirmación equivocada consolidada en la suite, que es peor:
una prueba verde defendiendo el error.

Las dos copias desaparecieron. Ahora ambos cierres llaman al mismo `settle()` del repositorio, que
usa la única función pura.

## La fórmula, versión 1

```
segmentos = (turno aprobado ∩ sesiones válidas) − descansos
minutos   = round(Σ duración(segmentos) / 60 s)
```

Documentada en [ADR 0011](../../docs/decisions/0011-effective-time-formula.md) e implementada en
[`effective-time.port.ts`](../../backend/src/modules/shifts/effective-time.port.ts).

## Criterios de aceptación mapeados a la prueba que los demuestra

| Criterio de OPS-07 / FR-17 | Prueba |
|---|---|
| Función pura versionada que intersecta shift/override/sesiones y resta breaks | `effective-time.spec.ts` «subtracts the break from the worked window» (415 min sobre un turno de 480) |
| Minutos nunca mayores al turno aprobado | «never counts time outside the approved shift»; «never exceeds the approved window, whatever the sessions do» barre 29 desfases de sesión |
| Minutos nunca negativos | «ignores inverted and empty intervals instead of going negative» |
| Sesiones parciales y solapadas con resultado definido | «counts overlapping sessions once» (ocho perfiles simultáneos = una jornada) |
| Breaks solapados con resultado definido | «collapses overlapping breaks instead of discounting them twice» |
| Cruces de día | «handles the night shift that crosses UTC midnight» (22:05→06:05 Bogotá) |
| Reconciliación suma de segmentos = total | `effectiveTimeSegments reconciles with the total`, 4 escenarios más los invariantes de tramos disjuntos y ordenados |
| Minutos enteros deterministas | Se redondea una sola vez sobre el total: partir una sesión en dos no cambia el resultado |
| Coordinador queda scoped | `shifts-and-crews.int.spec.ts` «limits a coordinator to the operators of their own crew» |
| Totales por operador/periodo y paginación | «paginates without losing the totals of the whole period» |
| Filtro por cuadrilla | «lets an admin narrow the report down to one crew» |
| Liquidación real contra Postgres | «records the effective minutes when the shift closes, discounting the break» (30 min) y el cierre automático «closes a shift exactly at its upper boundary» (415 min) |

## Dos cosas que este cambio deja establecidas y conviene no perder de vista

**Un turno sin sesión de perfil liquida cero minutos.** Es la fórmula escrita en `plan.md` §5.4 y
está cubierta por la prueba `does not pay a shift where no session was ever opened`, que existe
justamente para que el día que aparezca un turno completo en cero se encuentre la decisión y no un
bug. Pero ata el número de nómina a que la extensión funcione, y INT-01 todavía no la valida en una
PC administrada. Si el cliente prefiere pagar presencia, el cambio es quitar el término de sesiones
de la función pura; la ADR se reabre.

**`COORDINADOR` ganó el permiso `reports.read`.** La matriz de rutas ya declaraba `scope = CREW`
para `GET /api/v1/reports/effective-time`, pero el rol no tenía cómo llegar al endpoint. El
endpoint pasó además de `UNBOUNDED` a `OFFSET`. Ambos cambios están en el snapshot de OpenAPI
revisado y en `route-policy-matrix.md`.

## Efecto sobre el Checkpoint 2

Cierra una de sus dos brechas. **Sigue sin cumplirse**: ninguna prueba reinicia la API a mitad del
recorrido, que es la otra exigencia explícita del checkpoint.

## Lo que no se hizo

- No se persiste la versión de la fórmula por turno. Si la versión 2 cambia la cuenta, los turnos
  ya liquidados conservan el número viejo hasta que se recalculen. La constante viaja en la
  respuesta del reporte, suficiente para detectar el desajuste; persistirla es trabajo de PAY-01
  si nómina lo necesita.
- No hay exportación a archivo del reporte, solo consulta paginada.
