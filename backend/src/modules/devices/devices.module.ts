import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DevicesController, AgentDevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({ imports: [AuthModule], controllers: [DevicesController, AgentDevicesController], providers: [DevicesService], exports: [DevicesService] })
export class DevicesModule {}
