# Checkpoint 2 — la brecha del reinicio de API · 2026-09-08

Cierra la segunda y última brecha que dejó abierta la corrida del 2026-09-07
([`checkpoints-1-3-2026-09-07.md`](checkpoints-1-3-2026-09-07.md)). La primera, el cálculo del
tiempo efectivo, se cerró con OPS-07 ([`ops-07-effective-time-2026-09-08.md`](ops-07-effective-time-2026-09-08.md)).

## Qué significa "API reiniciada" aquí

El checkpoint pide repetir el recorrido *"con dos requests concurrentes y una API reiniciada"*.
Reiniciar de verdad significa tirar el proceso de aplicación completo, no reasignar una variable:

- se destruye el `DatabaseService` y con él su pool de Postgres;
- se destruye el `RedisService` y su conexión;
- se pierde el `AsyncLocalStorage` que ata las transacciones al request;
- se descartan todas las instancias de servicio y se construyen nuevas.

Lo que sobreviva tiene que estar en Postgres o en Redis. El pool crudo del contexto de pruebas
(`ctx.pool`) no se reinicia a propósito: es el canal de observación del test, no la API.

Implementado en
[`checkpoint2-restart.int.spec.ts`](../../backend/src/test/integration/checkpoint2-restart.int.spec.ts)
con un `bootApi()` que devuelve una instancia completa y su `stop()`.

## Las tres pruebas

**`resumes the shift, the break and the handover after the process is replaced`** — recorrido
completo con el corte en medio. La instancia A abre el turno, asigna el perfil, abre la sesión,
hace heartbeat y arranca el descanso. Se mata. La instancia B: cierra el descanso que abrió la
anterior, hace el siguiente CAS sobre la sesión con la versión que devolvió A (`version + 1`, o sea
que el número no vivía en memoria), ejecuta el relevo contiguo **sin 409 espurio**, comprueba que
la asignación anterior quedó `ENDED/HANDOFF` y su sesión `CLOSED/SHIFT_ENDED`, y liquida el turno.

El tiempo efectivo se verifica contra los instantes reales de la sesión y del descanso leídos de la
base, no contra una constante: `round((sesión − descanso) / 60 s)`. Así la aserción es exacta y no
depende del reloj del test.

**`keeps two concurrent requests to a restarted API from both winning`** — la otra mitad de la
exigencia, las dos condiciones a la vez. Tras el reinicio, dos heartbeats con la misma versión: gana
exactamente uno, porque el CAS vive en Postgres. Dos cierres de turno concurrentes: uno completa, el
otro recibe `NotFoundException`/`ConflictException`, y el turno queda `COMPLETED` con minutos
liquidados una sola vez.

**`lets a fresh instance close the shifts the previous one left expired`** — el cierre automático
tampoco depende del proceso que abrió el turno. Una instancia deja un turno vencido con un descanso
abierto, se muere, y `closeExpiredShifts` de la instancia nueva lo cierra. Liquida cero minutos,
porque no hubo sesión de perfil: el reinicio no altera la fórmula de FR-17.

## Estado del Checkpoint 2

**Cumplido.** Las seis exigencias del recorrido ya estaban demostradas el 2026-09-07; las dos
brechas que lo bloqueaban están cerradas.

## Un detalle que la prueba dejó a la vista

En el recorrido tal cual, sesión y descanso duran segundos y todo redondea a cero, con lo que la
resta del descanso no se observa. Por eso la prueba retrasa `started_at` de ambos antes del
reinicio. No es maquillaje del resultado: es la única forma de que un recorrido que en producción
dura ocho horas produzca tramos medibles en una prueba de dos segundos, y la aserción sigue
derivándose de los instantes que quedaron en la base.
