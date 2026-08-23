# ADR 0006: política de acceso por turno y overrides

- Estado: aceptada
- Fecha: 2026-08-23
- Alcance: SEC-06

## Contexto

Las operaciones del operador deben autorizarse con la ventana vigente del
turno o con un override aprobado. El borde de un relevo debe ser determinista:
se usan rangos semiabiertos `[)` para que el turno entrante pueda comenzar
exactamente cuando termina el saliente.

## Decisión

`ShiftAccessService` es la única fuente de verdad para login, refresh y
`ShiftWindowGuard`. La consulta compara contra un reloj inyectable y usa la
hora como parámetro de PostgreSQL, no SQL construido con entrada del cliente.
Los overrides aceptan solo `OVERTIME`, `EXTENDED_SHIFT` o
`SPECIAL_PERMISSION`, validan instantes reales aunque tengan offsets distintos
y dejan de autorizar inmediatamente al registrar `revoked_at`/`revoked_by`.

La ruta de revocación exige `shifts.approve_overtime` y vuelve a comprobar el
alcance de cuadrilla del actor. Los roles administrativos no heredan por
accidente la restricción de turno de `OPERADOR`; cada ruta declara su política
explícita.

## Consecuencias

- Los tests pueden probar 06:05, 14:05, 22:05 y medianoche sin depender del
  reloj de la máquina.
- Una revocación no borra el histórico: conserva quién aprobó, quién revocó y
  cuándo ocurrió.
- La materialización automática de turnos, cierres de sesión y breaks sigue
  siendo OPS-05/OPS-06; este slice solo cierra la decisión de autorización.
