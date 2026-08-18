import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AdminService } from './admin.service.js';
import { compensationSchema, featureFlagSchema, ipAllowlistSchema, settingSchema, userCreateSchema, userPatchSchema, type CompensationInput, type FeatureFlagInput, type IpAllowlistInput, type SettingInput, type UserCreateInput, type UserPatchInput } from './admin.schemas.js';

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('users') @RequirePermissions('users.read') users(@CurrentUser() user: AccessTokenClaims) { return this.admin.listUsers(user); }
  @Post('users') @RequirePermissions('users.create') @UsePipes(new ZodValidationPipe(userCreateSchema)) create(@Body() body: UserCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.createUser(body, user.sub); }
  @Patch('users/:id') @RequirePermissions('users.update') @UsePipes(new ZodValidationPipe(userPatchSchema)) update(@Param('id') id: string, @Body() body: UserPatchInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.updateUser(id, body, user.sub); }
  @Post('users/:id/disable') @RequirePermissions('users.disable') disable(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.admin.disableUser(id, user.sub); }
  @Get('users/:id/compensation') @RequirePermissions('payroll.configure') compensation(@Param('id') id: string) { return this.admin.listCompensation(id); }
  @Post('users/:id/compensation') @RequirePermissions('payroll.configure') @UsePipes(new ZodValidationPipe(compensationSchema)) addCompensation(@Param('id') id: string, @Body() body: CompensationInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.addCompensation(id, body, user.sub); }
  @Get('roles') @RequirePermissions('rbac.read') roles() { return this.admin.roles(); }
  @Get('permissions') @RequirePermissions('rbac.read') permissions() { return this.admin.permissions(); }
  @Get('settings') @RequirePermissions('settings.manage') settings() { return this.admin.settings(); }
  @Patch('settings/:key') @RequirePermissions('settings.manage') @UsePipes(new ZodValidationPipe(settingSchema)) setting(@Param('key') key: string, @Body() body: SettingInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.setSetting(key, body, user.sub); }
  @Get('feature-flags') @RequirePermissions('settings.manage') flags() { return this.admin.flags(); }
  @Patch('feature-flags/:key') @RequirePermissions('settings.manage') @UsePipes(new ZodValidationPipe(featureFlagSchema)) flag(@Param('key') key: string, @Body() body: FeatureFlagInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.setFlag(key, body, user.sub); }
  @Get('settings/ip-allowlist') @RequirePermissions('security.manage') allowlist() { return this.admin.listAllowlist(); }
  @Post('settings/ip-allowlist') @RequirePermissions('security.manage') @UsePipes(new ZodValidationPipe(ipAllowlistSchema)) addAllowlist(@Body() body: IpAllowlistInput, @CurrentUser() user: AccessTokenClaims) { return this.admin.addAllowlist(body, user.sub); }
  @Post('settings/ip-allowlist/:id/disable') @RequirePermissions('security.manage') disableAllowlist(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.admin.removeAllowlist(id, user.sub); }
  @Get('audit-log') @RequirePermissions('audit.read') audit(@CurrentUser() user: AccessTokenClaims, @Query('from') from?: string, @Query('to') to?: string, @Query('action') action?: string, @Query('actorId') actorId?: string) { return this.admin.audit({ from, to, action, actorId }, user); }
}
