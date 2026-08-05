import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ProfilesService } from './profiles.service.js';
import { profileCreateSchema, profileUpdateSchema, type ProfileCreateInput, type ProfileUpdateInput } from './profiles.schemas.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @RequirePermissions('profiles.read')
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.profiles.list(Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post()
  @RequirePermissions('profiles.create')
  @UsePipes(new ZodValidationPipe(profileCreateSchema))
  create(@Body() body: ProfileCreateInput, @CurrentUser() user: AccessTokenClaims) {
    return this.profiles.create(body, user.sub);
  }

  @Get(':id')
  @RequirePermissions('profiles.read')
  get(@Param('id') id: string) { return this.profiles.get(id); }

  @Patch(':id')
  @RequirePermissions('profiles.update')
  @UsePipes(new ZodValidationPipe(profileUpdateSchema))
  update(@Param('id') id: string, @Body() body: ProfileUpdateInput, @CurrentUser() user: AccessTokenClaims) { return this.profiles.update(id, body, user.sub); }

  @Post(':id/deactivate')
  @RequirePermissions('profiles.update')
  deactivate(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.profiles.deactivate(id, user.sub); }

  @Get(':id/access-log')
  @RequirePermissions('audit.read')
  accessLog(@Param('id') id: string) { return this.profiles.accessLog(id); }
}
