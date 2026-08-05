import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { DeviceTokenGuard } from '../../common/auth/guards.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { MetricsService } from './metrics.service.js';
import { metricBatchSchema, type MetricBatchInput } from './metrics.schemas.js';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Post('agent/metrics/batch')
  @UseGuards(DeviceTokenGuard)
  @UsePipes(new ZodValidationPipe(metricBatchSchema))
  async ingest(@Body() body: MetricBatchInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-session-id') sessionId?: string) {
    return this.metrics.ingest(body, user.sub, sessionId);
  }

  @Get('metrics/profiles')
  @RequirePermissions('metrics.audit')
  profiles(@Query('from') from?: string, @Query('to') to?: string, @Query('profileId') profileId?: string) { return this.metrics.profiles(from, to, profileId); }

  @Get('metrics/ranking')
  @RequirePermissions('metrics.audit')
  ranking() { return this.metrics.ranking(); }

  @Get('metrics/profiles/:id/timeseries') @RequirePermissions('metrics.audit') timeseries(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) { return this.metrics.timeseries(id, from, to); }
  @Get('metrics/reconciliation') @RequirePermissions('metrics.audit') reconciliation(@Query('date') date?: string) { return this.metrics.reconciliation(date); }
}
