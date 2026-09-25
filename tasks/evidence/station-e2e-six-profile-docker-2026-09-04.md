# Ensayo Docker de estación con seis perfiles — 2026-09-04

Estado: **PASS para el host Docker y el ensayo de datos; validación en la estación Windows pendiente**.

## Alcance ejecutado

- `pnpm ci:quality`: PASS.
- Compose validado y ambas imágenes multi-stage reconstruidas con el lockfile vigente.
- Arranque sobre los volúmenes existentes: PostgreSQL y Redis saludables; migraciones, roles mínimos, seed base, bootstrap de IP y seed E2E terminaron con código 0.
- Gateway HTTPS saludable y dos réplicas API saludables.
- Verificación directa de identidad PostgreSQL: API como `agency_runtime`; worker efímero como `agency_worker_runtime`.
- El worker de Rocket.Chat permaneció detenido; la comprobación de rol no inició su integración externa.
- Se provisionaron Luna, Mar, Sol, Nube, Alma y Vera mediante el endpoint real de rotación del vault: `6 created, 0 retained`.
- Segunda ejecución del provisionador: `0 created, 6 retained`; no rotó ni duplicó secretos.
- Ningún valor de credencial en claro fue mostrado ni persistido por el provisionador.

## Compatibilidad observada en Docker Desktop para Windows

Docker Desktop entrega al gateway las conexiones del puerto publicado mediante el salto NAT `172.30.0.1`. El bridge quedó fijado explícitamente y esa dirección se incorporó como `/32` a la allowlist interna. La IP real de la estación continúa restringida por Windows Firewall antes de llegar al bridge.

## Acceso local al frontend

- Se añadió un bloque marcado y reversible en `hosts` para `app.agency-os.test` y `api.agency-os.test` apuntando a `192.168.80.81`.
- Se instaló únicamente la CA pública del ensayo en el almacén raíz de esta PC; no se instaló la extensión ni el helper.
- HTTPS estricto: frontend `200 text/html`; API readiness `200` con PostgreSQL y Redis en `true`.
- Navegador: título `Acceso · Agency OS`, estilos y formulario de acceso renderizados; cero errores o advertencias de consola.
- No se introdujeron credenciales y no se pulsó `Entrar al workspace`.
- La configuración local se puede retirar mediante `deploy/station-e2e/disable-local-browser-access.ps1` ejecutado como Administrador.

## Fallos controlados

- `api-a` detenida: readiness continuó en `ok`; login y lectura de metadata del vault funcionaron por `api-b`.
- Ambas API detenidas: el gateway devolvió HTTP `504`, sin exponer PostgreSQL ni Redis.
- Ambas API restauradas: las dos quedaron `running healthy`; readiness volvió a `ok` y una operación autenticada nueva confirmó `0 created, 6 retained`.

## Bundle offline

- Bundle: `.local/station-e2e/bundles/agency-os-station-0.1.0.zip`.
- Versión: `0.1.0`.
- Commit base: `b1ee36ba18053dfc7f84cf4050e3db584aaba443`.
- Extensión: `fcniigapdfcoigmnkhkcgmhlhjdledbo`.
- Imagen API: `sha256:dc8f50216a44947046a19eb5e92957f440dc61489aa3adf1d18c03e200f26e6d`.
- Imagen gateway: `sha256:0f9fde5b2b8793658c2c02d07a30ad4eb34be370670d942c14cc007d5c252a29`.
- Helper SHA-256: `e16e358e0f235e02adbc3ba7ac0c6f25ad4eb230c53826ffa7d771ec328bf1cc`.
- CRX SHA-256: `24bd84ff943dec7136a733b4d8acd6e9c4796131f52e08b47d7cbdc522fad797`.
- Contenido verificado: helper x64, CA pública, instalador, desinstalador, preflight, policy installer, runbook, manifiesto y checksums. No contiene PEM, claves privadas, tokens ni credenciales.

## Calidad

- Requisitos/despliegue: 31 pruebas.
- Extensión: 3 pruebas y validación de manifiesto.
- Helper: pruebas Go PASS.
- Contratos HTTP: 9 pruebas.
- Shared: 8 pruebas.
- Backend: 172 pruebas y 7 reglas de arquitectura.
- Frontend: 18 pruebas.
- Builds, lint y typecheck: PASS.
- Auditoría de producción a severidad alta: PASS; permanecen 4 avisos moderados.

## Alcance que esta evidencia no cierra

Este archivo registra un **ensayo de seis perfiles**. No demuestra todavía:

- instalación Enterprise, Native Messaging ni seis ventanas en otra PC Windows;
- inyección DOM en TalkyTimes, ausencia en `chrome.storage` ni clic humano omitido;
- aislamiento real de cookies y límite de ocho perfiles con cuentas autorizadas;
- recolección de RAM/CPU y tiempos de apertura de los árboles Chrome;
- failover HA gestionado de PostgreSQL/Redis;
- Rocket.Chat funcional.

Por lo anterior, `INT-01`, `QUA-03`, Rocket.Chat y las decisiones de negocio abiertas conservan su estado formal.
