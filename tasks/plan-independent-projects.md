# Plan: proyectos independientes de Agency OS

## Objetivo

Eliminar la dependencia del workspace raíz de pnpm para que backend, frontend y extensión puedan
instalar, desarrollar, probar y construir de forma independiente. Esta separación no cambia los
contratos HTTP ni la arquitectura de despliegue; solo define límites de proyecto y comandos locales.

## Decisiones

- `backend/` será un proyecto Node/NestJS independiente con su propio lockfile y scripts.
- `web-app/` será el proyecto frontend independiente. El stack acordado en requerimientos es React
  + TailwindCSS; se agregará solo el esqueleto de tooling, no pantallas de negocio en esta tarea.
- `extension/` será un proyecto independiente de tooling: scripts para validar manifest, empaquetar
  el ZIP/CRX y ejecutar los spikes Python. La extensión no compartirá dependencias npm con el backend.
- `packages/shared/` no será una dependencia runtime del backend. La configuración que solo consume
  el backend se moverá a `backend/src/config`; los contratos públicos futuros se versionarán como
  artefactos/API, no mediante `workspace:*`.
- El root queda como documentación/infraestructura durante la transición; no se usará como punto de
  entrada para instalar o ejecutar los tres proyectos.

## Fases y criterios

### Fase 1 — Backend aislado

- El backend compila y prueba desde `backend/` sin resolver `workspace:*`.
- `backend/package.json` contiene todos sus scripts (`dev`, `build`, `typecheck`, `lint`, `test`, DB).
- Existe lockfile propio y `.env.example` local.

### Fase 2 — Frontend aislado

- `web-app/` tiene `package.json`, lockfile y scripts locales (`dev`, `build`, `typecheck`, `lint`,
  `test`).
- La compilación inicial funciona sin depender de paquetes del root.

### Fase 3 — Extensión aislada

- `extension/package.json` documenta comandos de validación y empaquetado.
- Los scripts no leen ni imprimen credenciales; `credenciales.json` sigue siendo evidencia del spike
  y no un patrón de producción.

### Fase 4 — CI y documentación

- CI ejecuta cada proyecto desde su directorio y no depende del workspace raíz.
- `CLAUDE.md` y `agents.md` describen los nuevos límites y comandos.
- Se verifica cada proyecto por separado y se registra cualquier bloqueo de instalación de Windows.

## Fuera de alcance

- No implementar pantallas del dashboard.
- No migrar todavía el vault ni la extensión a credenciales de producción.
- No cambiar endpoints, esquema de base de datos, autenticación ni el contrato Tableau.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Contratos compartidos duplicados | Definir OpenAPI/JSON Schemas versionados cuando el frontend empiece; mantener validación backend autoritativa |
| Dos lockfiles divergen | Actualizaciones dependientes por proyecto, CI instala desde cada directorio |
| Frontend sin stack instalado | Usar React + Vite + Tailwind según requerimientos, sin añadir features todavía |
| Instalación Windows bloquea `node_modules` | Instalar desde cada proyecto; documentar errores y evitar depender del root |
