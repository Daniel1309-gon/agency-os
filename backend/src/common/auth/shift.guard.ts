import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SHIFT_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ShiftAccessService } from './shift-access.service.js';

@Injectable()
export class ShiftWindowGuard implements CanActivate {
  constructor(private readonly shiftAccess: ShiftAccessService, private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_SHIFT_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authenticated operator required');
    if (user.role !== 'OPERADOR') return true;

    if (await this.shiftAccess.isWithinApprovedWindow(user.sub)) return true;

    await this.audit.record({ actorType: 'USER', actorUserId: user.sub, action: 'shift.access.denied', result: 'DENIED', ip: request.ip, requestId: request.id, metadata: { denyReason: 'OUTSIDE_SHIFT', route: request.raw?.url } }).catch(() => undefined);
    throw new ForbiddenException('Operator is outside an approved shift');
  }
}
