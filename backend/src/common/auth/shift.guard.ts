import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { shiftOverrides, shifts } from '../../database/schema/index.js';
import { REQUIRE_SHIFT_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class ShiftWindowGuard implements CanActivate {
  constructor(private readonly db: DatabaseService, private readonly reflector: Reflector, private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_SHIFT_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authenticated operator required');
    if (user.role !== 'OPERADOR') return true;

    const shift = await this.db.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(
        eq(shifts.operatorId, user.sub),
        or(eq(shifts.status, 'SCHEDULED'), eq(shifts.status, 'IN_PROGRESS')),
        sql`${shifts.scheduledRange} @> now()`,
      ))
      .limit(1);
    if (shift.length) return true;

    const override = await this.db.db
      .select({ id: shiftOverrides.id })
      .from(shiftOverrides)
      .where(and(eq(shiftOverrides.operatorId, user.sub), sql`${shiftOverrides.range} @> now()`))
      .limit(1);
    if (override.length) return true;

    await this.audit.record({ actorType: 'USER', actorUserId: user.sub, action: 'shift.access.denied', result: 'DENIED', ip: request.ip, requestId: request.id, metadata: { denyReason: 'OUTSIDE_SHIFT', route: request.raw?.url } }).catch(() => undefined);
    throw new ForbiddenException('Operator is outside an approved shift');
  }
}
