import { SetMetadata, applyDecorators, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AUTH_USER, type AuthenticatedRequest } from './auth.types.js';
import type { AccessTokenClaims } from './crypto.js';

export const IS_PUBLIC_KEY = 'agency-os.public';
export const IP_ALLOWLIST_BYPASS_KEY = 'agency-os.ip-allowlist-bypass';
export const REQUIRE_SHIFT_KEY = 'agency-os.require-shift';
export const REQUIRED_PERMISSIONS_KEY = 'agency-os.permissions';
export const REQUIRED_ROLES_KEY = 'agency-os.roles';
export const ROUTE_POLICY_KEY = 'agency-os.route-policy';

export type RoutePolicy = 'authenticated' | 'permissions' | 'public' | 'roles';

export const Authenticated = () => SetMetadata(ROUTE_POLICY_KEY, 'authenticated' satisfies RoutePolicy);
export const Public = () => applyDecorators(
  SetMetadata(IS_PUBLIC_KEY, true),
  SetMetadata(ROUTE_POLICY_KEY, 'public' satisfies RoutePolicy),
);
export const BypassIpAllowlist = () => SetMetadata(IP_ALLOWLIST_BYPASS_KEY, true);
export const RequireShift = () => SetMetadata(REQUIRE_SHIFT_KEY, true);
function requirePolicyValues(policy: string, values: string[]): void {
  if (!values.length || values.some((value) => !value.trim())) {
    throw new Error(`${policy} requires at least one non-empty value`);
  }
}

export const RequirePermissions = (...permissions: string[]) => {
  requirePolicyValues('RequirePermissions', permissions);
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    SetMetadata(ROUTE_POLICY_KEY, 'permissions' satisfies RoutePolicy),
  );
};
export const RequireRoles = (...roles: string[]) => {
  requirePolicyValues('RequireRoles', roles);
  return applyDecorators(
    SetMetadata(REQUIRED_ROLES_KEY, roles),
    SetMetadata(ROUTE_POLICY_KEY, 'roles' satisfies RoutePolicy),
  );
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenClaims | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

export function setAuthenticatedUser(request: AuthenticatedRequest, user: AccessTokenClaims): void {
  request.user = user;
  (request as unknown as Record<symbol, unknown>)[AUTH_USER] = user;
}
