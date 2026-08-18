import { Body, Controller, Delete, Get, Param, Post, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CrewsService } from './crews.service.js';
import { crewMemberSchema, crewSchema, type CrewInput, type CrewMemberInput } from './crews.schemas.js';

@Controller('crews')
@RequirePermissions('crews.read')
export class CrewsController {
  constructor(private readonly crews: CrewsService) {}
  @Get() list(@CurrentUser() user: AccessTokenClaims) { return this.crews.list(user); }
  @Post() @RequirePermissions('crews.manage') @UsePipes(new ZodValidationPipe(crewSchema)) create(@Body() body: CrewInput, @CurrentUser() user: AccessTokenClaims) { return this.crews.create(body, user); }
  @Post(':id/members') @RequirePermissions('crews.manage') @UsePipes(new ZodValidationPipe(crewMemberSchema)) add(@Param('id') id: string, @Body() body: CrewMemberInput, @CurrentUser() user: AccessTokenClaims) { return this.crews.addMember(id, body, user); }
  @Delete(':id/members/:userId') @RequirePermissions('crews.manage') remove(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: AccessTokenClaims) { return this.crews.remove(id, userId, user); }
}
