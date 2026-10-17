import { Body, Controller, Delete, Get, Param, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ShiftsService } from './shifts.service.js';
import { effectiveTimeQuerySchema, shiftCreateSchema, shiftOverrideSchema, shiftTemplateSchema, type EffectiveTimeQueryInput, type ShiftCreateInput, type ShiftOverrideInput, type ShiftTemplateInput } from './shifts.schemas.js';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Post()
  @RequirePermissions('shifts.manage')
  @UsePipes(new ZodValidationPipe(shiftCreateSchema))
  create(@Body() body: ShiftCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.shifts.create(body, user.sub); }

  @Get('me/current')
  @RequirePermissions('shifts.read')
  current(@CurrentUser() user: AccessTokenClaims) { return this.shifts.current(user.sub); }

  @Post(':id/start')
  @RequirePermissions('shifts.read')
  start(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.shifts.start(id, user.sub); }

  @Post(':id/end')
  @RequirePermissions('shifts.read')
  end(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.shifts.end(id, user.sub); }
}

@Controller('shift-templates')
export class ShiftTemplatesController {
  constructor(private readonly shifts: ShiftsService) {}
  @Get() @RequirePermissions('shifts.read') list() { return this.shifts.listTemplates(); }
  @Post() @RequirePermissions('shifts.manage') @UsePipes(new ZodValidationPipe(shiftTemplateSchema)) create(@Body() body: ShiftTemplateInput, @CurrentUser() user: AccessTokenClaims) { return this.shifts.createTemplate(body, user.sub); }
}

@Controller('shift-overrides')
export class ShiftOverridesController {
  constructor(private readonly shifts: ShiftsService) {}
  @Post() @RequirePermissions('shifts.approve_overtime') @UsePipes(new ZodValidationPipe(shiftOverrideSchema)) create(@Body() body: ShiftOverrideInput, @CurrentUser() user: AccessTokenClaims) { return this.shifts.createOverride(body, user.sub); }
  @Delete(':id') @RequirePermissions('shifts.approve_overtime') revoke(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.shifts.revokeOverride(id, user.sub); }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly shifts: ShiftsService) {}
  @Get('effective-time') @RequirePermissions('reports.read') @UsePipes(new ZodValidationPipe(effectiveTimeQuerySchema)) report(@Query() query: EffectiveTimeQueryInput, @CurrentUser() user: AccessTokenClaims) { return this.shifts.effectiveTime(query, user.sub); }
}
