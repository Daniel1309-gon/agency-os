import { Body, Controller, Get, Param, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TableauService } from './tableau.service.js';
import { tableauRunSchema, tableauViewSchema, type TableauRunInput, type TableauViewInput } from './tableau.schemas.js';

@Controller('tableau')
@RequirePermissions('etl.manage')
export class TableauController {
  constructor(private readonly tableau: TableauService) {}
  @Get('views') views() { return this.tableau.listViews(); }
  @Post('views') @UsePipes(new ZodValidationPipe(tableauViewSchema)) createView(@Body() body: TableauViewInput, @CurrentUser() user: AccessTokenClaims) { return this.tableau.createView(body, user.sub); }
  @Get('runs') runs(@Query('viewId') viewId?: string) { return this.tableau.runs(viewId); }
  @Post('runs') @UsePipes(new ZodValidationPipe(tableauRunSchema)) run(@Body() body: TableauRunInput) { return this.tableau.run(body); }
  @Post('runs/:id/execute') execute(@Param('id') id: string) { return this.tableau.execute(id); }
}
