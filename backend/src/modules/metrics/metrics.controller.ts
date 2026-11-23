import { Body, Controller, Get, Headers, Param, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions, RequireRoles, RequireShift } from '../../common/auth/decorators.js';
import { RequireStationDevice } from '../../common/auth/device.decorator.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { MetricsService } from './metrics.service.js';
import { metricBatchSchema, metricQuerySchema, rankingQuerySchema, reconciliationQuerySchema, timeseriesQuerySchema, type MetricBatchInput, type MetricQueryInput, type RankingQueryInput, type ReconciliationQueryInput, type TimeseriesQueryInput } from './metrics.schemas.js';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Post('agent/metrics/batch')
  @RequireStationDevice()
  @RequireRoles('OPERADOR')
  @RequireShift()
  @UsePipes(new ZodValidationPipe(metricBatchSchema))
  async ingest(@Body() body: MetricBatchInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-session-id') sessionId?: string) {
    return this.metrics.ingest(body, user.sub, sessionId);
  }

  @Get('metrics/profiles')
  @RequirePermissions('metrics.audit')
  profiles(@Query(new ZodValidationPipe(metricQuerySchema)) query: MetricQueryInput, @CurrentUser() user: AccessTokenClaims) {
    return this.metrics.profiles(query.from, query.to, query.profileId, user, query.limit);
  }

  @Get('metrics/me/profiles')
  @RequireRoles('OPERADOR')
  myProfiles(@Query(new ZodValidationPipe(metricQuerySchema)) query: MetricQueryInput, @CurrentUser() user: AccessTokenClaims) {
    return this.metrics.operatorProfiles(user, query);
  }

  @Get('metrics/ranking')
  @RequirePermissions('metrics.audit')
  ranking(@Query(new ZodValidationPipe(rankingQuerySchema)) query: RankingQueryInput, @CurrentUser() user: AccessTokenClaims) {
    return this.metrics.ranking(query, user);
  }

  @Get('metrics/profiles/:id/timeseries')
  @RequirePermissions('metrics.audit')
  timeseries(@Param('id') id: string, @Query(new ZodValidationPipe(timeseriesQuerySchema)) query: TimeseriesQueryInput, @CurrentUser() user: AccessTokenClaims) {
    return this.metrics.timeseries(id, query.from, query.to, user, query.limit);
  }

  @Get('metrics/reconciliation')
  @RequirePermissions('metrics.audit')
  reconciliation(@Query(new ZodValidationPipe(reconciliationQuerySchema)) query: ReconciliationQueryInput, @CurrentUser() user: AccessTokenClaims) {
    return this.metrics.reconciliation(query, user);
  }

  @Get('metrics/operations') @RequirePermissions('metrics.audit') operations(@CurrentUser() user: AccessTokenClaims) { return this.metrics.operations(user); }
}
