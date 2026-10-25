# Prueba del VPS de producción y de PostgreSQL gestionado

Runbook de continuidad y plan de pruebas ejecutable para retomar el trabajo desde un PC nuevo.
Este documento reúne el contexto mínimo, el plan por fases y los criterios de evidencia de dos
frentes que quedaron pendientes al cierre de la Entrega 1 (E1):

1. **El baseline de producción**: desplegar y validar el VPS con PostgreSQL y Redis autogestionados
   (decisión vigente, [ADR 0013](decisions/0013-production-topology-and-ha-path.md)).
2. **El spike de compatibilidad de PostgreSQL gestionado**: decidir si una base administrada
   soporta el esquema real (`CREATE ROLE`, RLS, `SECURITY DEFINER`, particiones) y una restauración
   completa sin superusuario. Es el criterio acordado para elegir la ruta a alta disponibilidad.

**Estado real al escribir (2026-10-16):** no se ha ejecutado ninguna fase remota de este documento.
No hay evidencia de que el VPS, el túnel, el bucket B2 ni una instancia gestionada estén
contratados: la [comparación A2 de VPS](../tasks/a2-comparacion-vps-2026-09-21.md) registra la
decisión de compra (Hostinger KVM 2, EE. UU.) pero cerró con la contratación pendiente. Cada fase
empieza verificando el estado real, no lo asume. Este documento no contrata servicios, no aplica
configuración remota y no es una autorización: describe pruebas y exige autorización explícita
antes de aprovisionar, conectarse por SSH o ejecutar pruebas remotas.

**Revisión 2026-10-17 ([ADR 0013](decisions/0013-production-topology-and-ha-path.md), revisión de
esa fecha):** la producción queda en **un solo VPS con B2 y Cloudflare**, y el spike de PostgreSQL
gestionado se aplaza: deja de ser criterio de cierre de la Entrega 1. Las **Fases 4 y 7 quedan EN
ESPERA** hasta que se cumpla una de las condiciones de reapertura del ADR. Las Fases 0–3, 5 y 6 se
ejecutan primero como **ensayo en un VPS de Hostinger de Daniel**, con datos y secretos propios del
ensayo, y después en el VPS de la clienta.

**Avance del ensayo (2026-10-25, VPS de ensayo `erp.rentia.online`):** la **Fase 1 pasó** (despliegue,
túnel, mTLS positivo y negativo, login del admin) y la **Fase 3 pasó el 2026-10-25** (primer ciclo de
backup exitoso en 26 s; Object Lock, limpieza y restauración verificados). Las Fases 2, 5 y 6 no han
empezado. Detalle en
[`tasks/evidence/ensayo-vps-rentia-2026-10-21.md`](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md).

---

## Quick path

Si tienes poco tiempo, este es el camino corto; cada paso enlaza a la sección detallada.

1. **Prepara el PC nuevo** (§2): clona el repositorio, verifica versiones (`node >=22`,
   `pnpm >=10`, Go según `local-helper/go.mod`) e instala; recupera accesos y custodia de secretos sin copiar valores al repo.
2. **Verifica el estado real** (§2.4): confirma rama/commit y si el VPS/B2/túnel ya existen. Nada
   se asume.
3. **Ejecuta la verificación local** (Fase 0): `pnpm ci:verify` verde antes de tocar cualquier
   entorno remoto.
4. **Con autorización escrita de Daniel**, ejecuta en orden en el VPS de ensayo de Daniel: Fase 1
   (VPS + túnel + mTLS), Fase 2 (capacidad), Fase 3 (backups B2 y restauración real), Fase 5 (humo)
   y Fase 6 (interrupción). Después, repite el despliegue limpio en el VPS de la clienta.
5. **Completa la matriz de resultados** (§6) con cada corrida; sin evidencia registrada, una prueba
   no cuenta.
6. **Fases 4 y 7: EN ESPERA** (ADR 0013, revisión 2026-10-17). Solo se retoman, con el inventario
   del proveedor (§3), si se cumple una condición de reapertura de la HA.

---

## 0. Cómo leer este documento

**Etiquetas de estado** (se usan en todo el documento):

| Etiqueta | Significado |
|---|---|
| **Acordado** | Decisión registrada en un ADR o plan del repositorio; no se renegocia aquí. |
| **Propuesto** | Parte de este runbook: hay que aprobarlo antes de ejecutarlo o construirlo. |
| **Verificado (local)** | Ya se demostró en el PC de desarrollo, con evidencia fechada en `tasks/evidence/`. Sirve como regresión, no como resultado remoto. |
| **Pendiente externo** | Depende de recursos reales (VPS, B2, Cloudflare, proveedor, PC de oficina). No está hecho. |
| **En espera** | Aplazado por decisión (ADR 0013, revisión 2026-10-17); no se ejecuta hasta que se cumpla una condición de reapertura. |

**Etiquetas de comando** (el repo es multiplataforma; no mezcles shells):

| Etiqueta | Dónde y con qué se ejecuta |
|---|---|
| `[PC/pwsh]` | PowerShell en el PC Windows de trabajo. |
| `[PC/bash]` | bash en la PC: WSL o Git Bash. Necesario para scripts escritos para Linux (`aws`, `openssl`, `sha256sum`). |
| `[VPS]` | Shell del VPS (Linux, `sh`/`bash`) por SSH, solo con autorización. |
| `[manual]` | Consola web de un panel (Cloudflare, Backblaze, proveedor de PG, Rocket.Chat). |
| `[propuesto]` | El comando o instrumento todavía **no existe** en el repositorio; hay que construirlo o verificarlo antes de confiar en él. |
| `[histórico]` | Comando ya ejecutado en local con evidencia en `tasks/evidence/`; úsalo como referencia, no como resultado actual. |

**Reglas del ensayo (§4 resumido):** datos sintéticos, producción intacta, KEK y claves de backup
custodiadas, salidas saneadas (sin contraseñas, sin ciphertext, sin secretos) y limpieza solo de
recursos desechables con confirmación explícita.

---

## 1. Contexto: qué está decidido, qué está propuesto y qué falta

### 1.1 Estado por tema

| Tema | Estado | Dónde está registrado |
|---|---|---|
| Primer despliegue: un VPS con PostgreSQL y Redis autogestionados; HA aplazada | **Acordado** | [ADR 0013](decisions/0013-production-topology-and-ha-path.md) |
| HA futura definida al cierre de E1 por un spike de compatibilidad de PG gestionado; si falla, Patroni o `pg_auto_failover` con testigo mínimo | **Reemplazado**: el spike se aplaza y deja de ser criterio de cierre de E1 | ADR 0013, revisión 2026-09-21 |
| Producción en un solo VPS con B2 y Cloudflare; spike aplazado con condiciones de reapertura; ensayo previo en un VPS de Daniel con datos y secretos propios | **Acordado** | ADR 0013, revisión 2026-10-17 |
| Presupuesto autorizado: ~US$155/mes; costo actual estimado ~US$16/mes (KVM 2 + B2) | **Acordado** | [Propuesta v3 / A2 §5](../tasks/a2-comparacion-vps-2026-09-21.md) |
| RPO ≤5 min y RTO ≤30 min | **Acordado como objetivo del ensayo de HA futuro** (ADR 0009/0013); NO es una promesa del diseño actual de backups | [ADR 0009](decisions/0009-rbac-and-production-topology.md) |
| Backup actual: dumps cifrados cada 30 min a B2; objetivo del plan "pérdida máxima de una hora de datos y recuperación en cuatro horas" | **Acordado y con artefactos listos** | [deploy/production/backup/README.md](../deploy/production/backup/README.md) |
| Restore fiel **local** como superusuario (extensiones, dueños, GRANT, DEFAULT ACL, vault con KEK) | **Verificado (local)** 2026-09-23 | [e1-e-backups](../tasks/evidence/e1-e-backups-2026-09-21.md) |
| Restore `--no-owner --role=agency_owner` sobre el esquema real | **Verificado (local) como FAIL** (365 errores en cascada) | e1-e-backups, ensayo 2026-09-23 |
| Restore sobre PostgreSQL gestionado sin superusuario | **En espera** (Fase 4) | ADR 0013, revisión 2026-10-17 + e1-e-backups §Pendiente |
| VPS contratado, túnel, B2, reglas Cloudflare, restore real RPO/RTO | **Pendiente externo** | [Matriz de cierre §7](../tasks/cierre-e1-matriz-2026-09-21.md) |
| Prueba de 30 logins / 30 sockets / scrypt en hardware real | **Pendiente externo** (umbrales acordados en el [plan §3](../tasks/plan-cierre-entrega-1-despliegue-2026-09-20.md)) | Matriz E1-17 |
| Modelo de roles, RLS, `SECURITY DEFINER` y particiones | **Verificado (local)** contra PostgreSQL 16 real | Migraciones y suites citadas en §1.3 |
| Plan por fases de este documento | **Propuesto** | Este archivo |

### 1.2 Arquitectura de referencia (texto plano)

Despliegue vigente de E1 (lo que despliega la Fase 1):

