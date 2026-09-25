# Revisión de código de la rama · 2026-09-08

`/code-review low` sobre `git diff main...HEAD` (~40k líneas). El review cubrió los tramos de
fuente no-test de los módulos críticos —guards de autenticación e IP, asignaciones, comunicación—
y devolvió tres hallazgos. **Ninguno viene de OPS-07**: la comparación fue contra `main`, no contra
el commit. Los tres números de línea reportados estaban fuera de rango, así que cada patrón se
buscó a mano antes de dar el hallazgo por bueno.

Verdicto: **uno real, uno falso positivo, uno decisión ya tomada.**

## 1. Real — la consulta de usuario activo dentro del `try` · `backend/src/common/auth/guards.ts:66-75`

```ts
try {
  const claims = verifyAccessToken(value.slice(7), this.config.get('JWT_SECRET'));
  setAuthenticatedUser(request, claims);
  const [active] = await this.db.db.select({ id: users.id }).from(users)...  // ← consulta
  if (!active) throw new Error('Inactive user or stale role');
  return true;
} catch {
  await recordDenied(this.audit, request, 'auth.token.denied', { denyReason: 'INVALID_TOKEN' });
  throw new UnauthorizedException('Invalid or expired token');
}
```

El `catch` es desnudo. Cualquier fallo de la base —caída, saturación del pool, error de Drizzle—
se convierte en `401 Invalid or expired token`. Durante un parpadeo de Postgres, cada sesión válida
recibe un 401 y el operador queda forzado a reautenticarse, con la causa real oculta tras un error
de autenticación.

Lo que lo hace más grave que un error de estado HTTP: **escribe filas `INVALID_TOKEN` falsas en
`audit_log`**. Esa es exactamente la evidencia sobre la que se apoyan SEC-02 y SEC-10, así que un
incidente de infraestructura queda registrado de forma indistinguible de un ataque de credenciales.

Corrección: sacar la consulta del `try`, o relanzar lo que no sea un error de verificación de JWT.
El fallo de infraestructura debe salir como 500 y sin fila de denegación.

Anotado como pendiente de SEC-01 en [`todo.md`](../todo.md).

## 2. Falso positivo — la transacción de `assignments`

El review sospechaba que `this.db.transaction(async () => …)` ejecuta su cuerpo contra `this.db.db`
en lugar de contra un handle transaccional, y que por tanto un fallo a mitad de relevo dejaría la
asignación nueva confirmada y la anterior todavía `ACTIVE`. Él mismo lo marcó como *"worth
confirming against database.service.ts"*. Confirmado: no ocurre.

```ts
// database.service.ts:110
this._db.transaction(async (transaction) =>
  this.requestContext.run({ database: transaction }, callback))

// database.service.ts:97
get db() { const scoped = this.requestContext.getStore(); if (scoped) return scoped.database; ... }
```

El getter lee el `AsyncLocalStorage`, así que dentro de `transaction()` `this.db.db` **es** el
handle transaccional. Se verificó con interés propio: el `end()` de `shifts.service.ts` que escribió
OPS-07 usa el mismo patrón.

## 3. Decisión ya tomada — el token de dispositivo sin `assignedOperatorId`

El review observó que `eq(devices.assignedOperatorId, request.user.sub)` desapareció de los guards
y de `assignments.service.ts`, y que `DevicePrincipal.operatorId` se eliminó, de modo que cualquier
operador autenticado puede actuar con cualquier token de dispositivo aprobado y vigente.

Es correcto y es deliberado: migración `0007_shared_office_stations` y la prueba
`treats enrolled computers as shared office stations instead of crew-owned devices`. Los PC son
estaciones compartidas de oficina, no equipos asignados a una persona.

El riesgo residual que señala es legítimo pero está acotado por otros controles: un token filtrado
todavía necesita venir de una IP de oficina permitida y durante un turno aprobado. La fuerza de ese
acotamiento depende de **SEC-03**, que sigue abierta a la espera de los CIDR reales del
balanceador. No hace falta abrir un hallazgo nuevo; queda como una razón más para no cerrar SEC-03
con valores de laboratorio.

## Nota sobre el uso de la herramienta

El review comparó toda la rama contra `main` en lugar del commit en revisión, lo que explica que
los tres hallazgos sean de código preexistente y que ninguno toque los archivos de OPS-07. Para
revisar un cambio concreto conviene apuntarlo al diff de ese commit.
