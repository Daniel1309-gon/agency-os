# A2 — Comparación de VPS y decisión de compra (2026-09-21, rev. 4)

Estado: **decisión tomada por Daniel: Hostinger KVM 2, región Estados Unidos** (rev. 6: EE. UU. a 12 meses con KVM 2; el selector muestra EE. UU. a 96 ms y São Paulo medía 140–165 ms). Queda pendiente la verificación
de latencia contra el datacenter real y la contratación; **no se ha contratado ningún servicio**.
Daniel contrata y aporta accesos; el agente no ejecuta compras ni envía mensajes.

Requisito del plan vigente: 2 vCPU, 4 GB RAM, 80 GB SSD/NVMe, x86-64, región próxima a Colombia, con margen para Backblaze B2 dentro de US$30/mes. HA aplazada explícitamente; backups, restauración y rollback no se aplazan.

Precios consultados el 2026-09-21 en las páginas públicas. Son precios de lista **sin impuestos**; verificar en el checkout (puede aplicar IVA colombiano del 19% sobre servicios digitales).

## 1. Comparación

| Criterio | Vultr | DigitalOcean | Hetzner | Hostinger |
|---|---|---|---|---|
| Plan equivalente | Cloud Compute Regular `vc2-2c-4gb`: 2 vCPU, 4 GB, 80 GB NVMe | Basic 4 GiB/2 vCPU: 80 GB SSD | CPX22: 2 vCPU, 4 GB, 80 GB NVMe | KVM 2: 2 vCPU, **8 GB**, 100 GB NVMe |
| Precio de lista | **US$20/mes** | US$24/mes | €19,99/mes (~US$23,5); el tier económico CX23 figura no disponible | **US$8,99/mes** a 2 años; renueva a **US$14,99/mes** |
| Regiones cercanas | **Miami**, Atlanta, São Paulo, CDMX | Atlanta, Nueva York, Toronto | Solo EU y US (ASH/HIL) | **São Paulo**, EE. UU. (Phoenix, Boston), EU, Asia |
| Latencia medida desde el equipo de Daniel (2026-09-21, TCP 443, p50) | **Miami 55 ms** | Atlanta (no medido; típico 60–80) | no medido; estimado 120–220 | São Paulo medida con referencias de la ciudad: **140–165 ms** |
| Transferencia | 3 TB | 4 TB | 20 TB EU / 1 TB US | 8 TB |
| Ampliación | cambio de plan con reinicio | resize con apagado | upgrade con reinicio | upgrade con reinicio |
| Consola de recuperación | web + snapshots + ISO | web + recovery ISO | web + sistema de rescate | web + snapshots; SLA y rescate **sin verificar** |
| Compromiso | mensual | mensual | mensual | el precio promo exige 2 años (renovación US$14,99) |
| IPv4 | 1 incluida | 1 incluida | 1 incluida | 1 incluida |

**Hostinger KVM 4** (4 vCPU, 16 GB, 200 GB NVMe, 16 TB): US$12,99/mes a 2 años, **renueva a US$28,99/mes**. Se descarta por presupuesto: la renovación consume casi todo el objetivo y deja sin margen para B2, snapshots e impuestos; además 16 GB es el doble de lo que el diseño justifica.

**Backblaze B2**: US$6,95/TB/mes, Object Lock, egreso gratis hasta 3× lo almacenado; con decenas de GB queda por debajo de US$1/mes. Vultr figura entre los partners con egreso gratuito desde B2.

## 2. Latencia medida (2026-09-21)

Método: 10 pings ICMP + 15 conexiones TCP:443 a IPs de prueba públicas, desde el equipo de Daniel (Colombia). Se usan referencias de la misma ciudad cuando el proveedor no publica IP de prueba.

| Destino | ICMP avg | TCP 443 p50 | Lectura |
|---|---|---|---|
| Vultr **Miami** (`fl-us-ping.vultr.com`) | 58 ms | **55 ms** | confirma la estimación; la mejor opción |
| Vultr São Paulo (`sao-br-ping.vultr.com`) | 166 ms | 162 ms | **peor que lo estimado (~90–120 ms)** |
| AWS São Paulo (`s3.sa-east-1.amazonaws.com`) | 140 ms | 140 ms | misma ciudad, red distinta: ~140 ms |
| RocketChat actual (`chat.globalcompany.company`) | — | 89 ms | referencia operativa vigente |

Conclusiones:

1. **Miami mide ~100 ms menos que São Paulo** en esta conexión. La suposición de que São Paulo
   estaría cerca de 90–110 ms no se sostiene: las dos referencias independientes de la ciudad dieron
   140–166 ms.
2. **Hostinger no publica IP de prueba de su datacenter de São Paulo**, así que su latencia real no
   está medida. Antes de pagar: pedir a soporte una IP de prueba de Brasil y repetir esta medición
   desde la oficina.
