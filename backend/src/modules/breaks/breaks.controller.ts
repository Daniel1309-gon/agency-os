import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { BreaksService } from './breaks.service.js';

@Controller('breaks')
export class BreaksController {
  constructor(private readonly breaks: BreaksService) {}
  @Get(':shiftId') list(@Param('shiftId') shiftId: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.list(shiftId, user.sub); }
  @Post(':id/start') start(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.start(id, user.sub); }
  @Post(':id/end') end(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.breaks.end(id, user.sub); }
}
