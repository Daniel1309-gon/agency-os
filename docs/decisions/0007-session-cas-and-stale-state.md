# ADR 0007: CAS explícito y estado `STALE` para sesiones

- Estado: aceptada
- Fecha: 2026-08-24
- Alcance: OPS-03, OPS-04, FR-08, FR-10, FR-15

## Contexto

Una sesión de TalkyTimes recibe heartbeats desde una extensión y puede ser modificada al mismo
tiempo por el operador, el relevo de asignación o el reaper. Un `UPDATE` condicionado solo por
estado no distingue dos heartbeats que partieron de la misma observación. Además, cerrar por
heartbeat vencido como `CLOSED` mezcla una pérdida de señal con un cierre intencional y no deja una
salida explícita para limpiar una sesión abandonada.

## Decisión

`profile_sessions.version` empieza en 1 y tiene un `CHECK (version > 0)`. Toda transición iniciada
por el cliente lleva la versión observada; el backend actualiza con CAS sobre id, operador,
dispositivo, estado y versión, incrementa la versión en el mismo `UPDATE` y devuelve el resultado
con `RETURNING`. Handoff, fin de assignment y reaper también incrementan la versión.

El reaper convierte `ACTIVE` sin heartbeat dentro del umbral en `STALE` con
`end_reason = HEARTBEAT_TIMEOUT`. `STALE` es terminal para PATCH. La ruta de cierre recibe
`{ version }` y ejecuta su propio CAS; puede retirar `LAUNCHING`, `ACTIVE`, `ERROR` o `STALE` como
`CLOSED`, sin reabrir una sesión stale.

La proyección de perfiles selecciona la sesión no cerrada más reciente de la asignación vigente,
incluye `version` y no expone credenciales, tokens ni detalles internos. La web y la extensión
transportan esa versión para que un heartbeat perdido no se reintente con estado obsoleto.

## Alternativas consideradas

### Cierre implícito leyendo la versión actual

Rechazado: una ruta de cierre sin versión puede cerrar una transición más nueva que el cliente no
observó. El contrato ahora hace la intención concurrente explícita.

### Usar `CLOSED` para heartbeat vencido

Rechazado: pierde la diferencia operacional entre cierre voluntario, fin de turno y pérdida de
señal. También dificulta que el panel explique por qué una sesión dejó de estar viva.

### Permitir `STALE → ACTIVE`

Rechazado: una sesión sin heartbeat no debe revivir con un PATCH antiguo. El operador prepara una
nueva sesión; el cierre CAS retira la fila stale sin reactivarla.

## Consecuencias

- Un heartbeat concurrente perdedor recibe 409 y no puede sobrescribir el estado ganador.
- El body de `POST /agent/sessions/:id/close` cambia a `{ version }`; los clientes deben enviar la
  versión de su snapshot.
- La proyección evita duplicar reintentos `ERROR` y evita mostrar una sesión de una asignación
  anterior durante un relevo.
- El reaper sigue siendo un `setInterval` con lock Redis por ahora; la migración a leases/jobs
  durables queda en ASY-04.
