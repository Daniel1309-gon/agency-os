import { UseGuards, applyDecorators } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { DeviceTokenGuard } from './guards.js';

export const RequireDevice = () => applyDecorators(
  UseGuards(DeviceTokenGuard),
  ApiExtension('x-agency-device', true),
);