3. ICMP y TCP443 coinciden (±3 ms), así que no hay deprioritización de ICMP que invalide el resultado.
4. Estas cifras son de **un solo punto de observación** (el equipo de Daniel). El plan pide medir desde
   la oficina; repetir allí antes de contratar.
5. **La latencia no es un requisito crítico de este sistema** (decisión de Daniel, 2026-09-21): el plan
   exige login p95 ≤5 s, heartbeats p95 ≤1 s y semáforo <500 ms, y con 140–165 ms esos umbrales tienen
   holgura amplia. La carga pesada (TalkyTimes) no pasa por el VPS y los jobs/backups son batch. Con
   latencia fuera de la ecuación, pesan más los 8 GB de RAM (elimina la tensión de scrypt, §5.3 de
   `agents.md`, sin depender de bajar `PASSWORD_SCRYPT_LOG2N`) y el costo.

## 3. Decisión: Hostinger KVM 2, región Estados Unidos

**Elegido: Hostinger KVM 2 a 12 meses** — 2 vCPU, 8 GB RAM, 100 GB NVMe, 8 TB de transferencia. Región:
**Estados Unidos** (Hostinger ofrece Phoenix y Boston para VPS; el selector de compra informa
«Best latency 96 ms» desde la conexión de Daniel, frente a 163 ms Düsseldorf y 140–165 ms medidos a
São Paulo con referencias de la ciudad). US$8,99/mes en el término promocional de 2 años; renueva a
US$14,99/mes. + B2 (<US$1) deja el total por debajo de los US$30/mes incluso en renovación, sin tocar
el alcance ni el scrypt.

Razones registradas: los 8 GB eliminan el riesgo de memoria que el propio proyecto dejó abierto para
4 GB; cumple y supera la capacidad acordada (2 vCPU / 4 GB / 80 GB); el precio es el más bajo de la
comparación; y 96 ms no compromete ningún umbral del plan (login p95 ≤5 s, heartbeats p95 ≤1 s,
semáforo <500 ms). Miami sigue midiendo mejor (55 ms) pero cuesta US$20 mensuales con 4 GB.

Decisión de tamaño razonada (2026-09-21): el único estrés de CPU es la oleada de 30 logins scrypt (~10 s-CPU); Postgres aporta ~0,1–0,2 s y por eso una BD gestionada no elimina el riesgo. Se arranca con 2 vCPU y se sube a KVM 4 (prorrateado, sin migración; bajar no está soportado) solo si la prueba de carga no cumple p95 ≤5 s. Techo documentado: medir `PASSWORD_SCRYPT_LOG2N=16` antes de reducir nada.

Condiciones antes de pagar (si alguna falla, vuelve Vultr Miami):

1. Confirmar en el checkout **qué ciudad** de EE. UU. se está contratando (Phoenix o Boston) y, si se
   puede, el dato de Brasil que aparece más abajo en la lista.
2. **No contratar el addon «Daily auto-backup» (US$6/mes)**: no reemplaza los dumps cifrados a B2 que
   ya están diseñados y consume presupuesto. Los snapshots del proveedor, si existen, se evalúan
   aparte para rollback.
3. Confirmar consola de recuperación, snapshots y soporte ante fallos del hipervisor (no verificado).
4. Confirmar el precio de renovación por escrito (US$14,99/mes) y el IVA aplicable.
5. Tras contratar, medir desde la oficina con el servidor real (`ping` + una descarga): p95 ≤250 ms
   sin pérdida; si no, migrar a Vultr Miami.

**Hechos contractuales verificados de Hostinger (2026-09-21):** la VPS admite facturación de 1, 12 o 24
meses (el precio promocional exige 12–24 meses; el mensual es más caro y no aparece por defecto).
Actualizar de plan es inmediato y prorrateado, sin migrar datos; **bajar de plan no está soportado**.
Renovación KVM 2 ~US,99/mes. Limitación para la HA: no ofrece red privada entre instancias, IP
flotante ni balanceador (confirmar con soporte); no bloquea el diseño por túnel de Cloudflare, pero la
replicación entre nodos iría cifrada por IP pública.
**Respaldo: Vultr Miami** (`vc2-2c-4gb`, US$20/mes mensual) si las condiciones anteriores no se
cumplen. **Descartados:** DigitalOcean (sin Miami y más caro), Hetzner (latencia y catálogo) y
Hostinger KVM 4 (renovación US$28,99 y 16 GB que el diseño no justifica).

## 4. Presupuesto mensual objetivo

