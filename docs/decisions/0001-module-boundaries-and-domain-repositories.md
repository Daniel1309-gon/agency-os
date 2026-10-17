# ADR-0001: Límites de módulos y repositorios por dominio

## Status

Accepted

## Date

2026-08-21

## Context

Los servicios de `backend/src/modules` accedían directamente a `database/schema/index.ts` y
varios módulos importaban implementaciones privadas de otros módulos. Ese acoplamiento hace que
una migración, una política RLS o un cambio de infraestructura se propague por toda la aplicación.
También dificulta probar los casos de seguridad sin levantar Drizzle y PostgreSQL en cada prueba.

La migración no puede hacerse de golpe: hay 32 imports históricos que deben eliminarse
gradualmente sin romper la Entrega 1. El vault es el primer slice porque contiene credenciales
cifradas, grants de un solo uso y auditoría; su frontera debe quedar clara antes de SEC-09.

## Decision

Cada módulo que se migre separará:

`application service → port del dominio → adaptador Drizzle`

El port vive dentro del módulo propietario, expone operaciones con nombres del dominio y nunca
recibe una contraseña en claro ni devuelve datos de persistencia fuera de lo necesario. El adaptador
es específico del dominio (`*.drizzle-repository.ts`) y es la única clase autorizada a importar el
schema de Drizzle para ese módulo. Nest lo conecta mediante un token `Symbol` y `@Inject`.

Los módulos solo pueden consumir superficies públicas de otro módulo (`*.module.ts`, `*.port.ts` o
`*.contracts.ts`); importar servicios o adaptadores privados de otro módulo falla el lint AST.

El lint usa el Compiler API de TypeScript, no regex sobre el texto fuente, para distinguir imports y
llamadas ejecutables de comentarios o strings. Las deudas existentes se registran por fingerprint
exacto en `backend/architecture-baseline.json`; una excepción nueva, un import ampliado o una
excepción resuelta hacen fallar CI.

## Alternatives Considered

### Repositorio genérico para todo el backend

Rechazado. Un repositorio genérico escondería las reglas de autorización y volvería a acoplar los
dominios mediante consultas que cualquier módulo podría reutilizar sin contexto.

### Migración completa antes de volver a integrar

Rechazada. Mantendría una rama grande y difícil de revertir. Se adopta un slice vertical por
módulo, con pruebas y commit independiente.

### Baseline por carpeta o comodín

Rechazado. Permitiría introducir nuevos accesos sin revisión. El fingerprint incluye ruta, regla,
specifier y símbolos importados.

## Consequences

- `VaultService` ya no conoce `DatabaseService` ni el schema; `DrizzleVaultRepository` conserva la
  transacción de rotación y las consultas de grants/redeems.
- Las pruebas del vault mantienen los 15 casos de abuso existentes y agregan una prueba del
  repositorio que verifica rotación y access log en una sola transacción.
- Quedan 32 excepciones históricas explícitas. Cada módulo que se toque debe reducirlas o mantener
  exactamente el fingerprint; no puede añadir deuda.
- El patrón añade archivos y un provider por dominio, pero permite sustituir Drizzle, probar reglas
  con un fake de dominio y preparar SEC-01/SEC-09 sin mover toda la aplicación.
