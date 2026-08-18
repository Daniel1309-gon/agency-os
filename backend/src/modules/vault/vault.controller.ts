import { Body, Controller, Get, Headers, Param, Post, Put, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, RequirePermissions, RequireRoles, RequireShift } from '../../common/auth/decorators.js';
import { DeviceTokenGuard } from '../../common/auth/guards.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { VaultService } from './vault.service.js';
import { credentialGrantSchema, credentialRedeemSchema, credentialRotationSchema, type CredentialGrantInput, type CredentialRedeemInput, type CredentialRotationInput } from './vault.schemas.js';

@Controller('profiles/:profileId')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Put('credential')
  @RequirePermissions('vault.rotate')
  @UsePipes(new ZodValidationPipe(credentialRotationSchema))
  async rotate(@Param('profileId') profileId: string, @Body() body: CredentialRotationInput, @CurrentUser() user: AccessTokenClaims) {
    return this.vault.rotate(profileId, body, user.sub);
  }

  @Get('credential/meta')
  @RequirePermissions('vault.read_meta')
  async meta(@Param('profileId') profileId: string) {
    return this.vault.meta(profileId);
  }
}

@Controller('agent/session')
@UseGuards(DeviceTokenGuard)
@RequireRoles('OPERADOR')
@RequireShift()
export class AgentVaultController {
  constructor(private readonly vault: VaultService) {}

  @Post('credential-grant')
  @RequirePermissions('vault.credential.issue')
  @UsePipes(new ZodValidationPipe(credentialGrantSchema))
  async grant(@Body() body: CredentialGrantInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-device-token') deviceToken: string, @Req() req: FastifyRequest) {
    return this.vault.grant({ ...body }, { userId: user.sub, deviceToken, ip: req.ip });
  }

  @Post('credential-redeem')
  @RequirePermissions('vault.credential.issue')
  @UsePipes(new ZodValidationPipe(credentialRedeemSchema))
  async redeem(@Body() body: CredentialRedeemInput, @CurrentUser() user: AccessTokenClaims, @Headers('x-device-token') deviceToken: string, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    return this.vault.redeem(body, { userId: user.sub, deviceToken, ip: req.ip });
  }
}