| Opción | VPS | B2 | Total antes de impuestos |
|---|---|---|---|
| **Hostinger KVM 2 EE. UU. (elegido, promo 2 años)** | US$8,99 | <US$1 | **≈US$10 (con prepago)** |
| Hostinger KVM 2 (renovación) | US$14,99 | <US$1 | ≈US$16 |
| Vultr Miami `vc2-2c-4gb` (respaldo, mensual) | US$20,00 | <US$1 | ≈US$21 |
| Hostinger KVM 4 (renovación) | US$28,99 | <US$1 | ≈US$30 (sin margen) |
| DigitalOcean Atlanta | US$24,00 | <US$1 | ≈US$25 |

Si aparece presión real de memoria con scrypt a 128 MiB y 240 sesiones, el plan permite presentar
mediciones y subir a 4 vCPU/8 GB **antes** de ampliar, sin reducir scrypt; el KVM 2 ya cubre los 8 GB
y solo habría que evaluar los 4 vCPU (KVM 4) si el ensayo de carga lo exige.

## 5. Presupuesto autorizado (propuesta v3) vs. costo real

La propuesta comercial v3 §6 autorizó infraestructura de producción por ~US$155/mes: backend
App Platform US$70, PostgreSQL administrado US$50, Redis administrado US$35, almacenamiento US$5 y
frontend US$0 (Cloudflare). El plan de despliegue del 2026-09-20 fijó en cambio **un VPS dedicado con
PostgreSQL y Redis autogestionados y un objetivo interno de US$30/mes**, y aplazó explícitamente la
alta disponibilidad prometida por la propuesta (dos instancias + recuperación automática).

Consecuencias que deben quedar registradas:

1. **El costo real es ~US$16/mes** (KVM 2 + B2), muy por debajo de lo autorizado: la clienta ahorra
   del orden de US$135/mes. No es un exceso de presupuesto, es lo contrario.
2. **El ahorro no es gratis**: se entrega un solo VPS sin failover, con backups cifrados cada 30 min
   como recuperación. La promesa de «recuperación automática ~30 s» y «dos instancias con balanceador»
   queda aplazada y así debe constar en el acta.
3. **Por qué no se tomó la ruta administrada de la propuesta**: el esquema exige `CREATE ROLE`, RLS,
   `SECURITY DEFINER` y particiones sobre PostgreSQL (roles `agency_owner/app/worker`, migraciones
   propias), que los servicios administrados suelen restringir; Redis no es fuente de verdad y el
   diseño tolera su pérdida. Validar una base administrada sería un proyecto aparte.
4. **El presupuesto autorizado da margen para hacerlo bien**: sin pedir aprobación nueva se puede
   ampliar el VPS (KVM 4: 4 vCPU/16 GB por US$28,99 de renovación), pagar staging o financiar más
   adelante la HA con un segundo nodo, siempre por debajo de los ~US$155/mes. La decisión de gastar
   ese margen es de Daniel; el candidato actual no lo necesita.

## 6. Acciones que requieren a Daniel (no las ejecuta el agente)

1. Pedir a soporte de Hostinger la IP de prueba del datacenter de Brasil y medirla desde la oficina.
2. Contratar **KVM 2 en Estados Unidos** (o Vultr Miami si la verificación falla), confirmando por
   escrito la ciudad, la renovación y el IVA. No agregar el addon de auto-backup.
3. Crear la cuenta B2 a nombre de la clienta, bucket con Object Lock en la región más cercana
   disponible, y una *application key* sin permiso de saltarse retención.
4. Crear el túnel de Cloudflare `agency-os-prod` y entregar el token por canal seguro.
5. Generar el par SSH del VPS y la clave de consola; MFA en las cuentas.
6. Aportar el CIDR público del túnel/proxy para `TRUSTED_PROXY_CIDRS`.

Ninguna de estas acciones está hecha por este documento.

## 7. Registro de fuentes

- DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets (4 GiB/2 vCPU, US$24/mes, consultado 2026-09-21).
- Vultr pricing: https://www.vultr.com/pricing/ (`vc2-2c-4gb` US$20/mes; High Performance 2/4 US$24/mes; Miami disponible).
- Vultr test IPs: `fl-us-ping.vultr.com` (Miami) y `sao-br-ping.vultr.com` (São Paulo), medidas 2026-09-21.
- Hetzner cloud: https://www.hetzner.com/cloud/regular-performance/ y ajuste de precios 2026 (CPX22 €19,99; CX23 no disponible, verificado por terceros el 2026-09-07).
- Hostinger VPS pricing: https://www.hostinger.com/pricing/vps-hosting (KVM 2: US$8,99/mes a 2 años, renueva US$14,99; KVM 4: US$12,99, renueva US$28,99; consultado 2026-09-21).
- Hostinger ubicaciones VPS: https://www.hostinger.com/support/1583267-where-are-hostinger-servers-located/ (VPS: Brasil, EE. UU. Phoenix/Boston, EU, Asia).
- Backblaze B2: https://www.backblaze.com/cloud-storage/pricing (US$6,95/TB/mes, Object Lock, egreso 3×).