```
Estaciones Windows (oficina)          Cloudflare (borde)               VPS (Hostinger KVM 2, EE. UU.)
┌─────────────────────────┐          ┌──────────────────────┐         ┌───────────────────────────────┐
│ Chrome (perfil operador)│  mTLS    │ WAF: exige cert.     │         │ cloudflared (salida túnel)    │
│ Agente local (WinHTTP)  │ ───────► │ Transform: Client-Cert│ ──────► │   └─► Caddy :80 (interno)     │
│ Web App (navegador)     │          │ Health/webhook: skip │         │        ├─► api (sin JOBS)     │
└─────────────────────────┘          └──────────────────────┘         │        ├─► web              │
                                                                      │        └─► worker (jobs)      │
        Backblaze B2 (fuera del VPS)                                  │              │               │
        ┌──────────────────────────┐                                  │   redes: edge / internal /    │
        │ frequent/ (24 h)         │ ◄──── backup cada 30 min ─────── │   egress (PG y Redis solo en  │
        │ daily/ (30 días)         │       (cifrado antes de salir)   │   internal; nadie los publica)│
        │ manifest/last-backup.json│                                  │   PostgreSQL 16 + Redis 7     │
        └──────────────────────────┘                                  └───────────────────────────────┘
```

Variante que evalúa el spike (Fase 4): el mismo VPS, pero PostgreSQL fuera (gestionado por un
proveedor); Redis sigue local. El spike decide si esa variante soporta el esquema real.

```
VPS (API + worker + Caddy + cloudflared + Redis)  ──TLS verify-full──►  PostgreSQL gestionado
        │                                                                  (rol admin del proveedor)
        └── backup cifrado cada 30 min ──► B2                              ↑
                                                                   pg_restore + migraciones + RLS
```

**El spike decide**: si el proveedor permite el esquema real (roles, RLS, `SECURITY DEFINER`,
particiones), la restauración completa y la conexión TLS validada dentro del presupuesto.
**El spike NO decide ni entrega**: failover, réplica, PITR ni RPO/RTO de HA. Una instancia gestionada
mínima (un solo nodo) no tiene HA por el hecho de ser gestionada. Eso es la Fase 7, separada y
opcional, y solo aplica si el proveedor ofrece réplica automática o se elige Patroni.

### 1.3 RPO y RTO: dos escalas distintas (no confundirlas)

| Métrica | Diseño vigente (dumps a B2) | Objetivo HA (ADR 0009/0013) |
|---|---|---|
| Pérdida máxima de datos (RPO) | Cadencia de 30 min; alerta si la última copia supera 45 min. Objetivo del plan: ≤1 h. | ≤5 min |
| Recuperación (RTO) | Objetivo: ≤4 h desde el incidente hasta el servicio validado | ≤30 min |
| Cómo se logra | `pg_dump` consistente cada 30 min + restore manual documentado | Replicación en streaming / PITR + conmutación |
| Estado | **Acordado y pendiente de medir con B2 real** | **Solo objetivo del ensayo futuro (Fase 7)** |

La frase "RPO 5 minutos" **no aplica** al diseño de backups actual; no debe citarse como si ya
estuviera cumplido. El dump cada 30 minutos no da 5 minutos de RPO: da hasta ~45 minutos con la
alerta vigente.

---

## 2. Preflight del PC nuevo

### 2.1 Clonar y verificar el repositorio

El repositorio remoto es `https://github.com/Daniel1309-gon/agency-os.git`. No se asume el estado
del remoto: se clona o se actualiza y se verifica.

```pwsh
# [PC/pwsh] Clonar (primera vez en el PC nuevo)
git clone https://github.com/Daniel1309-gon/agency-os.git
cd agency-os

# Verificar la rama de trabajo de E1 y el estado del remoto; no asumir commits locales.
git fetch --all --prune
git switch codex/delivery1-backend
git log --oneline -5
git status --short
```

- La rama de trabajo de E1 es `codex/delivery1-backend`; el estado del PR correspondiente debe
  confirmarse en GitHub (con `gh pr view` si está instalado, o en la web). No reconstruir de memoria
  si el PR sigue en borrador ni qué commit es el último verificado por CI.
- El `.gitattributes` del repo exige fin de línea LF en `*.sh`; si algo se editó desde Windows,
  verificar antes de construir imágenes (§nota en [e1-e-backups](../tasks/evidence/e1-e-backups-2026-09-21.md)).

### 2.2 Herramientas y versiones (tomadas de los archivos del repo)

| Herramienta | Versión / nota | Fuente en el repo |
|---|---|---|
| Node.js | `>=22` | `engines` en [package.json](../package.json) y CI (`NODE_VERSION: '22'`) |
| pnpm | `>=10`; la versión fijada es `pnpm@10.29.2` | `packageManager` en package.json |
| Docker + Compose | Docker Engine y plugin Compose; en la PC, Docker Desktop para las suites de integración (PostgreSQL 16 + Redis 7) | [vitest.integration.config.ts](../backend/vitest.integration.config.ts), README de despliegue |
| Git | Con acceso al remoto y al PR | — |
| AWS CLI | Para subir/bajar objetos de B2 y probar Object Lock | [deploy/production/backup/README.md](../deploy/production/backup/README.md) |
| OpenSSL | Para descifrar artefactos del backup | ídem |
| Cliente `psql` 16 | SQL de control y sondas de la Fase 4 contra la instancia gestionada | `postgres:16-alpine` en [compose.production.yml](../compose.production.yml) |
| Python ≥3.11 + `uv` | Herramientas del piloto mTLS (`uv run tools/...`) | [tools/mtls-pilot-cycle.py](../tools/mtls-pilot-cycle.py) |
| Go, versión de `local-helper/go.mod` o superior | **Obligatorio**: `pnpm ci:verify` ejecuta `pnpm helper:test` dentro de `ci:quality`, que compila y prueba el helper nativo; sin Go la Fase 0 falla con `spawnSync go ENOENT` | [local-helper/go.mod](../local-helper/go.mod), `.github/workflows/ci.yml` (`setup-go` con `go-version-file`) |

```pwsh
# [PC/pwsh] Instalación con lockfile congelado y verificación completa (histórico: verde 2026-09-23)
pnpm install --frozen-lockfile
pnpm ci:verify
```

`pnpm ci:verify` corre la calidad completa y las suites de integración contra PostgreSQL 16 y
Redis 7 reales (usa `backend/.env` o los valores por defecto de
[backend/.env.example](../backend/.env.example); deriva su propia base `<db>_test` y el índice
Redis 15). Detalle del runner en [tools/ci-verify.mjs](../tools/ci-verify.mjs), que funciona tanto
con pnpm instalado por Node (Corepack o npm) como con el ejecutable nativo `@pnpm/exe` desde el
commit `1c718ec`; en commits anteriores, con el ejecutable nativo, falla al arrancar con
`SyntaxError: Invalid or unexpected token`.

### 2.3 Checklist de accesos y secretos (sin valores en este archivo)

Recuperar accesos y **custodia de secretos** desde los canales seguros acordados. Nunca copiar un
valor a este documento, al repositorio ni a un chat.

- [ ] Cuenta de GitHub del proyecto y token con permiso `read:packages` (para GHCR). El VPS no
      compila: solo descarga imágenes publicadas por el workflow `publish-images`.
- [ ] Cuenta de Cloudflare de la zona `globalcompany.company`: túnel `agency-os-prod` (token),
      certificados de cliente y reglas de zona. Las reglas exactas están en
      [deploy/mtls-pilot/CERTIFICATES.md](../deploy/mtls-pilot/CERTIFICATES.md) §mTLS definitivo.
- [ ] Cuenta Hostinger (o el proveedor que finalmente se contrate) con el VPS; confirmar si existe.
- [ ] Cuenta Backblaze B2: bucket `agency-os-backups` con Object Lock, llaves de aplicación sin
      `bypassGovernance` y el endpoint S3 del bucket.
- [ ] `BACKUP_ENCRYPTION_PASSPHRASE` y `VAULT_KEK` **custodiadas fuera del VPS** (gestor de
      contraseñas de Daniel o de la clienta). Sin ellas los dumps y el vault no se pueden abrir.
- [ ] Secretos SMTP/correo no aplican aquí: Rocket.Chat vive en su propio servidor y se integra por
      API/webhooks.
- [ ] URL de heartbeat (Healthchecks.io o equivalente) con período 45 min.
- [ ] Bot de Rocket.Chat: `ROCKETCHAT_TOKEN`, `ROCKETCHAT_USER_ID`, `ROCKETCHAT_WEBHOOK_SECRET`
      (canal de prueba para el humo de la Fase 5; autorización explícita antes de escribir en canales
      reales).
- [ ] Playbook de MFA y recuperación de las cuentas administrativas (GitHub, Cloudflare, B2,
      proveedor, Rocket.Chat).
- [ ] Estación de trabajo de la dueña (certificado `ADMIN`) y PCs de oficina: son entradas de la
      Fase D/E, no de esta prueba; mantenerlas fuera salvo indicación.

### 2.4 Verificación local antes de tocar remoto

