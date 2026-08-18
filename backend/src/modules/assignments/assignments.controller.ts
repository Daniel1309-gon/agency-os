import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions, RequireRoles, RequireShift } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DeviceTokenGuard } from '../../common/auth/guards.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { AssignmentsService } from './assignments.service.js';
import { assignmentCreateSchema, assignmentHistoryQuerySchema, sessionCreateSchema, sessionPatchSchema, type AssignmentCreateInput, type AssignmentHistoryQuery, type SessionCreateInput, type SessionPatchInput } from './assignments.schemas.js';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  @RequirePermissions('profiles.update')
  @UsePipes(new ZodValidationPipe(assignmentCreateSchema))
  create(@Body() body: AssignmentCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.assignments.create(body, user.sub); }

  @Get()
  @RequirePermissions('profiles.read')
  history(@Query(new ZodValidationPipe(assignmentHistoryQuerySchema)) query: AssignmentHistoryQuery, @CurrentUser() user: AccessTokenClaims) {
    return this.assignments.history(query, user.sub);
  }

  @Post(':id/end')
  @RequirePermissions('profiles.update')
  end(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.assignments.end(id, user.sub); }
}

@Controller('agent')
@UseGuards(DeviceTokenGuard)
@RequireRoles('OPERADOR')
@RequireShift()
export class AgentSessionsController {
  constructor(private readonly assignments: AssignmentsService, private readonly profiles: ProfilesService) {}

  @Get('profiles/assigned')
  @RequirePermissions('profiles.read')
  assigned(@CurrentUser() user: AccessTokenClaims) { return this.profiles.assignedTo(user.sub); }

  @Post('sessions')
  @UsePipes(new ZodValidationPipe(sessionCreateSchema))
  open(@Body() body: SessionCreateInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-device-token') token: string) { return this.assignments.openSession(body, user.sub, token); }

  @Patch('sessions/:id')
  @UsePipes(new ZodValidationPipe(sessionPatchSchema))
  update(@Param('id') id: string, @Body() body: SessionPatchInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-device-token') token: string) { return this.assignments.updateSession(id, body, user.sub, token); }

  @Post('sessions/:id/close')
  close(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims, @Headers('x-device-token') token: string) { return this.assignments.closeSession(id, user.sub, token); }
}
