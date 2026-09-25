import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentDevice, CurrentUser, RequirePermissions, RequireRoles, RequireShift, StationAuthenticated } from '../../common/auth/decorators.js';
import { RequireStationDevice } from '../../common/auth/device.decorator.js';
import type { DevicePrincipal } from '../../common/auth/auth.types.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { AssignmentsService } from './assignments.service.js';
import { assignmentCreateSchema, assignmentHistoryQuerySchema, sessionCloseSchema, sessionCreateSchema, sessionPatchSchema, stationSessionHeartbeatSchema, stationSessionPatchSchema, type AssignmentCreateInput, type AssignmentHistoryQuery, type SessionCloseInput, type SessionCreateInput, type SessionPatchInput, type StationSessionHeartbeatInput, type StationSessionPatchInput } from './assignments.schemas.js';

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
@RequireRoles('OPERADOR')
@RequireShift()
export class AgentSessionsController {
  constructor(private readonly assignments: AssignmentsService, private readonly profiles: ProfilesService) {}

  @Get('profiles/assigned')
  @RequirePermissions('profiles.read')
  assigned(@CurrentUser() user: AccessTokenClaims) { return this.profiles.assignedTo(user.sub); }

  @Post('sessions/prepare')
  @RequireStationDevice()
  @RequirePermissions('profiles.read')
  @UsePipes(new ZodValidationPipe(sessionCreateSchema))
  prepare(@Body() body: SessionCreateInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.prepareSession(body, user.sub, device.id);
  }

  @Post('sessions')
  @RequireStationDevice()
  @UsePipes(new ZodValidationPipe(sessionCreateSchema))
  open(@Body() body: SessionCreateInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.openSession(body, user.sub, device.id);
  }

  @Patch('sessions/:id')
  @RequireStationDevice()
  @UsePipes(new ZodValidationPipe(sessionPatchSchema))
  update(@Param('id') id: string, @Body() body: SessionPatchInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.updateSession(id, body, user.sub, device.id);
  }

  @Post('sessions/:id/close')
  @RequireStationDevice()
  @UsePipes(new ZodValidationPipe(sessionCloseSchema))
  close(@Param('id') id: string, @Body() body: SessionCloseInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.closeSession(id, body.version, user.sub, device.id);
  }
}

@Controller('station/sessions')
@RequireStationDevice()
export class StationSessionsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Patch(':id')
  @StationAuthenticated()
  @UsePipes(new ZodValidationPipe(stationSessionPatchSchema))
  update(@Param('id') id: string, @Body() body: StationSessionPatchInput, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.updateStationSession(id, body, device.id);
  }

  @Post(':id/heartbeat')
  @StationAuthenticated()
  @UsePipes(new ZodValidationPipe(stationSessionHeartbeatSchema))
  heartbeat(@Param('id') id: string, @Body() body: StationSessionHeartbeatInput, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.heartbeatStationSession(id, body.version, device.id);
  }

  @Post(':id/close')
  @StationAuthenticated()
  @UsePipes(new ZodValidationPipe(sessionCloseSchema))
  close(@Param('id') id: string, @Body() body: SessionCloseInput, @CurrentDevice() device: DevicePrincipal) {
    return this.assignments.closeStationSession(id, body.version, device.id);
  }
}