- [ ] `pnpm ci:verify` verde en el PC nuevo (Fase 0).
- [ ] `git status` limpio y rama/commit anotados en la evidencia de la corrida.
- [ ] Confirmar si existen (o no) VPS, B2 y túnel: este documento no los asume.
- [ ] Confirmar en `tasks/todo.md` y en la matriz de cierre qué gates siguen abiertos
      ([todo.md](../tasks/todo.md), [cierre-e1-matriz §7](../tasks/cierre-e1-matriz-2026-09-21.md)).

---

## 3. Inventario del proveedor (completar antes de gastar)

> **EN ESPERA** con la Fase 4 (ADR 0013, revisión 2026-10-17).

**No hay proveedor de PostgreSQL gestionado preseleccionado.** La comparación A2 eligió hospedaje
para el VPS, no para la base administrada. Completar este formulario por cada candidato (2–3), con
la respuesta **citada de la documentación del proveedor**, antes de pedir autorización de compra.
Si un candidato deja un campo crítico sin respuesta verificable, no pasa a la Fase 4.

| Campo | Qué se necesita | Candidato A | Candidato B |
|---|---|---|---|
| Proveedor y servicio | PostgreSQL gestionado real (no "compatible") | | |
| Plan mínimo | Instancia mínima del spike, con margen para carga de prueba | | |
| Región | La misma región esperada del futuro par con el VPS (latencia de replicación); cercana a Colombia | | |
| Versión | 16.x, para igualar `postgres:16-alpine` del compose y las migraciones probadas | | |
| Rol administrador | ¿Puede `CREATEROLE`? ¿puede crear `citext`, `btree_gist`, `pgcrypto`? ¿hay superusuario? | | |
| Extensiones | Lista permitida; ¿se activan por SQL o por consola? | | |
| Endpoint directo | host/puerto; conexiones máximas del plan | | |
| Endpoint pooler | ¿Existe? ¿Modo transacción o sesión? ¿Solo el pooler es público? | | |
| Límite de conexiones | `max_connections` efectivo y tope del plan (ver presupuesto en Fase 6) | | |
| TLS | CA publicada para clientes; ¿`sslmode=verify-full` con `sslrootcert`? | | |
| Backups/PITR propios | Ventana de restauración, retención, costo (no reemplazan a B2; se evalúan aparte) | | |
| Consola de recuperación | Reinicio/restauración manual disponible en el plan | | |
| Costo | Mensual, impuestos y extras; comparar contra los ~US$155/mes autorizados | | |
| SLA y soporte | Tiempo de respuesta, canal, idioma | | |

**Puerta de autorización (obligatoria):**

- Aprovisionar, ampliar, reiniciar o borrar recursos del proveedor **lo hace Daniel** o alguien con
  autorización escrita; el agente no ejecuta compras ni consolas externas.
- Abrir SSH al VPS y ejecutar pruebas remotas requiere además autorización explícita para la ventana
  de prueba. Este documento no la otorga.
- Registrar cada autorización (fecha, alcance, quién) en la evidencia de la fase correspondiente.

---

## 4. Reglas de seguridad del ensayo

Valen para todas las fases. Un incumplimiento detiene la prueba.

1. **Entorno aislado.** El spike de PostgreSQL gestionado usa una instancia dedicada y desechable,
   sin datos de producción ni perfiles reales. La carga de prueba usa cuentas, perfiles y
   asignaciones sintéticas. El VPS de producción real no es el objetivo de las pruebas destructivas.
2. **Producción intacta.** Ninguna prueba de este documento restaura sobre datos reales, rota la
   KEK de producción, revoca certificados de personas reales ni envía mensajes a canales reales sin
   autorización. Las pruebas de interrupción corren solo en el entorno aislado.
3. **Claves custodiadas.** `VAULT_KEK` y `BACKUP_ENCRYPTION_PASSPHRASE` viven en el gestor de
   secretos y en los archivos `600` fuera del repo. Nunca en la línea de comandos (quedaría en
   historial y en `ps`), nunca en B2 junto a los dumps, nunca en la evidencia.
4. **Salidas saneadas.** La evidencia incluye resultados, conteos y capturas sin contraseñas,
   ciphertext, tokens, URLs de heartbeat ni cabeceras `Client-Cert` completas. Auditar los logs
   antes de adjuntarlos.
5. **Keystore del vault.** La credencial sintética de prueba (`vault-restore-check.mjs seal/open`)
   se usa con un perfil que no pertenece a ninguna operadora; su secreto se guarda junto a la KEK.
6. **Limpieza con confirmación.** Solo se destruyen recursos desechables del spike (instancia
   gestionada, canal de prueba, claves de aplicación temporales) y solo después de confirmación
   explícita y de haber extraído la evidencia. Prohibido cualquier comando destructivo apuntado a
   producción.
7. **Nada de umbrales inventados.** Para latencia, memoria o conexiones, primero se mide la línea
   base (Fases 1–2) y las comparaciones se expresan como deltas contra esa base. Los únicos umbrales
   absolutos son los ya acordados en el plan §3 (tabla en Fase 2).

---

## 5. Fases de prueba

| Fase | Qué valida | Entorno | Instrumento base |
|---|---|---|---|
| 0 | PC nuevo sano: calidad y suites locales verdes | PC | `pnpm ci:verify` |
| 1 | Baseline real: deploy del VPS, health, túnel, mTLS positivo y negativo | VPS + Cloudflare | [deploy/production/README.md](../deploy/production/README.md) + [CERTIFICATES.md](../deploy/mtls-pilot/CERTIFICATES.md) |
| 2 | Capacidad: 30 logins, 30 sockets, scrypt y memoria | VPS real | Plan §3 (umbrales acordados); harness [propuesto] |
| 3 | Backups B2 reales: retención, candidatos y restauración completa con KEK | VPS + B2 | [backup/README.md](../deploy/production/backup/README.md) |
| 4 | **EN ESPERA.** PostgreSQL gestionado: permisos, extensiones, roles, RLS, `SECURITY DEFINER`, particiones, TLS, pooling, restore y validación de datos | Proveedor + PC | Este documento + migraciones del repo |
| 5 | Humo funcional y efectos externos saneados (outbox, jobs, Rocket.Chat de prueba) | VPS o instancia de staging | APIs y scripts del repo |
| 6 | Medidas de conexiones/memoria, límites y recuperación ante interrupción (aislado) | Ambos | — |
| 7 | **EN ESPERA.** (Opcional, futuro, separado) Ensayo de HA con RPO/RTO | Réplica/PITR reales | ADR 0013; no se declara viable sin evidencia |

Ninguna fase se marca cerrada sin evidencia registrada y matriz actualizada (§6).

---

### Fase 0 — Verificación local del PC nuevo

**Objetivo.** Confirmar que el árbol nuevo reproduce los gates locales antes de cualquier gasto o
conexión remota.

**Comandos.**

```pwsh
# [PC/pwsh]
pnpm install --frozen-lockfile
pnpm ci:verify          # calidad + migraciones + seed + integración PostgreSQL/Redis [histórico: verde 2026-09-23]
pnpm test:requirements  # trazabilidad de requisitos
```

**Resultado esperado.** Todo verde; en los cortes históricos del 2026-09-23 (commits `70ab4b7` y
`78a6ba6`) el corte final registró backend 214/214 unitarios, integración 276/276, web 77/77,
contratos 10/10 y requisitos 34/34 (ver
[ci-verify-local-2026-09-23.md](../tasks/evidence/ci-verify-local-2026-09-23.md)). En el PC nuevo
los conteos pueden haber crecido: lo importante es exit 0.

**Evidencia.** Salida de los comandos con la fecha, rama y commit (`git rev-parse --short HEAD`).

**Condiciones de parada.** Cualquier fallo se resuelve antes de seguir: no se depura infraestructura
remota con un árbol local roto.

---

### Fase 1 — Baseline del VPS: deploy, health, túnel y mTLS

**Ensayo y producción.** En el VPS de ensayo de Daniel, `erp.globalcompany.company` de los comandos
se sustituye por el hostname de ensayo, con sus propios certificados de cliente y secretos (ADR 0013,
revisión 2026-10-17); el hostname de producción y los certificados de las estaciones reales se
emiten al desplegar en el VPS de la clienta.

**Estado (VPS de ensayo, 2026-10-21): PASS.** `/health/ready` y `/health/live` 200 sin certificado;
login, el mismo con cabecera `Client-Cert` falsificada y `GET /` sin certificado, 403; con el
certificado del admin el login llegó al backend (400 por falta de cuerpo). Las correcciones al
runbook que salieron del ensayo están en el
[README de producción](../deploy/production/README.md) y en
[CERTIFICATES.md](../deploy/mtls-pilot/CERTIFICATES.md).

**Objetivo.** Dejar el despliegue de producción operativo y demostrar la entrada mTLS hacia
positivo y negativo, incluido el rechazo de cabeceras falsificadas (gate E1-16).

**Prerrequisitos.** VPS contratado; cuenta B2; túnel de Cloudflare creado; imágenes publicadas en
GHCR con digest anotado; autorización para SSH.

**Comandos.**

