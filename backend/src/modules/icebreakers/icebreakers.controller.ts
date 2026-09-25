import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { Authenticated, CurrentUser, RequirePermissions, RequireRoles } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { IcebreakersService } from './icebreakers.service.js';
import { icebreakerCreateSchema, icebreakerUpdateSchema, reviewSchema, ruleSchema, ruleUpdateSchema, type IcebreakerCreateInput, type IcebreakerUpdateInput, type ReviewInput, type RuleInput, type RuleUpdateInput } from './icebreakers.schemas.js';

@Controller('icebreakers')
@Authenticated()
export class IcebreakersController {
  constructor(private readonly icebreakers: IcebreakersService) {}
  @Get() @RequireRoles('OPERADOR') list(@CurrentUser() user: AccessTokenClaims) { return this.icebreakers.list(user); }
  @Post() @RequireRoles('OPERADOR') @UsePipes(new ZodValidationPipe(icebreakerCreateSchema)) create(@Body() body: IcebreakerCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.create(body, user); }
  @Patch(':id') @RequireRoles('OPERADOR') @UsePipes(new ZodValidationPipe(icebreakerUpdateSchema)) update(@Param('id') id: string, @Body() body: IcebreakerUpdateInput, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.update(id, body, user); }
  @Post(':id/evaluate') @RequireRoles('OPERADOR') evaluate(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.evaluate(id, user); }
  @Post(':id/publish') @RequireRoles('OPERADOR') publish(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.publish(id, user); }
  @Post(':id/reviews') @RequirePermissions('icebreaker.review') @UsePipes(new ZodValidationPipe(reviewSchema)) review(@Param('id') id: string, @Body() body: ReviewInput, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.review(id, body, user); }
  @Get(':id/evaluations') @RequireRoles('OPERADOR') evaluations(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.evaluations(id, user); }
  @Get(':id/effectiveness') @RequireRoles('OPERADOR') effectiveness(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.effectiveness(id, user); }
  @Get('violations') @RequirePermissions('icebreaker.review') violations(@CurrentUser() user: AccessTokenClaims, @Query('from') from?: string, @Query('to') to?: string, @Query('operatorId') operatorId?: string) { return this.icebreakers.violations({ from, to, operatorId }, user); }
}

@Controller('icebreaker-rules')
export class IcebreakerRulesController {
  constructor(private readonly icebreakers: IcebreakersService) {}
  @Post() @RequirePermissions('icebreaker.rules.manage') @UsePipes(new ZodValidationPipe(ruleSchema)) create(@Body() body: RuleInput, @CurrentUser() user: AccessTokenClaims) { return this.icebreakers.createRule(body, user.sub); }
  @Get() @RequirePermissions('icebreaker.rules.manage') list() { return this.icebreakers.listRules(); }
  @Patch(':id') @RequirePermissions('icebreaker.rules.manage') @UsePipes(new ZodValidationPipe(ruleUpdateSchema)) update(@Param('id') id: string, @Body() body: RuleUpdateInput) { return this.icebreakers.updateRule(id, body); }
}
