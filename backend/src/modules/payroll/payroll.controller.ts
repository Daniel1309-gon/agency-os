import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UsePipes } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUser, RequirePermissions, RequireRoles } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PayrollService } from './payroll.service.js';
import { adjustmentSchema, competitionSchema, goalSchema, periodCreateSchema, pointsAdjustmentSchema, type AdjustmentInput, type CompetitionInput, type GoalInput, type PeriodCreateInput, type PointsAdjustmentInput } from './payroll.schemas.js';

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('me/summary')
  @RequirePermissions('payroll.read')
  summary(@CurrentUser() user: AccessTokenClaims, @Query('periodId') periodId?: string) { return this.payroll.summary(user.sub, periodId); }

  @Get('me/periods')
  @RequirePermissions('payroll.read')
  myPeriods() { return this.payroll.myPeriods(); }

  // FR-28: period rows carry the default rate and lines carry gross COP and rate
  // snapshots, which the operator must not see. Operators read their own figures
  // through /payroll/me/summary and /payroll/me/periods instead.
  @Get('periods')
  @RequireRoles('ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR')
  periods() { return this.payroll.listPeriods(); }

  @Post('periods')
  @RequirePermissions('payroll.configure')
  @UsePipes(new ZodValidationPipe(periodCreateSchema))
  createPeriod(@Body() body: PeriodCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.payroll.createPeriod(body, user.sub); }

  @Post('periods/:id/compute')
  @RequirePermissions('payroll.configure')
  compute(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.payroll.compute(id, user.sub); }

  @Post('periods/:id/lock')
  @RequirePermissions('payroll.close')
  lock(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.payroll.setStatus(id, 'LOCKED', user.sub); }

  @Post('periods/:id/close')
  @RequirePermissions('payroll.close')
  close(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.payroll.setStatus(id, 'CLOSED', user.sub); }

  @Post('lines/:id/adjustments')
  @RequirePermissions('payroll.adjust')
  @UsePipes(new ZodValidationPipe(adjustmentSchema))
  adjustment(@Param('id') id: string, @Body() body: AdjustmentInput, @CurrentUser() user: AccessTokenClaims) { return this.payroll.adjustment(id, body, user.sub); }

  @Get('periods/:id/lines') @RequireRoles('ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR') lines(@Param('id') id: string) { return this.payroll.lines(id); }

  @Get('periods/:id/export')
  @RequirePermissions('payroll.configure')
  async exportPeriod(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims, @Res({ passthrough: true }) reply: FastifyReply) {
    const { filename, buffer } = await this.payroll.exportPeriodXlsx(id, user.sub);
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store');
    return new StreamableFile(buffer);
  }

  @Get('goals') @RequirePermissions('payroll.read') goals(@Query('periodId') periodId?: string) { return this.payroll.listGoals(periodId); }
  @Post('goals') @RequirePermissions('payroll.configure') @UsePipes(new ZodValidationPipe(goalSchema)) createGoal(@Body() body: GoalInput) { return this.payroll.createGoal(body); }
  @Get('goals/me/progress') @RequirePermissions('payroll.read') goalProgress(@CurrentUser() user: AccessTokenClaims, @Query('periodId') periodId: string) { return this.payroll.goalProgress(user.sub, periodId); }

  @Post('points/adjustments') @RequirePermissions('payroll.adjust') @UsePipes(new ZodValidationPipe(pointsAdjustmentSchema)) pointsAdjustment(@Body() body: PointsAdjustmentInput, @CurrentUser() user: AccessTokenClaims) { return this.payroll.addPointsAdjustment(body, user.sub); }
}

@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly payroll: PayrollService) {}
  @Get() @RequirePermissions('payroll.read') list() { return this.payroll.listCompetitions(); }
  @Post() @RequirePermissions('payroll.configure') @UsePipes(new ZodValidationPipe(competitionSchema)) create(@Body() body: CompetitionInput, @CurrentUser() user: AccessTokenClaims) { return this.payroll.createCompetition(body, user.sub); }
  @Get(':id/leaderboard') @RequirePermissions('payroll.read') leaderboard(@Param('id') id: string) { return this.payroll.leaderboard(id); }
}
