import { UseGuards, applyDecorators } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { StationDeviceGuard } from './guards.js';

/**
 * Requires an approved STATION-kind device identity, resolved from the mTLS
 * client certificate by the global ClientCertGuard. Administrative devices
 * (for example the owner workstation) are explicitly excluded.
 */
export const RequireStationDevice = () => applyDecorators(
  UseGuards(StationDeviceGuard),
  ApiExtension('x-agency-device', true),
  ApiExtension('x-agency-device-kind', 'STATION'),
);
