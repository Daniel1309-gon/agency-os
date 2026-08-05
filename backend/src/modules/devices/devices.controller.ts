import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators.js';
import { DeviceTokenGuard } from '../../common/auth/guards.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DevicesService } from './devices.service.js';
import { deviceCreateSchema, deviceEnrollSchema, deviceHeartbeatSchema, type DeviceCreateInput, type DeviceEnrollInput, type DeviceHeartbeatInput } from './devices.schemas.js';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @RequirePermissions('devices.manage')
  @UsePipes(new ZodValidationPipe(deviceCreateSchema))
  create(@Body() body: DeviceCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.devices.create(body, user.sub); }

  @Get()
  @RequirePermissions('devices.manage')
  list() { return this.devices.list(); }

  @Public()
  @Post('enroll')
  @UsePipes(new ZodValidationPipe(deviceEnrollSchema))
  enroll(@Body() body: DeviceEnrollInput) { return this.devices.enroll(body); }

  @Get(':id')
  @RequirePermissions('devices.manage')
  get(@Param('id') id: string) { return this.devices.get(id); }

  @Post(':id/revoke')
  @RequirePermissions('devices.manage')
  revoke(@Param('id') id: string, @Body() body: { reason?: string }) { return this.devices.revoke(id, body.reason); }
}

@Controller('agent/devices')
@UseGuards(DeviceTokenGuard)
export class AgentDevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('heartbeat')
  @UsePipes(new ZodValidationPipe(deviceHeartbeatSchema))
  heartbeat(@Headers('x-device-token') token: string, @Body() body: DeviceHeartbeatInput, @Req() req: FastifyRequest) { return this.devices.heartbeat(token, body, req.ip); }
}
