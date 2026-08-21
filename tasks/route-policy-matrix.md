# Matriz ruta × política

Generada desde los decoradores Nest y `backend/src/common/contracts/route-contracts.ts`.
Describe la implementación actual; los actores pendientes de OQ-01/OQ-02 no constituyen aprobación del cliente.
`UNBOUNDED` identifica deuda explícita que los slices funcionales deberán reemplazar por un límite verificable.

| Ruta | Actores efectivos | Acceso | Device | Shift | Scope | Idempotencia | Paginación |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/agent/devices/heartbeat` | OPERADOR | authenticated; roles: OPERADOR | REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/agent/metrics/batch` | OPERADOR | authenticated; roles: OPERADOR | REQUIRED | REQUIRED | SELF | NATURAL_KEY | NOT_APPLICABLE |
| `GET /api/v1/agent/profiles/assigned` | OPERADOR | authenticated; roles: OPERADOR; permissions: profiles.read | NOT_REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | BOUNDED_FILTER |
| `POST /api/v1/agent/session/credential-grant` | OPERADOR | authenticated; roles: OPERADOR; permissions: vault.credential.issue | REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/agent/session/credential-redeem` | OPERADOR | authenticated; roles: OPERADOR; permissions: vault.credential.issue | REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/agent/sessions` | OPERADOR | authenticated; roles: OPERADOR | REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/agent/sessions/{id}` | OPERADOR | authenticated; roles: OPERADOR | REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/agent/sessions/{id}/close` | OPERADOR | authenticated; roles: OPERADOR | REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/agent/sessions/prepare` | OPERADOR | authenticated; roles: OPERADOR; permissions: profiles.read | NOT_REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/assignments` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: profiles.read | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | OFFSET |
| `POST /api/v1/assignments` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: profiles.update | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/assignments/{id}/end` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: profiles.update | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/audit-log` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: audit.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/auth/login` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/auth/logout` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/auth/me` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/auth/password` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/auth/password/reset` | ADMIN | authenticated; permissions: users.update | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/auth/refresh` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/breaks/{id}/end` | OPERADOR | authenticated; roles: OPERADOR | NOT_REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/breaks/{id}/start` | OPERADOR | authenticated; roles: OPERADOR | NOT_REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/breaks/{shiftId}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: shifts.read | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/cafeteria/accounts/me` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/cafeteria/menu` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/cafeteria/orders` | ADMIN, DIRECTOR_OPERATIVO, CAFETERIA | authenticated; permissions: cafeteria.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/cafeteria/orders` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | REQUIRED | SELF | IDEMPOTENCY_KEY | NOT_APPLICABLE |
| `POST /api/v1/cafeteria/orders/{id}/cancel` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/cafeteria/orders/{id}/status` | ADMIN, DIRECTOR_OPERATIVO, CAFETERIA | authenticated; permissions: cafeteria.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/cafeteria/products` | ADMIN, DIRECTOR_OPERATIVO, CAFETERIA | authenticated; permissions: cafeteria.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/cafeteria/products` | ADMIN, DIRECTOR_OPERATIVO, CAFETERIA | authenticated; permissions: cafeteria.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/cafeteria/products/{id}` | ADMIN, DIRECTOR_OPERATIVO, CAFETERIA | authenticated; permissions: cafeteria.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/competitions` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/competitions` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/competitions/{id}/leaderboard` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/crews` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: crews.read | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/crews` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: crews.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/crews/{id}/members` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: crews.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `DELETE /api/v1/crews/{id}/members/{userId}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: crews.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/devices` | ADMIN, COORDINADOR | authenticated; permissions: devices.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/devices` | ADMIN, COORDINADOR | authenticated; permissions: devices.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/devices/{id}` | ADMIN, COORDINADOR | authenticated; permissions: devices.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/devices/{id}/revoke` | ADMIN, COORDINADOR | authenticated; permissions: devices.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/devices/enroll` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/feature-flags` | ADMIN | authenticated; permissions: settings.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `PATCH /api/v1/feature-flags/{key}` | ADMIN | authenticated; permissions: settings.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/icebreaker-rules` | ADMIN | authenticated; permissions: icebreaker.rules.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/icebreaker-rules` | ADMIN | authenticated; permissions: icebreaker.rules.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/icebreaker-rules/{id}` | ADMIN | authenticated; permissions: icebreaker.rules.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/icebreakers` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/icebreakers` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/icebreakers/{id}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/icebreakers/{id}/effectiveness` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/icebreakers/{id}/evaluate` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/icebreakers/{id}/evaluations` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/icebreakers/{id}/publish` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/icebreakers/{id}/reviews` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: icebreaker.review | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/icebreakers/violations` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: icebreaker.review | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/metrics/operations` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: metrics.audit | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/metrics/profiles` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: metrics.audit | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/metrics/profiles/{id}/timeseries` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: metrics.audit | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/metrics/ranking` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: metrics.audit | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/metrics/reconciliation` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: metrics.audit | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/notifications` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | UNBOUNDED |
| `PATCH /api/v1/notifications/{id}/read` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR, CAFETERIA | authenticated | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/operators/me/status` | OPERADOR | authenticated; roles: OPERADOR | NOT_REQUIRED | REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/operators/status` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: operators.monitor | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/payroll/goals` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/payroll/goals` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/payroll/goals/me/progress` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/payroll/lines/{id}/adjustments` | ADMIN | authenticated; permissions: payroll.adjust | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/payroll/me/summary` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/payroll/periods` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/payroll/periods` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/payroll/periods/{id}/close` | ADMIN | authenticated; permissions: payroll.close | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/payroll/periods/{id}/compute` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/payroll/periods/{id}/lines` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: payroll.read | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/payroll/periods/{id}/lock` | ADMIN | authenticated; permissions: payroll.close | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/payroll/points/adjustments` | ADMIN | authenticated; permissions: payroll.adjust | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/permissions` | ADMIN | authenticated; permissions: rbac.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/profiles` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: profiles.read | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | OFFSET |
| `POST /api/v1/profiles` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: profiles.create | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/profiles/{id}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: profiles.read | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/profiles/{id}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: profiles.update | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/profiles/{id}/access-log` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: audit.read | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/profiles/{id}/deactivate` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: profiles.update | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `PUT /api/v1/profiles/{profileId}/credential` | ADMIN | authenticated; permissions: vault.rotate | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NATURAL_KEY | NOT_APPLICABLE |
| `GET /api/v1/profiles/{profileId}/credential/meta` | ADMIN, COORDINADOR, OPERADOR | authenticated; permissions: vault.read_meta | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/reports/effective-time` | ADMIN, DIRECTOR_OPERATIVO | authenticated; permissions: reports.read | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/rocketchat/bot/events` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NATURAL_KEY | NOT_APPLICABLE |
| `GET /api/v1/rocketchat/bot/knowledge` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `PUT /api/v1/rocketchat/bot/knowledge/{slug}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NATURAL_KEY | NOT_APPLICABLE |
| `GET /api/v1/rocketchat/channels` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/rocketchat/channels` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/rocketchat/messages` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/roles` | ADMIN | authenticated; permissions: rbac.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `GET /api/v1/scheduled-messages` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/scheduled-messages` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `DELETE /api/v1/scheduled-messages/{id}` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, CAFETERIA | authenticated; permissions: chat.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/settings` | ADMIN | authenticated; permissions: settings.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `PATCH /api/v1/settings/{key}` | ADMIN | authenticated; permissions: settings.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/settings/ip-allowlist` | ADMIN | authenticated; permissions: security.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/settings/ip-allowlist` | ADMIN | authenticated; permissions: security.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/settings/ip-allowlist/{id}/disable` | ADMIN | authenticated; permissions: security.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/shift-overrides` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: shifts.approve_overtime | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/shift-templates` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: shifts.read | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/shift-templates` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: shifts.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/shifts` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: shifts.manage | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/shifts/{id}/end` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: shifts.read | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/shifts/{id}/start` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: shifts.read | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/shifts/me/current` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR, OPERADOR | authenticated; permissions: shifts.read | NOT_REQUIRED | NOT_REQUIRED | SELF | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/tableau/runs` | ADMIN | authenticated; permissions: etl.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/tableau/runs` | ADMIN | authenticated; permissions: etl.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/tableau/runs/{id}/execute` | ADMIN | authenticated; permissions: etl.manage | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/tableau/views` | ADMIN | authenticated; permissions: etl.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/tableau/views` | ADMIN | authenticated; permissions: etl.manage | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/users` | ADMIN, DIRECTOR_OPERATIVO, COORDINADOR | authenticated; permissions: users.read | NOT_REQUIRED | NOT_REQUIRED | CREW | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/users` | ADMIN | authenticated; permissions: users.create | NOT_REQUIRED | NOT_REQUIRED | GLOBAL | NOT_APPLICABLE | NOT_APPLICABLE |
| `PATCH /api/v1/users/{id}` | ADMIN | authenticated; permissions: users.update | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /api/v1/users/{id}/compensation` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | UNBOUNDED |
| `POST /api/v1/users/{id}/compensation` | ADMIN | authenticated; permissions: payroll.configure | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `POST /api/v1/users/{id}/disable` | ADMIN | authenticated; permissions: users.disable | NOT_REQUIRED | NOT_REQUIRED | RESOURCE | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /health/live` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NOT_APPLICABLE | NOT_APPLICABLE |
| `GET /health/ready` | ANONYMOUS | public | NOT_REQUIRED | NOT_REQUIRED | PUBLIC | NOT_APPLICABLE | NOT_APPLICABLE |
