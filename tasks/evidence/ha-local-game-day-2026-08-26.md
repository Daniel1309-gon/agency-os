# Game day local de disponibilidad — 2026-08-26

Estado: **PASS para los escenarios locales; QUA-03 de producción sigue abierto**.

## Restore aislado de PostgreSQL

- Origen: contenedor local `agency-os-postgres-1` (`postgres:16-alpine`).
- Destino: contenedor efímero `agency-os-restore-drill` (`postgres:16-alpine`), sin tocar el volumen origen.
- Método: `pg_dump` en formato SQL por streaming hacia `psql --set ON_ERROR_STOP=1`.
- Resultado: restore terminado sin errores.
- Comparación no sensible origen/restaurado: `14` migraciones, `5` usuarios, `4` credenciales cifradas y `0` eventos outbox pendientes en ambos.
- Limpieza: el contenedor efímero fue eliminado; solo permanecen los servicios locales originales.

## Redundancia de API

- Se levantaron dos procesos stateless con la misma configuración de PostgreSQL/Redis: puertos `3101` y `3102`.
- Readiness inicial: ambas instancias respondieron `ok` con PostgreSQL y Redis `true`.
- Se detuvo la instancia `3101`.
- La instancia `3102` continuó respondiendo `ok`, con PostgreSQL y Redis `true`; `3101` quedó fuera de servicio.

## Alcance que esta evidencia no cubre

El `docker-compose.yml` local tiene un solo PostgreSQL y un solo Redis, por lo que esta prueba no demuestra:

- failover real de PostgreSQL primary/standby;
- failover real de Redis HA/Sentinel/managed;
- PITR a un punto anterior y medición formal de RPO;
- rolling deploy detrás del balanceador del proveedor;
- RTO medido bajo una interrupción de infraestructura.

Para cerrar QUA-03 hay que ejecutar el mismo game day sobre la infraestructura gestionada contratada y registrar timestamps de caída, promoción, restore y recuperación.
