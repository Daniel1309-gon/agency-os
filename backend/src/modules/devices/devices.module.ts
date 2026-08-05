import { Module } from '@nestjs/common';
import { DevicesController, AgentDevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({ controllers: [DevicesController, AgentDevicesController], providers: [DevicesService], exports: [DevicesService] })
export class DevicesModule {}
