import { Body, Controller, Get, Param, Post, Put, Req, Res, UsePipes } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentDevice, CurrentUser, RequirePermissions, RequireRoles, RequireShift, StationAuthenticated } from '../../common/auth/decorators.js';
import { RequireStationDevice } from '../../common/auth/device.decorator.js';
import type { DevicePrincipal } from '../../common/auth/auth.types.js';
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
    return this.vault.rotate(profileId, body, { id: user.sub, role: user.role });
  }

  @Get('credential/meta')
  @RequirePermissions('vault.read_meta')
  async meta(@Param('profileId') profileId: string, @CurrentUser() user: AccessTokenClaims) {
    return this.vault.meta(profileId, { id: user.sub, role: user.role });
  }
}

@Controller('vault')
export class VaultKeyController {
  constructor(private readonly vault: VaultService) {}

  @Post('keys/rotate')
  @RequirePermissions('vault.keys.rotate')
  rotateKey(@CurrentUser() user: AccessTokenClaims) {
    return this.vault.rotateEncryptionKey(user.sub);
  }
}

@Controller('agent/session')
@RequireStationDevice()
@RequireRoles('OPERADOR')
@RequireShift()
export class AgentVaultController {
  constructor(private readonly vault: VaultService) {}

  @Post('credential-grant')
  @RequirePermissions('vault.credential.issue')
  @UsePipes(new ZodValidationPipe(credentialGrantSchema))
  async grant(@Body() body: CredentialGrantInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal, @Req() req: FastifyRequest) {
    return this.vault.grant({ ...body }, { userId: user.sub, deviceId: device.id, ip: req.ip });
  }

  @Post('credential-redeem')
  @RequirePermissions('vault.credential.issue')
  @UsePipes(new ZodValidationPipe(credentialRedeemSchema))
  async redeem(@Body() body: CredentialRedeemInput, @CurrentUser() user: AccessTokenClaims, @CurrentDevice() device: DevicePrincipal, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    return this.vault.redeem(body, { userId: user.sub, deviceId: device.id, ip: req.ip });
  }
}

@Controller('station')
@RequireStationDevice()
export class StationVaultController {
  constructor(private readonly vault: VaultService) {}

  @Post('credential-claims')
  @StationAuthenticated()
  @UsePipes(new ZodValidationPipe(credentialGrantSchema))
  async handoff(
    @Body() body: CredentialGrantInput,
    @CurrentDevice() device: DevicePrincipal,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    return this.vault.handoff(body, { deviceId: device.id, ip: req.ip });
  }
}
