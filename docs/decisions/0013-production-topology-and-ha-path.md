# ADR 0013: topología de producción y ruta a alta disponibilidad

- Estado: aceptada (revisada 2026-10-17: spike de PostgreSQL gestionado aplazado; ensayo previo en
  un VPS de Daniel)
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

## Revisión acordada con Daniel (2026-10-17)

**Contexto.** La clienta no gestiona con regularidad los pagos de infraestructura (el servidor de
Rocket.Chat estuvo dos meses sin pagar). Cada servicio contratado aparte es un punto más de
suspensión por falta de pago, y la ruta a HA suma servicios. La revisión del 2026-09-21 pedía
resolver la HA al cierre de la Entrega 1 con el spike de PostgreSQL gestionado.

**Decisión.**

1. **La producción queda en un solo VPS**, como en el punto 1 de la decisión: PostgreSQL, Redis,
   API, worker, Caddy y `cloudflared` en Docker, más **B2** para los backups y **Cloudflare** para el
   túnel y el mTLS. No se contrata PostgreSQL gestionado ni un segundo nodo.
2. **El spike de PostgreSQL gestionado se aplaza.** Deja de ser un criterio de cierre de la Entrega
   1; la aceptación registra HA aplazada y recuperación por backups. La restricción de diseño 2 sigue
   vigente sin cambios: nada de lo que se construya puede cerrar la ruta a HA.
3. **Condiciones para retomar la HA** (cualquiera de ellas reabre esta decisión y el spike, con el
   criterio de la revisión del 2026-09-21):
   - una caída o restauración que supere el RTO de 4 h del diseño de backups, o una pérdida de datos
     mayor a la cadencia de 30 min;
   - que la operación pase a depender del sistema de forma que una caída de horas deje de ser
     asumible (por ejemplo, más cuadrillas o turnos sin cobertura manual);
   - una solicitud explícita de la clienta.
4. **Ensayo previo en un VPS de Hostinger contratado y administrado por Daniel.** Sirve para
   validar el despliegue de punta a punta y para mostrarle a la clienta el sistema en internet antes
   de contratar el suyo. Después Daniel conserva ese VPS para proyectos propios. Reglas del ensayo:
   - **Solo datos sintéticos.** No se cargan credenciales reales de TalkyTimes en el vault, ni
     operadoras, ni perfiles o datos de nómina reales. El ensayo no es producción.
   - **Secretos propios del ensayo.** `VAULT_KEK`, `JWT_SECRET`, `BACKUP_ENCRYPTION_PASSPHRASE` y
     las contraseñas de rol se generan para el ensayo y **no se reutilizan** en la producción de la
     clienta.
   - **Hostname y certificados de ensayo.** El ensayo usa un hostname y certificados de cliente
     propios; el hostname de producción y los certificados de las estaciones reales se emiten al
     desplegar en el VPS de la clienta.
   - **Sin migración de datos.** La producción de la clienta arranca con un despliegue limpio
     (Primer despliegue de `deploy/production/README.md`), no copiando volúmenes ni restaurando
     backups del ensayo. Si en algún momento la operación real llegara a empezar en el VPS de Daniel,
     esta regla deja de valer y la mudanza se hace como una restauración completa desde B2 con la KEK
     custodiada, según `deploy/production/backup/README.md`.
5. **Pagos (recomendación, no decidida).** Para que un olvido no apague el servicio: pagar el VPS de
   la clienta por adelantado (anual o bianual) y dejar B2 y Cloudflare en una cuenta con cobro
   automático administrada por Daniel, que lo refactura a la clienta.

**Consecuencias.**

- El runbook [`docs/prueba-vps-postgresql-gestionado.md`](../prueba-vps-postgresql-gestionado.md)
  mantiene las Fases 0–3, 5 y 6 para el ensayo y la producción; las Fases 4 y 7 quedan en espera
  hasta que se cumpla una condición del punto 3.
- Con un solo VPS, B2 es la única copia de los datos fuera del servidor: sus backups, su retención y
  la restauración probada (Fase 3 del runbook) pasan a ser el control crítico de disponibilidad.
- El costo de la producción de la clienta queda en un KVM 2 + B2, por debajo de los US$33/mes
  estimados para dos nodos.
