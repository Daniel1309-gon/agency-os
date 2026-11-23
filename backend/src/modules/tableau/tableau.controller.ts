import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TableauService } from './tableau.service.js';
import { tableauRunSchema, tableauRunsQuerySchema, tableauViewSchema, tableauViewUpdateSchema, type TableauRunInput, type TableauRunsQueryInput, type TableauViewInput, type TableauViewUpdateInput } from './tableau.schemas.js';

@Controller('tableau')
@RequirePermissions('etl.manage')
export class TableauController {
  constructor(private readonly tableau: TableauService) {}
  @Get('views') views() { return this.tableau.listViews(); }
  @Post('views') @UsePipes(new ZodValidationPipe(tableauViewSchema)) createView(@Body() body: TableauViewInput, @CurrentUser() user: AccessTokenClaims) { return this.tableau.createView(body, user.sub); }
  @Patch('views/:id') @UsePipes(new ZodValidationPipe(tableauViewUpdateSchema)) updateView(@Param('id') id: string, @Body() body: TableauViewUpdateInput) { return this.tableau.updateView(id, body); }
  @Get('freshness') freshness() { return this.tableau.freshness(); }
  @Get('runs') runs(@Query(new ZodValidationPipe(tableauRunsQuerySchema)) query: TableauRunsQueryInput) { return this.tableau.runs(query); }
  @Post('runs') @UsePipes(new ZodValidationPipe(tableauRunSchema)) run(@Body() body: TableauRunInput) { return this.tableau.run(body); }
  // Queues the run again; the worker executes it (the API never holds the Tableau PAT).
  @Post('runs/:id/execute') execute(@Param('id') id: string) { return this.tableau.requeue(id); }
}
