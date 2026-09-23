import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { OutboxOpsService } from './outbox-ops.service.js';

@Controller('ops/outbox')
export class OutboxController {
  constructor(private readonly ops: OutboxOpsService) {}
  @Get() @RequirePermissions('outbox.manage') list(@Query('status') status?: string, @Query('eventType') eventType?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.ops.list({ status, eventType, cursor, limit }); }
  @Get('summary') @RequirePermissions('outbox.manage') summary() { return this.ops.summary(); }
  @Post(':id/requeue') @RequirePermissions('outbox.manage') requeue(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.ops.requeue(id, user.sub); }
}
