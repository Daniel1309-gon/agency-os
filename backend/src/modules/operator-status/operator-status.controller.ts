import { Body, Controller, Get, Post, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions, RequireShift } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OperatorStatusService } from './operator-status.service.js';
import { operatorStatusSchema, type OperatorStatusInput } from './operator-status.schemas.js';

@Controller('operators')
export class OperatorStatusController {
  constructor(private readonly status: OperatorStatusService) {}
  @Get('status') @RequirePermissions('operators.monitor') list() { return this.status.list(); }
  @Post('me/status') @RequireShift() @UsePipes(new ZodValidationPipe(operatorStatusSchema)) set(@Body() body: OperatorStatusInput, @CurrentUser() user: AccessTokenClaims) { return this.status.set(user.sub, body); }
}
