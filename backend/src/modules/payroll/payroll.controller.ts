import { Body, Controller, Get, Param, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
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

  @Get('periods')
  @RequirePermissions('payroll.read')
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

  @Get('periods/:id/lines') @RequirePermissions('payroll.read') lines(@Param('id') id: string) { return this.payroll.lines(id); }

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
