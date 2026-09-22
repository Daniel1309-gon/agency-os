# ADR 0013: topología de producción y ruta a alta disponibilidad

- Estado: aceptada
- Fecha: 2026-09-21
- Alcance: despliegue de Entrega 1 (plan 2026-09-20, fases A/E) y su evolución a HA

## Contexto

La propuesta comercial v3 §6 autorizó ~US$155/mes de infraestructura de producción (App Platform con
dos instancias, PostgreSQL administrado con recuperación automática y Redis administrado). El plan de
despliegue del 2026-09-20 decidió en cambio **un VPS dedicado con PostgreSQL y Redis autogestionados**
y aplazó explícitamente la HA; Daniel confirmó que la HA sigue siendo un objetivo futuro y que lo
construido ahora debe servir para ese momento.

Razones técnicas para no usar los servicios administrados: el esquema exige `CREATE ROLE`, RLS,
`SECURITY DEFINER` y particiones propias sobre PostgreSQL, y el diseño tolera la pérdida de Redis
porque no es fuente de verdad.

## Decisión

1. **Primer despliegue (ahora):** un VPS (Hostinger KVM 2, EE. UU.), con PostgreSQL, Redis, API,
   worker, Caddy y `cloudflared` en Docker; backups cifrados cada 30 min a B2 con Object Lock. La HA
   queda aplazada y consta así en el acta de aceptación.
2. **Restricción de diseño permanente:** ninguna decisión de esta fase puede cerrar la ruta a HA.
   Se consideran requisitos ya satisfechos y que deben conservarse:
   - API **sin estado** en memoria (JWT + BD); sesiones, jobs y outbox viven en PostgreSQL.
   - **Redis es desechable**: nada durable depende solo de él (realtime, límites, locks).
   - **Backups externos y restauración probada** antes de confiar en un failover.
   - **Migraciones aditivas** y despliegue por **digest de imagen**, no builds en el servidor.
   - Health checks (`/health/live` y `/health/ready`) y tolerancia a reinicios ya probada.
   - La entrada es el **túnel de Cloudflare**: no hay IP pública que reasignar ni DNS que cambiar al
     mover o duplicar nodos.
3. **Acciones de esta fase que dejan la puerta abierta (baratas, se ejecutan ahora):**
   - Publicar imágenes en **GHCR** y desplegar por digest; cada nodo corre el mismo compose sin
     compilar.
   - Mantener el compose **parametrizable por nodo**: endpoints de BD/Redis y dominios por variables;
     las IP estáticas solo dentro de la red Docker de cada nodo.
   - Terminar E1-04c (jobs durables) para que el scheduler tolere un segundo nodo con locks y trabajo
     recuperable en BD.
   - Mantener PostgreSQL en la misma versión fijada y los scripts de bootstrap/seed idempotentes, para
     que un standby se pueda crear por procedimiento y no por memoria del operador.
   - Definir una estrategia de secretos por nodo (Docker secrets o `sops/age`) y registrar que la
     **KEK del vault debe ser idéntica en ambos nodos**.
   - Conservar el mismo proveedor y región para el futuro segundo nodo (latencia de replicación).

## Topología objetivo (futuro, no se construye ahora)

- Dos VPS en la misma región: primario con PostgreSQL primario, API, worker y conector de túnel;
  secundario con standby en streaming, API y su propio conector.
- Redis con réplica (o Sentinel) para realtime y límites; sigue siendo desechable.
- Entrada con **Cloudflare Load Balancer** o varios conectores del mismo túnel; sin IP pública ni
  cambios de DNS al conmutar.
- Despliegue rodante por digest: migración aditiva una vez, luego nodos uno a uno contra el mismo
  esquema.
- Objetivos medidos en el ensayo: **RPO ≤5 min, RTO ≤30 min** (los del ADR 0009).

## Costo

Dos nodos KVM 2 + B2 ≈ **US$33/mes**, muy por debajo de los ~US$155/mes autorizados. No requiere
aprobación nueva de la clienta; el ahorro actual (~US$135/mes) es explícito en la matriz de cierre.

## Consecuencias

- La aceptación de la Entrega 1 registra HA aplazada y recuperación por backups, no failover.
- Las decisiones de esta fase se revisan contra la restricción 2: cualquier atajo que meta estado en
  Redis, dependa de una IP fija o impida un segundo nodo se rechaza.
- La ruta a HA conserva el trabajo hecho (imágenes, roles, RLS, outbox, backups) y solo agrega
  replicación, balanceo y ensayo de conmutación.

## Revisión acordada con Daniel (2026-09-21)

- La **HA no se decide en esta fase**: se resuelve al cierre de la Entrega 1, con el despliegue ya
  alineado con las dos rutas posibles.
- **Criterio de decisión**: un spike de compatibilidad de PostgreSQL gestionado (roles, RLS,
  `SECURITY DEFINER`, particiones) sobre una instancia mínima. Si pasa, es la vía preferida por menor
  operación; si no, Patroni o `pg_auto_failover` con testigo mínimo. En ambos casos la comparación
  final usa costo dentro de los ~US$155 autorizados y operación asumible.
- **Redis**: réplica manual entre nodos con promoción por script, sin Sentinel; se acepta pérdida de
  contadores y locks porque es desechable.
- **Imágenes**: GHCR (decidido), con despliegue por digest. El segundo nodo será copiar el compose y
  cambiar variables.
