import { Body, Controller, Get, Param, Post, Req, UsePipes } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AllowUnregisteredClientCert, CurrentClientCert, CurrentDevice, CurrentUser, Public, RequirePermissions, RequireRoles } from '../../common/auth/decorators.js';
import { RequireStationDevice } from '../../common/auth/device.decorator.js';
import type { ClientCertIdentity, DevicePrincipal } from '../../common/auth/auth.types.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { DevicesService } from './devices.service.js';
import { deviceCertificateSchema, deviceCreateSchema, deviceEnrollSchema, deviceHeartbeatSchema, deviceRevokeSchema, type DeviceCertificateInput, type DeviceCreateInput, type DeviceEnrollInput, type DeviceHeartbeatInput, type DeviceRevokeInput } from './devices.schemas.js';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @RequirePermissions('devices.manage')
  @UsePipes(new ZodValidationPipe(deviceCreateSchema))
  create(@Body() body: DeviceCreateInput, @CurrentUser() user: AccessTokenClaims) { return this.devices.create(body, user); }

  @Get()
  @RequirePermissions('devices.manage')
  list(@CurrentUser() user: AccessTokenClaims) { return this.devices.list(user); }

  /**
   * La PC nueva aun no existe en `devices`, asi que el guard de certificado no
   * puede resolverla: se exige el certificado (huella verificada) pero no un
   * dispositivo aprobado, y el codigo de un solo uso es el segundo factor.
   */
  @Public()
  @AllowUnregisteredClientCert()
  @Post('enroll')
  @UsePipes(new ZodValidationPipe(deviceEnrollSchema))
  enroll(@Body() body: DeviceEnrollInput, @CurrentClientCert() cert: ClientCertIdentity) { return this.devices.enroll(body, cert); }

  @Get(':id')
  @RequirePermissions('devices.manage')
  get(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.devices.get(id, user); }

  @Post(':id/certificate')
  @RequirePermissions('devices.manage')
  @UsePipes(new ZodValidationPipe(deviceCertificateSchema))
  registerCertificate(@Param('id') id: string, @Body() body: DeviceCertificateInput, @CurrentUser() user: AccessTokenClaims) {
    return this.devices.registerCertificate(id, body, user);
  }

  @Post(':id/revoke')
  @RequirePermissions('devices.manage')
  @UsePipes(new ZodValidationPipe(deviceRevokeSchema))
  revoke(@Param('id') id: string, @Body() body: DeviceRevokeInput, @CurrentUser() user: AccessTokenClaims) { return this.devices.revoke(id, user, body.reason); }
}

@Controller('agent/devices')
@RequireStationDevice()
@RequireRoles('OPERADOR')
export class AgentDevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('heartbeat')
  @UsePipes(new ZodValidationPipe(deviceHeartbeatSchema))
  heartbeat(@CurrentDevice() device: DevicePrincipal, @Body() body: DeviceHeartbeatInput, @Req() req: FastifyRequest) {
    return this.devices.heartbeat(device.id, body, req.ip);
  }
}
