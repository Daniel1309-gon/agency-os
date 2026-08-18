import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions, RequireShift } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { BreaksService } from './breaks.service.js';

@Controller('breaks')
export class BreaksController {
  constructor(private readonly breaks: BreaksService) {}
  @Get(':shiftId') @RequirePermissions('shifts.read') list(@Param('shiftId') shiftId: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.list(shiftId, user.sub); }
  @Post(':id/start') @RequireShift() start(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.start(id, user.sub); }
  @Post(':id/end') @RequireShift() end(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.end(id, user.sub); }
}
