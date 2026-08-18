import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AUTH_USER, type AuthenticatedRequest } from './auth.types.js';
import type { AccessTokenClaims } from './crypto.js';

export const IS_PUBLIC_KEY = 'agency-os.public';
export const IP_ALLOWLIST_BYPASS_KEY = 'agency-os.ip-allowlist-bypass';
export const REQUIRE_SHIFT_KEY = 'agency-os.require-shift';
export const REQUIRED_PERMISSIONS_KEY = 'agency-os.permissions';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const BypassIpAllowlist = () => SetMetadata(IP_ALLOWLIST_BYPASS_KEY, true);
export const RequireShift = () => SetMetadata(REQUIRE_SHIFT_KEY, true);
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

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
