import type { OpenAPIObject } from '@nestjs/swagger';
import { rolePermissionCodes, type SeedRoleCode } from '../../database/seeds/role-permissions.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;
const ROLE_ORDER = ['ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR', 'OPERADOR', 'CAFETERIA'] as const;

type HttpMethod = Uppercase<(typeof HTTP_METHODS)[number]>;
type RouteScope = 'CREW' | 'GLOBAL' | 'PUBLIC' | 'RESOURCE' | 'SELF';
type Idempotency = 'IDEMPOTENCY_KEY' | 'NATURAL_KEY' | 'NOT_APPLICABLE';
type Pagination = 'BOUNDED_FILTER' | 'CURSOR' | 'NOT_APPLICABLE' | 'OFFSET' | 'UNBOUNDED';
interface RouteAccess {
  authenticated: boolean;
  permissions: string[];
  public: boolean;
  roles: string[];
}

export interface RouteContract {
  idempotency: Idempotency;
  method: HttpMethod;
  pagination: Pagination;
  path: string;
  scope: RouteScope;
}

export interface EffectiveRoutePolicy extends RouteContract {
  access: RouteAccess;
  actors: Array<SeedRoleCode | 'ANONYMOUS'>;
  device: boolean;
  shift: boolean;
}

type ExtendedOperation = Record<string, unknown> & {
  security?: Array<Record<string, string[]>>;
  'x-agency-authenticated'?: boolean;
  'x-agency-device'?: boolean;
  'x-agency-permissions'?: string[];
  'x-agency-policy'?: EffectiveRoutePolicy;
  'x-agency-public'?: boolean;
  'x-agency-roles'?: string[];
  'x-agency-shift'?: boolean;
};

function route(
  method: HttpMethod,
  path: string,
  scope: RouteScope,
  idempotency: Idempotency = 'NOT_APPLICABLE',
  pagination: Pagination = 'NOT_APPLICABLE',
): RouteContract {
  return { method, path, scope, idempotency, pagination };
}