```sh
# [VPS] Preparar y desplegar según el runbook vigente (léelo completo antes):
#   ../deploy/production/README.md  →  Preparar el VPS, Imágenes, Primer despliegue
export COMPOSE='docker compose --env-file deploy/production/.env.production -f compose.production.yml'
$COMPOSE --profile ops run --rm ops                                   # migraciones y roles
$COMPOSE --profile ops run --rm ops node dist/database/seeds/seed.js  # seed (BOOTSTRAP_ADMIN_*)
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-runtime.mjs
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-worker.mjs
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-ip.mjs
$COMPOSE --profile ops run --rm ops node scripts/db-bootstrap-admin-device.mjs   # paso 4b del runbook
$COMPOSE up -d
$COMPOSE --profile backup up -d backup
curl -fsS https://erp.globalcompany.company/health/ready
$COMPOSE ps
$COMPOSE exec backup backup-postgres.sh --check
```

```sh
# [VPS] Confirmar el CIDR real de los saltos internos para TRUSTED_PROXY_CIDRS
docker network inspect $(docker network ls --format '{{.Name}}' | grep edge) --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
# Esperado: cloudflared 172.28.0.10 y Caddy 172.28.0.11 en la subred edge; el ejemplo trae esos /32.
```

```pwsh
# [PC/pwsh] Verificación mTLS positiva/negativa (adaptada del runbook de zona; sin cert dona 403 salvo health)
curl.exe -s -o NUL -w "%{http_code}`n" https://erp.globalcompany.company/health/ready
curl.exe -s -o NUL -w "%{http_code}`n" -X POST https://erp.globalcompany.company/api/v1/auth/login
# sin certificado + cabecera falsificada: debe ser 403 (T1 la elimina en el borde)
curl.exe -s -o NUL -w "%{http_code}`n" -X POST https://erp.globalcompany.company/api/v1/auth/login -H "Client-Cert: :ZmFrZQ==:"
```

- **Con certificado de ensayo** (estación autorizada): ciclo completo de la sesión de operador con
  certificado. Los instrumentos del piloto apuntan al hostname del piloto; para producción hay que
  adaptar host (tarea manual, marcada como propuesta) o usar una estación real de ensayo:
  [tools/mtls-pilot-cycle.py](../tools/mtls-pilot-cycle.py) y
  [tools/mtls-pilot-websocket.mjs](../tools/mtls-pilot-websocket.mjs).
- Las reglas de zona (skip de `/health/*`, exigencia mTLS, transform de `Client-Cert`, skip del
  webhook de Rocket.Chat) están documentadas en
  [CERTIFICATES.md §mTLS definitivo](../deploy/mtls-pilot/CERTIFICATES.md); su aplicación es manual
  en la consola de Cloudflare.

**Resultado esperado.** `/health/ready` responde sin certificado (regla de excepción); todo lo demás
403 sin certificado; con certificado válido, login y ciclo funcionan; cabecera falsificada 403;
webhook con token válido 2xx y con token inválido descartado.

**Evidencia.** Códigos HTTP, capturas de las reglas, fecha y versión desplegada (digest).

**Condiciones de parada.** Si el health no responde o el mTLS no se comporta como el runbook de zona
indica, no se avanza a la Fase 2: primero se corrige configuración de borde o del guard
`client-cert.ts`. No desactivar la exigencia mTLS "para probar": se prueba en el orden documentado.

---

### Fase 2 — Capacidad: 30 logins, 30 sockets y costo de scrypt

**Objetivo.** Medir el hardware real con la cuadrilla objetivo (30 puestos) y decidir si el plan de
scrypt vigente se sostiene (gate E1-17). Los umbrales de esta fase son los **ya acordados** en el
[plan §3](../tasks/plan-cierre-entrega-1-despliegue-2026-09-20.md); no se agregan umbrales nuevos.

**Prerrequisitos.** Fase 1 cerrada; 30 cuentas sintéticas, 30 identidades de certificado de ensayo y
asignaciones válidas; IP pública de oficina simulada (el plan exige una sola IP pública de origen).

**Instrumento.** **No existe un harness de carga en el repo** [propuesto]: hay que construir un
script de oleadas (logins HTTPS independientes + WebSockets + heartbeats de hasta 240 sesiones
escalonadas) o ejecutarlo con la herramienta que el equipo elija, dejando el script en `tools/` para
reproducir. Antes de las oleadas, medir la **línea base** en reposo y con 1 login/1 socket.

**Umbrales acordados (plan §3, no renegociables aquí):**

| Medida | Umbral |
|---|---|
| Logins correctos | 30/30 por oleada, sin 429 ni 5xx |
| Latencia de login | p95 ≤5 s; máximo ≤10 s |
| Heartbeats | p95 ≤1 s; sin pérdidas de permiso por saturación |
| Memoria | Sin OOM, sin reinicios ni swap sostenido; ≥20% de RAM libre tras estabilizar |
| Reconexiones | Sin bucles de refresh ni pérdida persistente de estado |
| Backup concurrente | Completado y verificable durante la prueba |

**Plan de corridas.**

1. Tres oleadas de 30 logins en ventana de ~1 s, una de ellas durante un ciclo de backup.
2. 30 WebSockets sostenidos 30 minutos atravesando reconexiones (vida de socket 45–60 s).
3. Heartbeats hasta 240 sesiones con apertura escalonada.
4. Repetir con `PASSWORD_SCRYPT_LOG2N=17` (por defecto) y, si hay presión de memoria, medir
   `=16` como techo documentado: 128 MiB/hash vs 64 MiB/hash ([agents.md §5.3](../agents.md);
   cifras medidas en el PC viejo, **re-medir** aquí). No reducir scrypt ni desactivar límites para
   obtener verde.

**Resultado esperado.** Tabla de resultados con CPU, RAM, disco, conexiones de BD, latencias y
versión probada, por corrida. Nota: la validación de los límites de autenticación para oficina
compartida (5/cuenta, 30/certificado, 300/IP, refresh 60/1.200) ya está cubierta en integración
([e1-c](../tasks/evidence/e1-c-realtime-and-limits-2026-09-21.md)); aquí se mide el hardware.

**Evidencia.** Resultados brutos saneados + configuración (`log2N`, límites) + commit desplegado.

**Condiciones de parada.** Cualquier OOM, 5xx atribuible a saturación o backup que no completa
detiene la expansión: primero se identifica el cuello de botella; si se necesita más hardware, se
presentan mediciones y costo antes de ampliar (plan §3). Un p95 fuera del umbral no se "aprueba"
bajando scrypt ni eliminando controles.

---

### Fase 3 — Backups B2 reales y restauración completa

**Estado (VPS de ensayo, 2026-10-25): PASS, fase cerrada en el ensayo.** Ciclo completo en 26 s (PASS, límite 15 min);
`backup-postgres.sh --check` → «backup fresco: 0 min». Object Lock verificado (`head-object` +24 h y +30 d;
borrado con `--version-id` → AccessDenied). Limpieza de vencidos verificada (0 versiones el 2026-10-25) y restauración en un servidor vacío
(Mac de Daniel, solo con B2 y los secretos custodiados) validada con el vault: RTO ≈ 45 min netos
(3 h 14 min 52 s brutos), bajo el objetivo de 4 h. La restauración detectó una `VAULT_KEK` mal copiada
en el gestor: la verificación de custodia es obligatoria. La clave de aplicación debe crearse con la CLI de B2, no en el panel, y las reglas de ciclo de
vida usan «Days Till Hide» (ver [backup/README.md](../deploy/production/backup/README.md)).

**Objetivo.** Demostrar la cadena real: dump cifrado cada 30 min, subida con Object Lock, y una
restauración completa en un servidor vacío con la KEK custodiada, midiendo RTO y pérdida real.

**Prerrequisitos.** Fase 1 (backup corriendo); acceso B2; passphrase y KEK disponibles; ventana de
ensayo acordada.

**Comandos.**

```sh
# [VPS] Ciclo y estado
$COMPOSE --profile backup up -d backup
$COMPOSE logs --tail 20 backup
$COMPOSE exec backup backup-postgres.sh --check        # exige result=SUCCESS y antigüedad <45 min
```

- **Pruebas obligatorias del backup** (lista en
  [backup/README.md §7](../deploy/production/backup/README.md)): `aws s3api head-object` sobre una
  copia y su `.sha256` en `daily/` y `frequent/` para confirmar Object Lock (+24 h y +30 días);
  intento de borrado con las credenciales del VPS que **debe fallar** (sin `bypassGovernance`), usando
  `delete-object --version-id` sobre la versión de datos: sin `--version-id` solo se agrega un
  marcador de borrado y el comando termina con exit 0 (falso positivo);
  limpieza de objetos vencidos; ciclo completo <15 min; restauración.
- **Restauración en servidor vacío** (procedimiento exacto en
  [backup/README.md §Restauración](../deploy/production/backup/README.md)): bajar el manifiesto y
  los cifrados, verificar `sha256sum -c` **antes** de descifrar, descifrar con
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`, restaurar roles/tablespaces (`globals`),
  restablecer contraseñas de runtime desde `.env.production`, y `pg_restore --exit-on-error` fiel
  como superusuario conservando dueños.
- **Validación mínima obligatoria**: abrir la **credencial sintética del vault** con la KEK
  custodiada (`node scripts/vault-restore-check.mjs open <externalRef> <secreto>`, exit 0 = abre),
  iniciar sesión, ver el semáforo y confirmar el turno; medir desde el inicio del incidente hasta el
  servicio validado (**máximo 4 h**) y la pérdida de datos (**≤1 h objetivo**). Las cifras reales se
  registran aunque salgan mejores.
- Comandos B2 `s3 cp`/`s3api`: `[PC/bash]` (aws-cli) o `[VPS]`; en Windows usar WSL/Git Bash.

**Resultado esperado.** Object Lock verificable, manifiesto `SUCCESS`, restore sin errores, vault
abierto con la KEK correcto y **fallando cerrado con otra KEK** (comportamiento ya ensayado en local:
[e1-e-backups §vault/KEK](../tasks/evidence/e1-e-backups-2026-09-21.md)).

**Evidencia.** Manifiesto, checksums, comandos y resultados del restore, timestamps del RTO,
resultado de `vault-restore-check.mjs open`.

**Condiciones de parada.** Falta de Object Lock real, ciclo >15 min con el volumen real (el diseño
debe ampliarse antes de producción, condición del plan) o un restore que "pasa" sin validación de
vault: no se cierra la fase. La restauración **no** se valida solo por el exit code de `pg_restore`
(ver Fase 4.7).

---

### Fase 4 — PostgreSQL gestionado: spike de compatibilidad (EN ESPERA)

> **EN ESPERA** desde el 2026-10-17 ([ADR 0013](decisions/0013-production-topology-and-ha-path.md),
> revisión de esa fecha). No se aprovisiona ninguna instancia gestionada ni se completa el
> inventario §3 hasta que se cumpla una condición de reapertura de la HA. El contenido se conserva
> tal cual para ese momento; antes de ejecutarlo, verificar que las migraciones y los conteos citados
> sigan vigentes.

**Objetivo.** Decidir con evidencia si una instancia gestionada (rol administrador, sin
superusuario) soporta el esquema real de Agency OS: creación de roles, migraciones, RLS efectiva,
`SECURITY DEFINER`, particiones, restauración completa y TLS validado, dentro del presupuesto.

**Prerrequisitos.** Inventario §3 completo para el candidato; autorización escrita de aprovisionar;
instancia desechable creada; **datos sintéticos** (se puede usar el stack
`compose.station-e2e.yml` como origen de un esquema con seeds de demo, como se hizo en el ensayo
local).

**Regla de oro.** El spike prueba **el rol administrador del proveedor tal como lo entrega el
plan**, sin pedir superusuario, sin `trust` de autenticación y sin desactivar SSL.

#### 4.1 Aprovisionamiento y línea base de conexión

```pwsh
# [PC/pwsh] Cargar la URL de administración del proveedor desde deploy/spike/.env.spike (§4.2)
# a una variable de entorno de sesión. NUNCA pegar la contraseña en un comando visible (quedaría
# en el historial de PowerShell) ni en la evidencia.
$env:SPIKE_ADMIN_URL = ((Select-String -Path deploy/spike/.env.spike -Pattern '^DATABASE_URL=').Line -replace '^DATABASE_URL=', '')
```

- [ ] Confirmar versión: `SELECT version();` → 16.x.
- [ ] Confirmar TLS del servidor: `SHOW ssl;` → `on`; conexión con `sslmode=verify-full` y CA del
      proveedor **debe conectar**; con CA equivocada **debe fallar en cerrado**; con
      `sslmode=disable` **no se prueba ni se acepta** (ver 4.8).
- [ ] Anotar límite de conexiones del plan (`SHOW max_connections;` y el tope comercial).
- [ ] Anotar si el endpoint habitual es directo o pooler (afecta la Fase 4.9 y la Fase 6).

#### 4.2 Extensiones, roles y migraciones (la primera barrera real)

El esquema exige, como mínimo: crear extensiones `citext`, `btree_gist`, `pgcrypto`; crear los roles
`agency_owner`, `agency_app`, `agency_worker`, `agency_readonly`
([0008](../backend/src/database/migrations/0008_database_deployment_roles.sql)); que el rol de
migración reciba `agency_owner` y pueda `SET ROLE`; y crear el esquema `drizzle`
([db-migrate.mjs](../backend/scripts/db-migrate.mjs)).

```pwsh
# [PC/pwsh] Prueba mínima y aislada ANTES de correr migraciones completas:
psql $env:SPIKE_ADMIN_URL -c "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql $env:SPIKE_ADMIN_URL -c "CREATE ROLE spike_probe NOLOGIN; GRANT spike_probe TO CURRENT_USER; SET ROLE spike_probe; RESET ROLE; DROP ROLE spike_probe;"
```

Las migraciones del spike **no** pasan por `compose.production.yml`: su servicio `ops` carga
`deploy/production/.env.production` por `env_file` (cambiar `--env-file` no lo evita), depende del
`postgres` local y solo está en la red `internal`, sin salida hacia el proveedor. Se ejecutan desde
el PC con el checkout compilado y un archivo de entorno propio del spike, que nunca reutiliza
secretos del despliegue (KEK, passphrase, contraseñas de rol):

```text
# deploy/spike/.env.spike — permisos restringidos; .gitignore (.env.*) lo excluye del repositorio.
# Solo valores desechables del spike; nunca copiar nada de deploy/production/.env.production.
DATABASE_URL=postgresql://<admin>:<secreto>@<host>:<puerto>/agency_os?sslmode=verify-full&sslrootcert=<ruta-a-ca.pem>
# El seed valida la configuración completa (backend/src/config/config.schema.ts). Con
# NODE_ENV=production exigiría además Rocket.Chat, CORS y proxies; el seed no los usa.
NODE_ENV=development
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generado para el spike, >=32 caracteres>
VAULT_KEK=<generada para el spike, >=32 caracteres>
DATABASE_RUNTIME_PASSWORD=<generada para el spike>
DATABASE_WORKER_PASSWORD=<generada para el spike>
BOOTSTRAP_ADMIN_EMAIL=<admin sintético>
BOOTSTRAP_ADMIN_PASSWORD=<generada para el spike>
```

```pwsh
# [PC/pwsh] Migraciones, seed y roles de runtime/worker del esquema real contra el proveedor,
# en el orden de deploy/production/README.md §Primer despliegue. Ejecutar desde la raíz del repo.
pnpm --filter @agency-os/api build
$spikeEnv = (Resolve-Path deploy/spike/.env.spike).Path
node --env-file=$spikeEnv backend/scripts/db-migrate.mjs
node --env-file=$spikeEnv backend/dist/database/seeds/seed.js
node --env-file=$spikeEnv backend/scripts/db-bootstrap-runtime.mjs
node --env-file=$spikeEnv backend/scripts/db-bootstrap-worker.mjs
```

**Verificaciones (SQL de control).** El detalle de estos invariantes está probado en
[database-roles.int.spec.ts](../backend/src/test/integration/database-roles.int.spec.ts):

```sql
-- Extensiones presentes (esperado: btree_gist, citext, pgcrypto, plpgsql)
select extname from pg_extension order by 1;

-- Roles de capacidad: sin LOGIN, sin SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS
select rolname, rolsuper, rolcanlogin, rolbypassrls from pg_roles
 where rolname in ('agency_owner','agency_app','agency_worker','agency_readonly') order by 1;

-- Dueños: el esquema es de agency_owner (esperado: 0)
select count(*) from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
   and pg_get_userbyid(c.relowner) <> 'agency_owner';

-- DEFAULT ACL del owner en public (esperado: >0, cuatro entradas en el ensayo local)
select count(*) from pg_default_acl
 where defaclrole = 'agency_owner'::regrole and defaclnamespace = 'public'::regnamespace;

-- El runtime hereda su capacidad y no la del dueño
select pg_has_role('agency_runtime','agency_app','member') as app_member,
       pg_has_role('agency_runtime','agency_owner','member') as owner_member;   -- t | f
```

**Interpretación.** Si el proveedor no permite crear extensiones o roles, o `SET ROLE agency_owner`
falla, el spike **falla en esta fase** y la ruta gestionada queda descartada o condicionada a un
mecanismo soportado por el proveedor (por ejemplo, extensiones activadas por consola), que debe
quedar documentado con su limitación. No se "arregla" pidiendo superusuario.

#### 4.3 RLS con el rol real de runtime (no dueño, no admin)

Objetivo: repetir los invariantes de [rls.int.spec.ts](../backend/src/test/integration/rls.int.spec.ts)
contra la instancia gestionada, usando **el login real** `agency_runtime` (miembro de `agency_app`),
no `SET ROLE` desde el dueño ni el admin. Incluye:

1. **Denegación negativa**: un operador no ve filas de otro en `points_ledger`,
   `tt_profile_credentials`, `payroll_lines`, `operator_account_entries`, `icebreakers` ni
   `credential_access_log` (esperado: 0 filas ajenas, nunca error de permisos que oculte el
   mecanismo).
2. **Sin bypass**: como runtime, `SET row_security = off;` seguido de `SELECT ... FROM points_ledger`
   debe **fallar** ("query would be affected by row-level security policy"); el runtime no es
   superusuario ni `BYPASSRLS`.
3. **Sin fuga entre conexiones del pool**: con **una sola** conexión reutilizada (el patrón de un
   pool), correr en secuencia: transacción como operador A (`set_config('app.user_id', ..., true)`,
   commit) → transacción como operador B (verifica que solo ve lo de B) → transacción **sin** fijar
   identidad (debe negar, 0 filas). Esto comprueba que `set_config(..., true)` es local a la
   transacción ([database.service.ts](../backend/src/database/database.service.ts) líneas 133-134 y
   167-168) y que el reuso de conexiones del pool no arrastra contexto.
4. **FORCE RLS**: las seis tablas sensibles de [0009](../backend/src/database/migrations/0009_force_sensitive_rls.sql)
   tienen `relforcerowsecurity = true` (consulta de `pg_class` en rls.int.spec.ts:94-102).

**Resultado esperado.** Los mismos veredictos que en local, ahora con el admin del proveedor. Si el
proveedor impedía `ALTER TABLE ... FORCE ROW LEVEL SECURITY` o `ALTER DEFAULT PRIVILEGES`, los
veredictos locales no se transfieren: se registra el hallazgo.

**Evidencia.** Salida saneada de cada verificación con el rol usado (`current_user`, `session_user`)
y la identidad de cada transacción.

#### 4.4 `SECURITY DEFINER`, privilegios y `search_path`

Las funciones de mantenimiento de particiones son la parte del esquema que más suele romper en
entornos administrados ([0016](../backend/src/database/migrations/0016_partition_audit_log.sql)):

```sql
-- Esperado: audit_log_ensure_partition y audit_log_maintain con prosecdef=true,
-- dueño agency_owner y proconfig con search_path=public, pg_temp.
-- reject_audit_log_mutation es INVOKER por diseño (prosecdef=false).
select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('audit_log_ensure_partition','audit_log_maintain','reject_audit_log_mutation')
 order by 1;

-- El worker ejecuta el mantenimiento; la app no lo ejecuta (0016 revoca de PUBLIC; 0022 da a worker)
select has_function_privilege('agency_worker', 'public.audit_log_maintain(int,int)', 'EXECUTE');  -- t
select has_function_privilege('agency_app',    'public.audit_log_maintain(int,int)', 'EXECUTE');  -- f
```

**Resultado esperado.** `prosecdef = true` solo en las dos de particiones, dueño `agency_owner`,
`search_path` fijo y privilegios como arriba. Una ejecución de `audit_log_maintain` como
`agency_app` debe fallar por permisos.

#### 4.5 Particiones y jobs de mantenimiento

- [ ] Invocar el mantenimiento como worker: `SELECT audit_log_maintain(2, 2);` → JSON con
      `created` para el mes actual y los dos siguientes. Verificar en `pg_inherits` que existen las
      particiones `audit_log_YYYY_MM`.
- [ ] Insertar una fila de auditoría a través del padre `audit_log` como `agency_app` (los INSERT
      directos a la partición no son el camino de producción).
- [ ] Confirmar inmutabilidad: `UPDATE`/`DELETE` sobre `audit_log` → excepción `append-only`;
      `TRUNCATE` sobre una partición → excepción.
- [ ] Retención: crear una partición de un mes anterior a `hoy − retention_months` y ejecutar
      `audit_log_maintain(..., 2)`: debe eliminarla; la partición del mes en curso no se toca.
- [ ] Verificar en la BD y en la interfaz que el job durable de particiones corre en el worker
      (`job_runs` con resultado exitoso; la matriz local ya cubre el scheduler, aquí se verifica
      contra el motor gestionado).

#### 4.6 Restricciones del dominio (los invariantes no se pierden)

`btree_gist` habilita los constraints de exclusión que impiden solapamientos (FR-08: un perfil no
puede estar en dos operadores a la vez; turnos, cuadrillas y compensación sin solape; invariantes
del vault). Con la suite completa corriendo contra el motor gestionado
([schema-invariants.int.spec.ts](../backend/src/test/integration/schema-invariants.int.spec.ts)),
estos se validan automáticamente.

- **Carril preferido**: apuntar `DATABASE_URL` del runner de integración a la instancia gestionada y
  correr `pnpm test:integration:run` completo. Requiere que el rol admin pueda crear la base
  `<db>_test` y ejecutar `ALTER DATABASE ... SET synchronous_commit = off`.
- **Carril alternativo** [propuesto] si el proveedor restringe la creación de bases: las mismas
  sondas de exclusión a mano (insertar un solape y exigir el error `23P01` de exclusión) sobre una
  base de ensayo.

**Resultado esperado.** Ninguna migración "pasa" sin que los constraints existan: verificar que los
índices gist/constraints están presentes y que un solape real falla.

#### 4.7 Restauración completa en el motor gestionado (la prueba decisiva)

Replica el ensayo local (que fue **PASS como superusuario** y **FAIL con
`--no-owner --role=agency_owner`**) pero con el rol administrador del proveedor. Procedimiento base:
[backup/README.md §Restauración](../deploy/production/backup/README.md), adaptado:

1. Tomar un dump del origen sintético con el script real ([backup-postgres.sh](../deploy/production/backup/backup-postgres.sh))
   y el stub [aws-stub.sh](../deploy/production/backup/test/aws-stub.sh) (o B2 real de la Fase 3).
2. En la instancia gestionada, con el admin:
   - Si el proveedor lo permite, dejar que `pg_restore` (sin `--no-owner`/`--role`) recree
     extensiones, esquema `drizzle`, dueños `agency_owner`, GRANT y DEFAULT ACL.
   - Si no, pre-crear extensiones y roles y reintentar; **documentar el camino que funcionó** y cuál
     falló, con el error exacto (como se hizo en local con los 365 errores en cascada).
3. Validar **por datos, no por exit code**:
   - Conteos por tabla clave contra el origen (usuarios, roles, permisos, `audit_log` total y por
     partición, vault, outbox, `job_runs`, perfiles, asignaciones…): iguales.
   - Constraints e índices: mismos conteos que el origen; ningún constraint en estado `NOT VALID`
     inesperado.
   - Dueños, GRANT efectivos y DEFAULT ACL con las consultas de §4.2.
   - `db-migrate.mjs` contra el destino restaurado: no debe aplicar nada pendiente.
   - **Cifrado de extremo a extremo**: credencial sintética `seal` en el origen y
     `vault-restore-check.mjs open` contra el destino con la KEK custodiada → exit 0; con otra KEK →
     exit 1 (falla cerrado).
   - Contraseñas de rol restablecidas desde el `.env` del entorno (el dump de globals las omite a
     propósito) y login de la API contra el destino restaurado.

**Nota sobre `pg_dumpall --globals-only`:** en entornos gestionados suele ser la parte restringida
(el rol admin puede no tener acceso completo a los globals). Si falla: registrar el error, y usar
como camino alternativo la propia migración `0008` + scripts de bootstrap para recrear roles en una
base vacía antes del restore de datos. Ese camino también es válido y debe quedar evidenciado.

**Resultado esperado.** Un restore completo reproducible con el rol admin del proveedor, validado
por datos y con el vault abierto. Si el único camino es "restaurar como superusuario", el proveedor
**no pasa** el criterio del ADR 0013.

#### 4.8 TLS de la aplicación a la base (nunca desactivar SSL)

- `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_WORKER_URL` y la URL del backup usan
  `sslmode=verify-full` con la CA del proveedor (`sslrootcert`). La librería del proyecto
  (`pg-connection-string` del lockfile) soporta `verify-full`; no es un invento.
- Probar en cerrado: CA equivocada o `verify-full` contra un host que no coincide → **error, no
  conexión**. Registrar el mensaje saneado.
- `sslmode=disable` y las variantes sin verificación (`no-verify`) quedan **prohibidas** en este
  spike; si el proveedor no ofrece un camino con TLS verificado, es un bloqueador de la ruta
  gestionada, no una excusa para desactivarlo.
- Verificar también el camino del **backup container** (imagen con cliente PG 16 y `openssl`):
  `pg_dump` contra la base gestionada con TLS, cifrado y subida a B2 en un ciclo de prueba.

#### 4.9 Pooler y compatibilidad transaccional/sesión (solo si el proveedor lo ofrece)

La aplicación usa transacciones y estado **local a transacción**: `set_config(..., true)`,
`pg_advisory_xact_lock` ([breaks.service.ts](../backend/src/modules/breaks/breaks.service.ts), L40 y L75)
y un pool de 10+2 conexiones. Con un pooler en modo transacción esto es lo esperado; aun así hay que
demostrarlo:

- [ ] Ciclo: preparar sesión del vault (grant/redeem), breaks (lock por operador), outbox (claim con
      lease) y scheduler (jobs durables) contra el endpoint del pooler.
- [ ] Confirmar que no hay estado de sesión requerido entre transacciones (nada de
      `pg_advisory_lock` de sesión, `LISTEN/NOTIFY` ni locks entre requests).
- [ ] Si el pooler es obligatorio y algo falla, registrar el fallo; el modo sesión es el respaldo
      documentado.

#### 4.10 Medidas y límites de conexiones (con el presupuesto real)

Presupuesto **verificado en el código actual** (no de memoria):

| Proceso | Máximo de conexiones | Fuente |
|---|---|---|
| API (`api`) | **12** = pool principal 10 (default de `pg`, sin `max` explícito) + pool independiente 2 | [database.service.ts L24-27, L58-61](../backend/src/database/database.service.ts) |
| Worker (`worker`) | **12** (misma clase, rol `agency_worker`) | ídem + `DATABASE_RUNTIME_ROLE=worker` |
| Contenedor `ops` (migraciones) | 1 (pool `max: 1`) | [db-migrate.mjs L17](../backend/scripts/db-migrate.mjs) |
| Backup | 2 (un `pg_dump` y un `pg_dumpall` secuenciales) | [backup-postgres.sh](../deploy/production/backup/backup-postgres.sh) |
| Scripts de vault | pools por defecto (10) mientras corren | scripts `vault-*.mjs` |

- [ ] Medir con `SELECT usename, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC;` en
      reposo, en carga (Fase 2) y con dos workers.
- [ ] Comparar con el tope del proveedor: si el plan tiene un límite cercano a 24+contingencia,
      es un riesgo; documentarlo y considerar pooler o plan superior.
- [ ] Confirmar que sin pooler la suma (API + worker + ops + backup) queda con margen holgado.

**Condiciones de parada (Fase 4).** Un fallo en extensiones/roles (4.2), RLS (4.3), restore validado
por datos (4.7) o TLS verificado (4.8) marca la ruta gestionada como RECHAZADA o CONDICIONADA; no se
reintenta pidiendo superusuario ni desactivando controles. Los hallazgos se registran con el error
exacto y se proponen a la decisión del cierre de E1.

---

### Fase 5 — Humo funcional y efectos externos saneados

**Objetivo.** Con la base candidata (gestionada o el VPS de la Fase 1) arrancar el stack completo y
recorrer el flujo operativo con datos sintéticos, con los efectos externos aislados.

**Alcance mínimo.**

- [ ] Login de administrador, alta de operador y perfil sintéticos, turno y asignación.
- [ ] Preparar sesión de perfil con el certificado de ensayo (grant/redeem con TTL 60 s; repetir y
      confirmar el rechazo del segundo canje).
- [ ] Semáforo y heartbeat con la UI; cierre de sesión; ver el estado de otro operador no es posible.
- [ ] Outbox: crear un mensaje programado a un **canal de prueba** de Rocket.Chat y confirmar
      `SENT`; forzar un evento sintético `DEAD` y reprocesarlo con `POST /ops/outbox/:id/requeue`
      ([e1-05](../tasks/evidence/e1-05-outbox-ops-2026-09-23.md)).
- [ ] Job durable de particiones y `breaks:auto-close` ejecutados por el worker (sin la API).
- [ ] Dos workers simultáneos: los leases de `job_runs` y el outbox no se duplican (prueba E1-04c).

**Reglas.** Rocket.Chat de prueba (no canales reales); sin Notion/Jira/TalkyTimes reales; sin
enviar alertas al canal de administración real; nada de mensajes a personas reales. La rotación de
PAT del bot y su webhook permanente son E1-15, fuera de este humo.

**Resultado esperado.** Flujo verde de punta a punta con evidencia saneada; fallo cerrado en los
caminos negativos (doble canje, requeue no permitido a no-admin, etc.).

**Condiciones de parada.** Cualquier efecto externo no sandboxed (mensaje real, alerta real) es
motivo de parada inmediata.

---

### Fase 6 — Recuperación ante interrupción y contabilidad de la restauración

**Objetivo.** Demostrar que una interrupción controlada **en el entorno aislado** no pierde trabajo
durable, y que una restauración se valida por datos y claves, no por el código de salida.

**Pruebas.**

1. **Reinicio de procesos** [histórico local]: detener API y worker con transacciones en vuelo →
   `job_runs` retoman por lease, el outbox reclama eventos pendientes, un socket recibe snapshot al
   reconectar. Referencias: [ha-local-game-day](../tasks/evidence/ha-local-game-day-2026-08-26.md),
   [e1-c](../tasks/evidence/e1-c-realtime-and-limits-2026-09-21.md).
2. **Reinicio de la base gestionada** [manual, solo instancia del spike]: reiniciar la instancia
   desde la consola del proveedor; medir tiempo hasta `/health/ready` y hasta operación completa;
   confirmar que no hace falta reparación manual de datos.
3. **Contabilidad de la restauración**: repetir la validación de §4.7 sobre el destino, esta vez
   inventariando qué claves se necesitaron: KEK del vault (versión de DEK que envuelve), passphrase
   del backup, contraseñas de rol del `.env` del entorno. Documentar el inventario exacto de claves
   sin copiar ninguna.
4. **Pérdida real medida**: para una copia `daily/` concreta, calcular la ventana entre el último
   dato del dump y el momento del incidente simulado; comparar con la cadencia de 30 min y la alerta
   de 45 min. Dejar claro que esto sigue siendo el diseño de dumps, **no** el RPO ≤5 min de la HA.

**Resultado esperado.** Sin pérdida de trabajo durable, reconexión automática, claves contabilizadas
y ventana de pérdida real documentada.

**Condiciones de parada.** Cualquier escenario que exija intervención manual no documentada para
recuperar la base o las sesiones se registra como hallazgo y bloquea la aceptación de la ruta
correspondiente.

---

### Fase 7 — (Opcional, futuro, separado) Ensayo de HA con RPO/RTO (EN ESPERA)

> **EN ESPERA** desde el 2026-10-17 ([ADR 0013](decisions/0013-production-topology-and-ha-path.md),
> revisión de esa fecha), igual que la Fase 4.

**Esta fase no es parte del spike de compatibilidad y no se ejecuta sin decidir antes la ruta.**
Solo aplica si se elige un proveedor con réplica automática/PITR probados o Patroni/pg_auto_failover
con testigo mínimo ([ADR 0013](decisions/0013-production-topology-and-ha-path.md)).

- Ensayo con timestamps: caída → promoción/conmutación → servicio validado. Objetivos **acordados**:
  RPO ≤5 min, RTO ≤30 min (ADR 0009/0013).
- Una instancia gestionada mínima **no** cumple esto por sí sola: sin standby ni archivo de WAL, el
  RPO sigue siendo el de los dumps. No declarar "HA resuelta" como conclusión de la Fase 4.
- Redis: la decisión vigente es réplica manual con promoción por script, sin Sentinel; se acepta
  pérdida de contadores y locks por ser desechable (ADR 0013).

---

## 6. Matriz de resultados (plantilla)

Una fila por ejecución; sin fila no cuenta como prueba. Guardar la evidencia en `tasks/evidence/`
con fecha en el nombre (patrón vigente del repositorio) o donde el equipo lo acuerde. Indicar en
cada fila si la corrida fue en el **VPS de ensayo** o en el **VPS de la clienta**. Las filas 9–14
(Fase 4) quedan **EN ESPERA** (ADR 0013, revisión 2026-10-17).

| # | Fase | Prueba | Comando / instrumento | Resultado esperado | Resultado obtenido | Evidencia | Veredicto |
|---|---|---|---|---|---|---|---|
| 1 | 0 | `pnpm ci:verify` en PC nuevo | `pnpm ci:verify` | exit 0 | | | PASS/FAIL |
| 2 | 1 | Health público (VPS de ensayo) | `curl .../health/ready` | 200 sin cert | 200 (`/health/ready` y `/health/live`) | [ensayo 2026-10-21](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md) | PASS |
| 3 | 1 | mTLS negativo (VPS de ensayo) | curl sin cert / cabecera falsificada | 403 | 403 login, 403 con `Client-Cert` falsificada, 403 `GET /` | [ensayo 2026-10-21](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md) | PASS |
| 4 | 1 | mTLS positivo (VPS de ensayo) | `curl --cert` + login en Safari | pasa el borde y el guard | 400 sin cuerpo (pasó borde y guard); login del admin en Safari OK | [ensayo 2026-10-21](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md) | PASS (ciclo de estación pendiente) |
| 5 | 2 | 30 logins ×3 oleadas | harness [propuesto] | umbrales plan §3 | | | |
| 6 | 2 | 30 sockets 30 min | harness [propuesto] | sin bucles; backup OK | | | |
| 7 | 3 | Object Lock real (VPS de ensayo) | `aws s3api head-object` | retención +24 h/+30 d | `frequent/` +24 h y `daily/` +30 d (GOVERNANCE); borrado con `--version-id` → AccessDenied | [ensayo 2026-10-21](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md) | PASS |
| 8 | 3 | Restore completo + KEK (VPS de ensayo) | README backup | ≤4 h; vault abre | restore en Mac, 26 migraciones, vault abre (exit 0) y falla cerrado con otra KEK (exit 1); RTO ≈ 45 min netos / 3 h 14 min 52 s brutos (pausa de 2 h 30 min restada a mano) | [ensayo 2026-10-21](../tasks/evidence/ensayo-vps-rentia-2026-10-21.md) | PASS |
| 9 | 4 | Extensiones/roles/migraciones | §4.2 | 0000–0025 sin error | | | |
| 10 | 4 | RLS runtime + no fuga en pool | §4.3 | veredictos locales | | | |
| 11 | 4 | `SECURITY DEFINER`/search_path | §4.4 | dueño y proconfig | | | |
| 12 | 4 | Particiones y retención | §4.5 | crea/borra solo vencidas | | | |
| 13 | 4 | TLS verify-full | §4.8 | conecta; CA mal → falla | | | |
| 14 | 4 | Restore gestionado validado por datos | §4.7 | conteos/constraints/ACL iguales | | | |
| 15 | 5 | Humo + outbox sandbox | Fase 5 | flujo verde | | | |
| 16 | 6 | Interrupción aislada | Fase 6 | sin pérdida durable | | | |

**Decisión del spike (escribirla en la evidencia y proponerla para ADR):** ruta gestionada
APROBADA / APROBADA CON CONDICIONES / RECHAZADA, con los números y el costo del proveedor.

---

## 7. Criterios de aceptación y bloqueadores

> Los criterios de la ruta gestionada aplican solo cuando se reabra la Fase 4 (EN ESPERA, ADR 0013,
> revisión 2026-10-17). Mientras tanto, la aceptación de la Entrega 1 la dan las Fases 0–3, 5 y 6
> y los gates E1-16, E1-17 y E1-18 en el VPS de la clienta.

**Aceptación de la ruta gestionada (todos obligatorios):**

1. Migraciones 0000–0025 aplican con el rol admin del proveedor y los cuatro roles quedan creados,
   sin superusuario.
2. RLS verificada con el rol real de runtime, con denegación negativa y sin fuga entre conexiones
   reutilizadas del pool.
3. `SECURITY DEFINER` y particiones funcionan (creación, retención, inmutabilidad del audit log).
4. Restauración completa validada por datos, constraints, ACL y apertura del vault con la KEK.
5. Conexiones TLS con verificación completa (`verify-full`); nada de SSL desactivado.
6. Presupuesto dentro de los ~US$155/mes autorizados y operación asumible.
7. Medidas de capacidad registradas (Fase 2 en el VPS; deltas contra la línea base en la instancia
   gestionada). No se introducen umbrales de latencia nuevos: se comparan contra la base medida.

**Bloqueadores (cualquiera de estos detiene o rechaza la ruta):**

- El proveedor no permite crear extensiones, roles ni `SET ROLE agency_owner`.
- El restore solo es posible como superusuario.
- RLS no se puede forzar o el runtime puede saltarla.
- Solo hay TLS sin verificación o sin cifrado.
- El plan de conexiones no soporta el presupuesto medido (12/proceso + contingencia).
- Los costos o la operación superan el presupuesto autorizado sin aprobación nueva.

Los gates pendientes del cierre de E1 siguen abiertos hasta que sus fases cierren: E1-16 (seguridad
del entorno), E1-17 (capacidad) y E1-18 (restore/rollback), ver
[matriz de cierre](../tasks/cierre-e1-matriz-2026-09-21.md).

---

## 8. Rollback y limpieza (solo recursos desechables, con confirmación)

Aplica únicamente a los recursos del ensayo. **Ninguna instrucción de esta sección se ejecuta sobre
producción.**

- **Instancia gestionada del spike**: se destruye/desaprovisiona solo después de (a) extraer toda la
  evidencia, (b) confirmación explícita de Daniel. Antes: exportar manifiesto de resultados y las
  salidas saneadas.
- **Claves de aplicación temporales** (B2, bot) creadas para el spike: revocarlas al cerrar.
- **Canal de prueba de Rocket.Chat**: retirar los mensajes de prueba si el cliente lo pide; nada de
  borrados masivos en canales reales.
- **Datos sintéticos** en entornos compartidos: eliminar por los endpoints/scripts del sistema, no
  por SQL directo, salvo indicación.
- **Rollback del VPS** (si ya está en producción con operación real): volver los digests anteriores
  de imagen y `$COMPOSE up -d`; no revertir migraciones ni restaurar la base salvo incidente de
  datos, y en ese caso seguir [backup/README.md](../deploy/production/backup/README.md). Nunca
  "restaurar a ciegas" sobre datos recientes (regla del plan §4).
- **Nunca** ejecutar `docker compose down -v`, borrar volúmenes de PostgreSQL o recrear contenedores
  de datos sin autorización explícita y backup verificado.

---

## 9. Próximo paso concreto

**Ejecutar la Fase 0 en el PC de trabajo y, con autorización de Daniel, contratar el VPS de ensayo
de Hostinger (KVM 2, igual al previsto para la clienta) a su nombre** para correr las Fases 1–3, 5 y
6 con datos y secretos propios del ensayo (ADR 0013, revisión 2026-10-17). Con el ensayo en verde, se
le muestra el sistema a la clienta y se contrata su VPS, con despliegue limpio y secretos nuevos. El
inventario §3 y la Fase 4 no se tocan mientras sigan en espera.

**Checklist antes del despliegue en el VPS de la clienta:**

- [ ] Cambiar la variable de repositorio de GitHub `VITE_API_BASE_URL` de vuelta a
  `https://erp.globalcompany.company/api/v1` (en el ensayo vale `https://erp.rentia.online/api/v1`) y
  **republicar las imágenes**; si no, la web llama al dominio del ensayo. Anotar los digests nuevos.
- [ ] Secretos nuevos generados en el VPS de la clienta (`openssl rand -hex 32`); nada del ensayo se reutiliza.
- [ ] Valores reales de Rocket.Chat (`ROCKETCHAT_*`); el ensayo usó `https://chat.invalid`.
- [ ] Bucket `agency-os-backups` y clave de aplicación creada con la CLI de B2.
- [ ] Zona de Cloudflare de la clienta con hostname en Client Certificates → Hosts y reglas WAF a nivel de zona.

---

## Anexo A — Referencias del repositorio

Runbooks y decisiones (rutas relativas a este archivo):

- [deploy/production/README.md](../deploy/production/README.md) — despliegue, actualización y rollback del VPS.
- [deploy/production/backup/README.md](../deploy/production/backup/README.md) — backups B2, restauración, reenvoltura de la KEK.
- [deploy/production/station/RUNBOOK.md](../deploy/production/station/RUNBOOK.md) — alta y renovación de estaciones.
- [deploy/mtls-pilot/CERTIFICATES.md](../deploy/mtls-pilot/CERTIFICATES.md) — reglas mTLS de Cloudflare para producción.
- [compose.production.yml](../compose.production.yml) — stack de producción (redes y servicios).
- [deploy/production/.env.production.example](../deploy/production/.env.production.example) — variables requeridas (sin secretos reales).
- [ADR 0013](decisions/0013-production-topology-and-ha-path.md) — topología de producción y ruta a HA.
- [ADR 0009](decisions/0009-rbac-and-production-topology.md) — baseline de disponibilidad y RPO/RTO.
- [ADR 0002](decisions/0002-postgresql-deployment-roles.md) — roles de PostgreSQL y conexiones.
- [ADR 0014](decisions/0014-mtls-access-without-office-ip.md) — acceso mTLS sin allowlist de IP de oficina.
- [plan-cierre-entrega-1-despliegue-2026-09-20.md](../tasks/plan-cierre-entrega-1-despliegue-2026-09-20.md) — plan vigente de cierre y despliegue.
- [cierre-e1-matriz-2026-09-21.md](../tasks/cierre-e1-matriz-2026-09-21.md) — matriz de cierre y gates externos.
- [a2-comparacion-vps-2026-09-21.md](../tasks/a2-comparacion-vps-2026-09-21.md) — comparación y decisión de VPS.
- [e1-e-backups-2026-09-21.md](../tasks/evidence/e1-e-backups-2026-09-21.md) — evidencia de backups y restore local.
- [e1-b-mtls-identity-2026-09-21.md](../tasks/evidence/e1-b-mtls-identity-2026-09-21.md) — identidad mTLS.
- [e1-c-realtime-and-limits-2026-09-21.md](../tasks/evidence/e1-c-realtime-and-limits-2026-09-21.md) — sockets y límites de oficina.
- [ha-local-game-day-2026-08-26.md](../tasks/evidence/ha-local-game-day-2026-08-26.md) — game day local (alcance y límites).
- [ci-verify-local-2026-09-23.md](../tasks/evidence/ci-verify-local-2026-09-23.md) — verificación local del corte.

## Anexo B — Qué quedó demostrado en local y qué falta (resumen honesto)

| Área | Demostrado en local (con evidencia) | Pendiente externo |
|---|---|---|
| Esquema, roles, RLS, `SECURITY DEFINER`, particiones | Contra PostgreSQL 16 real | El mismo esquema con el admin de un proveedor |
| Restore completo + vault/KEK | Como superusuario, esquema real | Con rol admin gestionado; RTO/RPO reales |
| Backups cifrados a B2 + Object Lock | Con stub; script real | Bucket real, retención real, ciclo <15 min |
| mTLS, límites, sockets | Integración y piloto | Reglas de zona aplicadas + carga real de 30 |
| Capacidad y scrypt | Medición de laboratorio | Hardware real, cuadrilla simbólica |