// Source of truth for dimensions that cannot be inferred from Nest decorators.
// UNBOUNDED is an honest inventory value, not an approval: later domain tasks
// must replace it with OFFSET/CURSOR/BOUNDED_FILTER where the endpoint is a
// growing collection. Every operation appears exactly once.
export const routeContracts = [
  route('GET', '/health/live', 'PUBLIC'),
  route('GET', '/health/ready', 'PUBLIC'),
  route('POST', '/api/v1/auth/login', 'PUBLIC'),
  route('POST', '/api/v1/auth/refresh', 'PUBLIC'),
  route('POST', '/api/v1/auth/logout', 'SELF'),
  route('GET', '/api/v1/auth/me', 'SELF'),
  route('POST', '/api/v1/auth/password', 'SELF'),
  route('POST', '/api/v1/auth/password/reset', 'RESOURCE'),

  route('PUT', '/api/v1/profiles/{profileId}/credential', 'RESOURCE', 'NATURAL_KEY'),
  route('GET', '/api/v1/profiles/{profileId}/credential/meta', 'RESOURCE'),
  route('POST', '/api/v1/agent/session/credential-grant', 'SELF'),
  route('POST', '/api/v1/agent/session/credential-redeem', 'SELF'),

  route('GET', '/api/v1/profiles', 'CREW', 'NOT_APPLICABLE', 'OFFSET'),
  route('POST', '/api/v1/profiles', 'CREW'),
  route('GET', '/api/v1/profiles/{id}', 'RESOURCE'),
  route('PATCH', '/api/v1/profiles/{id}', 'RESOURCE'),
  route('POST', '/api/v1/profiles/{id}/deactivate', 'RESOURCE'),
  route('GET', '/api/v1/profiles/{id}/access-log', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),

  route('GET', '/api/v1/devices', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/devices', 'GLOBAL'),
  route('POST', '/api/v1/devices/enroll', 'PUBLIC'),
  route('GET', '/api/v1/devices/{id}', 'RESOURCE'),
  route('POST', '/api/v1/devices/{id}/revoke', 'RESOURCE'),
  route('POST', '/api/v1/devices/{id}/rotate', 'RESOURCE'),
  route('POST', '/api/v1/agent/devices/heartbeat', 'SELF'),

  route('GET', '/api/v1/assignments', 'CREW', 'NOT_APPLICABLE', 'OFFSET'),
  route('POST', '/api/v1/assignments', 'CREW'),
  route('POST', '/api/v1/assignments/{id}/end', 'RESOURCE'),
  route('GET', '/api/v1/agent/profiles/assigned', 'SELF', 'NOT_APPLICABLE', 'BOUNDED_FILTER'),
  route('POST', '/api/v1/agent/sessions/prepare', 'SELF'),
  route('POST', '/api/v1/agent/sessions', 'SELF'),
  route('PATCH', '/api/v1/agent/sessions/{id}', 'SELF'),
  route('POST', '/api/v1/agent/sessions/{id}/close', 'SELF'),

  route('POST', '/api/v1/agent/metrics/batch', 'SELF', 'NATURAL_KEY'),
  route('GET', '/api/v1/metrics/profiles', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/metrics/ranking', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/metrics/profiles/{id}/timeseries', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/metrics/reconciliation', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/metrics/operations', 'CREW'),

  route('POST', '/api/v1/shifts', 'CREW'),
  route('GET', '/api/v1/shifts/me/current', 'SELF'),
  route('POST', '/api/v1/shifts/{id}/start', 'SELF'),
  route('POST', '/api/v1/shifts/{id}/end', 'SELF'),
  route('GET', '/api/v1/shift-templates', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/shift-templates', 'GLOBAL'),
  route('POST', '/api/v1/shift-overrides', 'CREW'),
  route('GET', '/api/v1/reports/effective-time', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),

  route('GET', '/api/v1/payroll/me/summary', 'SELF'),
  route('GET', '/api/v1/payroll/periods', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/payroll/periods', 'GLOBAL'),
  route('POST', '/api/v1/payroll/periods/{id}/compute', 'RESOURCE'),
  route('POST', '/api/v1/payroll/periods/{id}/lock', 'RESOURCE'),
  route('POST', '/api/v1/payroll/periods/{id}/close', 'RESOURCE'),
  route('POST', '/api/v1/payroll/lines/{id}/adjustments', 'RESOURCE'),
  route('GET', '/api/v1/payroll/periods/{id}/lines', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/payroll/goals', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/payroll/goals', 'GLOBAL'),
  route('GET', '/api/v1/payroll/goals/me/progress', 'SELF'),
  route('POST', '/api/v1/payroll/points/adjustments', 'RESOURCE'),
  route('GET', '/api/v1/competitions', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/competitions', 'GLOBAL'),
  route('GET', '/api/v1/competitions/{id}/leaderboard', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),

  route('GET', '/api/v1/cafeteria/menu', 'SELF', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/cafeteria/products', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/cafeteria/products', 'GLOBAL'),
  route('PATCH', '/api/v1/cafeteria/products/{id}', 'RESOURCE'),
  route('GET', '/api/v1/cafeteria/orders', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/cafeteria/orders', 'SELF', 'IDEMPOTENCY_KEY'),
  route('PATCH', '/api/v1/cafeteria/orders/{id}/status', 'RESOURCE'),
  route('POST', '/api/v1/cafeteria/orders/{id}/cancel', 'SELF'),
  route('GET', '/api/v1/cafeteria/accounts/me', 'SELF'),

  route('GET', '/api/v1/icebreakers', 'SELF', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/icebreakers', 'SELF'),
  route('PATCH', '/api/v1/icebreakers/{id}', 'SELF'),
  route('POST', '/api/v1/icebreakers/{id}/evaluate', 'SELF'),
  route('POST', '/api/v1/icebreakers/{id}/publish', 'SELF'),
  route('POST', '/api/v1/icebreakers/{id}/reviews', 'RESOURCE'),
  route('GET', '/api/v1/icebreakers/{id}/evaluations', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/icebreakers/{id}/effectiveness', 'RESOURCE'),
  route('GET', '/api/v1/icebreakers/violations', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/icebreaker-rules', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/icebreaker-rules', 'GLOBAL'),
  route('PATCH', '/api/v1/icebreaker-rules/{id}', 'RESOURCE'),

  route('GET', '/api/v1/tableau/views', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/tableau/views', 'GLOBAL'),
  route('GET', '/api/v1/tableau/runs', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/tableau/runs', 'GLOBAL'),
  route('POST', '/api/v1/tableau/runs/{id}/execute', 'RESOURCE'),

  route('GET', '/api/v1/users', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/users', 'GLOBAL'),
  route('PATCH', '/api/v1/users/{id}', 'RESOURCE'),
  route('POST', '/api/v1/users/{id}/disable', 'RESOURCE'),
  route('GET', '/api/v1/users/{id}/compensation', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/users/{id}/compensation', 'RESOURCE'),
  route('GET', '/api/v1/roles', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/permissions', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('GET', '/api/v1/settings', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('PATCH', '/api/v1/settings/{key}', 'RESOURCE'),
  route('GET', '/api/v1/feature-flags', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('PATCH', '/api/v1/feature-flags/{key}', 'RESOURCE'),
  route('GET', '/api/v1/settings/ip-allowlist', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/settings/ip-allowlist', 'GLOBAL'),
  route('POST', '/api/v1/settings/ip-allowlist/{id}/disable', 'RESOURCE'),
  route('GET', '/api/v1/audit-log', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),

  route('GET', '/api/v1/crews', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/crews', 'GLOBAL'),
  route('POST', '/api/v1/crews/{id}/members', 'RESOURCE'),
  route('DELETE', '/api/v1/crews/{id}/members/{userId}', 'RESOURCE'),
  route('GET', '/api/v1/operators/status', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/operators/me/status', 'SELF'),
  route('GET', '/api/v1/breaks/{shiftId}', 'RESOURCE', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/breaks/{id}/start', 'SELF'),
  route('POST', '/api/v1/breaks/{id}/end', 'SELF'),

  route('GET', '/api/v1/rocketchat/channels', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/rocketchat/channels', 'CREW'),
  route('POST', '/api/v1/rocketchat/messages', 'CREW'),
  route('POST', '/api/v1/rocketchat/bot/events', 'PUBLIC', 'NATURAL_KEY'),
  route('GET', '/api/v1/rocketchat/bot/knowledge', 'GLOBAL', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('PUT', '/api/v1/rocketchat/bot/knowledge/{slug}', 'RESOURCE', 'NATURAL_KEY'),
  route('GET', '/api/v1/scheduled-messages', 'CREW', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('POST', '/api/v1/scheduled-messages', 'CREW'),
  route('DELETE', '/api/v1/scheduled-messages/{id}', 'RESOURCE'),
  route('GET', '/api/v1/notifications', 'SELF', 'NOT_APPLICABLE', 'UNBOUNDED'),
  route('PATCH', '/api/v1/notifications/{id}/read', 'SELF'),
] satisfies readonly RouteContract[];

export function routeContractKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function operations(document: OpenAPIObject): Array<{ key: string; operation: ExtendedOperation }> {
  const result: Array<{ key: string; operation: ExtendedOperation }> = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method] as ExtendedOperation | undefined;
      if (operation) result.push({ key: routeContractKey(method, path), operation });
    }
  }
  return result;
}

function actorsFor(access: RouteAccess): Array<SeedRoleCode | 'ANONYMOUS'> {
  if (access.public) return ['ANONYMOUS'];
  const allowedRoles = new Set(access.roles);
  return ROLE_ORDER.filter((role) => {
    if (allowedRoles.size && !allowedRoles.has(role)) return false;
    const permissions = rolePermissionCodes[role];
    return permissions.includes('*') || access.permissions.every((permission) => permissions.includes(permission));
  });
}

function accessFor(operation: ExtendedOperation): RouteAccess | undefined {
  const isPublic = operation['x-agency-public'] === true;
  const roles = operation['x-agency-roles'] ?? [];
  const permissions = operation['x-agency-permissions'] ?? [];
  const isAuthenticated = operation['x-agency-authenticated'] === true || roles.length > 0 || permissions.length > 0;
  if (!isPublic && !isAuthenticated) return undefined;
  return { authenticated: !isPublic, public: isPublic, roles, permissions };
}

function validateContract(contract: RouteContract): void {
  if (!contract.path.startsWith('/')) throw new Error(`${routeContractKey(contract.method, contract.path)}: path must start with /`);
  if (!contract.scope || !contract.idempotency || !contract.pagination) {
    throw new Error(`${routeContractKey(contract.method, contract.path)}: incomplete route contract`);
  }
}

export function assertRouteContractCoverage(
  document: OpenAPIObject,
  contracts: readonly RouteContract[],
): void {
  const documented = operations(document);
  const documentedKeys = new Set(documented.map(({ key }) => key));
  const contractKeys = contracts.map((contract) => routeContractKey(contract.method, contract.path));
  const uniqueContractKeys = new Set(contractKeys);
  const duplicates = contractKeys.filter((key, index) => contractKeys.indexOf(key) !== index);
  const missing = [...documentedKeys].filter((key) => !uniqueContractKeys.has(key));
  const stale = [...uniqueContractKeys].filter((key) => !documentedKeys.has(key));
  const problems = [
    ...duplicates.map((key) => `duplicate: ${key}`),
    ...missing.map((key) => `missing: ${key}`),
    ...stale.map((key) => `stale: ${key}`),
  ];

  for (const contract of contracts) validateContract(contract);
  for (const { key, operation } of documented) {
    if (!accessFor(operation)) problems.push(`missing access metadata: ${key}`);
    if (operation['x-agency-policy'] && operation['x-agency-policy'].actors.length === 0) {
      problems.push(`no effective actors: ${key}`);
    }
  }
  if (problems.length) throw new Error(`Invalid route contract catalog:\n${problems.join('\n')}`);
}

export function applyRouteContracts(document: OpenAPIObject, contracts: readonly RouteContract[]): void {
  assertRouteContractCoverage(document, contracts);
  const byKey = new Map(contracts.map((contract) => [routeContractKey(contract.method, contract.path), contract]));
  for (const { key, operation } of operations(document)) {
    const contract = byKey.get(key);
    const access = accessFor(operation);
    if (!contract || !access) throw new Error(`Route contract invariant failed for ${key}`);
    operation['x-agency-policy'] = {
      ...contract,
      access,
      actors: actorsFor(access),
      device: operation['x-agency-device'] === true,
      shift: operation['x-agency-shift'] === true,
    };
    operation.security = access.public ? [] : [{ accessToken: [] }];
  }
}
